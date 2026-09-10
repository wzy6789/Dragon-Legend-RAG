"use client";

import { memo } from "react";
import { MenuIcon, SettingsIcon } from "./icons";

interface Props {
  title: string;
  onOpenSidebar: () => void;
  onOpenSettings: () => void;
}

function TopBarImpl({ title, onOpenSidebar, onOpenSettings }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.08] px-3 sm:px-4">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="打开侧栏"
        title="侧栏"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-white/[0.06] hover:text-ink lg:hidden"
      >
        <MenuIcon className="h-4 w-4" />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden text-[12.5px] text-ink-muted sm:inline">龙王传说</span>
        <span className="hidden text-ink-faint sm:inline">/</span>
        <span className="max-w-[46vw] truncate text-[13px] text-ink-soft lg:max-w-[320px]">
          {title}
        </span>
      </div>

      <div className="ml-auto">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="设置"
          title="设置"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-white/[0.06] hover:text-ink"
        >
          <SettingsIcon className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  );
}

export default memo(TopBarImpl);
