"use client";

import { useEffect, useRef, useState } from "react";
import SourceList from "./SourceList";
import TierSwitch from "./TierSwitch";
import type { ChatMessage, SourceItem, StageName, Tier } from "@/lib/types";
import { clearConversation, streamChat, uploadFile } from "@/lib/api";

const PRO_STAGES = ["拆解问题", "检索章节", "核验证据", "组织回答"];

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [tier, setTier] = useState<Tier>("flash");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string>("");
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [uploadHint, setUploadHint] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accessPassword, setAccessPassword] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeStage, status]);

  const patchAssistant = (id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  };

  const appendToken = (id: string, tok: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + tok } : m)),
    );
  };

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const assistantId = newId();
    const userMsg: ChatMessage = { id: newId(), role: "user", content: text };
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      tier,
      stages: tier === "pro" ? [] : undefined,
      sources: [],
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setBusy(true);
    setStatus("连接…");
    setActiveStage(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await streamChat(
        { message: text, tier, conversationId, accessPassword, llmApiKey, signal: ac.signal },
        {
          onStage: (stage) => {
            setActiveStage(stage);
            setStatus("");
            if (tier === "pro") {
              const reached = PRO_STAGES.slice(0, PRO_STAGES.indexOf(stage) + 1) as StageName[];
              patchAssistant(assistantId, { stages: reached });
            }
          },
          onToken: (tok) => {
            appendToken(assistantId, tok);
            setStatus("");
          },
          onSources: (sources) => {
            patchAssistant(assistantId, { sources });
          },
          onDone: (cid) => {
            setConversationId(cid || conversationId);
            patchAssistant(assistantId, { done: true });
            setBusy(false);
            setStatus("");
            setActiveStage(null);
          },
          onError: (msg) => {
            patchAssistant(assistantId, { error: msg, done: true });
            setBusy(false);
            setStatus("");
            setActiveStage(null);
          },
        },
      );
    } catch (e) {
      const err = e instanceof Error ? e.message : "未知错误";
      if (e instanceof DOMException && e.name === "AbortError") {
        patchAssistant(assistantId, { error: "已停止", done: true });
      } else {
        patchAssistant(assistantId, { error: err, done: true });
      }
      setBusy(false);
      setStatus("");
      setActiveStage(null);
    } finally {
      abortRef.current = null;
    }
  }

  async function handleClear() {
    if (conversationId) await clearConversation(conversationId);
    setMessages([]);
    setConversationId("");
    setActiveStage(null);
    setStatus("");
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploadHint("上传中…");
    const res = await uploadFile(file);
    setUploadHint(res.message);
    setTimeout(() => setUploadHint(""), 4000);
    if (fileRef.current) fileRef.current.value = "";
  }

  const showStages = tier === "pro";

  return (
    <div className="mx-auto flex h-screen w-full max-w-3xl flex-col px-4 sm:px-6">
      {/* 头部 */}
      <header className="flex items-center justify-between border-b border-ink-800/80 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="font-serif text-lg tracking-wide text-mist-100">龙王传说</h1>
          <span className="text-xs text-brass-500">考据问答</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSettingsOpen((open) => !open)}
            className="rounded-md px-2.5 py-1 text-xs text-mist-400 transition-colors hover:bg-ink-800 hover:text-mist-100"
          >
            连接设置
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-md px-2.5 py-1 text-xs text-mist-400 transition-colors hover:bg-ink-800 hover:text-mist-100"
          >
            补充资料
          </button>
          <button
            onClick={handleClear}
            disabled={messages.length === 0}
            className="rounded-md px-2.5 py-1 text-xs text-mist-400 transition-colors hover:bg-ink-800 hover:text-mist-100 disabled:opacity-30"
          >
            清除对话
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.pdf"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      </header>

      {settingsOpen && (
        <section className="mt-3 rounded-xl border border-ink-700 bg-ink-850/80 p-3 text-sm">
          <p className="mb-2 text-xs text-mist-400">访问密码用于保护题库；自己的 API Key 可选，仅保留在当前页面内存中。</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={accessPassword} onChange={(e) => setAccessPassword(e.target.value)} type="password" placeholder="完整 RAG 访问密码" className="rounded-md border border-ink-700 bg-ink-900 px-2.5 py-2 text-sm text-mist-100 placeholder:text-mist-600 focus:border-brass-500/50 focus:outline-none" />
            <input value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} type="password" placeholder="自己的 DeepSeek API Key（可选）" className="rounded-md border border-ink-700 bg-ink-900 px-2.5 py-2 text-sm text-mist-100 placeholder:text-mist-600 focus:border-brass-500/50 focus:outline-none" />
          </div>
        </section>
      )}

      {/* 消息区 */}
      <main className="flex-1 space-y-4 overflow-y-auto py-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="font-serif text-2xl text-mist-300">关于《龙王传说》的任何问题</p>
            <p className="max-w-md text-sm leading-6 text-mist-500">
              选择 Flash 快速作答，或 Pro 进行拆解检索与证据核验。所有回答都将标注参考来源。
            </p>
          </div>
        ) : (
          messages.map((m) => <MessageRow key={m.id} message={m} />)
        )}

        {/* 进行中的辅助行 */}
        {busy && (
          <div className="flex items-center gap-2 px-1 text-xs text-mist-500">
            {showStages && activeStage ? (
              <>
                <StageDots current={activeStage} />
                <span className="text-brass-400">{activeStage}</span>
              </>
            ) : (
              <>
                <Spinner />
                <span>{status || "生成中…"}</span>
              </>
            )}
          </div>
        )}
        {uploadHint && (
          <div className="px-1 text-xs text-brass-400">{uploadHint}</div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* 输入区 */}
      <footer className="border-t border-ink-800/80 pb-4 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <TierSwitch value={tier} onChange={setTier} disabled={busy} />
          <span className="hidden text-[11px] text-mist-500 sm:inline">
            {tier === "flash" ? "快速直答" : "拆解 · 检索 · 核验 · 组织"}
          </span>
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-ink-700 bg-ink-850/80 p-2 focus-within:border-brass-500/40">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="输入问题…（Enter 发送，Shift+Enter 换行）"
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-6 text-mist-100 placeholder:text-mist-500 focus:outline-none"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="shrink-0 rounded-lg bg-brass-500/15 px-4 py-2 text-sm text-brass-300 transition-colors hover:bg-brass-500/25 disabled:opacity-30"
          >
            发送
          </button>
        </div>
      </footer>
    </div>
  );
}

/* ---------- 子组件 ---------- */

function MessageRow({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-ink-800/90 px-3.5 py-2.5 text-sm leading-6 text-mist-100">
          {message.content}
        </div>
      </div>
    );
  }

  const streaming = !message.done;
  const hasSources = (message.sources?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-brass-500">
          {message.tier === "pro" ? "Pro" : "Flash"}
        </span>
        {message.stages && message.stages.length > 0 && (
          <span className="text-[11px] text-mist-500">{message.stages.join(" · ")}</span>
        )}
      </div>

      <div className="rounded-xl rounded-tl-sm border border-ink-800 bg-ink-900/60 px-3.5 py-2.5 text-sm leading-6 text-mist-100">
        {message.error ? (
          <p className="text-red-300/90">⚠ {message.error}</p>
        ) : message.content ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <span className="text-mist-500">{streaming ? "…" : "（空）"}</span>
        )}
        {streaming && <Cursor />}
      </div>

      {hasSources && (
        <div className="pt-0.5">
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] text-mist-500 underline-offset-2 hover:text-mist-300 hover:underline"
          >
            {open ? "收起参考来源" : `参考来源（${message.sources?.length}）`}
          </button>
          {open && (
            <div className="mt-2">
              <SourceList sources={message.sources ?? []} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StageDots({ current }: { current: string }) {
  const idx = PRO_STAGES.indexOf(current);
  return (
    <span className="flex items-center gap-1">
      {PRO_STAGES.map((s, i) => (
        <span
          key={s}
          className={
            "h-1.5 w-1.5 rounded-full " +
            (i < idx
              ? "bg-brass-500"
              : i === idx
                ? "animate-pulse bg-brass-400"
                : "bg-ink-700")
          }
        />
      ))}
    </span>
  );
}

function Spinner() {
  return (
    <span className="h-3 w-3 animate-spin rounded-full border border-brass-500/40 border-t-brass-400" />
  );
}

function Cursor() {
  return <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-brass-400 align-middle" />;
}
