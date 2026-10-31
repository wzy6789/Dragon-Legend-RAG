"use client";

import type { RefObject } from "react";
import type { ChatMessage } from "@/lib/types";
import EmptyState from "./EmptyState";
import MessageItem from "./MessageItem";
import ComparisonResults from "./ComparisonResults";

interface Props {
  messages: ChatMessage[];
  onPick: (text: string) => void;
  onRegenerate: (messageId: string) => void;
  onDeleteMessage: (messageId: string) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  showLatest: boolean;
  onLatest: () => void;
  onInspect: (id: string) => void;
  selectedId?: string;
  busy: boolean;
  comparisonPending?: boolean;
}

export default function ChatView({
  messages,
  onPick,
  onRegenerate,
  onDeleteMessage,
  scrollRef,
  bottomRef,
  onScroll,
  showLatest,
  onLatest,
  onInspect,
  selectedId,
  busy,
  comparisonPending,
}: Props) {
  const empty = messages.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {empty ? (
        <EmptyState onPick={onPick} />
      ) : (
        <div className="research-thread">
          {messages.map((m, index) => {
            const groupId = m.role === "assistant" ? m.research?.comparisonId : undefined;
            if (groupId) {
              if (messages.slice(0, index).some((message) => message.role === "assistant" && message.research?.comparisonId === groupId)) return null;
              const group = messages.filter((message) => message.role === "assistant" && message.research?.comparisonId === groupId);
              return <section className="comparison-group" key={groupId}><div className="comparison-heading"><span>顺序比较</span><span>A → B · 相同问题与协议</span></div><div className="comparison-grid">{group.map((message, position) => <div key={message.id} className={selectedId === message.id ? "answer-card is-selected" : "answer-card"}><span className="comparison-position">系统 {String.fromCharCode(65 + position)}</span><MessageItem message={message} onRegenerate={busy ? undefined : onRegenerate} onDelete={onDeleteMessage} onInspect={onInspect} /></div>)}{group.length === 1 && comparisonPending && <div className="comparison-waiting"><span className="comparison-position">系统 B</span><p>等待系统 A 结束后运行</p><span>切换会话后仍将继续</span></div>}</div><ComparisonResults messages={messages} comparisonId={groupId} /></section>;
            }
            return <div key={m.id} className={m.role === "assistant" ? `answer-card ${selectedId === m.id ? "is-selected" : ""}` : "question-block"}><MessageItem message={m} onRegenerate={busy ? undefined : onRegenerate} onDelete={onDeleteMessage} onInspect={onInspect} /></div>;
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
    {showLatest && !empty ? (
      <button type="button" onClick={onLatest} className="latest-button" aria-label="回到最新回答">
        <span aria-hidden="true">↓</span> 回到最新回答
      </button>
    ) : null}
    </div>
  );
}
