"use client";

import type { RefObject } from "react";
import type { ChatMessage } from "@/lib/types";
import EmptyState from "./EmptyState";
import MessageItem from "./MessageItem";
import ComparisonGroup from "./ComparisonGroup";

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
  pendingComparison?: { comparisonId?: string; label: string };
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
  pendingComparison,
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
              return <ComparisonGroup key={groupId} messages={messages} comparisonId={groupId} pendingLabel={pendingComparison?.comparisonId===groupId ? pendingComparison.label : undefined} busy={busy} selectedId={selectedId} onInspect={onInspect} onRegenerate={onRegenerate} onDelete={onDeleteMessage} />;
            }
            return <div key={m.id} className={m.role === "assistant" ? `answer-card ${selectedId === m.id ? "is-selected" : ""}` : "question-block"}><MessageItem message={m} onRegenerate={busy ? undefined : onRegenerate} onDelete={onDeleteMessage} onInspect={onInspect} /></div>;
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
    {showLatest && !empty ? (
      <button type="button" onClick={onLatest} className="latest-button" aria-label="回到最新回答">
         回到最新回答
      </button>
    ) : null}
    </div>
  );
}
