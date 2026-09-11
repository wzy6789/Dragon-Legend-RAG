/**
 * SSE 解析器（纯函数，零依赖，便于单测）。
 *
 * 关键点：
 * - 兼容 CRLF（`\r\n\r\n`）与 LF（`\n\n`）事件分隔 —— 只按 `\n\n` 切分会把整个响应
 *   缓冲到流结束才渲染，表现为"没有流式输出"。
 * - 一个 chunk 内可包含多个事件（必须全部派发）。
 * - 一个事件块内允许多行 `data:`（按 SSE 规范以 `\n` 连接）。
 */

export interface SSEEvent {
  event: string;
  data: string;
}

export interface SSEParser {
  /** 送入一个网络分片 */
  push(chunk: string): void;
  /** 流结束后清理尾部残留 */
  flush(): void;
}

export function createSSEParser(onEvent: (ev: SSEEvent) => void): SSEParser {
  let buffer = "";

  const emit = (block: string) => {
    if (!block.trim()) return;
    let event = "message";
    const dataLines: string[] = [];
    for (const rawLine of block.split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.startsWith(":")) continue; // 注释行
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) return;
    onEvent({ event, data: dataLines.join("\n") });
  };

  return {
    push(chunk: string) {
      // 归一化 CRLF；若分片正好切在 \r 与 \n 之间，下一片补齐后同样会被归一化
      buffer = (buffer + chunk).replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        emit(block);
      }
    },
    flush() {
      if (buffer.trim()) emit(buffer);
      buffer = "";
    },
  };
}
