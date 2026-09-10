import type { ApiError, ApiErrorKind, SourceItem, Tier } from "./types";

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
  onError?: (error: ApiError) => void;
}

/** 面向用户的错误文案（按类型归一化） */
export const ERROR_TEXT: Record<ApiErrorKind, string> = {
  auth: "访问密码错误",
  rate: "请求过于频繁，请稍后重试",
  model: "API Key 无效、额度不足或模型服务不可用",
  network: "无法连接知识库服务，请检查网络后重试",
  server: "知识库服务暂时不可用，请稍后重试",
  unknown: "请求失败，请稍后重试",
};

function authHeaders(accessKey?: string, llmApiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (accessKey) headers["X-RAG-Access-Key"] = accessKey;
  if (llmApiKey) headers["X-LLM-API-Key"] = llmApiKey;
  return headers;
}

function classifyStatus(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";
  if (status === 400 || status === 402 || status === 422) return "model";
  if (status >= 500) return "server";
  return "unknown";
}

/** 对纯文本错误信息做归类（用于 SSE error 事件） */
export function classifyText(text: string): ApiErrorKind {
  const t = text.toLowerCase();
  if (/401|403|unauthor|forbidden|访问密码|密码|access.?key/.test(t)) return "auth";
  if (/429|too many|rate.?limit|频繁/.test(t)) return "rate";
  if (/api.?key|额度|quota|insufficient|balance|invalid.?key|模型|model|deepseek/.test(t)) return "model";
  if (/timeout|timed out|network|fetch|connect|连接/.test(t)) return "network";
  return "server";
}

function toError(kind: ApiErrorKind): ApiError {
  return { kind, message: ERROR_TEXT[kind] };
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
    handlers.onError?.(toError("network"));
    return;
  }

  if (!res.ok) {
    handlers.onError?.(toError(classifyStatus(res.status)));
    return;
  }
  if (!res.body) {
    handlers.onError?.(toError("server"));
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
        handlers.onError?.(toError(classifyText(String(payload.message ?? ""))));
        break;
      default:
        break; // stage 等中间事件不展示
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

/** 清除后端会话历史（新对话时调用；失败静默） */
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
