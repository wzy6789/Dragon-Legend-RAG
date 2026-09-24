"use client";

import type { ReactNode } from "react";
import type { Conversation, SourceItem, Tier } from "@/lib/types";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import EvidencePanel from "./EvidencePanel";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  title: string;
  query: string;
  collapsed: boolean;
  mobileOpen: boolean;
  signedIn: boolean;
  connection: string;
  tier: Tier;
  evidence: SourceItem[];
  evidenceOpen: boolean;
  onToggleEvidence: () => void;
  onExportConversation: () => void;
  onToggleCollapse: () => void;
  onOpenMobileSidebar: () => void;
  onCloseMobileSidebar: () => void;
  onQueryChange: (query: string) => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
  onClearHistory: () => void;
  children: ReactNode;
  footer: ReactNode;
}

export default function AppShell(props: Props) {
  return (
    <div className="app-shell">
      <Sidebar
        conversations={props.conversations}
        activeId={props.activeId}
        query={props.query}
        collapsed={props.collapsed}
        mobileOpen={props.mobileOpen}
        signedIn={props.signedIn}
        onToggleCollapse={props.onToggleCollapse}
        onCloseMobile={props.onCloseMobileSidebar}
        onQueryChange={props.onQueryChange}
        onNewChat={props.onNewChat}
        onSelect={props.onSelectConversation}
        onRename={props.onRenameConversation}
        onDelete={props.onDeleteConversation}
        onOpenSettings={props.onOpenSettings}
        onClearHistory={props.onClearHistory}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={props.title}
          tier={props.tier}
          connection={props.connection}
          evidenceOpen={props.evidenceOpen}
          onOpenSidebar={props.onOpenMobileSidebar}
          onOpenSettings={props.onOpenSettings}
          onToggleEvidence={props.onToggleEvidence}
          onExport={props.onExportConversation}
        />
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col">{props.children}{props.footer}</section>
          {props.evidenceOpen ? <>
            <button type="button" aria-label="关闭证据栏" onClick={props.onToggleEvidence} className="fixed inset-0 z-10 bg-black/35 lg:hidden" />
            <EvidencePanel sources={props.evidence} onClose={props.onToggleEvidence} />
          </> : null}
        </div>
      </main>
    </div>
  );
}
