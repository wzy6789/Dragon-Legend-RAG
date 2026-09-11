"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-[380px] animate-fade-in rounded-[14px] border border-white/[0.08] bg-[#15181D] p-5 shadow-2xl shadow-black/50">
        <h2 className="text-[14.5px] font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-2 text-[12.5px] leading-5 text-ink-muted">{description}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[10px] px-3.5 py-2 text-[13px] text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              "rounded-[10px] px-4 py-2 text-[13px] font-medium transition-colors " +
              (danger
                ? "bg-red-500/80 text-white hover:bg-red-500"
                : "bg-gold-500 text-[#15181D] hover:bg-gold-400")
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
