export type Tier = "flash" | "pro";

export type StageName =
  | "拆解问题"
  | "检索章节"
  | "核验证据"
  | "组织回答";

export interface SourceItem {
  chapter_index?: number | null;
  chapter: string;
  title: string;
  snippet: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  tier?: Tier; // assistant 消息使用的档位
  sources?: SourceItem[];
  stages?: StageName[]; // pro 模式下经历过的阶段（用于渲染进度痕迹）
  done?: boolean;
  error?: string;
}
