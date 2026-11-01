import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./workbench.css";
import "./experiment-visuals.css";

export const metadata: Metadata = {
  title: "龙王传说 · 研究工作台",
  description: "可追溯的 RAG 实验工作台：系统版本、基准题库、答案比较、证据核对、独立评测与批次报告。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-base text-ink antialiased">{children}</body>
    </html>
  );
}
