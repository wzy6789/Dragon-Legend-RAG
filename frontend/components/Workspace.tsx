"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearConversation, streamChat } from "@/lib/api";
import {
  clearConversations,
  deleteConversation as deleteConversationRow,
  listConversations,
  putConversation,
} from "@/lib/chat-store";
import { filterConversations, makeTitle } from "@/lib/history";
import type { ApiError, ChatMessage, Conversation, Tier } from "@/lib/types";
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

export default function Workspace() {
  // ---- 会话与历史（IndexedDB 持久化，不含凭据）----
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<Tier>("flash");

  // ---- 登录态（凭据仅在内存）----
  const [creds, setCreds] = useState<{ accessKey: string; llmApiKey: string } | null>(null);
  const [loginError, setLoginError] = useState("");

  // ---- UI 状态 ----
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
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

  const signedIn = Boolean(creds?.accessKey && creds?.llmApiKey);

  // 会话镜像（用于流结束后取最新内容落盘）
  useEffect(() => {
    convsRef.current = conversations;
  }, [conversations]);

  // 载入本地历史（仅客户端）
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

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const visibleConversations = filterConversations(conversations, query);
  const title = active ? active.title : "新对话";

  // 滚动跟随
  useEffect(() => {
    if (!stickRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < MAX_STICK_DISTANCE;
  };

  const patchMessage = useCallback(
    (convId: string, msgId: string, next: Partial<ChatMessage>) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id !== convId
            ? c
            : {
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...next } : m)),
              },
        ),
      );
    },
    [],
  );

  const appendToken = useCallback((convId: string, msgId: string, text: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id !== convId
          ? c
          : {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, content: m.content + text } : m,
              ),
            },
      ),
    );
  }, []);

  const persist = useCallback((conv: Conversation) => {
    void putConversation(conv);
  }, []);

  const persistCurrent = useCallback(
    (convId: string) => {
      const found = convsRef.current.find((c) => c.id === convId);
      if (found) persist(found);
    },
    [persist],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  /** 创建本地会话；返回新会话对象 */
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

  const newChat = useCallback(() => {
    stop();
    // 结束上一段后端会话（后端按 conversation_id 维护上下文）
    if (active && creds) {
      void clearConversation(active.id, creds.accessKey, creds.llmApiKey);
    }
    createConversation(tier);
    setInput("");
    setMobileOpen(false);
    stickRef.current = true;
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [active, createConversation, creds, stop, tier]);

  const runStream = useCallback(
    async (convId: string, prompt: string, useTier: Tier) => {
      if (!creds) return;
      const assistantId = newId();

      setConversations((prev) =>
        prev.map((c) =>
          c.id !== convId
            ? c
            : {
                ...c,
                title: c.title === "新对话" ? makeTitle(prompt) : c.title,
                tier: useTier,
                updatedAt: Date.now(),
                messages: [
                  ...c.messages,
                  {
                    id: newId(),
                    role: "user" as const,
                    content: prompt,
                    createdAt: Date.now(),
                  },
                  {
                    id: assistantId,
                    role: "assistant" as const,
                    content: "",
                    tier: useTier,
                    sources: [],
                    status: "streaming" as const,
                    createdAt: Date.now(),
                  },
                ],
              },
        ),
      );

      setBusy(true);
      stickRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;

      const finish = (status: ChatMessage["status"], error?: string) => {
        patchMessage(convId, assistantId, error ? { status, error } : { status });
      };

      const handleError = (err: ApiError) => {
        finish("error", err.message);
        if (err.kind === "auth") {
          // 访问密码错误：清除内存凭据并回到登录页
          setCreds(null);
          setLoginError(err.message);
        }
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
            onToken: (t) => appendToken(convId, assistantId, t),
            onSources: (sources) => patchMessage(convId, assistantId, { sources }),
            onDone: () => finish("done"),
            onError: handleError,
          },
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          finish("stopped");
        } else {
          finish("error", "生成中断，请重试。");
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        window.setTimeout(() => {
          persistCurrent(convId);
          inputRef.current?.focus();
        }, 0);
      }
    },
    [appendToken, creds, patchMessage, persistCurrent],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || busy || !creds) return;
    let convId = activeId;
    if (!convId) {
      convId = createConversation(tier).id;
    }
    setInput("");
    void runStream(convId, text, tier);
  }, [activeId, busy, createConversation, creds, input, runStream, tier]);

  const regenerate = useCallback(
    (messageId: string) => {
      if (busy || !creds || !active) return;
      const idx = active.messages.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      // 找到该回答之前的用户问题
      let userIdx = -1;
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (active.messages[i].role === "user") {
          userIdx = i;
          break;
        }
      }
      if (userIdx < 0) return;
      const prompt = active.messages[userIdx].content;
      const keep = active.messages.slice(0, idx);
      const next: Conversation = { ...active, messages: keep, updatedAt: Date.now() };
      setConversations((prev) => prev.map((c) => (c.id === active.id ? next : c)));
      persist(next);
      void runStream(active.id, prompt, active.tier);
    },
    [active, busy, creds, persist, runStream],
  );

  const selectConversation = useCallback(
    (id: string) => {
      stop();
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
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title, updatedAt: Date.now() } : c)),
      );
      const found = convsRef.current.find((c) => c.id === id);
      if (found) persist({ ...found, title, updatedAt: Date.now() });
    },
    [persist],
  );

  const removeConversation = useCallback(
    (id: string) => {
      if (id === activeId) stop();
      setConversations((prev) => prev.filter((c) => c.id !== id));
      void deleteConversationRow(id);
      if (id === activeId) {
        const rest = convsRef.current.filter((c) => c.id !== id);
        setActiveId(rest.length > 0 ? rest[0].id : null);
      }
    },
    [activeId, stop],
  );

  const clearAllHistory = useCallback(() => {
    stop();
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

  const disconnect = useCallback(() => {
    stop();
    setCreds(null);
    setLoginError("");
  }, [stop]);

  // ---- 未接入：全屏登录页（不显示聊天界面）----
  if (!signedIn) {
    return (
      <LoginGate
        error={loginError}
        onSubmit={(next) => {
          setLoginError("");
          setCreds(next);
        }}
      />
    );
  }

  return (
    <>
      <AppShell
        conversations={visibleConversations}
        activeId={activeId}
        title={title}
        tier={tier}
        query={query}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        signedIn={signedIn}
        busy={busy}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        onOpenMobileSidebar={() => setMobileOpen(true)}
        onCloseMobileSidebar={() => setMobileOpen(false)}
        onQueryChange={setQuery}
        onNewChat={newChat}
        onSelectConversation={selectConversation}
        onRenameConversation={renameConversation}
        onDeleteConversation={removeConversation}
        onTierChange={handleTierChange}
        onOpenSettings={() => setSettingsOpen(true)}
        onClearHistory={() => setConfirmClearOpen(true)}
        footer={
          <Composer
            value={input}
            onChange={setInput}
            onSend={send}
            onStop={stop}
            busy={busy}
            inputRef={inputRef}
          />
        }
      >
        <ChatView
          messages={messages}
          onPick={(text) => {
            setInput(text);
            window.setTimeout(() => inputRef.current?.focus(), 20);
          }}
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
        onSave={(next) => setCreds(next)}
        onDisconnect={disconnect}
        onClose={() => setSettingsOpen(false)}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        title="清空本地历史？"
        description="将删除本机保存的全部对话记录，此操作不可撤销。访问密码与 API Key 不在其中。"
        confirmLabel="清空"
        danger
        onConfirm={clearAllHistory}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </>
  );
}
