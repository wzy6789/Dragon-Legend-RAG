import type { Conversation } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** 由首条问题生成对话标题 */
export function makeTitle(question: string, max = 22): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (!clean) return "新对话";
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface HistoryGroup {
  label: "今天" | "昨天" | "过去 7 天" | "更早";
  items: Conversation[];
}

/** 按 今天 / 昨天 / 过去 7 天 / 更早 分组（组内按更新时间倒序） */
export function groupConversations(conversations: Conversation[]): HistoryGroup[] {
  const now = Date.now();
  const today = startOfDay(now);
  const buckets: Record<HistoryGroup["label"], Conversation[]> = {
    今天: [],
    昨天: [],
    "过去 7 天": [],
    更早: [],
  };

  for (const c of conversations) {
    const d = startOfDay(c.updatedAt);
    if (d >= today) buckets["今天"].push(c);
    else if (d >= today - DAY) buckets["昨天"].push(c);
    else if (d >= today - 7 * DAY) buckets["过去 7 天"].push(c);
    else buckets["更早"].push(c);
  }

  return (["今天", "昨天", "过去 7 天", "更早"] as const)
    .map((label) => ({
      label,
      items: buckets[label].sort((a, b) => b.updatedAt - a.updatedAt),
    }))
    .filter((g) => g.items.length > 0);
}

/** 侧栏显示用的简短时间 */
export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return "刚刚";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  const d = startOfDay(ts);
  const today = startOfDay(Date.now());
  if (d === today) return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (d === today - DAY) return "昨天";
  if (d >= today - 7 * DAY) return `${Math.floor((today - d) / DAY)} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/** 按标题或消息内容筛选 */
export function filterConversations(conversations: Conversation[], query: string): Conversation[] {
  const q = query.trim().toLowerCase();
  if (!q) return conversations;
  return conversations.filter((c) => {
    if (c.title.toLowerCase().includes(q)) return true;
    return c.messages.some((m) => m.content.toLowerCase().includes(q));
  });
}
