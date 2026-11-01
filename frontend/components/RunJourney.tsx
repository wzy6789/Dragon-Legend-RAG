import type { ChatMessage } from "../lib/types";
import { groupTimeline, type JourneyEvent } from "../lib/visual-metrics";
import { formatMs, comparisonRunStatus } from "../lib/workbench";

const STATUS: Record<string, string> = {
  queued: "排队中", running: "执行中", streaming: "正在交付文字", reviewing: "核验中", judging: "评测中",
  done: "运行完成", error: "运行失败", stopped: "已停止", interrupted: "已中断",
};

function EventRecord({ item }: { item: JourneyEvent }) {
  return <div><span className="journey-time">{item.atMs === null ? "时间未记录" : `${item.atMs} ms`}</span><span className="journey-raw">{item.label} · {item.event}{item.stage ? ` · ${item.stage}` : ""}</span></div>;
}

export default function RunJourney({ message, compact = false }: { message: ChatMessage; compact?: boolean }) {
  const groups = groupTimeline(message);
  const active = ["queued", "running", "streaming", "reviewing"].includes(message.status ?? "");
  const status = message.status === "done" ? comparisonRunStatus(message) : message.status ? STATUS[message.status] ?? message.status : "状态未记录";
  const content = <>
    {active && message.stage && <p className="journey-current" role="status">当前状态：{message.stage} <span className="journey-time">时间未记录</span></p>}
    {groups.length ? <ol className="journey-list">{groups.map((group, index) => <li className="journey-item" data-phase={group.phase} key={`${index}-${group.phase}`}>
      <span className="journey-marker" aria-hidden="true" />
      <div className="journey-content"><details className="journey-stage-card"><summary>
        <span className="journey-step-index">{String(index + 1).padStart(2, "0")}</span><span className="journey-stage-title"><strong className="journey-phase">{group.label}</strong><span className="journey-count">{group.events.length} 条{group.noisy ? "交付" : "公开"}记录</span></span><span className="journey-time" title="该组首条记录的时间点，并非阶段耗时">{group.events[0].atMs === null ? "未计时" : formatMs(group.events[0].atMs)}</span>
      </summary><div className="journey-events">{group.events.map((item, itemIndex) => <EventRecord item={item} key={itemIndex} />)}</div></details>
      </div>
    </li>)}</ol> : <p className="journey-empty">过程事件未记录</p>}
    <p className="journey-note">公开执行记录；点击阶段查看原始事件。</p>
    <details className="journey-method"><summary>时间与记录口径</summary><p className="journey-note">时间为上报时间点，并非阶段耗时。展开后保留后端 at_ms 原值；阶段上报不代表完成，不推算阶段耗时。这里不包含模型私有思维链。</p></details>
  </>;
  return <section className={`journey${compact ? " journey-compact" : ""}`} aria-label="可观测运行过程">
    {compact ? <details className="journey-disclosure"><summary>{groups.length ? `运行过程 · ${groups.length} 个阶段` : active ? "等待过程记录" : "过程未记录"}<span className="journey-status">{status}</span></summary>{content}</details>
      : <><div className="journey-header"><h3>运行过程</h3><span className="journey-status">{status}</span></div>{content}</>}
  </section>;
}
