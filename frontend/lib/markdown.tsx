import type { ReactNode } from "react";

/**
 * 轻量 Markdown 渲染（零依赖）。
 * 支持：标题、段落、有序/无序列表、引用、分隔线、代码块、行内粗体/斜体/行内代码/链接。
 * 流式输出下未闭合的标记也能安全降级为纯文本。
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyBase}-i${i++}`;

    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (m) {
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
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={`b${key++}`} />);
      i += 1;
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

    // 无序列表
    if (LIST_UL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && LIST_UL.test(lines[i])) {
        items.push(LIST_UL.exec(lines[i])![1]);
        i += 1;
      }
      blocks.push(
        <ul key={`b${key++}`}>
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `b${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // 有序列表
    if (LIST_OL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && LIST_OL.test(lines[i])) {
        items.push(LIST_OL.exec(lines[i])![2]);
        i += 1;
      }
      blocks.push(
        <ol key={`b${key++}`}>
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `b${key}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // 段落：合并连续非空行
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trimStart().startsWith("```") &&
      !HEADING.test(lines[i]) &&
      !LIST_UL.test(lines[i]) &&
      !LIST_OL.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      buf.push(lines[i].trim());
      i += 1;
    }
    blocks.push(<p key={`b${key++}`}>{inline(buf.join(" "), `b${key}`)}</p>);
  }

  return <div className="prose-thread">{blocks}</div>;
}
