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
}

export default function ChatView({
  messages,
  onPick,
  onRegenerate,
  onDeleteMessage,
  scrollRef,
  bottomRef,
  onScroll,
}: Props) {
  const empty = messages.length === 0;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      {empty ? (
        <EmptyState onPick={onPick} />
      ) : (
        <div className="mx-auto w-full max-w-[980px] space-y-8 px-4 py-7 sm:px-8 sm:py-10">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} onRegenerate={onRegenerate} onDelete={onDeleteMessage} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
