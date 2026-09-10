"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearConversation, streamChat } from "@/lib/api";
import type { ChatMessage, SessionCredentials, Tier } from "@/lib/types";
import AppHeader from "./AppHeader";
import Composer from "./Composer";
import MessageItem from "./MessageItem";
import SettingsDialog from "./SettingsDialog";
import WelcomeScreen from "./WelcomeScreen";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [tier, setTier] = useState<Tier>("flash");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [connected, setConnected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 凭据仅存在于 React 内存：不写入 localStorage / sessionStorage / URL
  const [creds, setCreds] = useState<SessionCredentials>({
    accessKey: "",
    llmApiKey: "",
  });

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);

  // 滚动跟随：仅在用户停留在底部附近时自动滚动
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    const onScroll = () => {
      const scroller = document.scrollingElement ?? document.documentElement;
      const remaining = scroller.scrollHeight - scroller.scrollTop - window.innerHeight;
      stickToBottomRef.current = remaining < 120;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const patch = useCallback((id: string, next: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...next } : m)));
  }, []);

  const appendToken = useCallback((id: string, text: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + text } : m)),
    );
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    const assistantId = newId();
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: "user", content: text },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        tier,
        sources: [],
        status: "streaming",
      },
    ]);
    setInput("");
    setBusy(true);
    stickToBottomRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        {
          message: text,
          tier,
          conversationId: conversationId || undefined,
          accessKey: creds.accessKey || undefined,
          llmApiKey: creds.llmApiKey || undefined,
          signal: controller.signal,
        },
        {
          onToken: (t) => appendToken(assistantId, t),
          onSources: (sources) => patch(assistantId, { sources }),
          onDone: (cid) => {
            if (cid) setConversationId(cid);
            patch(assistantId, { status: "done" });
            setConnected(true);
          },
          onError: (message) => {
            patch(assistantId, { status: "error", error: message });
            setConnected(false);
          },
        },
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        patch(assistantId, { status: "stopped" });
      } else {
        patch(assistantId, { status: "error", error: "生成中断，请重试。" });
        setConnected(false);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [appendToken, busy, conversationId, creds, input, patch, tier]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    if (conversationId) {
      void clearConversation(
        conversationId,
        creds.accessKey || undefined,
        creds.llmApiKey || undefined,
      );
    }
    setMessages([]);
    setConversationId("");
    setInput("");
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [conversationId, creds]);

  return (
    <div className="flex min-h-dvh flex-col bg-base">
      <AppHeader
        connected={connected}
        busy={busy}
        onNewChat={newChat}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="flex-1">
        {messages.length === 0 ? (
          <WelcomeScreen
            onPick={(text) => {
              setInput(text);
              window.setTimeout(() => inputRef.current?.focus(), 20);
            }}
          />
        ) : (
          <div className="mx-auto w-full max-w-thread space-y-6 px-4 py-6 sm:px-6 sm:py-8">
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </main>

      <div className="sticky bottom-0 mt-auto bg-base/95 backdrop-blur">
        <Composer
          value={input}
          onChange={setInput}
          tier={tier}
          onTierChange={setTier}
          onSend={() => void send()}
          onStop={stop}
          busy={busy}
          inputRef={inputRef}
        />
      </div>

      <SettingsDialog
        open={settingsOpen}
        accessKey={creds.accessKey}
        llmApiKey={creds.llmApiKey}
        onSave={setCreds}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
