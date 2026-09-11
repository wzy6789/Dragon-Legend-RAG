export type Tier = "flash" | "pro" | "max";

export interface SourceItem {
  chapter_index?: number | null;
  chapter: string;
  title: string;
  snippet: string;
}

export type ChatRole = "user" | "assistant";

export type MessageStatus = "streaming" | "done" | "error" | "stopped";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  tier?: Tier;
  sources?: SourceItem[];
  status?: MessageStatus;
  error?: string;
}

/** 会话级凭据：仅保存在 React 内存中，绝不写入 storage / URL / 日志 */
export interface SessionCredentials {
  accessKey: string;
  llmApiKey: string;
}
