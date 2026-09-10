"use client";

import type { RefObject } from "react";
import type { ChatMessage } from "@/lib/types";
import EmptyState from "./EmptyState";
import MessageItem from "./MessageItem";

interface Props {
  messages: ChatMessage[];
  onPick: (text: string) => void;
  onRegenerate: (messageId: string) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

/** 对话内容区：主区内部保持舒适阅读宽度（页面本身全宽） */
export default function ChatView({
  messages,
  onPick,
  onRegenerate,
  scrollRef,
  bottomRef,
  onScroll,
}: Props) {
  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
      {messages.length === 0 ? (
        <EmptyState onPick={onPick} />
      ) : (
        <div className="mx-auto w-full max-w-[880px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} onRegenerate={onRegenerate} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
