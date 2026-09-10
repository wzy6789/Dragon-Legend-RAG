import type { SourceItem, Tier } from "./types";

/** 构建时注入；不要硬编码或替换该地址 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface ChatRequestOptions {
  message: string;
  tier: Tier;
  conversationId?: string;
  accessKey?: string;
  llmApiKey?: string;
  signal?: AbortSignal;
}

export interface StreamHandlers {
  onToken?: (text: string) => void;
  onSources?: (sources: SourceItem[]) => void;
  onDone?: (conversationId: string) => void;
  onError?: (message: string) => void;
}

function authHeaders(accessKey?: string, llmApiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (accessKey) headers["X-RAG-Access-Key"] = accessKey;
  if (llmApiKey) headers["X-LLM-API-Key"] = llmApiKey;
  return headers;
}

function friendlyError(status: number, body: string): string {
  if (status === 401 || status === 403) return "访问密码无效或已过期，请在右上角「设置」中检查。";
  if (status === 429) return "请求过于频繁，请稍后重试。";
  if (status >= 500) return "知识库服务暂时不可用，请稍后重试。";
  const tail = body ? `：${body.slice(0, 160)}` : "";
  return `请求失败（${status}）${tail}`;
}

/**
 * 调用后端 /api/chat（SSE）。
 * 事件：stage / token / sources / done / error
 */
export async function streamChat(
  opts: ChatRequestOptions,
  handlers: StreamHandlers,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(opts.accessKey, opts.llmApiKey),
      },
      body: JSON.stringify({
        message: opts.message,
        tier: opts.tier,
        conversation_id: opts.conversationId ?? null,
      }),
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    handlers.onError?.("无法连接知识库服务，请确认网络后重试。");
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    handlers.onError?.(friendlyError(res.status, text));
    return;
  }
  if (!res.body) {
    handlers.onError?.("响应无流式内容。");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const dispatch = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const lines = trimmed.split("\n");
    const evLine = lines.find((l) => l.startsWith("event:"));
    const dataLine = lines.find((l) => l.startsWith("data:"));
    if (!dataLine) return;
    const event = evLine ? evLine.slice(6).trim() : "message";
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (event) {
      case "token":
        handlers.onToken?.(String(payload.text ?? ""));
        break;
      case "sources":
        handlers.onSources?.((payload.sources as SourceItem[]) ?? []);
        break;
      case "done":
        handlers.onDone?.(String(payload.conversation_id ?? ""));
        break;
      case "error":
        handlers.onError?.(String(payload.message ?? "服务返回错误。"));
        break;
      default:
        break; // stage 等中间事件不再展示
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      dispatch(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) dispatch(buffer);
}

/** 清除后端会话历史（失败静默，不影响前端新对话） */
export async function clearConversation(
  conversationId: string,
  accessKey?: string,
  llmApiKey?: string,
): Promise<void> {
  if (!conversationId) return;
  try {
    await fetch(`${API_BASE}/api/conversations/${encodeURIComponent(conversationId)}/clear`, {
      method: "POST",
      headers: authHeaders(accessKey, llmApiKey),
    });
  } catch {
    /* 静默 */
  }
}
