"use client";

import type { RefObject } from "react";
import type { ChatMessage } from "@/lib/types";
import EmptyState from "./EmptyState";
import MessageItem from "./MessageItem";

interface Props {
  messages: ChatMessage[];
  /** 正在流式生成的回答（独立渲染，避免整段历史重绘） */
  streamingMessage: ChatMessage | null;
  onPick: (text: string) => void;
  onRegenerate: (messageId: string) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

export default function ChatView({
  messages,
  streamingMessage,
  onPick,
  onRegenerate,
  scrollRef,
  bottomRef,
  onScroll,
}: Props) {
  const empty = messages.length === 0 && !streamingMessage;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
      {empty ? (
        <EmptyState onPick={onPick} />
      ) : (
        <div className="mx-auto w-full max-w-[880px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} onRegenerate={onRegenerate} />
          ))}
          {streamingMessage ? (
            <MessageItem key="streaming" message={streamingMessage} />
          ) : null}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
