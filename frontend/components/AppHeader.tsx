"use client";

import { NewChatIcon, SettingsIcon } from "./icons";

interface Props {
  connected: boolean;
  onNewChat: () => void;
  onOpenSettings: () => void;
  busy?: boolean;
}

export default function AppHeader({ connected, onNewChat, onOpenSettings, busy }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#0D0F12]/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-thread items-center justify-between px-4 sm:px-6">
        {/* 左：品牌 + 连接状态 */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[17px] leading-none tracking-wide text-ink">
              龙王传说
            </span>
            <span className="hidden text-[11px] tracking-[0.18em] text-gold-500 sm:inline">
              考据助手
            </span>
          </div>
          <span className="hidden h-4 w-px bg-white/[0.08] sm:block" />
          <div className="flex items-center gap-1.5">
            <span
              className={
                "h-1.5 w-1.5 rounded-full " +
                (connected
                  ? "bg-gold-500"
                  : "animate-dot-pulse bg-ink-faint")
              }
            />
            <span className="truncate text-[11.5px] text-ink-muted">
              {connected ? "完整知识库已连接" : "正在连接"}
            </span>
          </div>
        </div>

        {/* 右：新对话 + 设置 */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewChat}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:bg-white/[0.05] hover:text-ink"
            aria-label="新对话"
          >
            <NewChatIcon className="h-4 w-4" />
            <span className="hidden sm:inline">新对话</span>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
            aria-label="连接设置"
            title="连接设置"
          >
            <SettingsIcon className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
      {busy ? <span className="sr-only">正在生成回答</span> : null}
    </header>
  );
}
