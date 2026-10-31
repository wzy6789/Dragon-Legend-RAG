"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { asApiError, cancelRun, createRun, deleteAllServerConversations, deleteRun, deleteServerConversation, fetchHealth, getRun, getRunByRequest, subscribeRun, getSystems, getBenchmarks, getExperiment, getAdminStatus, loginAdmin, logoutAdmin, evaluateRun } from "@/lib/api";
import { clearConversations, deleteConversation as deleteConversationRow, listConversations, putConversation } from "@/lib/chat-store";
import { clearStoredCredentials, loadStoredCredentials, saveStoredCredentials, loadStoredAdminSession, saveStoredAdminSession, clearStoredAdminSession } from "@/lib/credential-store";
import { filterConversations, makeTitle } from "@/lib/history";
import type { ApiError, Benchmark, BenchmarkQuestion, BrowserDelivery, ChatMessage, ComparisonTask, Conversation, ResearchRequest, ResearchSystem, RunEvent, RunSnapshot, SystemRegistry, Tier } from "@/lib/types";
import { canRunSystem, DEFAULT_SYSTEMS, downloadFile, exportBatch, nextComparisonTask, shouldPollExperiment, withoutCredentials, type ExportFormat } from "@/lib/workbench";
import WorkbenchShell, { type WorkbenchView } from "./WorkbenchShell";
import ExperimentInspector from "./ExperimentInspector";
import AdminDialog from "./AdminDialog";
import { BenchmarksPanel, ReportsPanel, VersionsPanel } from "./ResearchPanels";
import ChatView from "./ChatView";
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
    message.role === "assistant" && ACTIVE_STATUSES.has(message.status ?? ""));
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
  const [view, setView] = useState<WorkbenchView>("history");
  const [registry, setRegistry] = useState<SystemRegistry>({ systems: [], defaults: DEFAULT_SYSTEMS });
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [registryError, setRegistryError] = useState("");
  const [benchmarkError, setBenchmarkError] = useState("");
  const [registryRefresh, setRegistryRefresh] = useState(0);
  const [systemId, setSystemId] = useState(DEFAULT_SYSTEMS.flash);
  const [compare, setCompare] = useState(false);
  const [compareSystemId, setCompareSystemId] = useState("");
  const [questionSelection, setQuestionSelection] = useState<{ bank: Benchmark; question: BenchmarkQuestion } | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [experimentError, setExperimentError] = useState("");
  const [experimentRefresh, setExperimentRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [adminExpires, setAdminExpires] = useState<string | number | null>(null);
  const [adminConfigured, setAdminConfigured] = useState<boolean | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const convsRef = useRef<Conversation[]>([]);
  const persistTimersRef = useRef<Map<string, number>>(new Map());
  const recoveringRef = useRef<Set<string>>(new Set());
  const startingRequestsRef = useRef<Set<string>>(new Set());
  const stickRef = useRef(true);
  const draftsRef = useRef<Map<string, string>>(new Map());
  const [showLatest, setShowLatest] = useState(false);
  const comparisonLaunchingRef = useRef<Set<string>>(new Set());
  const browserObservers = useRef<Map<string, { start: number; delivery: BrowserDelivery }>>(new Map());
  const secretsRef = useRef<string[]>([]);
  secretsRef.current = [creds?.accessKey ?? "", creds?.llmApiKey ?? "", adminToken];

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
  const assistantMessages = active?.messages.filter((m) => m.role === "assistant") ?? [];
  const activeAssistant = assistantMessages.find((message) => message.id === selectedMessageId) ?? assistantMessages.at(-1);
  const selectedSystem = registry.systems.find((system) => system.id === systemId);
  const compareSystem = registry.systems.find((system) => system.id === compareSystemId);
  const compatibleSystems = registry.systems.filter((system) => system.tiers.includes(tier));
  const comparisonBusy = Boolean(active?.compareQueue?.length);
  const canSubmit = canRunSystem(selectedSystem, tier) && (!compare || Boolean(compareSystem?.status === "runnable" && compareSystem.id !== systemId && compareSystem.tiers.some((value) => ["flash", "pro", "max"].includes(value))));

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

  const observeDelivery = useCallback((message: ChatMessage, hasContent: boolean, done: boolean): BrowserDelivery | undefined => {
    const observer = browserObservers.current.get(message.id);
    if (!observer) return message.browserDelivery;
    const elapsed = Math.max(0, performance.now() - observer.start);
    if (hasContent && observer.delivery.firstContentMs === undefined) observer.delivery.firstContentMs = elapsed;
    if (done && observer.delivery.completedMs === undefined) observer.delivery.completedMs = elapsed;
    return { ...observer.delivery };
  }, []);

  useEffect(() => {
    const stored = loadStoredCredentials();
    if (stored) {
      setCreds(stored);
      const admin = loadStoredAdminSession();
      if (admin) { setAdminToken(admin.token); setAdminExpires(admin.expiresAt); }
    }
    try { setCollapsed(localStorage.getItem("dragon-legend.sidebar-collapsed") === "true"); } catch { /* optional preference */ }
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
        const latest = [...restored[0].messages].reverse().find((message) => message.role === "assistant");
        setSystemId(latest?.research?.systemId ?? latest?.experiment?.system_id ?? DEFAULT_SYSTEMS[restored[0].tier]);
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
    if (!signedIn) return;
    const controller = new AbortController();
    void getSystems(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setRegistry(data); setRegistryError("");
      setSystemId((current) => data.systems.some((system) => system.id === current) ? current : data.defaults.flash);
    }).catch((error) => { if (!controller.signal.aborted) setRegistryError(asApiError(error).message); });
    void getBenchmarks(controller.signal).then((data) => { if (!controller.signal.aborted) { setBenchmarks(data.benchmarks); setBenchmarkError(""); } }).catch((error) => { if (!controller.signal.aborted) setBenchmarkError(asApiError(error).message); });
    return () => controller.abort();
  }, [signedIn, registryRefresh]);

  const expireAdmin = useCallback(() => { clearStoredAdminSession(); setAdminToken(""); setAdminExpires(null); setAdminError("管理员登录已失效，请重新登录。"); }, []);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    const check = async () => {
      try {
        const status = await getAdminStatus(adminToken || undefined, creds?.accessKey, controller.signal);
        if (controller.signal.aborted) return;
        setAdminConfigured(status.configured);
        if (adminToken && !status.authenticated) expireAdmin();
      } catch (error) { if (!controller.signal.aborted && adminToken && asApiError(error).kind === "auth") expireAdmin(); }
    };
    void check();
    const timer = window.setInterval(check, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [signedIn, adminToken, creds?.accessKey, expireAdmin]);

  useEffect(() => {
    if (!adminToken || adminExpires == null) return;
    const raw = typeof adminExpires === "number" ? adminExpires < 1e12 ? adminExpires * 1000 : adminExpires : Date.parse(adminExpires);
    if (!Number.isFinite(raw)) return;
    const timer = window.setTimeout(expireAdmin, Math.max(0, Math.min(raw - Date.now(), 2147483647)));
    return () => window.clearTimeout(timer);
  }, [adminToken, adminExpires, expireAdmin]);

  // Independent from the generation stream: completed answers may still be judged.
  useEffect(() => {
    if (!creds || !activeId || !activeAssistant?.runId) return;
    const controller = new AbortController();
    const conversationId = activeId, messageId = activeAssistant.id, runId = activeAssistant.runId;
    let timer: number | undefined;
    setExperimentError("");
    const poll = async () => {
      let again = true;
      try {
        const experiment = await getExperiment(runId, creds.accessKey, controller.signal);
        if (controller.signal.aborted) return;
        updateRunMessage(conversationId, messageId, (message) => ({ ...message, experiment: withoutCredentials(experiment, secretsRef.current) as typeof experiment }));
        setExperimentError("");
        const latest = convsRef.current.find((conversation) => conversation.id === conversationId)?.messages.find((message) => message.id === messageId);
        again = shouldPollExperiment(latest?.status, experiment);
      } catch (error) {
        if (!controller.signal.aborted) {
          const apiError = asApiError(error);
          const latest = convsRef.current.find((conversation) => conversation.id === conversationId)?.messages.find((message) => message.id === messageId);
          if (apiError.status === 404 && !latest?.experiment && !ACTIVE_STATUSES.has(latest?.status ?? "")) {
            again = false; setExperimentError("");
          } else setExperimentError(`实验记录暂未同步：${apiError.message}`);
        }
      }
      if (again && !controller.signal.aborted) timer = window.setTimeout(poll, 2000);
    };
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [activeId, activeAssistant?.id, activeAssistant?.runId, creds?.accessKey, experimentRefresh, updateRunMessage]);

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
    if (el) {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      setShowLatest(!stickRef.current);
    }
  }, []);

  const scrollToLatest = useCallback(() => {
    stickRef.current = true;
    setShowLatest(false);
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, []);

  const applyEvent = useCallback((conversationId: string, messageId: string, type: string, event: RunEvent) => {
    const seq = Number(event.seq ?? 0);
    updateRunMessage(conversationId, messageId, (message) => {
      if (seq && seq <= (message.lastSeq ?? 0)) return message;
      const contentEvent = ["draft_token", "token", "final"].includes(type) && Boolean(event.text || (event.use_streamed_answer && message.content));
      const base = { ...message, lastSeq: Math.max(seq, message.lastSeq ?? 0), browserDelivery: observeDelivery(message, contentEvent, type === "done") };
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
  }, [updateRunMessage, observeDelivery]);

  const syncSnapshot = useCallback((conversationId: string, messageId: string, snapshot: RunSnapshot) => {
    const queued = convsRef.current.find((conversation) => conversation.id === conversationId)?.compareQueue?.some((task) => task.afterMessageId === messageId && task.comparisonParentRunId !== snapshot.run_id);
    if (queued) updateConversation(conversationId, (conversation) => ({ ...conversation, compareQueue: conversation.compareQueue?.map((task) => task.afterMessageId === messageId ? { ...task, comparisonParentRunId: snapshot.run_id } : task) }), true);
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
        experiment: snapshot.experiment ? withoutCredentials(snapshot.experiment, secretsRef.current) as typeof snapshot.experiment : message.experiment,
        browserDelivery: observeDelivery(message, Boolean(snapshot.answer || snapshot.draft), snapshot.status === "done"),
      };
    });
  }, [updateRunMessage, observeDelivery, updateConversation]);

  const attachRun = useCallback(async (
    conversationId: string,
    messageId: string,
    runId: string,
    accessKey: string,
    signal: AbortSignal,
  ) => {
    const existing = convsRef.current.find((conversation) => conversation.id === conversationId)?.messages.find((message) => message.id === messageId);
    if (!browserObservers.current.has(messageId) && !existing?.browserDelivery?.completedMs) browserObservers.current.set(messageId, { start: performance.now(), delivery: { observedFrom: "reattachment" } });
    let failures = 0;
    while (!signal.aborted) {
      try {
        const snapshot = await getRun(runId, accessKey);
        syncSnapshot(conversationId, messageId, snapshot);
        if (["done", "error", "stopped", "interrupted"].includes(snapshot.status)) return;
        await subscribeRun(runId, snapshot.seq, accessKey, signal, {
          onEvent: (type, event) => {
            applyEvent(conversationId, messageId, type, event);
            if (["done", "cancelled", "interrupted", "error"].includes(type)) {
              void getRun(runId, accessKey).then((finished) => syncSnapshot(conversationId, messageId, finished)).catch(() => { /* inspector polling can retry metadata */ });
            }
          },
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

  // Keep background state current so a comparison can advance while another
  // conversation is selected. Detaching SSE never cancels a durable run.
  const backgroundRunKey = conversations.flatMap((conversation) => conversation.messages.filter((message) => message.role === "assistant" && message.runId && ACTIVE_STATUSES.has(message.status ?? "") && (conversation.id !== activeId || message.id !== activeMessageId)).map((message) => `${conversation.id}:${message.id}:${message.runId}`)).join("|");
  useEffect(() => {
    if (!creds || !backgroundRunKey) return;
    let alive = true, pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      const runs = convsRef.current.flatMap((conversation) => conversation.messages.filter((message) => message.role === "assistant" && message.runId && ACTIVE_STATUSES.has(message.status ?? "") && (conversation.id !== activeId || message.id !== activeMessageId)).map((message) => ({ conversationId: conversation.id, message })));
      await Promise.allSettled(runs.map(async ({ conversationId, message }) => {
        try { const snapshot = await getRun(message.runId!, creds.accessKey); if (alive) syncSnapshot(conversationId, message.id, snapshot); } catch { /* foreground recovery and health check expose connection status */ }
      }));
      pending = false;
    };
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [backgroundRunKey, activeId, activeMessageId, creds?.accessKey, syncSnapshot]);

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

  const launchRun = useCallback(async (conversationId: string, prompt: string, selectedTier: Tier, userMessageExists: boolean, research: ResearchRequest, nextTask?: Omit<ComparisonTask, "afterMessageId">) => {
    if (!creds) return;
    const conversation = convsRef.current.find((item) => item.id === conversationId);
    if (!conversation || pendingMessage(conversation)) return;
    const assistantId = newId();
    const requestId = newId();
    browserObservers.current.set(assistantId, { start: performance.now(), delivery: { observedFrom: "submission" } });
    startingRequestsRef.current.add(requestId);
    const linkedUserId = [...conversation.messages].reverse().find((message) =>
      message.role === "user" && message.content === prompt && !message.clientRequestId,
    )?.id;
    const assistant: ChatMessage = {
      id: assistantId, role: "assistant", content: "", tier: selectedTier,
      status: "queued", stage: "正在连接知识库…", clientRequestId: requestId, createdAt: Date.now(), research: { ...research, question: prompt },
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
      compareQueue: nextTask ? [{ ...nextTask, afterMessageId: assistantId }] : research.comparisonId && current.compareQueue?.[0]?.comparisonId === research.comparisonId ? current.compareQueue.slice(1) : current.compareQueue,
    }), true);
    try {
      const run = await createRun({
        message: prompt,
        tier: selectedTier,
        conversationId,
        clientRequestId: requestId,
        apiKey: creds.llmApiKey,
        accessKey: creds.accessKey,
        research,
        adminToken: adminToken || undefined,
        comparisonParentRunId: research.comparisonParentRunId,
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
  }, [creds, adminToken, syncSnapshot, updateConversation, updateRunMessage]);

  const comparisonQueueKey = conversations.filter((conversation) => nextComparisonTask(conversation)).map((conversation) => `${conversation.id}:${conversation.compareQueue?.[0]?.afterMessageId}`).join("|");
  useEffect(() => {
    if (!creds || !comparisonQueueKey || !registry.systems.length) return;
    for (const conversation of convsRef.current) {
      const task = nextComparisonTask(conversation);
      if (!task || comparisonLaunchingRef.current.has(conversation.id)) continue;
      comparisonLaunchingRef.current.add(conversation.id);
      if (!task.comparisonParentRunId) {
        updateConversation(conversation.id, (current) => ({ ...current, compareQueue: current.compareQueue?.slice(1) }), true);
        setNotice("比较任务未继续：系统 A 未返回运行 ID，无法复用冻结上下文。");
        comparisonLaunchingRef.current.delete(conversation.id);
        continue;
      }
      if (!canRunSystem(registry.systems.find((system) => system.id === task.systemId), task.tier)) {
        updateConversation(conversation.id, (current) => ({ ...current, compareQueue: current.compareQueue?.slice(1) }), true);
        setNotice(`比较任务未继续：系统 ${task.systemId} 当前不可运行。`);
        comparisonLaunchingRef.current.delete(conversation.id);
        continue;
      }
      void launchRun(conversation.id, task.prompt, task.tier, true, task).finally(() => comparisonLaunchingRef.current.delete(conversation.id));
    }
  }, [comparisonQueueKey, creds, registry.systems, launchRun, updateConversation]);

  const send = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || !creds || !canSubmit || comparisonBusy || (active && pendingMessage(active))) return;
    const conversation = active ?? createConversation(tier);
    updateConversation(conversation.id, (current) => ({
      ...current,
      title: current.title === "新对话" ? makeTitle(prompt) : current.title,
      tier,
      updatedAt: Date.now(),
      messages: [...current.messages, { id: newId(), role: "user", content: prompt, createdAt: Date.now() }],
    }), true);
    setInput("");
    draftsRef.current.delete(activeId ?? "new");
    stickRef.current = true;
    setSelectedMessageId(null);
    setNotice("");
    const research: ResearchRequest = { systemId, benchmarkId: questionSelection?.bank.id ?? "free", questionId: questionSelection?.question.id ?? null, protocolId: questionSelection?.bank.protocol_id || undefined, comparisonId: compare ? newId() : undefined, question: prompt, questionType: questionSelection?.question.type };
    const secondTier = compareSystem?.tiers.find((value): value is Tier => ["flash", "pro", "max"].includes(value));
    const nextTask = compare && compareSystem && secondTier ? { ...research, systemId: compareSystem.id, tier: secondTier, prompt } : undefined;
    void launchRun(conversation.id, prompt, tier, true, research, nextTask);
  }, [active, activeId, createConversation, creds, input, launchRun, tier, updateConversation, canSubmit, comparisonBusy, systemId, questionSelection, compare, compareSystem]);

  const stopActiveRun = useCallback(async () => {
    if (!creds || !activeId) return;
    updateConversation(activeId, (current) => ({ ...current, compareQueue: [] }), true);
    if (!activeRunId) return;
    updateRunMessage(activeId ?? "", activeMessageId ?? "", (message) => ({ ...message, stage: "正在停止当前步骤…" }));
    try { await cancelRun(activeRunId, creds.accessKey); } catch (error) { setNotice(`停止请求未确认：${asApiError(error).message}`); }
  }, [activeId, activeMessageId, activeRunId, creds, updateRunMessage, updateConversation]);

  const regenerate = useCallback((messageId: string) => {
    if (!active || !creds || pendingMessage(active) || comparisonBusy) return;
    const index = active.messages.findIndex((message) => message.id === messageId);
    const user = [...active.messages.slice(0, index)].reverse().find((message) => message.role === "user");
    if (!user) return;
    const original = active.messages[index];
    const research = original.research ?? { systemId: original.experiment?.system_id ?? registry.defaults[original.tier ?? tier], benchmarkId: original.experiment?.benchmark_id ?? "free", questionId: original.experiment?.question_id ?? null, protocolId: original.experiment?.protocol_id ?? undefined };
    const runTier = original.tier ?? tier;
    if (!canRunSystem(registry.systems.find((system) => system.id === research.systemId), runTier)) { setNotice("此回答的系统版本当前不可运行，请在版本页选择可运行系统。"); return; }
    setSelectedMessageId(null);
    // A rerun is another observation, never a destructive replacement of history.
    void launchRun(active.id, user.content, runTier, false, { ...research, comparisonId: undefined, comparisonParentRunId: original.runId });
  }, [active, creds, launchRun, registry, tier, comparisonBusy]);

  const deleteMessage = useCallback((messageId: string) => {
    if (!active) return;
    const target = active.messages.find((message) => message.id === messageId);
    if (!target) return;
    const running = Boolean(target.runId && active.messages.some((message) =>
      message.runId === target.runId && message.role === "assistant" && ACTIVE_STATUSES.has(message.status ?? ""),
    ));
    if (running && !window.confirm("这条消息对应的回答仍在运行。删除会停止本轮任务，继续吗？")) return;
    if (target.runId && creds) void deleteRun(target.runId, creds.accessKey).catch((error) => setNotice(`本地消息已删除；服务端删除未确认：${asApiError(error).message}`));
    const removeIds = new Set([messageId]);
    if (running && target.role === "user" && target.runId) {
      active.messages.filter((message) => message.runId === target.runId).forEach((message) => removeIds.add(message.id));
    }
    updateConversation(active.id, (current) => ({
      ...current, messages: current.messages.filter((message) => !removeIds.has(message.id)), compareQueue: current.compareQueue?.filter((task) => !removeIds.has(task.afterMessageId)), updatedAt: Date.now(),
    }), true);
  }, [active, creds, updateConversation]);

  const exportConversation = useCallback((conversation: Conversation, format: ExportFormat) => {
    const report = exportBatch(conversation, format, [creds?.accessKey ?? "", creds?.llmApiKey ?? "", adminToken]);
    downloadFile(`${conversation.title.slice(0, 80) || "研究批次"}.${format}`, report.content, report.mime);
  }, [creds, adminToken]);

  const selectConversation = useCallback((id: string) => {
    draftsRef.current.set(activeId ?? "new", input);
    setInput(draftsRef.current.get(id) ?? "");
    setShowLatest(false);
    setActiveId(id);
    setSelectedMessageId(null);
    setQuestionSelection(null);
    setView("history");
    setMobileOpen(false);
    const conversation = convsRef.current.find((item) => item.id === id);
    if (conversation) {
      setTier(conversation.tier);
      const latest = [...conversation.messages].reverse().find((message) => message.role === "assistant");
      setSystemId(latest?.research?.systemId ?? latest?.experiment?.system_id ?? registry.defaults[conversation.tier]);
    }
    stickRef.current = true;
  }, [activeId, input, registry.defaults]);

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
    draftsRef.current.delete(id);
    if (id === activeId) {
      const nextId = rest[0]?.id ?? null;
      setActiveId(nextId);
      setInput(draftsRef.current.get(nextId ?? "new") ?? "");
      stickRef.current = true;
      setShowLatest(false);
    }
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
    draftsRef.current.clear();
    setInput("");
    await clearConversations();
    setConfirmClearOpen(false);
  }, [creds]);

  const handleTierChange = useCallback((nextTier: Tier) => {
    setTier(nextTier);
    setSystemId(registry.defaults[nextTier]);
    if (active) updateConversation(active.id, (conversation) => ({ ...conversation, tier: nextTier }), true);
  }, [active, registry.defaults, updateConversation]);

  const newChat = useCallback(() => {
    draftsRef.current.set(activeId ?? "new", input);
    createConversation(tier);
    setInput("");
    setQuestionSelection(null);
    setSelectedMessageId(null);
    setView("history");
    setShowLatest(false);
    setMobileOpen(false);
    stickRef.current = true;
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, [activeId, input, createConversation, tier]);

  const disconnect = useCallback(() => {
    if (adminToken && creds) void logoutAdmin(creds.accessKey, adminToken).catch(() => { /* local credentials still cleared */ });
    clearStoredCredentials();
    setCreds(null);
    setAdminToken("");
    setAdminExpires(null);
    setLoginError("");
  }, [adminToken, creds]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o" && signedIn) {
        event.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [newChat, signedIn]);

  const pickQuestion = useCallback((bank: Benchmark, question: BenchmarkQuestion) => {
    if (question.runnable === false) return;
    setInput(question.question);
    setQuestionSelection({ bank, question });
    setView("history");
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }, []);

  const signInAdmin = async (password: string) => {
    if (!creds || adminBusy) return;
    setAdminBusy(true); setAdminError("");
    try {
      const result = await loginAdmin(password, creds.accessKey);
      if (secretsRef.current[0] !== creds.accessKey) return;
      saveStoredAdminSession({ token: result.token, expiresAt: result.expires_at });
      setAdminToken(result.token); setAdminExpires(result.expires_at); setAdminOpen(false);
    } catch (error) { setAdminError(asApiError(error).message); }
    finally { setAdminBusy(false); }
  };

  const rejudge = async () => {
    if (!activeAssistant?.runId || !creds || !adminToken || evaluating) return;
    setEvaluating(true); setExperimentError("");
    try { await evaluateRun(activeAssistant.runId, creds.accessKey, adminToken); setExperimentRefresh((value) => value + 1); }
    catch (error) { setExperimentError(asApiError(error).message); if (asApiError(error).kind === "auth") expireAdmin(); }
    finally { setEvaluating(false); }
  };

  if (!hydrated || !signedIn || !creds) {
    return <LoginGate error={loginError} onSubmit={(apiKey, remember) => {
      setLoginError("");
      const next = { accessKey: apiKey, llmApiKey: apiKey };
      if (remember) saveStoredCredentials(next); else clearStoredCredentials();
      setCreds(next);
      setAdminToken(""); setAdminExpires(null);
    }} />;
  }

  const connectionLabel = connection === "ready" ? "知识库已连接" : connection === "offline" ? "知识库离线" : "正在连接";
  return (
    <>
      <WorkbenchShell
        view={view}
        onView={setView}
        conversations={visibleConversations}
        activeId={activeId}
        title={active?.title ?? "新建实验"}
        query={query}
        onQuery={setQuery}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        inspectorOpen={evidenceOpen}
        connection={connectionLabel}
        admin={Boolean(adminToken)}
        onAdmin={() => setAdminOpen(true)}
        onInspector={() => setEvidenceOpen((value) => !value)}
        onToggleCollapse={() => {
          setCollapsed(!collapsed);
          try { localStorage.setItem("dragon-legend.sidebar-collapsed", String(!collapsed)); } catch { /* optional preference */ }
        }}
        onMobile={setMobileOpen}
        onNew={newChat}
        onSelect={selectConversation}
        onRename={renameConversation}
        onDelete={(id) => void removeConversation(id)}
        onSettings={() => setSettingsOpen(true)}
        onClear={() => setConfirmClearOpen(true)}
        inspector={<ExperimentInspector messages={assistantMessages} selectedId={activeAssistant?.id ?? null} onSelect={setSelectedMessageId} message={activeAssistant} admin={Boolean(adminToken)} onLogin={() => setAdminOpen(true)} onEvaluate={() => void rejudge()} evaluating={evaluating} error={experimentError} />}
      >
        {notice && <div className="workspace-notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")}>关闭</button></div>}
        {view === "history" && <>
          <div className="experiment-controls">
            <div className="system-controls"><label className="stack-label tier-control"><span className="sr-only">档位</span><select aria-label="档位" value={tier} onChange={(event) => handleTierChange(event.target.value as Tier)}><option value="flash">Flash</option><option value="pro">Pro</option><option value="max">Max</option></select></label><label className="stack-label system-control"><span className="sr-only">系统版本</span><select aria-label="系统版本" value={systemId} onChange={(event) => setSystemId(event.target.value)}>{!compatibleSystems.some((system) => system.id === systemId) && <option value={systemId}>{systemId} · 等待注册表</option>}{compatibleSystems.map((system) => <option key={system.id} value={system.id} disabled={!canRunSystem(system, tier)}>{system.label}{system.status !== "runnable" ? ` · ${system.status === "pending" ? "待接入" : "历史归档"}` : ""}</option>)}</select></label><label className="compare-switch"><input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} />对比</label><details className="experiment-options"><summary>设置</summary><div className="experiment-options-body">
            <div className="setup-caption"><span>{questionSelection ? `${questionSelection.bank.label} · ${questionSelection.question.id}` : "自由问题 · 在线诊断"}</span><button onClick={() => setView("benchmarks")}>选择题库</button></div>
            <dl className="setup-metadata" aria-label="配置摘要"><div><dt>档位</dt><dd>{tier.toUpperCase()}</dd></div><div><dt>版本</dt><dd>{selectedSystem?.version || "未记录"}</dd></div><div><dt>变体</dt><dd>{selectedSystem?.variant || "未记录"}</dd></div><div><dt>所选运行模型</dt><dd>{activeAssistant?.experiment?.system_id === systemId ? activeAssistant.experiment.generation_model || "运行时记录" : "运行时记录"}</dd></div><div><dt>协议</dt><dd>{questionSelection?.bank.protocol_id || benchmarks.find((bank) => bank.id === "free")?.protocol_id || "未记录"}</dd></div></dl>
            </div></details></div>
            {compare && <div className="compare-controls"><label className="stack-label system-control"><span className="sr-only">第二个系统</span><select aria-label="第二个系统" value={compareSystemId} onChange={(event) => setCompareSystemId(event.target.value)}><option value="">选择第二个系统</option>{registry.systems.map((system) => <option key={system.id} value={system.id} disabled={system.status !== "runnable" || system.id === systemId || !system.tiers.some((value) => ["flash", "pro", "max"].includes(value))}>{system.label} · {system.family}{system.status !== "runnable" ? ` · ${system.status}` : ""}</option>)}</select></label></div>}
            {questionSelection && <div className="selected-question">{questionSelection.bank.label} · {questionSelection.question.id}</div>}
            {registryError && <p className="inline-error">注册表加载失败：{registryError} <button onClick={() => setRegistryRefresh((value) => value + 1)}>重试</button></p>}
          </div>
          {!!assistantMessages.length && active && <div className="thread-toolbar"><button onClick={() => exportConversation(active, "md")}>导出对话 ↓</button></div>}
          <ChatView messages={active?.messages ?? []} onPick={() => setView("benchmarks")} onRegenerate={regenerate} onDeleteMessage={deleteMessage} scrollRef={scrollRef} bottomRef={bottomRef} onScroll={onScroll} showLatest={showLatest} onLatest={scrollToLatest} onInspect={(id) => { setSelectedMessageId(id); setEvidenceOpen(true); }} selectedId={activeAssistant?.id} busy={Boolean(activeRun) || comparisonBusy} comparisonPending={comparisonBusy} />
          <div className="research-composer"><div className="research-composer-input"><textarea ref={inputRef} value={input} rows={2} maxLength={4000} aria-label="输入研究问题" title="Enter 发送，Shift + Enter 换行" placeholder="输入问题…" onChange={(event) => { setInput(event.target.value); if (questionSelection && event.target.value !== questionSelection.question.question) setQuestionSelection(null); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><div className="composer-actions"><span>{activeRun || comparisonBusy ? "后台运行中" : input.length >= 3200 ? `${input.length}/4000` : ""}</span>{activeRun || comparisonBusy ? <button className="quiet-button" onClick={() => void stopActiveRun()}>停止</button> : <button className="primary-button" disabled={!input.trim() || !canSubmit} onClick={send}>{compare ? "开始对比" : "发送"}<span aria-hidden="true"> ↑</span></button>}</div></div></div>
        </>}
        {view === "versions" && <VersionsPanel systems={registry.systems} error={registryError} onRetry={() => setRegistryRefresh((value) => value + 1)} onUse={(system: ResearchSystem) => { const selectedTier = system.tiers.find((value): value is Tier => ["flash", "pro", "max"].includes(value)); if (!selectedTier) return; handleTierChange(selectedTier); setSystemId(system.id); setView("history"); }} />}
        {view === "benchmarks" && <BenchmarksPanel benchmarks={benchmarks} onPick={pickQuestion} error={benchmarkError} />}
        {view === "reports" && <ReportsPanel conversations={conversations} onExport={exportConversation} onSelect={selectConversation} accessKey={creds.accessKey} adminToken={adminToken} onLogin={() => setAdminOpen(true)} onAdminExpired={expireAdmin} />}
      </WorkbenchShell>

      <AdminDialog open={adminOpen} authenticated={Boolean(adminToken)} configured={adminConfigured} busy={adminBusy} error={adminError} onLogin={(password) => void signInAdmin(password)} onLogout={() => { if (creds && adminToken) void logoutAdmin(creds.accessKey, adminToken).catch(() => setNotice("当前浏览器已退出；服务端会话暂未撤销，请恢复连接后重试。")); clearStoredAdminSession(); setAdminToken(""); setAdminExpires(null); setAdminError(""); }} onClose={() => setAdminOpen(false)} />

      <SettingsDialog
        open={settingsOpen}
        llmApiKey={creds?.llmApiKey ?? ""}
        onSave={(apiKey, remember) => {
          const next = { accessKey: apiKey, llmApiKey: apiKey };
          if (remember) saveStoredCredentials(next); else clearStoredCredentials();
          setCreds(next);
          if (apiKey !== creds?.accessKey) {
            if (creds && adminToken) void logoutAdmin(creds.accessKey, adminToken).catch(() => { /* clear this browser regardless */ });
            clearStoredAdminSession();
            setAdminToken(""); setAdminExpires(null);
          }
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
