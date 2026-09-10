import { createSSEParser } from "./sse";
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
  /** 首个 token 到达（用于延迟统计） */
  onFirstToken?: () => void;
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
 * 调用后端 /api/chat（SSE 流式）。
 * 事件：stage / token / sources / done / error
 *
 * 使用增量解析器（兼容 CRLF 与 LF、单分片多事件），保证 token 到达即回调渲染。
 */
export async function streamChat(
  opts: ChatRequestOptions,
  handlers: StreamHandlers,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
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

  let firstTokenSeen = false;

  const parser = createSSEParser(({ event, data }) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (event) {
      case "token": {
        const text = String(payload.text ?? "");
        if (!text) return;
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          handlers.onFirstToken?.();
        }
        handlers.onToken?.(text);
        break;
      }
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
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.flush();
  } finally {
    reader.releaseLock();
  }
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
      cache: "no-store",
      headers: authHeaders(accessKey, llmApiKey),
    });
  } catch {
    /* 静默 */
  }
}
