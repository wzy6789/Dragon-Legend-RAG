"use client";

import { memo } from "react";
import type { Tier } from "@/lib/types";
import { BookIcon, DownloadIcon, MenuIcon, SettingsIcon } from "./icons";

const VERSION_LABEL: Record<Tier, string> = {
  flash: "v1.9 · sem_select",
  pro: "v2.5 Pro",
  max: "v3.0 MAX",
};

interface Props {
  title: string;
  tier: Tier;
  connection: string;
  evidenceOpen: boolean;
  onOpenSidebar: () => void;
  onOpenSettings: () => void;
  onToggleEvidence: () => void;
  onExport: () => void;
}

function TopBarImpl({ title, tier, connection, evidenceOpen, onOpenSidebar, onOpenSettings, onToggleEvidence, onExport }: Props) {
  const online = connection === "知识库已连接";
  return (
    <header className="flex h-[62px] shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#101216]/90 px-3 sm:px-5">
      <button type="button" onClick={onOpenSidebar} aria-label="打开对话历史" title="打开对话历史" className="topbar-icon lg:hidden">
        <MenuIcon className="h-4 w-4" />
      </button>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="hidden text-[12px] font-medium tracking-wide text-ink-muted sm:inline">龙王传说</span>
        <span className="hidden text-ink-faint sm:inline">/</span>
        <span className="max-w-[44vw] truncate text-[13px] font-medium text-ink-soft lg:max-w-[380px]">{title}</span>
        <span className="hidden rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1 text-[10px] text-ink-faint md:inline">{VERSION_LABEL[tier]}</span>
      </div>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <span className="hidden items-center gap-1.5 px-2 text-[10.5px] text-ink-faint md:flex" title={connection}>
          <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : connection === "知识库离线" ? "bg-red-400" : "animate-pulse bg-amber-300"}`} />
          {connection}
        </span>
        <button type="button" onClick={onToggleEvidence} aria-pressed={evidenceOpen} aria-label="切换原文证据栏" title="原文证据" className={`topbar-icon ${evidenceOpen ? "topbar-icon-active" : ""}`}>
          <BookIcon className="h-[17px] w-[17px]" />
        </button>
        <button type="button" onClick={onExport} aria-label="导出当前对话" title="导出对话" className="topbar-icon">
          <DownloadIcon className="h-[17px] w-[17px]" />
        </button>
        <button type="button" onClick={onOpenSettings} aria-label="连接与设置" title="连接与设置" className="topbar-icon">
          <SettingsIcon className="h-[17px] w-[17px]" />
        </button>
      </div>
    </header>
  );
}

export default memo(TopBarImpl);
