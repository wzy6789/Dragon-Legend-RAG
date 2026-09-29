"use client";

import { useEffect, useRef, useState } from "react";
import { EyeIcon, EyeOffIcon } from "./icons";

interface Props {
  /** remember=true 表示在这台电脑上保留登录状态 */
  onSubmit: (apiKey: string, remember: boolean) => void;
  /** 上次连接失败的原因 */
  error?: string;
  busy?: boolean;
}

export default function LoginGate({ onSubmit, error, busy }: Props) {
  const [llmApiKey, setLlmApiKey] = useState("");
  const [revealKey, setRevealKey] = useState(false);
  const [remember, setRemember] = useState(true);
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const canSubmit = llmApiKey.trim().length > 0 && !busy;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(llmApiKey.trim(), remember);
  };

  return (
    <div className="flex min-h-dvh w-screen flex-col bg-base lg:flex-row">
      {/* 品牌区 */}
      <div className="flex flex-1 flex-col justify-center px-8 py-10 lg:px-16">
        <div className="max-w-md">
          <div className="flex items-baseline gap-2">
            <h1 className="font-serif text-[30px] leading-tight text-ink">龙王传说</h1>
            <span className="text-[11.5px] tracking-[0.2em] text-gold-500">考据助手</span>
          </div>
          <p className="mt-3 text-[14px] leading-6 text-ink-muted">完整知识库考据助手</p>
          <p className="mt-1.5 text-[13px] leading-6 text-ink-muted">
            使用自己的 DeepSeek API Key，直接连接完整知识库。
          </p>
        </div>
      </div>

      {/* 登录卡 */}
      <div className="flex flex-1 items-center justify-center px-6 pb-12 lg:border-l lg:border-white/[0.08] lg:px-10 lg:pb-0">
        <div className="w-full max-w-[400px]">
          <h2 className="text-[15px] font-semibold text-ink">连接知识库</h2>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">
            填写一次 API Key 即可开始提问。默认保存在这台设备，下次打开无需重复输入。
          </p>

          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="login-llm-key" className="mb-1.5 block text-[12.5px] text-ink-soft">
                DeepSeek API Key
              </label>
              <div className="relative">
                <input
                  id="login-llm-key"
                  ref={firstRef}
                  type={revealKey ? "text" : "password"}
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
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
                  onClick={() => setRevealKey((v) => !v)}
                  aria-label={revealKey ? "隐藏 API Key" : "显示 API Key"}
                  title={revealKey ? "隐藏" : "显示"}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink-faint transition-colors hover:text-ink-muted"
                >
                  {revealKey ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <label className="mt-4 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#C9A227]"
            />
            <span>在这台设备记住 API Key，下次无需重复填写</span>
          </label>

          {error ? (
            <p className="mt-4 rounded-[10px] border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[12.5px] leading-5 text-red-200/90">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={
              "mt-5 w-full rounded-[12px] py-2.5 text-[13.5px] font-medium transition-colors " +
              (canSubmit
                ? "bg-gold-500 text-[#15181D] hover:bg-gold-400"
                : "cursor-not-allowed bg-white/[0.05] text-ink-faint")
            }
          >
            {busy ? "连接中…" : "连接并开始对话"}
          </button>

          <p className="mt-4 text-[11.5px] leading-5 text-ink-faint">
            {remember
              ? "API Key 会保存在这台设备的浏览器本地，可随时在设置中更换或退出。"
              : "本次不会记住 API Key；刷新或关闭页面后需要重新填写。"}
          </p>
        </div>
      </div>
    </div>
  );
}
