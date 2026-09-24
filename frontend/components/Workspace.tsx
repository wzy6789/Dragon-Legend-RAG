"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { asApiError, cancelRun, createRun, deleteAllServerConversations, deleteRun, deleteServerConversation, fetchHealth, getRun, getRunByRequest, subscribeRun } from "@/lib/api";
import { clearConversations, deleteConversation as deleteConversationRow, listConversations, putConversation } from "@/lib/chat-store";
import { clearStoredCredentials, loadStoredCredentials, saveStoredCredentials } from "@/lib/credential-store";
import { filterConversations, makeTitle } from "@/lib/history";
import type { ApiError, ChatMessage, Conversation, RunEvent, RunSnapshot, Tier } from "@/lib/types";
import AppShell from "./AppShell";
import ChatView from "./ChatView";
import Composer from "./Composer";
import ConfirmDialog from "./ConfirmDialog";
import LoginGate from "./LoginGate";
import SettingsDialog from "./SettingsDialog";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const ACTIVE_STATUSES = new Set(["queued", "running", "streaming", "reviewing"]);
const RETRY_MS = [800, 1600, 3000, 5000, 8000];

interface Creds { accessKey: string; llmApiKey: string }

function pendingMessage(conversation?: Conversation): ChatMessage | undefined {
  return conversation?.messages.find((message) =>
    message.role === "assistant" && message.runId && ACTIVE_STATUSES.has(message.status ?? ""));
}

function statusFromSnapshot(status: string): ChatMessage["status"] {
  if (status === "queued") return "queued";
  if (status === "drafting") return "streaming";
  if (status === "streaming") return "streaming";
  if (status === "reviewing") return "reviewing";
  if (status === "done") return "done";
  if (status === "stopped") return "stopped";
  if (status === "cancelling") return "running";
  if (status === "interrupted") return "interrupted";
  if (status === "error") return "error";
  return "running";
}

function waitToReconnect(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [connection, setConnection] = useState<"checking" | "ready" | "offline">("checking");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const convsRef = useRef<Conversation[]>([]);
  const persistTimersRef = useRef<Map<string, number>>(new Map());
  const recoveringRef = useRef<Set<string>>(new Set());
  const startingRequestsRef = useRef<Set<string>>(new Set());
  const stickRef = useRef(true);

  const signedIn = Boolean(creds?.accessKey && creds?.llmApiKey);
  const active = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]);
  const visibleConversations = useMemo(() => filterConversations(conversations, query), [conversations, query]);
  const activeRun = pendingMessage(active ?? undefined);
  const activeRunId = activeRun?.runId ?? null;
  const activeMessageId = activeRun?.id ?? null;
  const orphanRequestKey = useMemo(() => conversations.flatMap((conversation) =>
    conversation.messages
      .filter((message) => message.role === "assistant" && message.clientRequestId && !message.runId && ACTIVE_STATUSES.has(message.status ?? ""))
      .map((message) => `${conversation.id}:${message.id}:${message.clientRequestId}`),
  ).join("|"), [conversations]);
  const title = active?.title ?? "新对话";
  const assistantMessages = active?.messages.filter((m) => m.role === "assistant") ?? [];
  const activeAssistant = assistantMessages[assistantMessages.length - 1];
  const evidence = activeAssistant?.sources ?? [];

  const updateConversation = useCallback((id: string, update: (conversation: Conversation) => Conversation, immediate = false) => {
    const next = convsRef.current.map((conversation) => conversation.id === id ? update(conversation) : conversation);
    convsRef.current = next;
    setConversations(next);
    const changed = next.find((conversation) => conversation.id === id);
    if (!changed) return;
    const timers = persistTimersRef.current;
    const oldTimer = timers.get(id);
    if (oldTimer) window.clearTimeout(oldTimer);
    if (immediate) {
      timers.delete(id);
      void putConversation(changed);
    } else {
      timers.set(id, window.setTimeout(() => {
        timers.delete(id);
        const latest = convsRef.current.find((conversation) => conversation.id === id);
        if (latest) void putConversation(latest);
      }, 300));
    }
  }, []);

  const updateRunMessage = useCallback((conversationId: string, messageId: string, update: (message: ChatMessage) => ChatMessage) => {
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      updatedAt: Date.now(),
      messages: conversation.messages.map((message) => message.id === messageId ? update(message) : message),
    }));
  }, [updateConversation]);

  useEffect(() => {
    const stored = loadStoredCredentials();
    if (stored) setCreds(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    let alive = true;
    void listConversations().then((list) => {
      if (!alive) return;
      const restored = list.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.status === "streaming" && !message.runId
            ? { ...message, status: "interrupted" as const, error: "旧任务无法恢复，请重新发送。" }
            : message,
        ),
      }));
      convsRef.current = restored;
      setConversations(restored);
      if (restored.length) {
        setActiveId(restored[0].id);
        setTier(restored[0].tier);
      }
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setConnection("checking");
      return;
    }
    let alive = true;
    const check = async () => {
      try {
        const health = await fetchHealth();
        if (alive) setConnection(health.status === "ok" && health.warmed_up ? "ready" : "checking");
      } catch {
        if (alive) setConnection("offline");
      }
    };
    void check();
    const timer = window.setInterval(check, 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [signedIn]);

  useEffect(() => {
    if (!active) return;
    setTier(active.tier);
  }, [activeId]);

  useEffect(() => {
    if (!stickRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [active?.messages]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const applyEvent = useCallback((conversationId: string, messageId: string, type: string, event: RunEvent) => {
    const seq = Number(event.seq ?? 0);
    updateRunMessage(conversationId, messageId, (message) => {
      if (seq && seq <= (message.lastSeq ?? 0)) return message;
      const base = { ...message, lastSeq: Math.max(seq, message.lastSeq ?? 0) };
      if (type === "queued") return { ...base, status: "queued", stage: String(event.stage ?? "排队中") };
      if (type === "stage") return { ...base, status: "running", stage: String(event.stage ?? "正在处理") };
      if (type === "draft_reset") return { ...base, content: "", provisional: true, status: "streaming", stage: "生成待核验初稿" };
      if (type === "draft_token") return { ...base, content: base.content + String(event.text ?? ""), provisional: true, status: "streaming" };
      if (type === "token") return { ...base, content: base.content + String(event.text ?? ""), provisional: false, status: "streaming" };
      if (type === "sources") return { ...base, sources: (event.sources as ChatMessage["sources"]) ?? [] };
      if (type === "final") return {
        ...base,
        content: event.use_streamed_answer ? base.content : String(event.text ?? ""),
        sources: (event.sources as ChatMessage["sources"]) ?? base.sources,
        completionStatus: String(event.completion_status ?? "complete"),
        warning: String(event.warning ?? ""),
        provisional: false,
        status: "reviewing",
        stage: "整理最终答案",
      };
      if (type === "done") return { ...base, status: "done", stage: "", provisional: false, version: String(event.version ?? base.version ?? "") };
      if (type === "cancelling") return { ...base, status: "running", stage: "正在停止当前步骤…" };
      if (type === "cancelled") return { ...base, status: "stopped", stage: "", error: String(event.message ?? "已停止生成。") };
      if (type === "interrupted") return { ...base, status: "interrupted", stage: "", error: String(event.message ?? "服务重启导致任务中断。") };
      if (type === "error") return { ...base, status: "error", stage: "", error: String(event.message ?? "生成失败，请重试。") };
      return base;
    });
  }, [updateRunMessage]);

  const syncSnapshot = useCallback((conversationId: string, messageId: string, snapshot: RunSnapshot) => {
    updateRunMessage(conversationId, messageId, (message) => {
      const status = statusFromSnapshot(snapshot.status);
      const content = snapshot.answer || snapshot.draft || message.content;
      return {
        ...message,
        runId: snapshot.run_id,
        version: snapshot.version,
        lastSeq: snapshot.seq,
        status,
        stage: snapshot.stage || "",
        content,
        sources: snapshot.sources ?? message.sources,
        completionStatus: snapshot.completion_status || message.completionStatus,
        warning: snapshot.warning || message.warning,
        error: snapshot.error || (snapshot.status === "interrupted" ? "本机服务曾重启，已保留已有内容。请重新发送。" : message.error),
        provisional: Boolean(snapshot.draft && !snapshot.answer),
      };
    });
  }, [updateRunMessage]);

  const attachRun = useCallback(async (
    conversationId: string,
    messageId: string,
    runId: string,
    accessKey: string,
    signal: AbortSignal,
  ) => {
    let failures = 0;
    while (!signal.aborted) {
      try {
        const snapshot = await getRun(runId, accessKey);
        syncSnapshot(conversationId, messageId, snapshot);
        if (["done", "error", "stopped", "interrupted"].includes(snapshot.status)) return;
        await subscribeRun(runId, snapshot.seq, accessKey, signal, {
          onEvent: (type, event) => applyEvent(conversationId, messageId, type, event),
        });
        failures = 0;
        if (signal.aborted) return;
        const afterStream = await getRun(runId, accessKey);
        syncSnapshot(conversationId, messageId, afterStream);
        if (["done", "error", "stopped", "interrupted"].includes(afterStream.status)) return;
        failures = 1;
        await waitToReconnect(RETRY_MS[0], signal);
      } catch (error) {
        if (signal.aborted) return;
        const apiError = asApiError(error);
        if (apiError.kind === "auth") {
          clearStoredCredentials();
          setCreds(null);
          setLoginError(apiError.message);
          return;
        }
        updateRunMessage(conversationId, messageId, (message) => ({
          ...message,
          stage: "连接中断，正在恢复任务…",
          status: ACTIVE_STATUSES.has(message.status ?? "") ? message.status : "running",
        }));
        await waitToReconnect(RETRY_MS[Math.min(failures, RETRY_MS.length - 1)], signal);
        failures += 1;
      }
    }
  }, [applyEvent, syncSnapshot, updateRunMessage]);

  useEffect(() => {
    if (!creds || !activeId || !activeRunId || !activeMessageId) return;
    const controller = new AbortController();
    void attachRun(activeId, activeMessageId, activeRunId, creds.accessKey, controller.signal);
    return () => controller.abort();
  }, [activeId, activeRunId, activeMessageId, creds?.accessKey, attachRun]);

  useEffect(() => {
    if (!creds?.accessKey || !orphanRequestKey) return;
    const orphans = convsRef.current.flatMap((conversation) => conversation.messages
      .filter((message) => message.role === "assistant" && message.clientRequestId && !message.runId && ACTIVE_STATUSES.has(message.status ?? ""))
      .map((message) => ({ conversationId: conversation.id, message })));
    for (const orphan of orphans) {
      const recoveryKey = `${orphan.conversationId}:${orphan.message.id}`;
      if (recoveringRef.current.has(recoveryKey)) continue;
      if (startingRequestsRef.current.has(orphan.message.clientRequestId!)) continue;
      recoveringRef.current.add(recoveryKey);
      void (async () => {
        let found: RunSnapshot | null = null;
        let lastError: unknown;
        for (const delay of [0, 800, 1600, 3000]) {
          if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
          try {
            found = await getRunByRequest(orphan.message.clientRequestId!, creds.accessKey);
            break;
          } catch (error) {
            lastError = error;
            if (asApiError(error).kind === "auth") break;
          }
        }
        if (found) {
          syncSnapshot(orphan.conversationId, orphan.message.id, found);
          updateConversation(orphan.conversationId, (conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) => message.clientRequestId === orphan.message.clientRequestId
              ? { ...message, runId: found!.run_id }
              : message),
          }), true);
        } else {
          const apiError = asApiError(lastError);
          if (apiError.kind === "auth") {
            clearStoredCredentials();
            setCreds(null);
            setLoginError(apiError.message);
          } else {
            updateRunMessage(orphan.conversationId, orphan.message.id, (message) => ({
              ...message, status: "interrupted", stage: "", error: "未能恢复这次请求；请重新发送问题。",
            }));
          }
        }
        recoveringRef.current.delete(recoveryKey);
      })();
    }
  }, [creds?.accessKey, orphanRequestKey, syncSnapshot, updateConversation, updateRunMessage]);

  const createConversation = useCallback((selectedTier: Tier): Conversation => {
    const now = Date.now();
    const conversation: Conversation = {
      id: newId(), title: "新对话", tier: selectedTier, createdAt: now, updatedAt: now, messages: [],
    };
    const next = [conversation, ...convsRef.current];
    convsRef.current = next;
    setConversations(next);
    setActiveId(conversation.id);
    setTier(selectedTier);
    void putConversation(conversation);
    return conversation;
  }, []);

  const launchRun = useCallback(async (conversationId: string, prompt: string, selectedTier: Tier, userMessageExists: boolean) => {
    if (!creds) return;
    const conversation = convsRef.current.find((item) => item.id === conversationId);
    if (!conversation || pendingMessage(conversation)) return;
    const assistantId = newId();
    const requestId = newId();
    startingRequestsRef.current.add(requestId);
    const linkedUserId = [...conversation.messages].reverse().find((message) =>
      message.role === "user" && message.content === prompt && !message.clientRequestId,
    )?.id;
    const assistant: ChatMessage = {
      id: assistantId, role: "assistant", content: "", tier: selectedTier,
      status: "queued", stage: "正在连接知识库…", clientRequestId: requestId, createdAt: Date.now(),
    };
    const messages = userMessageExists
      ? [...conversation.messages.map((message) => message.id === linkedUserId
        ? { ...message, clientRequestId: requestId }
        : message), assistant]
      : [...conversation.messages, { id: newId(), role: "user" as const, content: prompt, clientRequestId: requestId, createdAt: Date.now() }, assistant];
    updateConversation(conversationId, (current) => ({
      ...current,
      title: current.title === "新对话" ? makeTitle(prompt) : current.title,
      tier: selectedTier,
      updatedAt: Date.now(),
      messages,
    }), true);
    try {
      const run = await createRun({
        message: prompt,
        tier: selectedTier,
        conversationId,
        clientRequestId: requestId,
        accessKey: creds.accessKey,
        llmApiKey: creds.llmApiKey,
      });
      startingRequestsRef.current.delete(requestId);
      updateConversation(conversationId, (current) => ({
        ...current,
        messages: current.messages.map((message) => message.clientRequestId === requestId
          ? { ...message, runId: run.run_id }
          : message),
      }));
      syncSnapshot(conversationId, assistantId, run);
    } catch (error) {
      startingRequestsRef.current.delete(requestId);
      const apiError: ApiError = asApiError(error);
      updateRunMessage(conversationId, assistantId, (message) => ({
        ...message,
        status: apiError.kind === "network" ? "queued" : "error",
        stage: apiError.kind === "network" ? "正在确认任务是否已创建…" : "",
        error: apiError.kind === "network" ? undefined : apiError.message,
      }));
      if (apiError.kind === "auth") {
        clearStoredCredentials();
        setCreds(null);
        setLoginError(apiError.message);
      }
    }
  }, [creds, syncSnapshot, updateConversation, updateRunMessage]);

  const send = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || !creds || (active && pendingMessage(active))) return;
    const conversation = active ?? createConversation(tier);
    updateConversation(conversation.id, (current) => ({
      ...current,
      title: current.title === "新对话" ? makeTitle(prompt) : current.title,
      tier,
      updatedAt: Date.now(),
      messages: [...current.messages, { id: newId(), role: "user", content: prompt, createdAt: Date.now() }],
    }), true);
    setInput("");
    stickRef.current = true;
    void launchRun(conversation.id, prompt, tier, true);
  }, [active, createConversation, creds, input, launchRun, tier, updateConversation]);

  const stopActiveRun = useCallback(async () => {
    if (!activeRunId || !creds) return;
    updateRunMessage(activeId ?? "", activeMessageId ?? "", (message) => ({ ...message, stage: "正在停止当前步骤…" }));
    try { await cancelRun(activeRunId, creds.accessKey); } catch { /* stream reconnection will show the final state */ }
  }, [activeId, activeMessageId, activeRunId, creds, updateRunMessage]);

  const regenerate = useCallback((messageId: string) => {
    if (!active || !creds || pendingMessage(active)) return;
    const index = active.messages.findIndex((message) => message.id === messageId);
    const user = [...active.messages.slice(0, index)].reverse().find((message) => message.role === "user");
    if (!user) return;
    const oldRunId = active.messages[index]?.runId;
    updateConversation(active.id, (current) => ({
      ...current,
      messages: current.messages.slice(0, index).map((message) => message.id === user.id
        ? { ...message, runId: undefined, clientRequestId: undefined }
        : message),
      updatedAt: Date.now(),
    }), true);
    void (async () => {
      if (oldRunId) {
        try { await deleteRun(oldRunId, creds.accessKey); } catch { /* replacement can still run */ }
      }
      await launchRun(active.id, user.content, active.tier, true);
    })();
  }, [active, creds, launchRun, updateConversation]);

  const deleteMessage = useCallback((messageId: string) => {
    if (!active) return;
    const target = active.messages.find((message) => message.id === messageId);
    if (!target) return;
    const running = Boolean(target.runId && active.messages.some((message) =>
      message.runId === target.runId && message.role === "assistant" && ACTIVE_STATUSES.has(message.status ?? ""),
    ));
    if (running && !window.confirm("这条消息对应的回答仍在运行。删除会停止本轮任务，继续吗？")) return;
    if (target.runId && creds) void deleteRun(target.runId, creds.accessKey);
    const removeIds = new Set([messageId]);
    if (running && target.role === "user" && target.runId) {
      active.messages.filter((message) => message.runId === target.runId).forEach((message) => removeIds.add(message.id));
    }
    updateConversation(active.id, (current) => ({
      ...current, messages: current.messages.filter((message) => !removeIds.has(message.id)), updatedAt: Date.now(),
    }), true);
  }, [active, creds, updateConversation]);

  const exportConversation = useCallback(() => {
    if (!active) return;
    const content = [
      `# ${active.title}`,
      "",
      ...active.messages.flatMap((message) => {
        const heading = message.role === "user" ? "## 用户" : `## 助手${message.version ? ` · ${message.version}` : ""}`;
        const sources = message.sources?.length
          ? ["", "参考来源：", ...message.sources.map((source, index) => `- ${source.chapter || source.title || `片段 ${index + 1}`}${source.snippet ? `：${source.snippet}` : ""}`)]
          : [];
        return [heading, "", message.content || (message.error ? `（${message.error}）` : "（尚无正文）"), ...sources, ""];
      }),
    ].join("\n");
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${active.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "龙王传说对话"}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [active]);

  const selectConversation = useCallback((id: string) => {
    setActiveId(id);
    setMobileOpen(false);
    const conversation = convsRef.current.find((item) => item.id === id);
    if (conversation) setTier(conversation.tier);
    stickRef.current = true;
  }, []);

  const renameConversation = useCallback((id: string, nextTitle: string) => {
    updateConversation(id, (conversation) => ({ ...conversation, title: nextTitle, updatedAt: Date.now() }), true);
  }, [updateConversation]);

  const removeConversation = useCallback(async (id: string) => {
    const conversation = convsRef.current.find((item) => item.id === id);
    const running = conversation?.messages.find((message) => message.runId && ACTIVE_STATUSES.has(message.status ?? ""));
    if (running && !window.confirm("此对话仍有回答在运行。删除会停止该回答并移除本地记录，继续吗？")) return;
    let serverDeleted = false;
    if (creds) {
      try {
        await deleteServerConversation(id, creds.accessKey);
        serverDeleted = true;
      } catch { /* local deletion remains available */ }
      if (!serverDeleted && running?.runId) {
        try { await cancelRun(running.runId, creds.accessKey); } catch { /* best-effort fallback */ }
      }
    }
    const rest = convsRef.current.filter((item) => item.id !== id);
    convsRef.current = rest;
    setConversations(rest);
    void deleteConversationRow(id);
    if (id === activeId) setActiveId(rest[0]?.id ?? null);
  }, [activeId, creds]);

  const clearAllHistory = useCallback(async () => {
    const copy = [...convsRef.current];
    let serverCleared = false;
    if (creds) {
      try {
        await deleteAllServerConversations(creds.accessKey);
        serverCleared = true;
      } catch { /* local history can still be cleared */ }
    }
    if (!serverCleared && creds) {
      const activeRunIds = new Set(copy.flatMap((conversation) => conversation.messages
        .filter((message) => message.runId && ACTIVE_STATUSES.has(message.status ?? ""))
        .map((message) => message.runId!)));
      await Promise.allSettled([...activeRunIds].map((runId) => cancelRun(runId, creds.accessKey)));
    }
    convsRef.current = [];
    setConversations([]);
    setActiveId(null);
    await clearConversations();
    setConfirmClearOpen(false);
  }, [creds]);

  const handleTierChange = useCallback((nextTier: Tier) => {
    setTier(nextTier);
    if (active) updateConversation(active.id, (conversation) => ({ ...conversation, tier: nextTier }), true);
  }, [active, updateConversation]);

  const newChat = useCallback(() => {
    createConversation(tier);
    setInput("");
    setMobileOpen(false);
    stickRef.current = true;
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [createConversation, tier]);

  const disconnect = useCallback(() => {
    clearStoredCredentials();
    setCreds(null);
    setLoginError("");
  }, []);

  const pickSuggestion = useCallback((text: string) => {
    setInput(text);
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, []);

  if (!hydrated || !signedIn) {
    return <LoginGate error={loginError} onSubmit={(next, remember) => {
      setLoginError("");
      if (remember) saveStoredCredentials(next); else clearStoredCredentials();
      setCreds(next);
    }} />;
  }

  const connectionLabel = connection === "ready" ? "知识库已连接" : connection === "offline" ? "知识库离线" : "正在连接";
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
        connection={connectionLabel}
        tier={tier}
        evidence={evidence}
        evidenceOpen={evidenceOpen}
        onToggleEvidence={() => setEvidenceOpen((value) => !value)}
        onExportConversation={exportConversation}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        onOpenMobileSidebar={() => setMobileOpen(true)}
        onCloseMobileSidebar={() => setMobileOpen(false)}
        onQueryChange={setQuery}
        onNewChat={newChat}
        onSelectConversation={selectConversation}
        onRenameConversation={renameConversation}
        onDeleteConversation={(id) => void removeConversation(id)}
        onOpenSettings={() => setSettingsOpen(true)}
        onClearHistory={() => setConfirmClearOpen(true)}
        footer={
          <Composer
            value={input}
            onChange={setInput}
            onSend={send}
            onStop={() => void stopActiveRun()}
            busy={Boolean(activeRun)}
            tier={tier}
            onTierChange={handleTierChange}
            inputRef={inputRef}
          />
        }
      >
        <ChatView
          messages={active?.messages ?? []}
          onPick={pickSuggestion}
          onRegenerate={regenerate}
          onDeleteMessage={deleteMessage}
          scrollRef={scrollRef}
          bottomRef={bottomRef}
          onScroll={onScroll}
        />
      </AppShell>

      <SettingsDialog
        open={settingsOpen}
        accessKey={creds?.accessKey ?? ""}
        llmApiKey={creds?.llmApiKey ?? ""}
        onSave={(next, remember) => {
          if (remember) saveStoredCredentials(next); else clearStoredCredentials();
          setCreds(next);
        }}
        onDisconnect={disconnect}
        onClose={() => setSettingsOpen(false)}
      />
      <ConfirmDialog
        open={confirmClearOpen}
        title="清空全部对话？"
        description="会停止正在运行的任务，并删除此浏览器保存的历史记录。"
        confirmLabel="清空全部"
        danger
        onConfirm={() => void clearAllHistory()}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </>
  );
}
