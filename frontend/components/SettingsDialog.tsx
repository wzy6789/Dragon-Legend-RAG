"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon, EyeIcon, EyeOffIcon } from "./icons";

interface Props {
  open: boolean;
  accessKey: string;
  llmApiKey: string;
  onSave: (next: { accessKey: string; llmApiKey: string }) => void;
  onDisconnect: () => void;
  onClose: () => void;
}

export default function SettingsDialog({
  open,
  accessKey,
  llmApiKey,
  onSave,
  onDisconnect,
  onClose,
}: Props) {
  const [keyDraft, setKeyDraft] = useState(accessKey);
  const [llmDraft, setLlmDraft] = useState(llmApiKey);
  const [revealKey, setRevealKey] = useState(false);
  const [revealLlm, setRevealLlm] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setKeyDraft(accessKey);
    setLlmDraft(llmApiKey);
    setRevealKey(false);
    setRevealLlm(false);
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open, accessKey, llmApiKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSave = keyDraft.trim().length > 0 && llmDraft.trim().length > 0;

  const submit = () => {
    if (!canSave) return;
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
      <div className="w-full max-w-[440px] animate-fade-in rounded-[14px] border border-white/[0.08] bg-[#15181D] p-5 shadow-2xl shadow-black/50">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-[14.5px] font-semibold text-ink">连接设置</h2>
            <p className="mt-1 text-[12px] leading-5 text-ink-muted">
              访问密码保护知识库；API Key 用于调用你自己的模型额度。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="setting-access-key" className="mb-1.5 block text-[12.5px] text-ink-soft">
              访问密码
            </label>
            <div className="relative">
              <input
                id="setting-access-key"
                ref={firstFieldRef}
                type={revealKey ? "text" : "password"}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder="输入访问密码"
                className="w-full rounded-[12px] border border-white/[0.08] bg-[#111418] px-3.5 py-2.5 pr-11 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-gold-500/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setRevealKey((v) => !v)}
                aria-label={revealKey ? "隐藏访问密码" : "显示访问密码"}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink-faint transition-colors hover:text-ink-muted"
              >
                {revealKey ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="setting-llm-key" className="mb-1.5 block text-[12.5px] text-ink-soft">
              DeepSeek API Key
            </label>
            <div className="relative">
              <input
                id="setting-llm-key"
                type={revealLlm ? "text" : "password"}
                value={llmDraft}
                onChange={(e) => setLlmDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-..."
                className="w-full rounded-[12px] border border-white/[0.08] bg-[#111418] px-3.5 py-2.5 pr-11 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-gold-500/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setRevealLlm((v) => !v)}
                aria-label={revealLlm ? "隐藏 API Key" : "显示 API Key"}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink-faint transition-colors hover:text-ink-muted"
              >
                {revealLlm ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <p className="text-[11.5px] leading-5 text-ink-faint">
            保存后会在本机浏览器记住登录（下次打开无需重复填写）；点击「退出当前连接」会立即清除本机保存的
            访问密码与 API Key 并返回登录页。
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onDisconnect();
              onClose();
            }}
            className="rounded-[10px] px-3 py-2 text-[12.5px] text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-red-300"
          >
            退出当前连接
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[10px] px-3.5 py-2 text-[13px] text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSave}
              className={
                "rounded-[10px] px-4 py-2 text-[13px] font-medium transition-colors " +
                (canSave
                  ? "bg-gold-500 text-[#15181D] hover:bg-gold-400"
                  : "cursor-not-allowed bg-white/[0.05] text-ink-faint")
              }
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
