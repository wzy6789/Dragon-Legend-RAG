import { createSSEParser } from "./sse";
import type { ApiError, ApiErrorKind, RunEvent, RunSnapshot, Tier } from "./types";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export interface RunRequestOptions {
  message: string;
  tier: Tier;
  conversationId: string;
  clientRequestId: string;
  accessKey: string;
  llmApiKey: string;
}

export interface RunEventHandlers {
  onEvent: (type: string, event: RunEvent) => void;
}

export const ERROR_TEXT: Record<ApiErrorKind, string> = {
  auth: "访问密码错误，请重新连接知识库。",
  rate: "当前任务较多，请稍后重试。",
  model: "API Key 无效、额度不足或模型服务不可用。",
  network: "连接中断，正在尝试恢复任务。",
  server: "知识库服务暂时不可用，请稍后重试。",
  unknown: "请求失败，请稍后重试。",
};

function authHeaders(accessKey: string, llmApiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "X-RAG-Access-Key": accessKey };
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

async function throwResponseError(response: Response): Promise<never> {
  let message = "";
  try {
    const body = await response.json() as { detail?: unknown };
    message = typeof body.detail === "string" ? body.detail : "";
  } catch {
    // Keep a stable user-facing message when the bridge returns no JSON body.
  }
  const kind = classifyStatus(response.status);
  const error = new Error(message || ERROR_TEXT[kind]) as Error & { kind?: ApiErrorKind };
  error.kind = kind;
  throw error;
}

export async function createRun(options: RunRequestOptions): Promise<RunSnapshot> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(`${API_BASE}/api/runs`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(options.accessKey, options.llmApiKey),
        },
        body: JSON.stringify({
          message: options.message,
          tier: options.tier,
          conversation_id: options.conversationId,
          client_request_id: options.clientRequestId,
        }),
      });
      break;
    } catch {
      if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
  }
  if (!response) {
    const error = new Error(ERROR_TEXT.network) as Error & { kind?: ApiErrorKind };
    error.kind = "network";
    throw error;
  }
  if (!response.ok) await throwResponseError(response);
  return await response.json() as RunSnapshot;
}

export async function getRun(
  runId: string,
  accessKey: string,
): Promise<RunSnapshot> {
  const response = await fetch(`${API_BASE}/api/runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
    headers: authHeaders(accessKey),
  });
  if (!response.ok) await throwResponseError(response);
  return await response.json() as RunSnapshot;
}

export async function getRunByRequest(
  clientRequestId: string,
  accessKey: string,
): Promise<RunSnapshot> {
  const response = await fetch(`${API_BASE}/api/runs/by-request/${encodeURIComponent(clientRequestId)}`, {
    cache: "no-store",
    headers: authHeaders(accessKey),
  });
  if (!response.ok) await throwResponseError(response);
  return await response.json() as RunSnapshot;
}

/** Attach to a durable server-side run. Aborting this request only detaches the browser. */
export async function subscribeRun(
  runId: string,
  after: number,
  accessKey: string,
  signal: AbortSignal,
  handlers: RunEventHandlers,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/api/runs/${encodeURIComponent(runId)}/events?after=${Math.max(0, after)}`,
    { cache: "no-store", headers: { ...authHeaders(accessKey), Accept: "text/event-stream" }, signal },
  );
  if (!response.ok) await throwResponseError(response);
  if (!response.body) throw new Error(ERROR_TEXT.server);

  const parser = createSSEParser(({ event, data }) => {
    try {
      handlers.onEvent(event, JSON.parse(data) as RunEvent);
    } catch {
      // Ignore a malformed event and continue reading the sequenced stream.
    }
  });
  const reader = response.body.getReader();
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

export async function cancelRun(runId: string, accessKey: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    cache: "no-store",
    headers: authHeaders(accessKey),
  });
  if (!response.ok) await throwResponseError(response);
}

export async function deleteRun(runId: string, accessKey: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/runs/${encodeURIComponent(runId)}`, {
    method: "DELETE",
    cache: "no-store",
    headers: authHeaders(accessKey),
  });
  if (!response.ok) await throwResponseError(response);
}

export async function deleteServerConversation(
  conversationId: string,
  accessKey: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
    cache: "no-store",
    headers: authHeaders(accessKey),
  });
  if (!response.ok) await throwResponseError(response);
}

export async function deleteAllServerConversations(accessKey: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/conversations`, {
    method: "DELETE",
    cache: "no-store",
    headers: authHeaders(accessKey),
  });
  if (!response.ok) await throwResponseError(response);
}

export async function fetchHealth(): Promise<{
  status: string;
  warmed_up: boolean;
  tiers?: Record<string, string>;
}> {
  const response = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
  if (!response.ok) await throwResponseError(response);
  return await response.json();
}

export function asApiError(value: unknown): ApiError {
  const error = value as Error & { kind?: ApiErrorKind };
  return {
    kind: error?.kind ?? "unknown",
    message: error?.message || ERROR_TEXT.unknown,
  };
}
