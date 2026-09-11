"use client";

import type { ReactNode } from "react";
import type { Conversation } from "@/lib/types";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  title: string;
  query: string;
  collapsed: boolean;
  mobileOpen: boolean;
  signedIn: boolean;
  onToggleCollapse: () => void;
  onOpenMobileSidebar: () => void;
  onCloseMobileSidebar: () => void;
  onQueryChange: (q: string) => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
  onClearHistory: () => void;
  children: ReactNode;
  footer: ReactNode;
}

/** 全屏应用外壳：左侧历史栏 + 右侧主工作区（顶栏 / 内容 / 输入区） */
export default function AppShell({
  conversations,
  activeId,
  title,
  query,
  collapsed,
  mobileOpen,
  signedIn,
  onToggleCollapse,
  onOpenMobileSidebar,
  onCloseMobileSidebar,
  onQueryChange,
  onNewChat,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onOpenSettings,
  onClearHistory,
  children,
  footer,
}: Props) {
  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-base">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        query={query}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        signedIn={signedIn}
        onToggleCollapse={onToggleCollapse}
        onCloseMobile={onCloseMobileSidebar}
        onQueryChange={onQueryChange}
        onNewChat={onNewChat}
        onSelect={onSelectConversation}
        onRename={onRenameConversation}
        onDelete={onDeleteConversation}
        onOpenSettings={onOpenSettings}
        onClearHistory={onClearHistory}
      />

      {/* 主工作区：填满剩余宽度 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={title}
          onOpenSidebar={onOpenMobileSidebar}
          onOpenSettings={onOpenSettings}
        />
        <div className="min-h-0 flex-1">{children}</div>
        {footer}
      </div>
    </div>
  );
}
