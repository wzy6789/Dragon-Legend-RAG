import type { ReactNode } from "react";

/**
 * 轻量 Markdown 渲染（零依赖）。
 * 支持：标题、段落、有序/无序列表、引用、表格、分隔线、代码块、行内格式及安全链接。
 * 流式输出下未闭合的标记也能安全降级为纯文本。
 */

function safeHref(href: string): boolean {
  // 不让浏览器规范化控制字符、反斜杠或实体后改变链接协议。
  if (/[\s\u0000-\u001f\u007f-\u009f\\]/.test(href) || href.startsWith("//")) return false;
  if (/&(?:#(?:x[\da-f]+|\d+)|colon|tab|newline);?/i.test(href)) return false;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(href);
  if (scheme) return /^(https?|mailto)$/i.test(scheme[1]);
  // 相对路径首段不能包含冒号；查询参数和锚点内的冒号不受影响。
  return !/^[^/?#]*:/.test(href);
}

function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\\[\\|`*\[\]]|(?<!`)(`+)(?!`)(.+?)\1(?!`)|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-i${i++}`;

    if (token.startsWith("\\")) {
      nodes.push(token.slice(1));
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{match[2]}</code>);
    } else if (token.startsWith("[")) {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (m && safeHref(m[2])) {
        nodes.push(
          <a key={key} href={m[2]} target="_blank" rel="noreferrer noopener">
            {m[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const LIST_UL = /^\s*[-*•]\s+(.*)$/;
const LIST_OL = /^\s*(\d{1,3})[.)、]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])\1{2,}\s*$/;
const QUOTE = /^\s*>\s?/;

function startsBlock(line: string): boolean {
  return line.trimStart().startsWith("```") || HEADING.test(line) || RULE.test(line)
    || QUOTE.test(line) || LIST_UL.test(line) || LIST_OL.test(line);
}

/** 只在代码跨度外拆分未转义的管道符；未闭合代码保留为原文等待下一片输出。 */
function tableRow(line: string): string[] | null {
  const text = line.trim();
  if (!text.includes("|")) return null;
  const cells: string[] = [];
  let cell = "";
  let fence = 0;
  let firstPipe = -1;
  let lastPipe = -1;

  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (char === "\\" && text[i + 1] === "|") {
      cell += "|";
      i += 2;
    } else if (char === "\\" && !fence && i + 1 < text.length) {
      cell += text.slice(i, i + 2);
      i += 2;
    } else if (char === "`") {
      let end = i + 1;
      while (text[end] === "`") end += 1;
      const length = end - i;
      if (!fence) fence = length;
      else if (fence === length) fence = 0;
      cell += text.slice(i, end);
      i = end;
    } else if (char === "|" && !fence) {
      if (firstPipe === -1) firstPipe = i;
      lastPipe = i;
      cells.push(cell.trim());
      cell = "";
      i += 1;
    } else {
      cell += char;
      i += 1;
    }
  }

  if (fence || firstPipe === -1) return null;
  cells.push(cell.trim());
  if (firstPipe === 0) cells.shift();
  if (lastPipe === text.length - 1) cells.pop();
  return cells.length ? cells : null;
}

type Alignment = "left" | "center" | "right" | undefined;

function tableHeader(line: string, delimiter?: string): { cells: string[]; align: Alignment[] } | null {
  if (!delimiter || !/^[\s|:-]+$/.test(delimiter)) return null;
  const markers = tableRow(delimiter);
  if (!markers || !markers.every((cell) => /^:?-+:?$/.test(cell))) return null;
  const cells = tableRow(line);
  if (!cells || cells.length !== markers.length) return null;
  const align: Alignment[] = markers.map((cell) => cell.startsWith(":")
    ? (cell.endsWith(":") ? "center" : "left")
    : (cell.endsWith(":") ? "right" : undefined));
  return { cells, align };
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 代码块
    if (line.trimStart().startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过结束围栏
      blocks.push(
        <pre key={`b${key++}`}>
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // 标题
    const h = HEADING.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 4);
      const content = inline(h[2].trim(), `b${key}`);
      const Tag = (level === 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
      blocks.push(<Tag key={`b${key++}`}>{content}</Tag>);
      i += 1;
      continue;
    }

    // 分隔线
    if (RULE.test(line)) {
      blocks.push(<hr key={`b${key++}`} />);
      i += 1;
      continue;
    }

    // 完整表头和分隔行才启用表格；异常行留给段落分支，避免截断任何内容。
    const header = tableHeader(line, lines[i + 1]);
    if (header && !startsBlock(line)) {
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
        if (tableHeader(lines[i], lines[i + 1])) break;
        const row = tableRow(lines[i]);
        if (!row || row.length !== header.cells.length) break;
        rows.push(row);
        i += 1;
      }
      const tableKey = `b${key++}`;
      blocks.push(
        <div className="markdown-table-scroll" key={tableKey}>
          <table>
            <thead>
              <tr>{header.cells.map((cell, column) => (
                <th key={column} scope="col" style={{ textAlign: header.align[column] }}>
                  {inline(cell, `${tableKey}-h${column}`)}
                </th>
              ))}</tr>
            </thead>
            {rows.length > 0 && <tbody>{rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, column) => (
                <td key={column} style={{ textAlign: header.align[column] }}>
                  {inline(cell, `${tableKey}-r${rowIndex}-c${column}`)}
                </td>
              ))}</tr>
            ))}</tbody>}
          </table>
        </div>,
      );
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`b${key++}`}>{inline(buf.join(" "), `b${key}`)}</blockquote>,
      );
      continue;
    }

    // 列表：保留同一项的缩进续行，不把多行说明拆成多个列表。
    if (LIST_UL.test(line) || LIST_OL.test(line)) {
      const ordered = LIST_OL.test(line);
      const pattern = ordered ? LIST_OL : LIST_UL;
      const List = ordered ? "ol" : "ul";
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i]) && !RULE.test(lines[i])) {
        const item = [pattern.exec(lines[i])![ordered ? 2 : 1]];
        i += 1;
        while (i < lines.length && /^\s+\S/.test(lines[i]) && !startsBlock(lines[i])
          && !tableHeader(lines[i], lines[i + 1]) && !lines[i].trimStart().startsWith("|")) {
          item.push(lines[i].trim());
          i += 1;
        }
        items.push(item.join(" "));
      }
      blocks.push(
        <List key={`b${key++}`}>
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `b${key}-${idx}`)}</li>
          ))}
        </List>,
      );
      continue;
    }

    // 流式表格的残缺行按行显示；不丢失多余单元格，也不把几行挤成一行。
    if (line.includes("|")) {
      const content: ReactNode[] = [];
      const paragraphKey = `b${key++}`;
      while (i < lines.length && lines[i].includes("|") && !startsBlock(lines[i])) {
        if (content.length && tableHeader(lines[i], lines[i + 1])) break;
        if (content.length) content.push(<br key={`${paragraphKey}-br${i}`} />);
        content.push(...inline(lines[i], `${paragraphKey}-${i}`));
        i += 1;
      }
      blocks.push(<p key={paragraphKey}>{content}</p>);
      continue;
    }

    // 段落：合并连续非空行
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !startsBlock(lines[i]) &&
      !lines[i].includes("|")
    ) {
      buf.push(lines[i].trim());
      i += 1;
    }
    blocks.push(<p key={`b${key++}`}>{inline(buf.join(" "), `b${key}`)}</p>);
  }

  return <div className="prose-thread">{blocks}</div>;
}
