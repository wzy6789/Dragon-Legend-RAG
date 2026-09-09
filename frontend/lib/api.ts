import type { SourceItem, Tier } from "./types";

export interface ChatRequestOptions {
  message: string;
  tier: Tier;
  conversationId?: string;
  signal?: AbortSignal;
}

export interface StreamHandlers {
  onStage?: (stage: string) => void;
  onToken?: (text: string) => void;
  onSources?: (sources: SourceItem[]) => void;
  onDone?: (conversationId: string) => void;
  onError?: (message: string) => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * 向后端发起 SSE 聊天流。
 * 事件：stage / token / sources / done / error
 */
export async function streamChat(
  opts: ChatRequestOptions,
  handlers: StreamHandlers,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: opts.message,
      tier: opts.tier,
      conversation_id: opts.conversationId ?? null,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    handlers.onError?.(`请求失败（${res.status}）${text ? `：${text.slice(0, 160)}` : ""}`);
    return;
  }
  if (!res.body) {
    handlers.onError?.("响应无流式内容");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const dispatch = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const evLine = trimmed.split("\n").find((l) => l.startsWith("event:"));
    const dataLine = trimmed.split("\n").find((l) => l.startsWith("data:"));
    if (!dataLine) return;
    const event = evLine ? evLine.slice(6).trim() : "message";
    const data = dataLine.slice(5).trim();
    let payload: unknown = null;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    const p = payload as Record<string, unknown>;
    switch (event) {
      case "stage":
        handlers.onStage?.(String(p.stage ?? ""));
        break;
      case "token":
        handlers.onToken?.(String(p.text ?? ""));
        break;
      case "sources":
        handlers.onSources?.((p.sources as SourceItem[]) ?? []);
        break;
      case "done":
        handlers.onDone?.(String(p.conversation_id ?? ""));
        break;
      case "error":
        handlers.onError?.(String(p.message ?? "未知错误"));
        break;
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE 事件以空行分隔
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      dispatch(block);
    }
  }
  // 尾部残留（无空行结尾时）
  if (buffer.trim()) dispatch(buffer);
}

export async function clearConversation(conversationId: string): Promise<void> {
  if (!conversationId) return;
  await fetch(`${API_BASE}/api/conversations/${encodeURIComponent(conversationId)}/clear`, {
    method: "POST",
  }).catch(() => undefined);
}

export async function uploadFile(file: File): Promise<{ ok: boolean; message: string }> {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch(`${API_BASE}/api/uploads`, { method: "POST", body: fd });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string };
    if (!res.ok) return { ok: false, message: data.detail ?? `上传失败（${res.status}）` };
    return { ok: true, message: `已保存：${file.name}` };
  } catch {
    return { ok: false, message: "上传请求失败（后端不可达）" };
  }
}
