"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearConversation, streamChat } from "@/lib/api";
import {
  clearConversations,
  deleteConversation as deleteConversationRow,
  listConversations,
  putConversation,
} from "@/lib/chat-store";
import {
  clearStoredCredentials,
  loadStoredCredentials,
  saveStoredCredentials,
} from "@/lib/credential-store";
import { filterConversations, makeTitle } from "@/lib/history";
import type { ApiError, ChatMessage, Conversation, SourceItem, Tier } from "@/lib/types";
import AppShell from "./AppShell";
import ChatView from "./ChatView";
import Composer from "./Composer";
import ConfirmDialog from "./ConfirmDialog";
import LoginGate from "./LoginGate";
import SettingsDialog from "./SettingsDialog";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

const MAX_STICK_DISTANCE = 120;

interface Creds {
  accessKey: string;
  llmApiKey: string;
}

/** 正在生成的回答（独立于会话状态，避免每个 token 触发整棵树重建） */
interface StreamingState {
  convId: string;
  tier: Tier;
  text: string;
  sources: SourceItem[];
  startedAt: number;
}

export default function Workspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<Tier>("flash");

  const [creds, setCreds] = useState<Creds | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const convsRef = useRef<Conversation[]>([]);
  const stickRef = useRef(true);
  const streamTextRef = useRef("");

  const signedIn = Boolean(creds?.accessKey && creds?.llmApiKey);

  useEffect(() => {
    convsRef.current = conversations;
  }, [conversations]);

  // 本机登录记忆：若此前勾选过「记住登录」，直接进入工作区
  useEffect(() => {
    const stored = loadStoredCredentials();
    if (stored) setCreds(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    let alive = true;
    void listConversations().then((list) => {
      if (!alive) return;
      setConversations(list);
      if (list.length > 0) {
        setActiveId(list[0].id);
        setTier(list[0].tier);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const visibleConversations = useMemo(
    () => filterConversations(conversations, query),
    [conversations, query],
  );
  const title = active ? active.title : "新对话";

  // 滚动跟随（含流式期间）
  useEffect(() => {
    if (!stickRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [active?.messages, streaming?.text]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < MAX_STICK_DISTANCE;
  }, []);

  const persist = useCallback((conv: Conversation) => {
    void putConversation(conv);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const createConversation = useCallback(
    (t: Tier): Conversation => {
      const now = Date.now();
      const conv: Conversation = {
        id: newId(),
        title: "新对话",
        tier: t,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      setConversations((prev) => [conv, ...prev]);
      setActiveId(conv.id);
      persist(conv);
      return conv;
    },
    [persist],
  );

  const runStream = useCallback(
    async (convId: string, prompt: string, useTier: Tier) => {
      if (!creds) return;
      const startedAt = Date.now();
      streamTextRef.current = "";
      setStreaming({ convId, tier: useTier, text: "", sources: [], startedAt });
      setBusy(true);
      stickRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      let sources: SourceItem[] = [];
      let failure: ApiError | null = null;

      const commit = (status: ChatMessage["status"]) => {
        const text = streamTextRef.current;
        setConversations((prev) => {
          const next = prev.map((c) =>
            c.id !== convId
              ? c
              : {
                  ...c,
                  updatedAt: Date.now(),
                  messages: [
                    ...c.messages,
                    {
                      id: newId(),
                      role: "assistant" as const,
                      content: text,
                      tier: useTier,
                      sources,
                      status,
                      error: failure?.message,
                      createdAt: Date.now(),
                    },
                  ],
                },
          );
          const found = next.find((c) => c.id === convId);
          if (found) persist(found);
          return next;
        });
      };

      try {
        await streamChat(
          {
            message: prompt,
            tier: useTier,
            conversationId: convId,
            accessKey: creds.accessKey,
            llmApiKey: creds.llmApiKey,
            signal: controller.signal,
          },
          {
            onToken: (t) => {
              streamTextRef.current += t;
              setStreaming((s) => (s ? { ...s, text: s.text + t } : s));
            },
            onSources: (s) => {
              sources = s;
              setStreaming((cur) => (cur ? { ...cur, sources: s } : cur));
            },
            onError: (err) => {
              failure = err;
            },
          },
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          commit("stopped");
          setStreaming(null);
          setBusy(false);
          abortRef.current = null;
          return;
        }
        failure = { kind: "unknown", message: "生成中断，请重试。" };
      }

      setStreaming(null);
      setBusy(false);
      abortRef.current = null;

      if (failure) {
        commit("error");
        const err: ApiError = failure;
        if (err.kind === "auth") {
          clearStoredCredentials();
          setCreds(null);
          setLoginError(err.message);
        }
      } else {
        commit("done");
      }
      window.setTimeout(() => inputRef.current?.focus(), 20);
    },
    [creds, persist],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || busy || !creds) return;

    let convId = activeId;
    if (!convId) {
      convId = createConversation(tier).id;
    }
    // 先落库用户消息与标题，再开始流式（首个字更早出现）
    setConversations((prev) =>
      prev.map((c) =>
        c.id !== convId
          ? c
          : {
              ...c,
              title: c.title === "新对话" ? makeTitle(text) : c.title,
              tier,
              updatedAt: Date.now(),
              messages: [
                ...c.messages,
                { id: newId(), role: "user" as const, content: text, createdAt: Date.now() },
              ],
            },
      ),
    );
    const snapshot = convsRef.current.find((c) => c.id === convId);
    if (snapshot) persist({ ...snapshot, tier, updatedAt: Date.now() });

    setInput("");
    void runStream(convId, text, tier);
  }, [activeId, busy, createConversation, creds, input, persist, runStream, tier]);

  const regenerate = useCallback(
    (messageId: string) => {
      if (busy || !creds || !active) return;
      const idx = active.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      let userIdx = -1;
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (active.messages[i].role === "user") {
          userIdx = i;
          break;
        }
      }
      if (userIdx < 0) return;
      const prompt = active.messages[userIdx].content;
      const next: Conversation = {
        ...active,
        messages: active.messages.slice(0, idx),
        updatedAt: Date.now(),
      };
      setConversations((prev) => prev.map((c) => (c.id === active.id ? next : c)));
      persist(next);
      void runStream(active.id, prompt, active.tier);
    },
    [active, busy, creds, persist, runStream],
  );

  const selectConversation = useCallback(
    (id: string) => {
      stop();
      setStreaming(null);
      setActiveId(id);
      setMobileOpen(false);
      const conv = convsRef.current.find((c) => c.id === id);
      if (conv) setTier(conv.tier);
      stickRef.current = true;
    },
    [stop],
  );

  const renameConversation = useCallback(
    (id: string, title: string) => {
      const found = convsRef.current.find((c) => c.id === id);
      const updated = { ...(found ?? { id }), title, updatedAt: Date.now() } as Conversation;
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
      if (found) persist({ ...found, title, updatedAt: Date.now() });
    },
    [persist],
  );

  const removeConversation = useCallback(
    (id: string) => {
      if (id === activeId) {
        stop();
        setStreaming(null);
      }
      const rest = convsRef.current.filter((c) => c.id !== id);
      setConversations(rest);
      void deleteConversationRow(id);
      if (id === activeId) setActiveId(rest.length > 0 ? rest[0].id : null);
    },
    [activeId, stop],
  );

  const clearAllHistory = useCallback(() => {
    stop();
    setStreaming(null);
    setConversations([]);
    setActiveId(null);
    void clearConversations();
    setConfirmClearOpen(false);
  }, [stop]);

  const handleTierChange = useCallback(
    (t: Tier) => {
      setTier(t);
      if (active) {
        const next = { ...active, tier: t, updatedAt: Date.now() };
        setConversations((prev) => prev.map((c) => (c.id === active.id ? next : c)));
        persist(next);
      }
    },
    [active, persist],
  );

  const newChat = useCallback(() => {
    stop();
    setStreaming(null);
    if (active && creds) {
      void clearConversation(active.id, creds.accessKey, creds.llmApiKey);
    }
    createConversation(tier);
    setInput("");
    setMobileOpen(false);
    stickRef.current = true;
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [active, createConversation, creds, stop, tier]);

  const disconnect = useCallback(() => {
    stop();
    setStreaming(null);
    clearStoredCredentials();
    setCreds(null);
    setLoginError("");
  }, [stop]);

  // 稳定回调（配合 memo 的侧栏/顶栏，流式期间不重建）
  const toggleCollapse = useCallback(() => setCollapsed((v) => !v), []);
  const openMobileSidebar = useCallback(() => setMobileOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const requestClearHistory = useCallback(() => setConfirmClearOpen(true), []);
  const pickSuggestion = useCallback((text: string) => {
    setInput(text);
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, []);

  // 未接入：全屏登录页（不显示聊天界面）
  if (!hydrated || !signedIn) {
    return (
      <LoginGate
        error={loginError}
        onSubmit={(next, remember) => {
          setLoginError("");
          if (remember) saveStoredCredentials(next);
          else clearStoredCredentials();
          setCreds(next);
        }}
      />
    );
  }

  const streamingMessage: ChatMessage | null = streaming
    ? {
        id: "streaming",
        role: "assistant",
        content: streaming.text,
        tier: streaming.tier,
        sources: streaming.sources,
        status: "streaming",
        createdAt: streaming.startedAt,
      }
    : null;

  return (
    <>
      <AppShell
        conversations={visibleConversations}
        activeId={activeId}
        title={title}
        query={query}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        signedIn={signedIn}
        onToggleCollapse={toggleCollapse}
        onOpenMobileSidebar={openMobileSidebar}
        onCloseMobileSidebar={closeMobileSidebar}
        onQueryChange={setQuery}
        onNewChat={newChat}
        onSelectConversation={selectConversation}
        onRenameConversation={renameConversation}
        onDeleteConversation={removeConversation}
        onOpenSettings={openSettings}
        onClearHistory={requestClearHistory}
        footer={
          <Composer
            value={input}
            onChange={setInput}
            onSend={send}
            onStop={stop}
            busy={busy}
            tier={tier}
            onTierChange={handleTierChange}
            inputRef={inputRef}
          />
        }
      >
        <ChatView
          messages={active?.messages ?? []}
          streamingMessage={streamingMessage}
          onPick={pickSuggestion}
          onRegenerate={regenerate}
          scrollRef={scrollRef}
          bottomRef={bottomRef}
          onScroll={onScroll}
        />
      </AppShell>

      <SettingsDialog
        open={settingsOpen}
        accessKey={creds?.accessKey ?? ""}
        llmApiKey={creds?.llmApiKey ?? ""}
        onSave={(next) => {
          saveStoredCredentials(next);
          setCreds(next);
        }}
        onDisconnect={disconnect}
        onClose={() => setSettingsOpen(false)}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        title="清空本地历史？"
        description="将删除本机保存的全部对话记录，此操作不可撤销。登录信息不在此范围内。"
        confirmLabel="清空"
        danger
        onConfirm={clearAllHistory}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </>
  );
}
