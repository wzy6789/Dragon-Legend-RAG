"use client";
import { useEffect, useRef, useState } from "react";
import { READING_DEFAULTS, loadReading, saveReading, type ReadingPreferences } from "@/lib/reading";

export default function ReadingControls() {
  const [prefs, setPrefs] = useState<ReadingPreferences>(READING_DEFAULTS);
  const [ready, setReady] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(()=>{ setPrefs(loadReading()); setReady(true); },[]);
  useEffect(()=>{
    if (!ready) return;
    const root = document.documentElement;
    root.dataset.readingFont = prefs.font;
    root.dataset.readingSpacing = prefs.spacing;
    root.style.setProperty("--answer-font-size",`${prefs.size}px`);
    saveReading(prefs);
  },[prefs, ready]);
  useEffect(()=>{
    const close = (e: PointerEvent) => { if (details.current?.open && !details.current.contains(e.target as Node)) details.current.open = false; };
    document.addEventListener("pointerdown",close);
    return ()=>document.removeEventListener("pointerdown",close);
  },[]);
  function change(patch: Partial<ReadingPreferences>) { setPrefs(p=>({...p,...patch})); }
  return <details ref={details} className="reading-controls" onKeyDown={e=>{if(e.key==="Escape"&&details.current){details.current.open=false;details.current.querySelector("summary")?.focus();}}}>
    <summary title="调整回答字体与字号"><span aria-hidden="true" className="reading-symbol">Aa</span><span>阅读</span></summary>
    <div className="reading-popover"><header><h2>阅读设置</h2><button onClick={()=>setPrefs({...READING_DEFAULTS})}>恢复默认</button></header>
      <fieldset><legend>正文字体</legend><div className="reading-choice"><button className="font-sample-sans" aria-pressed={prefs.font==="sans"} onClick={()=>change({font:"sans"})}>清晰黑体</button><button className="font-sample-serif" aria-pressed={prefs.font==="serif"} onClick={()=>change({font:"serif"})}>书卷宋体</button></div></fieldset>
      <fieldset><legend>字号</legend><div className="reading-choice">{([16,18,20] as const).map(n=><button key={n} aria-pressed={prefs.size===n} onClick={()=>change({size:n})}>{n}<span> px</span></button>)}</div></fieldset>
      <fieldset><legend>行距</legend><div className="reading-choice"><button aria-pressed={prefs.spacing==="standard"} onClick={()=>change({spacing:"standard"})}>标准</button><button aria-pressed={prefs.spacing==="relaxed"} onClick={()=>change({spacing:"relaxed"})}>宽松</button></div></fieldset>
      <p className="reading-preview" aria-label="字体预览">以证据为依据，让每一次实验都清晰可读。</p><p className="reading-hint">设置自动保存在当前浏览器</p>
    </div>
  </details>;
}
