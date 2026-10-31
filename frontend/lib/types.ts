export type Tier = "flash" | "pro" | "max";
export type BenchmarkId = "free" | "new49" | "legacy50" | "flashbench";

export interface ResearchSystem {
  id: string;
  family: string;
  version: string;
  variant: string;
  label: string;
  tiers: string[];
  status: "runnable" | "pending" | "archive";
  source: string;
  notes: string;
  config: Record<string, unknown>;
  results: unknown[];
}

export interface SystemRegistry {
  systems: ResearchSystem[];
  defaults: Record<Tier, string>;
}

export interface BenchmarkQuestion {
  id: string;
  question: string;
  type?: string;
  runnable?: boolean;
  reason?: string;
  context?: unknown;
}

export interface Benchmark {
  id: BenchmarkId;
  label: string;
  protocol_id: string;
  questions: BenchmarkQuestion[];
}

export interface Evaluation {
  id: string;
  status: string;
  judge_model?: string | null;
  protocol_id?: string | null;
  scorer_fingerprint?: string | null;
  scorer_identity?: {
    source_fingerprints?: Record<string, unknown>;
    prompt_sha256?: string;
    weights?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  score?: number | null;
  score_scale?: number | null;
  type?: string | null;
  dimensions?: Record<string, unknown> | null;
  weights?: Record<string, unknown> | null;
  reasons?: unknown;
  raw?: unknown;
  error?: string | null;
  created_at?: string | number | null;
  finished_at?: string | number | null;
}

export interface Experiment {
  system_id?: string | null;
  system_snapshot?: Partial<ResearchSystem> | null;
  generation_model?: string | null;
  benchmark_id?: BenchmarkId | null;
  question_id?: string | null;
  protocol_id?: string | null;
  answer_hash?: string | null;
  context_hash?: string | null;
  context_snapshot?: unknown[] | { messages?: unknown[]; messages_hash?: string; [key: string]: unknown } | null;
  metrics?: {
    queue_ms?: number | null;
    execution_ms?: number | null;
    ttft_ms?: number | null;
    draft_ttft_ms?: number | null;
    e2e_ms?: number | null;
    retrieval_ms?: number | null;
    initialization_ms?: number | null;
    client_prepare_ms?: number | null;
    engine_first_token_ms?: number | null;
    model_first_token_ms?: number | null;
    delivery_mode?: string | null;
  } | null;
  timeline?: { event: string; at_ms: number; stage?: string }[];
  evaluations?: Evaluation[];
}

/** No credentials: safe to persist with the conversation and recover a comparison. */
export interface ResearchRequest {
  systemId: string;
  benchmarkId: BenchmarkId;
  questionId: string | null;
  protocolId?: string;
  comparisonId?: string;
  comparisonParentRunId?: string;
  question?: string;
  questionType?: string;
}

export interface ComparisonTask extends ResearchRequest {
  prompt: string;
  tier: Tier;
  afterMessageId: string;
}

export interface BrowserDelivery {
  firstContentMs?: number;
  completedMs?: number;
  observedFrom: "submission" | "reattachment";
}

export interface ArchiveBatch {
  id: string;
  version: string;
  bank: string;
  label: string;
  question_count: number;
  scored_questions: number;
}

export interface ArchiveDocument {
  id: string;
  version: string;
  bank: string;
  label: string;
  markdown: string;
}

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
  research?: ResearchRequest;
  experiment?: Experiment;
  browserDelivery?: BrowserDelivery;
  createdAt: number;
}

/** 本地会话（持久化到 IndexedDB；不包含 API Key 等凭据） */
export interface Conversation {
  id: string;
  title: string;
  tier: Tier;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  compareQueue?: ComparisonTask[];
}

/** 会话级凭据：仅存在于 React 内存，刷新即失效 */
export interface SessionCredentials {
  apiKey: string;
}

export type ApiErrorKind = "auth" | "rate" | "model" | "network" | "server" | "unknown";

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  status?: number;
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
  experiment?: Experiment;
}

export interface RunEvent {
  run_id: string;
  seq: number;
  [key: string]: unknown;
}
