"use client";

import type { RefObject } from "react";
import type { ChatMessage } from "@/lib/types";
import EmptyState from "./EmptyState";
import MessageItem from "./MessageItem";

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
}: Props) {
  const empty = messages.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {empty ? (
        <EmptyState onPick={onPick} />
      ) : (
        <div className="conversation-column mx-auto w-full space-y-10 px-4 py-7 sm:px-8 sm:py-10">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} onRegenerate={onRegenerate} onDelete={onDeleteMessage} />
          ))}
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
