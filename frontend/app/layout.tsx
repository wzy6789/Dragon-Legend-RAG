import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "龙王传说 · 考据助手",
  description: "基于完整知识库回答《斗罗大陆III 龙王传说》的人物、剧情、设定与关系问题，并提供参考来源。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0D0F12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-base text-ink antialiased">{children}</body>
    </html>
  );
}
