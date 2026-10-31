"use client";

import { useEffect, useRef, useState } from "react";

interface Props { open: boolean; authenticated: boolean; configured: boolean | null; busy: boolean; error: string; onLogin: (password: string) => void; onLogout: () => void; onClose: () => void }

export default function AdminDialog(p: Props) {
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (p.open) { setPassword(""); input.current?.focus(); } }, [p.open]);
  useEffect(() => { if (!p.open) return; const handler = (event: KeyboardEvent) => { if (event.key === "Escape") p.onClose(); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [p.open, p.onClose]);
  if (!p.open) return null;
  return <div className="research-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) p.onClose(); }}><section className="research-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title"><h2 id="admin-title">管理员登录</h2><p className="muted">此浏览器自动记住登录，退出可清除。</p>{p.error && <p className="inline-error" role="alert">{p.error}</p>}{p.configured === false && <p className="inline-error">后端尚未配置管理员登录。</p>}{p.authenticated ? <button className="quiet-button" onClick={() => { p.onLogout(); p.onClose(); }}>退出管理员登录</button> : <form onSubmit={(event) => { event.preventDefault(); if (password.trim() && !p.busy) { p.onLogin(password); setPassword(""); } }}><label className="stack-label" htmlFor="admin-password">管理员密码<input ref={input} id="admin-password" type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required /></label><button className="primary-button full-width" disabled={!password.trim() || p.busy || p.configured === false}>{p.busy ? "正在验证…" : "登录管理员"}</button></form>}<button className="quiet-button full-width" onClick={p.onClose}>关闭</button></section></div>;
}
