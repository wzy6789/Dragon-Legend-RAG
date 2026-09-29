"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon, EyeIcon, EyeOffIcon } from "./icons";

interface Props {
  open: boolean;
  llmApiKey: string;
  onSave: (apiKey: string, remember: boolean) => void;
  onDisconnect: () => void;
  onClose: () => void;
}

export default function SettingsDialog({
  open,
  llmApiKey,
  onSave,
  onDisconnect,
  onClose,
}: Props) {
  const [llmDraft, setLlmDraft] = useState(llmApiKey);
  const [revealLlm, setRevealLlm] = useState(false);
  const [remember, setRemember] = useState(true);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setLlmDraft(llmApiKey);
    setRevealLlm(false);
    setRemember(true);
    const t = window.setTimeout(() => firstFieldRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open, llmApiKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSave = llmDraft.trim().length > 0;

  const submit = () => {
    if (!canSave) return;
    onSave(llmDraft.trim(), remember);
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
              API Key 用于调用你自己的 DeepSeek 额度和识别你的对话记录。
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
            <label htmlFor="setting-llm-key" className="mb-1.5 block text-[12.5px] text-ink-soft">
              DeepSeek API Key
            </label>
            <div className="relative">
              <input
                id="setting-llm-key"
                ref={firstFieldRef}
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

          <label className="flex cursor-pointer items-start gap-2 text-[11.5px] leading-5 text-ink-faint">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="mt-1 h-3.5 w-3.5 accent-[#C9A227]" />
            <span>在此设备记住 API Key；取消勾选后，刷新页面需要重新输入。</span>
          </label>
          <p className="text-[11px] leading-5 text-ink-faint">退出当前连接会清除已保存的 API Key。服务仅在任务运行期间暂存该 Key。</p>
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
