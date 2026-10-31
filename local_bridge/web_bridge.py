"""将本机完整 RAG 以 SSE API 形式提供给网页版。

索引、原著资料和密钥始终保留在本机；此服务不把它们写入 GitHub。
"""
from __future__ import annotations

import json
import hashlib
import hmac
import os
import queue
import sqlite3
import threading
import time
import uuid
import sys
from contextlib import contextmanager
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Iterator

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import agents
import config
from agents import QAAgent
import experiment_catalog
import experiment_service

app = FastAPI(title="Dragon Legend Full RAG Bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://wzy6789.github.io", "http://localhost:3000", "http://localhost:3011", "http://127.0.0.1:3011"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    tier: str = "flash"
    conversation_id: str | None = None
    # 可选的按请求 Flash 版本覆盖（"v1.6" / "v1.7" / "v1.8" / "v1.9"）。
    # 目的是 A/B 对照时**不改全局配置**——任务书明确禁止在请求期间全局切换版本。
    flash_version: str | None = None


class RunRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    tier: str = "flash"
    conversation_id: str = Field(min_length=1, max_length=128)
    client_request_id: str = Field(min_length=1, max_length=128)
    system_id: str | None = None
    benchmark_id: str = "free"
    question_id: str | None = None
    protocol_id: str | None = None
    comparison_parent_run_id: str | None = None


_sessions: dict[str, QAAgent] = {}
_request_windows: dict[str, list[float]] = {}
_llm_lock = threading.RLock()
_RATE_LIMIT = 60
_RATE_WINDOW = 60.0
_RUN_DB = Path(os.environ.get("RAG_EXPERIMENT_DB", str(experiment_catalog.ROOT / "data/experiment_web_runs.sqlite3")))
_RUN_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rag-run")
_RUN_API_KEYS: dict[str, str] = {}
_RUN_FUTURES: dict[str, Future] = {}
_RUN_CANCEL: dict[str, threading.Event] = {}
_RUN_MEMORY_LOCK = threading.RLock()
_MAX_PENDING_RUNS = 8

# The web tiers are intentionally product-facing names, while the underlying
# capability profiles remain reproducible evaluation configurations.
_TIER_PROFILES = {
    "flash": {"profile": "RAG1", "kg": True, "v25": False,
              "version": "v1.9 sem_select"},
    "pro": {"profile": "RAG4", "kg": True, "v25": True, "v30": False,
            "v31": False,
            "version": "v2.5 Pro"},
    "max": {"profile": "RAG4", "kg": True, "v25": False, "v30": False,
            "v31": True, "version": "v3.1 MAX"},
}
_PROFILE_FLAGS = (
    "CRAG_FILTER_ENABLED", "RELEVANCE_ENABLED", "AGENTIC_ENABLED",
    "AGENTIC2_ENABLED", "ITERATIVE_ENABLED", "POLISH_ENABLED",
    "DECOMPOSE_ENABLED", "HYDE_ENABLED", "CHAPTER_ALIGNMENT_ENABLED",
    "KG_ENABLED", "PRO_V25_ENABLED", "PRO_V25_KG_ENABLED",
    "PRO_V30_ENABLED", "PRO_V30_KG_ENABLED", "PRO_V31_ENABLED",
    "PRO_V31_KG_ENABLED", "PRO_V32_ENABLED",
)
_V19_PROFILE_KEYS = tuple(dict.fromkeys(
    [key for key in (
        "FLASH_V19_PLAN_V2", "FLASH_V19_REF_RESOLVE",
        "FLASH_V19_PLAN_CONSISTENCY", "FLASH_V19_REASONING_DECOUPLE",
        "FLASH_V19_QUERY_CLEAN", "FLASH_V19_TOPIC_EXPAND",
        "FLASH_V19_EMBEDDING_RETRIEVAL", "FLASH_V19_SELECTION_V2",
        "FLASH_V19_QUERY_CLEAN_V18", "FLASH_V19_TOPIC_RERANK_RESERVE",
    ) if hasattr(config, key)]
))


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@contextmanager
def _run_db() -> Iterator[sqlite3.Connection]:
    _RUN_DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(_RUN_DB), timeout=20.0)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=20000")
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _init_run_store() -> None:
    with _run_db() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                tier TEXT NOT NULL,
                version TEXT NOT NULL,
                client_request_id TEXT NOT NULL,
                message TEXT NOT NULL,
                status TEXT NOT NULL,
                stage TEXT NOT NULL DEFAULT '',
                answer TEXT NOT NULL DEFAULT '',
                draft TEXT NOT NULL DEFAULT '',
                sources_json TEXT NOT NULL DEFAULT '[]',
                completion_status TEXT NOT NULL DEFAULT '',
                warning TEXT NOT NULL DEFAULT '',
                error TEXT NOT NULL DEFAULT '',
                seq INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                UNIQUE(owner_id, client_request_id)
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS run_events (
                run_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at REAL NOT NULL,
                PRIMARY KEY(run_id, seq),
                FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
            )
        """)
        db.execute("CREATE INDEX IF NOT EXISTS idx_runs_owner_status ON runs(owner_id, status)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(owner_id, conversation_id)")


def _owner_id(access_key: str) -> str:
    return hashlib.sha256(access_key.encode("utf-8")).hexdigest()


def _publish_run_event(run_id: str, event_type: str, payload: dict) -> int:
    now = time.time()
    statuses = {
        "queued": "queued", "stage": "running", "draft_reset": "drafting",
        "draft_token": "drafting", "token": "streaming", "sources": "running",
        "final": "reviewing", "done": "done", "error": "error",
        "cancelled": "stopped", "cancelling": "cancelling",
        "interrupted": "interrupted",
    }
    with _run_db() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT seq FROM runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            db.rollback()
            return 0
        seq = int(row["seq"]) + 1
        envelope = {"run_id": run_id, "seq": seq, **payload}
        assignments = ["seq=?", "updated_at=?", "status=?"]
        values: list[object] = [seq, now, statuses.get(event_type, "running")]
        if event_type == "stage":
            assignments.append("stage=?")
            values.append(str(payload.get("stage", ""))[:120])
        elif event_type == "draft_reset":
            assignments.append("draft=?")
            values.append("")
        elif event_type == "draft_token":
            assignments.append("draft=draft || ?")
            values.append(str(payload.get("text", "")))
        elif event_type == "token":
            assignments.append("answer=answer || ?")
            values.append(str(payload.get("text", "")))
        elif event_type == "sources":
            assignments.append("sources_json=?")
            values.append(json.dumps(payload.get("sources", []), ensure_ascii=False))
        elif event_type == "final":
            if payload.get("use_streamed_answer") and not payload.get("sources"):
                stored = db.execute("SELECT sources_json FROM runs WHERE run_id=?", (run_id,)).fetchone()
                payload = {**payload, "sources": json.loads(stored["sources_json"] or "[]")}
            assignments.extend(["sources_json=?", "completion_status=?", "warning=?"])
            values.extend([
                json.dumps(payload.get("sources", []), ensure_ascii=False),
                str(payload.get("completion_status", "complete")),
                str(payload.get("warning", ""))[:1000],
            ])
            if not payload.get("use_streamed_answer"):
                assignments.append("answer=?")
                values.append(str(payload.get("text", "")))
        elif event_type in ("error", "interrupted"):
            assignments.append("error=?")
            values.append(str(payload.get("message", "任务失败"))[:2000])
        values.append(run_id)
        db.execute(f"UPDATE runs SET {', '.join(assignments)} WHERE run_id=?", values)
        db.execute(
            "INSERT INTO run_events(run_id, seq, event_type, payload_json, created_at) VALUES(?,?,?,?,?)",
            (run_id, seq, event_type, json.dumps(envelope, ensure_ascii=False), now),
        )
        db.commit()
    experiment_service.on_event(run_id, event_type, payload)
    return seq


def _run_snapshot(row: sqlite3.Row) -> dict:
    return experiment_service.decorate_snapshot({
        "run_id": row["run_id"], "conversation_id": row["conversation_id"],
        "tier": row["tier"], "version": row["version"], "status": row["status"],
        "stage": row["stage"], "answer": row["answer"], "draft": row["draft"],
        "sources": json.loads(row["sources_json"] or "[]"),
        "completion_status": row["completion_status"], "warning": row["warning"],
        "error": row["error"], "seq": row["seq"],
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    })


def _get_owned_run(run_id: str, owner_id: str) -> sqlite3.Row | None:
    with _run_db() as db:
        return db.execute(
            "SELECT * FROM runs WHERE run_id=? AND owner_id=?", (run_id, owner_id)
        ).fetchone()


def _recover_interrupted_runs() -> None:
    with _run_db() as db:
        rows = db.execute(
            "SELECT run_id FROM runs WHERE status IN ('queued','running','drafting','streaming','reviewing','cancelling')"
        ).fetchall()
    for row in rows:
        _publish_run_event(
            row["run_id"], "interrupted",
            {"message": "本机服务曾重启；已保留当前内容，请重新发送以继续。"},
        )


def _sources(items: list[dict]) -> list[dict]:
    """把原系统来源结构转换成网页来源卡片结构。"""
    out = []
    for item in items:
        source_type = item.get("source_type", "novel")
        title = item.get("file_name") if source_type != "novel" else item.get("chapter_title")
        raw = (item.get("text_full") or item.get("text") or item.get("text_preview") or item.get("snippet") or "")
        original_text = raw
        # Flash 的召回块首行是「第N章 标题（本章涉及：…）」，当摘要噪声太大，去掉
        head, _, rest = raw.partition("\n")
        if rest and head.lstrip().startswith("第") and "章" in head:
            raw = rest
        out.append({
            "chunk_id": item.get("chunk_id") or item.get("id"),
            "source_type": source_type,
            "text_full": original_text,
            "chapter_title": item.get("chapter_title") or item.get("chapter") or "",
            "file_name": item.get("file_name") or item.get("title") or "",
            "chapter_index": item.get("chapter_index"),
            "chapter": item.get("chapter_title", ""),
            "title": title or "",
            "snippet": raw.strip(),
        })
    return out


def _get_agent(conversation_id: str, owner_id: str = "") -> QAAgent:
    session_key = owner_id + ":" + conversation_id
    with _RUN_MEMORY_LOCK:
        agent = _sessions.get(session_key)
        if agent is None:
            agent = QAAgent()
            try:
                with _run_db() as db:
                    rows = db.execute(
                        "SELECT message,answer FROM runs WHERE conversation_id=? AND owner_id=? AND status='done' "
                        "AND answer<>'' ORDER BY created_at DESC LIMIT 8",
                        (conversation_id, owner_id),
                    ).fetchall()
                agent.messages = []
                for row in reversed(rows):
                    agent.messages.extend([
                        {"role": "user", "content": row["message"]},
                        {"role": "assistant", "content": row["answer"]},
                    ])
                agent._trim_history()
            except sqlite3.OperationalError:
                pass
            _sessions[session_key] = agent
        return agent


def _reload_agent_history(conversation_id: str, owner_id: str = "") -> None:
    agent = _sessions.get(owner_id + ":" + conversation_id)
    if agent is None:
        return
    agent.messages = []
    try:
        with _run_db() as db:
            rows = db.execute(
                "SELECT message,answer FROM runs WHERE conversation_id=? AND owner_id=? AND status='done' "
                "AND answer<>'' ORDER BY created_at DESC LIMIT 8",
                (conversation_id, owner_id),
            ).fetchall()
        for row in reversed(rows):
            agent.messages.extend([
                {"role": "user", "content": row["message"]},
                {"role": "assistant", "content": row["answer"]},
            ])
        agent._trim_history()
    except sqlite3.OperationalError:
        return


def _authorize(request: Request, access_key: str | None) -> None:
    if not access_key or not access_key.strip():
        raise HTTPException(401, "请填写 DeepSeek API Key")
    client_ip = request.headers.get("CF-Connecting-IP") or request.client.host if request.client else "unknown"
    now = time.monotonic()
    bucket = client_ip + (":read" if request.method == "GET" else ":write")
    recent = [t for t in _request_windows.get(bucket, []) if now - t < _RATE_WINDOW]
    limit = 600 if request.method == "GET" else _RATE_LIMIT
    if len(recent) >= limit:
        raise HTTPException(429, "请求过于频繁，请稍后再试")
    _request_windows[bucket] = recent + [now]


@contextmanager
def _request_runtime(tier: str, user_key: str | None,
                     flash_version: str | None = None,
                     flash_profile: str | None = None):
    """将 BYOK 与能力档严格限定在单次请求。

    QAAgent 的既有实现以 config 模块作为运行时配置，所以必须
    串行切换：这可避免一个 Pro 请求在执行时被 Max 请求意外升档。
    """
    tier_config = _TIER_PROFILES[tier]
    with _llm_lock:
        old_key, old_client = config.DEEPSEEK_API_KEY, agents._client
        old_flags = {name: getattr(config, name) for name in _PROFILE_FLAGS}
        v19_module = None
        old_v19_profile = None
        old_v19_flags = {}
        config.apply_cap_profile(tier_config["profile"])
        # v1.8 的 Flash 只使用认证图谱的一跳导航；它不能沿用 RAG1 的
        # KG=False 档位，否则“Compiled Reflex”会退化成普通文本检索。
        requested_flash = str(
            (flash_version or getattr(config, "FLASH_V19_FORCE", "") or
             getattr(config, "FLASH_V18_FORCE", "")) if tier == "flash" else ""
        ).strip().lower()
        v19 = tier == "flash" and (
            requested_flash in ("v1.9", "1.9", "v19", "flash_v19")
            or bool(getattr(config, "FLASH_V19_ENABLED", False))
        )
        v18 = tier == "flash" and (
            requested_flash in ("v1.8", "1.8", "v18", "flash_v18")
            or bool(getattr(config, "FLASH_V18_ENABLED", False))
        )
        config.KG_ENABLED = bool(tier_config["kg"] or v18 or v19)
        config.PRO_V25_ENABLED = bool(tier_config["v25"])
        config.PRO_V25_KG_ENABLED = bool(tier_config["v25"])
        config.PRO_V30_ENABLED = bool(tier_config.get("v30", False))
        config.PRO_V30_KG_ENABLED = bool(tier_config.get("v30", False))
        config.PRO_V31_ENABLED = bool(tier_config.get("v31", False))
        config.PRO_V31_KG_ENABLED = bool(tier_config.get("v31", False))
        # v3.2 remains a separately tested candidate. Preserve current production routes.
        config.PRO_V32_ENABLED = False
        if v19:
            import v19_profiles as v19_module
            old_v19_profile = v19_module.active_profile()
            old_v19_flags = {name: getattr(config, name) for name in set(_V19_PROFILE_KEYS) | set(v19_module.profile_config(flash_profile or "sem_select"))}
            v19_module.apply_profile(
                flash_profile or getattr(config, "FLASH_V19_PROFILE", "sem_select")
            )
        if user_key:
            config.DEEPSEEK_API_KEY = user_key
            agents._client = None
        try:
            yield
        finally:
            for name, value in old_flags.items():
                setattr(config, name, value)
            for name, value in old_v19_flags.items():
                setattr(config, name, value)
            if v19_module is not None and old_v19_profile is not None:
                v19_module._ACTIVE = old_v19_profile
            config.DEEPSEEK_API_KEY = old_key
            agents._client = old_client


def _adapt_pieces(pieces: Iterator[str]) -> Iterator[str]:
    """把 Flash 老协议的裸片段翻译成前端要的 SSE 帧。

    背景：`flash_v16.answer_stream` / `QAAgent.answer_stream` 是给命令行用的老协议，
    产出的是**裸 NDJSON 控制行**（{"type": "meta"|"sources"|"error", ...}）和**裸文本**
    片段，完全没有 `event:` / `data:` 前缀。而网页端解析器（frontend/lib/sse.ts）
    只派发「至少含一行 data:」的事件块，裸行会被静默丢弃 —— 结果就是网页 flash 档
    一个字都不显示。所以必须在 bridge 层逐段翻译：

        裸文本            -> event: token    data: {"text": ...}
        {"type":"sources"} -> event: sources  data: {"sources": [...]}
        {"type":"error"}   -> event: error    data: {"message": ...}
        {"type":"meta"}    -> 丢弃（前端不展示）
    """
    for piece in pieces:
        if isinstance(piece, str) and (piece.lstrip().startswith("[ERROR]") or piece.lstrip().startswith("（API 返回空响应")):
            raise RuntimeError("生成接口失败或返回空响应")
        if piece.startswith("{"):
            try:
                control = json.loads(piece)
            except json.JSONDecodeError:
                control = None
            if isinstance(control, dict) and "type" in control:
                kind = control["type"]
                if kind == "sources":
                    trace = control.get("meta") or {}
                    yield _event("sources", {"sources": _sources(control.get("data", [])),
                        "retrieval_ms": trace.get("elapsed_retrieval_ms", trace.get("retrieval_ms"))})
                elif kind == "error":
                    yield _event("error", {"message": control.get("message", "回答失败")})
                elif kind == "meta":
                    continue
                else:
                    yield _event("token", {"text": piece})
                continue
        if piece:
            yield _event("token", {"text": piece})


def resolve_flash_version(explicit: str | None = None) -> str:
    """按请求解析要用的 Flash 版本（**只读全局配置，不在请求期间改写它**）。

    优先级：请求参数 > FLASH_V17_FORCE（评测用） > FLASH_V17_ENABLED 开关。
    上线规则（用户裁定）：v1.7 门槛不达标就保持 FLASH_V17_ENABLED=False，网站继续 v1.6。
    """
    want = str(explicit or getattr(config, "FLASH_V19_FORCE", "") or
               getattr(config, "FLASH_V18_FORCE", "") or
               getattr(config, "FLASH_V17_FORCE", "") or "").strip().lower()
    if want in ("v1.9", "1.9", "v19", "flash_v19"):
        return "v1.9"
    if want in ("v1.8", "1.8", "v18", "flash_v18"):
        return "v1.8"
    if want in ("v1.7", "1.7", "v17", "flash_v17"):
        return "v1.7"
    if want in ("v1.6", "1.6", "v16", "flash_v16"):
        return "v1.6"
    if getattr(config, "FLASH_V19_ENABLED", False):
        return "v1.9"
    if getattr(config, "FLASH_V18_ENABLED", False):
        return "v1.8"
    return "v1.7" if getattr(config, "FLASH_V17_ENABLED", False) else "v1.6"


def flash_health() -> str:
    """health 里报告的 Flash 版本串。"""
    v = resolve_flash_version()
    if v == "v1.9":
        return "v1.9"
    if v == "v1.8":
        return "v1.8"
    if v == "v1.7":
        return "v1.7"
    return config.FLASH_V16_VERSION if getattr(config, "FLASH_V16_ENABLED", False) else "legacy"


def _flash(agent: QAAgent, question: str,
           version: str | None = None) -> Iterator[str]:
    """Flash 档。

    v1.8：Compiled Reflex RAG —— 离线证据胶囊 + 条件式纠错 + 关键证据保护 + 单次生成。
    v1.7：Evidence-Set Flash RAG —— 本地槽位规划 + 覆盖优先证据集 + 单次生成。
    v1.6（默认，直到 v1.7 过门槛）：Adaptive Evidence Fast RAG。
    回退：FLASH_V16_ENABLED=False 时走旧 answer_stream（RAG1 口径）。
    三条路径都是老协议的裸片段，统一经 _adapt_pieces 转成 SSE。
    """
    ver = resolve_flash_version(version)
    if ver == "v1.9":
        import flash_v19
        yield _event("stage", {"stage": "证据义务编译"})
        yield from _adapt_pieces(flash_v19.answer_stream(agent, question))
        return
    if ver == "v1.8":
        import flash_v18
        yield _event("stage", {"stage": "编译证据反射检索"})
        yield from _adapt_pieces(flash_v18.answer_stream(agent, question))
        return
    if ver == "v1.7":
        import flash_v17
        yield _event("stage", {"stage": "槽位规划"})
        yield from _adapt_pieces(flash_v17.answer_stream(agent, question))
        return
    if getattr(config, "FLASH_V16_ENABLED", False):
        import flash_v16
        yield _event("stage", {"stage": "极速检索"})
        yield from _adapt_pieces(flash_v16.answer_stream(agent, question))
        return

    # ---- 旧口径（保留以便对照/回退）----
    yield _event("stage", {"stage": "检索资料"})
    yield from _adapt_pieces(agent.answer_stream(question))


def _tidy_list_spacing(text: str) -> str:
    """把编号/无序列表项之间的空行去掉。

    原因：前端 markdown 渲染器（lib/markdown.tsx）遇到空行会打断列表，
    每个编号项各成一个 <ol>，浏览器对每个 <ol> 都从 1 开始编号，用户看到
    的是 "1. 1. 1."。标准 markdown 的列表项之间本就不需要空行——去掉后
    既符合规范，渲染器也会合并成一个列表。

    只删除「前一非空行是列表项 且 后一非空行也是列表项」的纯空行；
    列表与正文之间的空行一律保留，不影响段落结构。
    """
    import re as _re
    item = _re.compile(r"^\s*(?:\d{1,3}[.、)]|[-*•])\s+\S")
    lines = text.split("\n")
    out: list[str] = []
    k = 0
    while k < len(lines):
        ln = lines[k]
        if ln.strip():
            out.append(ln)
            k += 1
            continue
        # 空行：向后找到下一个非空行
        m = k
        while m < len(lines) and not lines[m].strip():
            m += 1
        prev_ok = bool(out) and bool(item.match(out[-1]))
        next_ok = m < len(lines) and bool(item.match(lines[m]))
        if prev_ok and next_ok:
            k = m                      # 丢弃这段空行
            continue
        out.append(ln)
        k += 1
    return "\n".join(out)


def _deep_answer(agent: QAAgent, question: str, tier: str) -> Iterator[str]:
    """完整 Agentic 路径：检索、覆盖规划、证据对齐与答案核验。"""
    stages = ["拆解问题", "检索章节", "核验证据"]
    if tier == "max":
        stages.append("图谱证据回链")
    stages.append("组织回答")
    for stage in stages:
        yield _event("stage", {"stage": stage})
    answer, sources = agent.answer(question)
    answer = _tidy_list_spacing(answer)
    yield _event("sources", {"sources": _sources(sources)})
    for pos in range(0, len(answer), 12):
        yield _event("token", {"text": answer[pos:pos + 12]})


def _decode_sse_frame(frame: str) -> tuple[str, dict] | None:
    event_type = "message"
    data_lines: list[str] = []
    for line in frame.splitlines():
        if line.startswith("event:"):
            event_type = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].strip())
    if not data_lines:
        return None
    try:
        payload = json.loads("\n".join(data_lines))
    except json.JSONDecodeError:
        return None
    return event_type, payload if isinstance(payload, dict) else {}


class _DraftEmitter:
    """把模型真实生成的初稿 token 合并成适合持久化与网页刷新的小批次。"""

    def __init__(self, run_id: str):
        self.run_id = run_id
        self.buffer = ""

    def _flush(self) -> None:
        if self.buffer:
            _publish_run_event(self.run_id, "draft_token", {"text": self.buffer})
            self.buffer = ""

    def __call__(self, text: str | None) -> None:
        if text is None:
            self._flush()
            _publish_run_event(self.run_id, "draft_reset", {})
            return
        self.buffer += text
        if len(self.buffer) >= 48:
            self._flush()

    def finish(self) -> None:
        self._flush()


class _TokenEmitter:
    """批量持久化回答 token，避免每个极短 token 都单独提交 SQLite。"""

    def __init__(self, run_id: str, threshold: int = 32):
        self.run_id = run_id
        self.threshold = threshold
        self.buffer = ""

    def __call__(self, text: str) -> None:
        self.buffer += text
        if len(self.buffer) >= self.threshold:
            self.flush()

    def flush(self) -> None:
        if self.buffer:
            _publish_run_event(self.run_id, "token", {"text": self.buffer})
            self.buffer = ""


def _stage_for_call(call_label: str) -> str:
    if call_label == "answer_draft":
        return "生成待核验初稿"
    if "audit" in call_label or "revision" in call_label or "recovery" in call_label:
        return "核验证据并修订答案"
    if call_label in ("obligation_plan", "evidence_mapping"):
        return "规划要点并整理证据"
    return "分析问题并检索原文证据"


def _run_worker(run_id: str) -> None:
    try:
        with _run_db() as db:
            row = db.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
    except Exception as exc:  # noqa: BLE001
        print(f"[WEB-RUN] {run_id[:8]} lookup failed: {type(exc).__name__}", flush=True)
        _publish_run_event(run_id, "error", {"message": "任务状态读取失败，请重新发送问题。"})
        with _RUN_MEMORY_LOCK:
            _RUN_API_KEYS.pop(run_id, None)
            _RUN_FUTURES.pop(run_id, None)
            _RUN_CANCEL.pop(run_id, None)
        return
    if row is None:
        with _RUN_MEMORY_LOCK:
            _RUN_API_KEYS.pop(run_id, None)
            _RUN_FUTURES.pop(run_id, None)
            _RUN_CANCEL.pop(run_id, None)
        return
    conversation_id = row["conversation_id"]
    tier = row["tier"]
    question = row["message"]
    with _RUN_MEMORY_LOCK:
        llm_api_key = _RUN_API_KEYS.get(run_id)
        cancel_event = _RUN_CANCEL.get(run_id)
    if cancel_event is None:
        cancel_event = threading.Event()
    try:
        if cancel_event.is_set():
            raise agents.WebRunCancelled()
        _publish_run_event(run_id, "stage", {"stage": "拆解问题并检索原著证据"})
        metadata = experiment_service.get_experiment(run_id)
        system = experiment_catalog.resolve_system(metadata.get("system_id") or experiment_catalog.DEFAULTS[tier], tier)
        agent = _get_agent(conversation_id, row["owner_id"])
        if metadata.get("benchmark_id", "free") != "free":
            agent.messages = []
        if metadata.get("comparison_parent_run_id"):
            parent = experiment_service.get_experiment(metadata["comparison_parent_run_id"])
            agent.messages = list(parent.get("context_snapshot", []))
        experiment_service.on_event(run_id, "context", {"messages": list(agent.messages)})
        agent._llm_call_metadata = []
        call_offset = 0
        settings = system["config"]
        with _request_runtime(
            tier,
            llm_api_key,
            settings.get("flash_version") if tier == "flash" else None,
            flash_profile=settings.get("flash_profile") if tier == "flash" else None,
        ):
            experiment_service.started(run_id)
            if tier == "flash":
                answer_emitter = _TokenEmitter(run_id)
                try:
                    for frame in _flash(agent, question, "v1.9"):
                        if cancel_event.is_set():
                            raise agents.WebRunCancelled()
                        decoded = _decode_sse_frame(frame)
                        if decoded:
                            event_type, payload = decoded
                            if event_type == "token":
                                answer_emitter(str(payload.get("text", "")))
                            elif event_type == "sources":
                                answer_emitter.flush()
                                _publish_run_event(run_id, "sources", {"sources": payload.get("sources", []),
                                    "retrieval_ms": payload.get("retrieval_ms")})
                            elif event_type == "stage":
                                answer_emitter.flush()
                                _publish_run_event(run_id, "stage", {"stage": payload.get("stage", "检索原文")})
                            elif event_type == "error":
                                raise RuntimeError(str(payload.get("message", "Flash 生成失败")))
                finally:
                    answer_emitter.flush()
                _publish_run_event(run_id, "final", {
                    "text": "", "sources": [], "completion_status": "complete", "warning": "",
                    "use_streamed_answer": True,
                })
            else:
                draft_emitter = _DraftEmitter(run_id)
                def on_stage(label: str) -> None:
                    stage = _stage_for_call(str(label))
                    with _run_db() as db:
                        current = db.execute("SELECT stage FROM runs WHERE run_id=?", (run_id,)).fetchone()
                    if current and current["stage"] != stage:
                        _publish_run_event(run_id, "stage", {"stage": stage})

                agent._web_draft_callback = draft_emitter
                agent._web_stage_callback = on_stage
                agent._web_cancel_check = cancel_event.is_set
                try:
                    answer, raw_sources = agent.answer(question)
                finally:
                    draft_emitter.finish()
                    for attr in ("_web_draft_callback", "_web_stage_callback", "_web_cancel_check"):
                        try:
                            delattr(agent, attr)
                        except AttributeError:
                            pass
                if cancel_event.is_set():
                    raise agents.WebRunCancelled()
                confidence = getattr(agent, "_last_answer_confidence", {}) or {}
                _publish_run_event(run_id, "sources", {"sources": _sources(raw_sources)})
                _publish_run_event(run_id, "final", {
                    "text": _tidy_list_spacing(answer or ""),
                    "sources": _sources(raw_sources),
                    "completion_status": str(confidence.get("completion_status", "complete")),
                    "warning": str(confidence.get("warning", "")),
                })
        experiment_service.on_event(run_id, "diagnostics", {
            "calls": getattr(agent, "_llm_call_metadata", [])[call_offset:],
            "call_count": None if tier == "flash" else len(getattr(agent, "_llm_call_metadata", [])[call_offset:]),
            "instrumentation": "agents._llm_call_metadata; Flash streaming API count is unrecorded; may exclude separate external tools",
        })
        _publish_run_event(run_id, "done", {
            "conversation_id": conversation_id,
            "version": system["label"],
        })
    except agents.WebRunCancelled:
        _publish_run_event(run_id, "cancelled", {"message": "已停止生成。"})
    except Exception as exc:  # noqa: BLE001
        print(f"[WEB-RUN] {run_id[:8]} failed: {type(exc).__name__}", flush=True)
        _publish_run_event(run_id, "error", {
            "message": "回答生成失败，请检查 API Key、额度或知识库服务状态后重试。",
        })
    finally:
        with _RUN_MEMORY_LOCK:
            _RUN_API_KEYS.pop(run_id, None)
            _RUN_FUTURES.pop(run_id, None)
            _RUN_CANCEL.pop(run_id, None)

@app.get("/api/health")
def health() -> dict:
    agent = QAAgent()
    return {
        "status": "ok",
        "mode": "local-full-rag",
        "indexed": agent.vector_store.is_indexed(),
        "flash": flash_health(),
        "tiers": {tier: item["version"] for tier, item in _TIER_PROFILES.items()},
        "warmed_up": _WARMUP.get("done", False),
        "warmup_ms": _WARMUP.get("total"),
    }


@app.post("/api/runs")
def create_run(
    req: RunRequest,
    request: Request,
    access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
    llm_api_key: str | None = Header(None, alias="X-LLM-API-Key"),
    admin_token: str | None = Header(None, alias="X-Experiment-Admin"),
) -> dict:
    if req.tier not in _TIER_PROFILES:
        raise HTTPException(422, "tier 仅支持 flash、pro 或 max")
    owner_id = _owner_id(access_key or "")
    _authorize(request, access_key)
    try:
        system = experiment_catalog.resolve_system(req.system_id or experiment_catalog.DEFAULTS[req.tier], req.tier)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    system["generation_model"] = str(getattr(config, "LLM_MODEL", "未记录"))
    system["generation_provider"] = str(getattr(config, "GENERATION_PROVIDER", "未记录"))
    system["engine_fingerprint"] = experiment_catalog.fingerprint([
        experiment_catalog.ROOT/"src/agents.py", experiment_catalog.ROOT/"src/vector_store.py",
        experiment_catalog.ROOT/"src"/("flash_v19.py" if req.tier=="flash" else "pro_v25.py"),
        experiment_catalog.ROOT/"src/pro_v31.py"])
    system["bridge_fingerprint"] = hashlib.sha256(b"".join(p.read_bytes() for p in sorted(Path(__file__).parent.glob("*.py")) if not p.name.startswith("test_"))).hexdigest()
    if req.tier == "flash":
        import v19_profiles
        system["config"] = {**system["config"], "variant_flags": v19_profiles.profile_config(system["variant"])}
    index_dir = Path(getattr(config, "FAISS_DATA_DIR", "."))
    system["index_snapshot"] = {"method":"file-size-mtime", "files":[
        {"file":p.name,"bytes":p.stat().st_size,"mtime_ns":p.stat().st_mtime_ns}
        for p in sorted(index_dir.glob("*")) if p.is_file()]}
    if not llm_api_key or not llm_api_key.strip():
        raise HTTPException(422, "请先填写自己的模型 API Key")
    if not hmac.compare_digest(access_key or "", llm_api_key.strip()):
        raise HTTPException(401, "所有请求请使用同一个 DeepSeek API Key")
    if not _WARMUP.get("done", False):
        raise HTTPException(503, "知识库仍在启动预热，请稍后再试")
    if req.comparison_parent_run_id:
        parent = _get_owned_run(req.comparison_parent_run_id, owner_id)
        parent_exp = experiment_service.get_experiment(req.comparison_parent_run_id) if parent else None
        if (not parent or parent["status"] != "done" or parent["message"] != req.message.strip()
                or not parent_exp or "context_snapshot" not in parent_exp
                or parent_exp.get("benchmark_id", "free") != req.benchmark_id
                or str(parent_exp.get("question_id") or "") != str(req.question_id or "")):
            raise HTTPException(422, "对照必须引用本人已完成的同题、同题库运行及其固定上下文")

    with _run_db() as db:
        existing = db.execute(
            "SELECT * FROM runs WHERE owner_id=? AND client_request_id=?",
            (owner_id, req.client_request_id),
        ).fetchone()
        if existing:
            return _run_snapshot(existing)
        active = db.execute(
            "SELECT run_id FROM runs WHERE owner_id=? AND conversation_id=? "
            "AND status IN ('queued','running','drafting','streaming','reviewing','cancelling') LIMIT 1",
            (owner_id, req.conversation_id),
        ).fetchone()
        if active:
            raise HTTPException(409, f"此对话已有任务运行中：{active['run_id']}")
        pending = db.execute(
            "SELECT COUNT(*) AS n FROM runs WHERE owner_id=? "
            "AND status IN ('queued','running','drafting','streaming','reviewing','cancelling')",
            (owner_id,),
        ).fetchone()["n"]
        if int(pending) >= _MAX_PENDING_RUNS:
            raise HTTPException(429, "当前排队任务较多，请稍后再发送")

        run_id = uuid.uuid4().hex
        now = time.time()
        db.execute(
            "INSERT INTO runs(run_id,owner_id,conversation_id,tier,version,client_request_id,"
            "message,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (run_id, owner_id, req.conversation_id, req.tier,
             system["label"], req.client_request_id,
             req.message.strip(), "queued", now, now),
        )

    try:
        experiment_service.create_metadata(run_id, owner_id, req.model_dump(), system, admin_token)
    except Exception:
        with _run_db() as db:
            db.execute("DELETE FROM runs WHERE run_id=?", (run_id,))
        raise
    _publish_run_event(run_id, "queued", {"stage": "排队等待本机 RAG 服务"})
    with _RUN_MEMORY_LOCK:
        _RUN_API_KEYS[run_id] = llm_api_key.strip()
        _RUN_CANCEL[run_id] = threading.Event()
        _RUN_FUTURES[run_id] = _RUN_EXECUTOR.submit(_run_worker, run_id)
    row = _get_owned_run(run_id, owner_id)
    return _run_snapshot(row) if row else {"run_id": run_id, "status": "queued"}


@app.get("/api/runs/{run_id}")
def get_run(
    run_id: str,
    request: Request,
    access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
) -> dict:
    _authorize(request, access_key)
    row = _get_owned_run(run_id, _owner_id(access_key or ""))
    if row is None:
        raise HTTPException(404, "任务不存在或无权访问")
    return _run_snapshot(row)


@app.get("/api/runs/by-request/{client_request_id}")
def get_run_by_request(
    client_request_id: str,
    request: Request,
    access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
) -> dict:
    _authorize(request, access_key)
    with _run_db() as db:
        row = db.execute(
            "SELECT * FROM runs WHERE owner_id=? AND client_request_id=?",
            (_owner_id(access_key or ""), client_request_id),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "请求尚未创建任务")
    return _run_snapshot(row)


@app.get("/api/runs/{run_id}/events")
def stream_run_events(
    run_id: str,
    request: Request,
    after: int = 0,
    access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
) -> StreamingResponse:
    _authorize(request, access_key)
    owner_id = _owner_id(access_key or "")
    if _get_owned_run(run_id, owner_id) is None:
        raise HTTPException(404, "任务不存在或无权访问")

    def generate() -> Iterator[str]:
        cursor = max(0, after)
        last_ping = time.monotonic()
        terminal = {"done", "error", "stopped", "interrupted"}
        while True:
            with _run_db() as db:
                rows = db.execute(
                    "SELECT seq,event_type,payload_json FROM run_events "
                    "WHERE run_id=? AND seq>? ORDER BY seq LIMIT 200",
                    (run_id, cursor),
                ).fetchall()
                run = db.execute("SELECT status FROM runs WHERE run_id=?", (run_id,)).fetchone()
            for row in rows:
                cursor = int(row["seq"])
                yield (f"id: {cursor}\nevent: {row['event_type']}\ndata: "
                       f"{row['payload_json']}\n\n")
            if run is None or (run["status"] in terminal and not rows):
                break
            if not rows:
                now = time.monotonic()
                if now - last_ping >= 10:
                    yield ": keepalive\n\n"
                    last_ping = now
                time.sleep(0.25)

    return StreamingResponse(
        generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform",
                 "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.post("/api/runs/{run_id}/cancel")
def cancel_run(
    run_id: str,
    request: Request,
    access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
) -> dict:
    _authorize(request, access_key)
    owner_id = _owner_id(access_key or "")
    row = _get_owned_run(run_id, owner_id)
    if row is None:
        raise HTTPException(404, "任务不存在或无权访问")
    if row["status"] not in ("queued", "running", "drafting", "streaming", "reviewing", "cancelling"):
        return _run_snapshot(row)
    with _RUN_MEMORY_LOCK:
        flag = _RUN_CANCEL.get(run_id)
        future = _RUN_FUTURES.get(run_id)
    if flag:
        flag.set()
    if future and future.cancel():
        with _RUN_MEMORY_LOCK:
            _RUN_API_KEYS.pop(run_id, None)
            _RUN_FUTURES.pop(run_id, None)
            _RUN_CANCEL.pop(run_id, None)
        _publish_run_event(run_id, "cancelled", {"message": "已停止排队任务。"})
    else:
        _publish_run_event(run_id, "cancelling", {"message": "正在安全停止当前生成步骤。"})
    current = _get_owned_run(run_id, owner_id)
    return _run_snapshot(current) if current else {"run_id": run_id, "status": "stopped"}


@app.delete("/api/runs/{run_id}")
def delete_run(
    run_id: str,
    request: Request,
    access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
) -> dict:
    _authorize(request, access_key)
    owner_id = _owner_id(access_key or "")
    row = _get_owned_run(run_id, owner_id)
    if row is None:
        raise HTTPException(404, "任务不存在或无权访问")
    conversation_id = row["conversation_id"]
    with _RUN_MEMORY_LOCK:
        flag = _RUN_CANCEL.get(run_id)
        if flag:
            flag.set()
        future = _RUN_FUTURES.get(run_id)
        if future and future.cancel():
            _RUN_API_KEYS.pop(run_id, None)
            _RUN_FUTURES.pop(run_id, None)
            _RUN_CANCEL.pop(run_id, None)
    with _run_db() as db:
        db.execute("DELETE FROM run_events WHERE run_id=?", (run_id,))
        db.execute("DELETE FROM runs WHERE run_id=? AND owner_id=?", (run_id, owner_id))
    _reload_agent_history(conversation_id, owner_id)
    return {"ok": True, "run_id": run_id, "deleted": True}


@app.delete("/api/conversations/{conversation_id}")
def delete_server_conversation(
    conversation_id: str,
    request: Request,
    access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
) -> dict:
    _authorize(request, access_key)
    owner_id = _owner_id(access_key or "")
    with _run_db() as db:
        rows = db.execute(
            "SELECT run_id FROM runs WHERE owner_id=? AND conversation_id=?",
            (owner_id, conversation_id),
        ).fetchall()
    run_ids = [row["run_id"] for row in rows]
    with _RUN_MEMORY_LOCK:
        for run_id in run_ids:
            flag = _RUN_CANCEL.get(run_id)
            if flag:
                flag.set()
            future = _RUN_FUTURES.get(run_id)
            if future:
                if future.cancel():
                    _RUN_API_KEYS.pop(run_id, None)
                    _RUN_FUTURES.pop(run_id, None)
                    _RUN_CANCEL.pop(run_id, None)
    with _run_db() as db:
        db.execute("DELETE FROM run_events WHERE run_id IN (SELECT run_id FROM runs WHERE owner_id=? AND conversation_id=?)",
                   (owner_id, conversation_id))
        deleted = db.execute(
            "DELETE FROM runs WHERE owner_id=? AND conversation_id=?",
            (owner_id, conversation_id),
        ).rowcount
    _sessions.pop(owner_id + ":" + conversation_id, None)
    return {"ok": True, "conversation_id": conversation_id, "deleted_runs": deleted}


@app.delete("/api/conversations")
def delete_all_server_conversations(
    request: Request,
    access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
) -> dict:
    _authorize(request, access_key)
    owner_id = _owner_id(access_key or "")
    with _run_db() as db:
        runs = db.execute("SELECT run_id,conversation_id FROM runs WHERE owner_id=?", (owner_id,)).fetchall()
    conversation_ids = {row["conversation_id"] for row in runs}
    with _RUN_MEMORY_LOCK:
        for row in runs:
            run_id = row["run_id"]
            flag = _RUN_CANCEL.get(run_id)
            if flag:
                flag.set()
            future = _RUN_FUTURES.get(run_id)
            if future and future.cancel():
                _RUN_API_KEYS.pop(run_id, None)
                _RUN_FUTURES.pop(run_id, None)
                _RUN_CANCEL.pop(run_id, None)
    with _run_db() as db:
        db.execute("DELETE FROM run_events WHERE run_id IN (SELECT run_id FROM runs WHERE owner_id=?)", (owner_id,))
        deleted = db.execute("DELETE FROM runs WHERE owner_id=?", (owner_id,)).rowcount
    for conversation_id in conversation_ids:
        _sessions.pop(owner_id + ":" + conversation_id, None)
    return {"ok": True, "deleted_runs": deleted, "deleted_conversations": len(conversation_ids)}


# 预热状态：服务在预热完成前不应被视作 ready
_WARMUP: dict = {"done": False}


@app.on_event("startup")
def _startup_warmup() -> None:
    """启动阶段完成全部重资源预热（含档案库）。

    档案库首次 load_model() 实测 ~13s；原先是在首个用户请求里懒加载，
    导致首问极慢（P50 被抬到 9.5s）。这里在任何请求到达前做完，
    并打印各阶段耗时，保证 /api/health 报告 warmed_up 时确实就绪。
    """
    _init_run_store()
    experiment_service.initialize(sys.modules[__name__])
    _recover_interrupted_runs()
    t0 = time.time()
    print("[STARTUP] 开始预热……", flush=True)
    try:
        agent = QAAgent()
    except Exception as exc:  # noqa: BLE001
        print(f"[STARTUP] QAAgent 初始化失败：{exc}", flush=True)
        return
    try:
        agent.vector_store.connect()
        agent.vector_store.load_model()
        agent.vector_store.load_reranker()
        import flash_v16
        out = flash_v16.warmup(agent, verbose=True)
        _WARMUP.update(out)
        # v1.8可以通过请求参数临时强制测试，即使网站默认仍是v1.6，
        # 因此CPU上下文索引始终在启动阶段预热，不能等首个v1.8请求。
        import flash_v18
        v18 = flash_v18.warmup(agent)
        _WARMUP["flash_v18"] = v18
        print(f"[STARTUP] Flash v1.8 CPU资源预热完成：{v18}", flush=True)
        import v19_profiles
        v19_profiles.apply_profile("sem_select")
        import flash_v19
        v19 = flash_v19.warmup(agent)
        _WARMUP["flash_v19"] = v19
        print(f"[STARTUP] Flash v1.9 {v19_profiles.active_profile()} 资源预热完成：{v19}", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[STARTUP] 预热异常：{type(exc).__name__}: {exc}", flush=True)
        _WARMUP["error"] = type(exc).__name__
        _WARMUP["done"] = False
        return
    _WARMUP["done"] = True
    _WARMUP["wall_ms"] = int((time.time() - t0) * 1000)
    print(f"[STARTUP] ready（总 {_WARMUP['wall_ms']} ms）", flush=True)


@app.post("/api/conversations/{conversation_id}/clear")
def clear_conversation(
    conversation_id: str,
    request: Request,
    access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
) -> dict:
    """兼容旧客户端的受保护清理接口。"""
    _authorize(request, access_key)
    owner_id = _owner_id(access_key or "")
    with _run_db() as db:
        db.execute("DELETE FROM run_events WHERE run_id IN (SELECT run_id FROM runs WHERE owner_id=? AND conversation_id=?)",
                   (owner_id, conversation_id))
        db.execute("DELETE FROM runs WHERE owner_id=? AND conversation_id=?", (owner_id, conversation_id))
    existed = _sessions.pop(owner_id + ":" + conversation_id, None) is not None
    return {"ok": True, "conversation_id": conversation_id, "existed": existed}


@app.post("/api/chat")
def chat_stream(
    req: ChatRequest,
    request: Request,
    access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
    llm_api_key: str | None = Header(None, alias="X-LLM-API-Key"),
) -> StreamingResponse:
    raise HTTPException(410, "实验网站请使用可追溯的 /api/runs 接口")
    if req.tier not in _TIER_PROFILES:
        raise HTTPException(422, "tier 仅支持 flash、pro 或 max")
    _authorize(request, access_key)
    if not llm_api_key or not llm_api_key.strip():
        raise HTTPException(422, "请先填写自己的模型 API Key")
    if not hmac.compare_digest(access_key or "", llm_api_key.strip()):
        raise HTTPException(401, "所有请求请使用同一个 DeepSeek API Key")
    conversation_id = req.conversation_id or uuid.uuid4().hex
    agent = _get_agent(conversation_id)

    def generate() -> Iterator[str]:
        """把重型工作放进后台线程，主生成器定时发心跳。

        原因：tier=pro/max 走完整管线（拆解→检索→IRCoT 多轮→润色），
        agent.answer() 会阻塞数分钟且期间零输出。Cloudflare 隧道对源站静默
        ~100s 即返回 524，浏览器表现为「无法连接知识库服务」。
        心跳（SSE 注释行，前端忽略）可避免隧道判死。"""
        done = threading.Event()
        q: "queue.Queue[str | None]" = queue.Queue()

        def work() -> None:
            try:
                with _request_runtime(req.tier, llm_api_key, req.flash_version):
                    source = (_deep_answer(agent, req.message, req.tier)
                              if req.tier in ("pro", "max")
                              else _flash(agent, req.message, req.flash_version))
                    for ev in source:
                        q.put(ev)
                q.put(_event("done", {"conversation_id": conversation_id}))
            except Exception as exc:  # noqa: BLE001
                q.put(_event("error", {"message": f"完整 RAG 服务处理失败：{exc}"}))
            finally:
                done.set()

        t = threading.Thread(target=work, daemon=True)
        t.start()
        while True:
            try:
                yield q.get(timeout=10.0)
            except queue.Empty:
                if done.is_set():
                    break
                yield ": keepalive\n\n"
        while not q.empty():
            yield q.get()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform",
                 "X-Accel-Buffering": "no",
                 "Connection": "keep-alive"},
    )


experiment_catalog.install(app)
experiment_service.install(app, sys.modules[__name__])
import experiment_archive
experiment_archive.install(app, experiment_service, sys.modules[__name__])
