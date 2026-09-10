"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon, EyeIcon, EyeOffIcon } from "./icons";

interface Props {
  open: boolean;
  accessKey: string;
  llmApiKey: string;
  onSave: (next: { accessKey: string; llmApiKey: string }) => void;
  onClose: () => void;
}

export default function SettingsDialog({
  open,
  accessKey,
  llmApiKey,
  onSave,
  onClose,
}: Props) {
  const [keyDraft, setKeyDraft] = useState(accessKey);
  const [llmDraft, setLlmDraft] = useState(llmApiKey);
  const [reveal, setReveal] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // 打开时同步草稿并把焦点放到第一个输入框
  useEffect(() => {
    if (!open) return;
    setKeyDraft(accessKey);
    setLlmDraft(llmApiKey);
    setReveal(false);
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open, accessKey, llmApiKey]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = () => {
    onSave({ accessKey: keyDraft.trim(), llmApiKey: llmDraft.trim() });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="连接设置"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[440px] animate-fade-in rounded-2xl border border-white/[0.08] bg-panel p-5 shadow-2xl shadow-black/40">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">连接设置</h2>
            <p className="mt-1 text-[12px] text-ink-muted">
              用于访问本机知识库服务，可选地使用自己的模型额度。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
            aria-label="关闭设置"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="rag-access-key"
              className="mb-1.5 block text-[12.5px] font-medium text-ink-soft"
            >
              访问密码
            </label>
            <div className="relative">
              <input
                id="rag-access-key"
                ref={firstFieldRef}
                type={reveal ? "text" : "password"}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="输入访问密码"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-white/[0.08] bg-[#111418] px-3 py-2.5 pr-10 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-gold-500/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-faint transition-colors hover:text-ink-muted"
                aria-label={reveal ? "隐藏密码" : "显示密码"}
              >
                {reveal ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="llm-api-key"
              className="mb-1.5 block text-[12.5px] font-medium text-ink-soft"
            >
              使用自己的 DeepSeek API Key（可选）
            </label>
            <input
              id="llm-api-key"
              type="password"
              value={llmDraft}
              onChange={(e) => setLlmDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="留空则使用服务端默认配置"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-white/[0.08] bg-[#111418] px-3 py-2.5 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-gold-500/50 focus:outline-none"
            />
          </div>

          <p className="text-[11.5px] leading-5 text-ink-faint">
            信息仅保存在当前浏览器会话，不会保存到服务器。
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-[13px] text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-gold-500 px-4 py-2 text-[13px] font-medium text-[#15181D] transition-colors hover:bg-gold-400"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
