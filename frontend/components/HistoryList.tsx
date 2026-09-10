"use client";

import { useState } from "react";
import { formatRelative, groupConversations } from "@/lib/history";
import type { Conversation } from "@/lib/types";
import { PencilIcon, TrashIcon } from "./icons";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  query: string;
  collapsed?: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export default function HistoryList({
  conversations,
  activeId,
  query,
  collapsed,
  onSelect,
  onRename,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const groups = groupConversations(conversations);

  if (conversations.length === 0) {
    return (
      <p className="px-2.5 py-3 text-[12px] leading-5 text-ink-faint">
        {query ? "没有匹配的对话。" : "还没有对话，开始提问后会出现在这里。"}
      </p>
    );
  }

  const commit = (id: string) => {
    const next = draft.trim();
    if (next) onRename(id, next);
    setEditingId(null);
  };

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.label}>
          {!collapsed && (
            <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium tracking-wide text-ink-faint">
              {group.label}
            </div>
          )}
          <ul className="space-y-0.5">
            {group.items.map((c) => {
              const active = c.id === activeId;
              if (editingId === c.id) {
                return (
                  <li key={c.id} className="px-1">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commit(c.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="w-full rounded-lg border border-white/[0.1] bg-[#0E1013] px-2.5 py-1.5 text-[12.5px] text-ink focus:border-gold-500/50 focus:outline-none"
                    />
                  </li>
                );
              }
              return (
                <li key={c.id}>
                  <div
                    className={
                      "group/item flex items-center gap-1 rounded-lg pl-2.5 pr-1 transition-colors " +
                      (active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]")
                    }
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      title={c.title}
                      className="flex min-w-0 flex-1 flex-col items-start py-1.5 text-left"
                    >
                      <span
                        className={
                          "w-full truncate text-[12.5px] " +
                          (active ? "text-ink" : "text-ink-soft")
                        }
                      >
                        {c.title}
                      </span>
                      {!collapsed && (
                        <span className="text-[10.5px] text-ink-faint">
                          {formatRelative(c.updatedAt)}
                        </span>
                      )}
                    </button>

                    {!collapsed && (
                      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          aria-label="重命名"
                          title="重命名"
                          onClick={() => {
                            setEditingId(c.id);
                            setDraft(c.title);
                          }}
                          className="rounded-md p-1 text-ink-faint hover:bg-white/[0.06] hover:text-ink-soft"
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="删除"
                          title="删除"
                          onClick={() => onDelete(c.id)}
                          className="rounded-md p-1 text-ink-faint hover:bg-white/[0.06] hover:text-red-300"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
