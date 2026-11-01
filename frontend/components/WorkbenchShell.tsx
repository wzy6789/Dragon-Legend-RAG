"use client";

import { useState, type ReactNode } from "react";
import type { Conversation } from "@/lib/types";
import HistoryList from "./HistoryList";
import ReadingControls from "./ReadingControls";
import { CloseIcon, PanelLeftIcon, PlusIcon, SearchIcon, SettingsIcon } from "./icons";

export type WorkbenchView = "history" | "versions" | "benchmarks" | "reports";
const NAV: { id: WorkbenchView; title: string; mark: string }[] = [
  { id: "history", title: "实验工作台", mark: "01" }, { id: "versions", title: "系统版本", mark: "02" },
  { id: "benchmarks", title: "基准题库", mark: "03" }, { id: "reports", title: "报告与归档", mark: "04" },
];

interface Props {
  view: WorkbenchView;
  onView: (view: WorkbenchView) => void;
  conversations: Conversation[];
  activeId: string | null;
  title: string;
  query: string;
  onQuery: (query: string) => void;
  collapsed: boolean;
  mobileOpen: boolean;
  inspectorOpen: boolean;
  onToggleCollapse: () => void;
  onMobile: (open: boolean) => void;
  onInspector: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
  onClear: () => void;
  onAdmin: () => void;
  admin: boolean;
  connection: string;
  inspector: ReactNode;
  children: ReactNode;
}

export default function WorkbenchShell(p: Props) {
  const [focused, setFocused] = useState(false);
  return <div className={`research-shell ${focused && p.view === "history" ? "is-focused" : ""} ${p.collapsed ? "is-collapsed" : ""} ${p.inspectorOpen ? "has-inspector" : "inspector-collapsed"}`}>
    {p.mobileOpen && <button className="research-overlay sidebar-overlay" aria-label="关闭导航" onClick={() => p.onMobile(false)} />}
    <aside className={`research-sidebar ${p.mobileOpen ? "is-open" : ""}`} aria-label="研究导航">
      <div className="research-brand"><span className="brand-symbol" aria-hidden="true">R</span><div className="sidebar-label"><strong>RAG 实验台</strong></div>
        <button className="icon-button collapse-button" aria-label={p.collapsed ? "展开导航" : "收起导航"} onClick={p.onToggleCollapse}><PanelLeftIcon className="h-4 w-4" /></button>
        <button className="icon-button mobile-close" aria-label="关闭导航" onClick={() => p.onMobile(false)}><CloseIcon className="h-4 w-4" /></button>
      </div>
      <button className="research-new" onClick={p.onNew} title="新建对话（Ctrl+Shift+O）"><PlusIcon className="h-4 w-4" /><span className="sidebar-label">新建对话</span></button>
      <nav className="research-nav" aria-label="工作区">{NAV.map((item) => <button key={item.id} title={item.title} aria-current={p.view === item.id ? "page" : undefined} className={p.view === item.id ? "active" : ""} onClick={() => { p.onView(item.id); p.onMobile(false); }}><span className="nav-mark" aria-hidden="true">{item.title.slice(0,1)}</span><span className="sidebar-label">{item.title}</span></button>)}</nav>
      <div className="history-heading sidebar-label"><span>会话历史</span><span>{p.conversations.length}</span></div>
      <label className="research-search sidebar-label"><SearchIcon className="h-3.5 w-3.5" /><input value={p.query} onChange={(event) => p.onQuery(event.target.value)} placeholder="搜索问题与回答" aria-label="搜索历史" /></label>
      <div className="research-history sidebar-label"><HistoryList conversations={p.conversations} activeId={p.activeId} query={p.query} onSelect={p.onSelect} onRename={p.onRename} onDelete={p.onDelete} /></div>
      <div className="sidebar-footer">
        <button className="admin-entry" onClick={p.onAdmin} title={p.admin ? "管理员会话" : "管理员登录"}><span className={`status-dot ${p.admin ? "ready" : ""}`} /><span className="sidebar-label">{p.admin ? "管理员会话已启用" : "访客 · 管理员登录"}</span></button>
        <div className="sidebar-footer-actions"><button onClick={p.onSettings} title="BYOK 连接设置"><SettingsIcon className="h-4 w-4" /><span className="sidebar-label">连接设置</span></button><button onClick={p.onClear} className="sidebar-label">清空历史</button></div>
      </div>
    </aside>
    <main className="research-main">
      <header className="research-topbar"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => p.onMobile(true)}><PanelLeftIcon className="h-4 w-4" /></button><div className="topbar-title"><h1>{p.view === "history" ? p.title : NAV.find((item) => item.id === p.view)?.title}</h1></div><span className="connection-label" title={p.connection}><span className={`status-dot ${p.connection === "知识库已连接" ? "ready" : ""}`} /><span className="sr-only">{p.connection}</span></span>{p.view === "history" && <button className="focus-toggle" aria-pressed={focused} onClick={()=>setFocused(value=>!value)}>{focused ? "退出专注" : "专注"}</button>}<ReadingControls /><button className="quiet-button inspector-toggle" aria-expanded={p.inspectorOpen} onClick={p.onInspector}>{p.inspectorOpen ? "收起详情" : "详情"}</button></header>
      {p.children}
    </main>
    {p.inspectorOpen && <button className="research-overlay inspector-overlay" aria-label="关闭实验详情" onClick={p.onInspector} />}
    <aside className={`research-inspector ${p.inspectorOpen ? "is-open" : ""}`} aria-label="实验详情"><button className="icon-button inspector-close" aria-label="关闭实验详情" onClick={p.onInspector}><CloseIcon className="h-4 w-4" /></button>{p.inspector}</aside>
  </div>;
}
