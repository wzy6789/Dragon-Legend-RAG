export type Tier = "flash" | "pro" | "max";

export interface SourceItem {
  chapter_index?: number | null;
  chapter: string;
  title: string;
  snippet: string;
}

export type ChatRole = "user" | "assistant";

export type MessageStatus =
  | "queued"
  | "running"
  | "streaming"
  | "reviewing"
  | "done"
  | "error"
  | "stopped"
  | "interrupted";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** assistant 消息使用的档位（用于消息标签） */
  tier?: Tier;
  version?: string;
  sources?: SourceItem[];
  status?: MessageStatus;
  error?: string;
  runId?: string;
  clientRequestId?: string;
  lastSeq?: number;
  stage?: string;
  provisional?: boolean;
  completionStatus?: string;
  warning?: string;
  createdAt: number;
}

/** 本地会话（持久化到 IndexedDB；绝不包含访问密码 / API Key 等凭据） */
export interface Conversation {
  id: string;
  title: string;
  tier: Tier;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

/** 会话级凭据：仅存在于 React 内存，刷新即失效 */
export interface SessionCredentials {
  accessKey: string;
  llmApiKey: string;
}

export type ApiErrorKind = "auth" | "rate" | "model" | "network" | "server" | "unknown";

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
}

export interface RunSnapshot {
  run_id: string;
  conversation_id: string;
  tier: Tier;
  version: string;
  status: string;
  stage: string;
  answer: string;
  draft: string;
  sources: SourceItem[];
  completion_status: string;
  warning: string;
  error: string;
  seq: number;
}

export interface RunEvent {
  run_id: string;
  seq: number;
  [key: string]: unknown;
}
