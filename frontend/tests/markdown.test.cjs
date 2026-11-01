const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const previousLoader = require.extensions['.tsx'];
require.extensions['.tsx'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText, filename);
};
const { Markdown } = require('../lib/markdown.tsx');
if (previousLoader) require.extensions['.tsx'] = previousLoader;
else delete require.extensions['.tsx'];

const render = (text) => renderToStaticMarkup(React.createElement(Markdown, { text }));
const cells = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>(.*?)</${tag}>`, 'gs'))]
  .map((match) => match[1]);
const visibleText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('comparison tables have semantic headers/body, alignment and a local scrolling hook', () => {
  const html = render([
    '| Model | Evidence | Score | Notes |',
    '| :--- | :---: | ---: | --- |',
    '| Flash | **原文** | 89 | *fast* |',
    '| Pro | `citation` | 92 | [source](https://example.com) |',
  ].join('\n'));
  assert.match(html, /<div class="markdown-table-scroll"><table>/);
  assert.match(html, /<thead><tr>.*<\/tr><\/thead><tbody><tr>/);
  assert.match(html, /<th\b[^>]*scope="col"[^>]*style="text-align:left"[^>]*>Model<\/th>/);
  assert.match(html, /<th\b[^>]*style="text-align:center"[^>]*>Evidence<\/th>/);
  assert.match(html, /<th\b[^>]*style="text-align:right"[^>]*>Score<\/th>/);
  assert.match(html, /<td\b[^>]*style="text-align:center"[^>]*><strong>原文<\/strong><\/td>/);
  assert.match(html, /<td\b[^>]*style="text-align:right"[^>]*>89<\/td>/);
  assert.deepEqual(cells(html, 'th'), ['Model', 'Evidence', 'Score', 'Notes']);
  assert.equal(cells(html, 'td').length, 8);
  assert.ok(cells(html, 'td').includes('<em>fast</em>'));
  assert.ok(cells(html, 'td').includes('<code>citation</code>'));
  assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noreferrer noopener">source<\/a>/);
});

test('tables accept omitted edge pipes, short GFM delimiters, CRLF and no preceding blank line', () => {
  const html = render('Summary\r\nModel | Score\r\n:-: | -:\r\nFlash | 89\r\n\r\nAfter');
  assert.match(html, /<p>Summary<\/p><div class="markdown-table-scroll">/);
  assert.deepEqual(cells(html, 'th'), ['Model', 'Score']);
  assert.deepEqual(cells(html, 'td'), ['Flash', '89']);
  assert.match(html, /<\/table><\/div><p>After<\/p>/);
});

test('escaped pipes and single or multiple backtick spans stay inside their cells', () => {
  const html = render([
    String.raw`| Case\|name | Expression |`,
    '| --- | --- |',
    '| alpha | `a | b` |',
    '| beta | ``a ` | b`` |',
    String.raw`| gamma | **left\|right** |`,
    '| delta | `x\\|y` |',
    String.raw`| epsilon | ending\|`,
    String.raw`| slash\\| last |`,
  ].join('\n'));
  assert.deepEqual(cells(html, 'th'), ['Case|name', 'Expression']);
  assert.deepEqual(cells(html, 'td'), [
    'alpha', '<code>a | b</code>',
    'beta', '<code>a ` | b</code>',
    'gamma', '<strong>left|right</strong>',
    'delta', '<code>x|y</code>',
    'epsilon', 'ending|',
    'slash\\', 'last',
  ]);
});

test('single-column tables and explicit empty body cells retain their structure', () => {
  assert.deepEqual(cells(render('| Model |\n| --- |\n| Flash |'), 'td'), ['Flash']);
  const html = render('| A | B |\n| --- | --- |\n| value | |\n| | value |');
  assert.deepEqual(cells(html, 'td'), ['value', '', '', 'value']);
  assert.equal((html.match(/<tbody><tr>|<\/tr><tr>/g) || []).length, 2);
});

test('invalid or incomplete table headers remain readable text with every row', () => {
  for (const text of [
    '| Model | Score |\n| --',
    '| Model | Score |\n| --- | :',
    '| Model | Score |\n| --- |\n| Flash | 89 |',
    '| Model | Score |\n| --- | nope |\n| Flash | 89 |',
    '| Model | `Score |\n| --- | --- |\n| Flash | 89 |',
  ]) {
    const html = render(text);
    assert.doesNotMatch(html, /<table>/, text);
    for (const row of text.split('\n')) assert.ok(html.includes(row), row);
    assert.equal((html.match(/<br\s*\/>/g) || []).length, text.split('\n').length - 1);
  }
});

test('an incomplete body row falls back after complete rows without swallowing later content', () => {
  for (const partial of ['| Pro', '| Pro | `unfinished', '| Pro | 93 | extra-evidence |']) {
    const html = render(`| Model | Score |\n| --- | --- |\n| Flash | 89 |\n${partial}\n# Next\nEnd`);
    assert.deepEqual(cells(html, 'td'), ['Flash', '89']);
    assert.ok(html.includes(`<p>${partial}</p>`), html);
    assert.match(html, /<h2>Next<\/h2><p>End<\/p>/);
    assert.ok(html.indexOf('Flash') < html.indexOf('Pro'));
  }
});

test('every streamed prefix preserves already received table content', () => {
  const complete = '| Model | Score |\n| --- | ---: |\n| Flash | 89 |\n| Pro | 92 |';
  for (let end = 0; end <= complete.length; end += 1) {
    const prefix = complete.slice(0, end);
    const visible = visibleText(render(prefix));
    for (const token of prefix.match(/[A-Za-z0-9]+/g) || []) {
      assert.ok(visible.includes(token), `Lost ${token} at prefix ${end}: ${visible}`);
    }
  }
  assert.deepEqual(cells(render(complete), 'td'), ['Flash', '89', 'Pro', '92']);
});

test('table bodies stop at headings, lists, quotes, rules, fences and another table', () => {
  const table = '| A | B |\n| --- | --- |\n| one | two |\n';
  for (const [suffix, expected] of [
    ['# Heading | text', /<h2>Heading \| text<\/h2>/],
    ['- item | text\n- next', /<ul><li>item \| text<\/li><li>next<\/li><\/ul>/],
    ['1. item | text\n2. next', /<ol><li>item \| text<\/li><li>next<\/li><\/ol>/],
    ['> quoted | text', /<blockquote>quoted \| text<\/blockquote>/],
    ['---\nAfter', /<hr\/><p>After<\/p>/],
    ['```\ncode | text\n```', /<pre><code>code \| text<\/code><\/pre>/],
  ]) {
    const html = render(table + suffix);
    assert.deepEqual(cells(html, 'td'), ['one', 'two']);
    assert.match(html, expected);
  }
  const adjacent = render(table + '| C | D |\n| --- | --- |\n| three | four |');
  assert.equal((adjacent.match(/<table>/g) || []).length, 2);
  assert.deepEqual(cells(adjacent, 'td'), ['one', 'two', 'three', 'four']);
});

test('headings, paragraphs, multiline lists, quotes and code remain readable around tables', () => {
  const html = render([
    '# Title', '## Subheading', '### Detail', '',
    'A **bold** and *italic* paragraph.', 'Second line.', '',
    '- first **item**', '  continued with `code`', '- second item', '',
    '1. first numbered', '   continuation', '2. second numbered', '',
    '> quoted **text**', '> next line', '', '---', '',
    '```md', '| not | a table |', '| --- | --- |', '<script>code</script>', '```',
  ].join('\n'));
  assert.match(html, /<h2>Title<\/h2><h3>Subheading<\/h3><h4>Detail<\/h4>/);
  assert.match(html, /<p>A <strong>bold<\/strong> and <em>italic<\/em> paragraph\. Second line\.<\/p>/);
  assert.match(html, /<ul><li>first <strong>item<\/strong> continued with <code>code<\/code><\/li><li>second item<\/li><\/ul>/);
  assert.match(html, /<ol><li>first numbered continuation<\/li><li>second numbered<\/li><\/ol>/);
  assert.match(html, /<blockquote>quoted <strong>text<\/strong> next line<\/blockquote>/);
  assert.match(html, /<hr\/>/);
  assert.match(html, /<pre><code>\| not \| a table \|\n\| --- \| --- \|\n&lt;script&gt;code&lt;\/script&gt;<\/code><\/pre>/);
  assert.doesNotMatch(html, /<table>/);
});

test('unfinished fences and inline markers keep their text during streaming', () => {
  assert.match(render('```js\nconst value = "<tag>";'), /<pre><code>const value = &quot;&lt;tag&gt;&quot;;<\/code><\/pre>/);
  for (const text of ['**unfinished', '*unfinished', '`unfinished', '[source](https://exam']) {
    assert.equal(visibleText(render(text)), text);
  }
});

test('raw HTML is escaped in paragraphs, headers, cells and code', () => {
  const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  for (const text of [
    payload,
    `# ${payload}`,
    `| ${payload} | Note |\n| --- | --- |\n| ${payload} | safe |`,
    `\`\`\`html\n${payload}\n\`\`\``,
  ]) {
    const html = render(text);
    assert.doesNotMatch(html, /<(?:script|img|iframe|svg)\b/i);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/);
  }
});

test('http, https, mailto, local paths, queries and anchors remain actionable', () => {
  for (const href of [
    'http://example.com', 'https://example.com/path?q=1#part', 'HTTPS://example.com',
    'mailto:reader@example.com', '/archive/49', './source', '../source', 'source/chapter',
    '#evidence', '?page=2', '/search?q=javascript:example', 'chapter%20one',
  ]) {
    const html = render(`[source](${href})`);
    assert.match(html, /<a\b/);
    assert.ok(html.includes(`href="${href}"`), href);
    assert.match(html, /rel="noreferrer noopener"/);
  }
});

test('unsafe and obfuscated destinations never become actionable links in any block', () => {
  for (const href of [
    'javascript:alert(1)', 'JaVaScRiPt:alert%281%29', 'data:text/html,evil',
    'vbscript:evil', 'file:///C:/secret', 'blob:https://example.com/id',
    '//example.com', '\\\\example.com', '/\\example.com', 'java\u0000script:evil',
    'java\tscript:evil', 'java\rscript:evil', 'javascript&#58;evil',
    'jav&#x61;script:evil', 'javascript&colon;evil', '%6aavascript:evil',
  ]) {
    const link = `[unsafe](${href})`;
    for (const text of [link, `- ${link}`, `> ${link}`, `| Value |\n| --- |\n| ${link} |`]) {
      const html = render(text);
      assert.doesNotMatch(html, /<a\b/i, href);
      assert.ok(html.includes('unsafe'), href);
    }
  }
});

test('partial unsafe links remain inert at every stream boundary', () => {
  for (const link of ['[unsafe](javascript:alert(1))', '[unsafe](data:text/html,evil)']) {
    for (let end = 1; end <= link.length; end += 1) {
      assert.doesNotMatch(render(link.slice(0, end)), /<a\b/i);
    }
  }
});
