"use client";

import type { Conversation } from "@/lib/types";
import HistoryList from "./HistoryList";
import {
  CloseIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
} from "./icons";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  query: string;
  collapsed: boolean;
  mobileOpen: boolean;
  signedIn: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onQueryChange: (q: string) => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onClearHistory: () => void;
}

const iconBtn =
  "flex h-9 w-9 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-ink-soft";

export default function Sidebar({
  conversations,
  activeId,
  query,
  collapsed,
  mobileOpen,
  signedIn,
  onToggleCollapse,
  onCloseMobile,
  onQueryChange,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
  onOpenSettings,
  onClearHistory,
}: Props) {
  return (
    <>
      {/* 移动端遮罩 */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="关闭侧栏"
          onClick={onCloseMobile}
          className="fixed inset-0 z-30 bg-black/55 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={
          "fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-white/[0.08] bg-[#111318] transition-[width,transform] duration-200 lg:static lg:translate-x-0 " +
          (collapsed ? "w-16" : "w-[272px]") +
          (mobileOpen ? " translate-x-0" : " -translate-x-full")
        }
      >
        {/* 顶部：品牌 + 收缩 */}
        <div className={"flex items-center gap-1.5 px-3 pb-2 pt-3 " + (collapsed ? "justify-center" : "")}>
          {!collapsed && (
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="font-serif text-[15px] leading-none text-ink">龙王传说</span>
              <span className="text-[10.5px] tracking-[0.16em] text-gold-500">考据助手</span>
            </div>
          )}
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? "展开侧栏" : "收起"}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            className={iconBtn + " hidden lg:flex"}
          >
            <PanelLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="关闭侧栏"
            className={iconBtn + " lg:hidden"}
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {/* 新建对话 */}
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={onNewChat}
            title="新建对话"
            className={
              "flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-[12.5px] text-ink-soft transition-colors hover:border-gold-500/30 hover:bg-white/[0.06] hover:text-ink " +
              (collapsed ? "mx-auto h-9 w-9 justify-center" : "w-full px-3 py-2")
            }
          >
            <PlusIcon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>新建对话</span>}
          </button>
        </div>

        {/* 搜索 / 历史 */}
        {collapsed ? (
          <div className="flex justify-center px-3 pb-2">
            <button
              type="button"
              onClick={onToggleCollapse}
              title="搜索历史对话"
              aria-label="搜索历史对话"
              className={iconBtn}
            >
              <SearchIcon className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 focus-within:border-gold-500/35">
              <SearchIcon className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="搜索历史对话"
                aria-label="搜索历史对话"
                className="w-full bg-transparent text-[12.5px] text-ink placeholder:text-ink-faint focus:outline-none"
              />
            </div>
          </div>
        )}

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {!collapsed && (
            <HistoryList
              conversations={conversations}
              activeId={activeId}
              query={query}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
            />
          )}
        </nav>

        {/* 底部：连接状态 / 设置 / 清空历史 */}
        <div className={"border-t border-white/[0.08] px-3 py-2.5 " + (collapsed ? "space-y-1.5" : "")}>
          <div
            className={
              "flex items-center gap-2 " + (collapsed ? "justify-center" : "mb-1.5")
            }
            title={signedIn ? "已登录" : "未登录"}
          >
            <span
              className={
                "h-1.5 w-1.5 shrink-0 rounded-full " +
                (signedIn ? "bg-gold-500" : "bg-ink-faint")
              }
            />
            {!collapsed && (
              <span className="text-[11.5px] text-ink-muted">
                {signedIn ? "已登录" : "未登录"}
              </span>
            )}
          </div>

          <div className={"flex items-center gap-1 " + (collapsed ? "flex-col" : "")}>
            <button
              type="button"
              onClick={onOpenSettings}
              title="设置"
              className={
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink " +
                (collapsed ? "justify-center" : "flex-1")
              }
            >
              <SettingsIcon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>设置</span>}
            </button>
            <button
              type="button"
              onClick={onClearHistory}
              title="清空本地历史"
              aria-label="清空本地历史"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-ink-faint transition-colors hover:bg-white/[0.05] hover:text-red-300"
            >
              <TrashIcon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>清空</span>}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
