# -*- coding: utf-8 -*-
"""FastAPI 应用入口。

接口：
- POST /api/chat    SSE 流式问答（stage/token/sources/done/error）
- POST /api/uploads 补充资料（私有存储）
- POST /api/conversations/{id}/clear  清除对话
- GET  /api/health
"""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import chat
from .config import settings
from .rag.engine import RAGEngine
from .schemas import (
    ChatRequest,
    done_event,
    error_event,
    sources_event,
    stage_event,
    token_event,
)

app = FastAPI(title="Dragon King Legend RAG API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

_engine: RAGEngine | None = None


def get_engine() -> RAGEngine:
    global _engine
    if _engine is None:
        _engine = RAGEngine()
    return _engine


@app.on_event("startup")
def _startup() -> None:
    # 预热：加载语料/索引，若缺失只记录（服务可用，检索为空并在回答中提示）
    try:
        r = get_engine().retriever
        print(
            f"[rag] corpus_chunks={r.corpus_size} vector_index={r.has_vector} "
            f"(RAG_DATA_PATH={settings.rag_data_path or '(未设置)'})"
        )
    except Exception as exc:  # LLM key 缺失等
        print(f"[rag] 引擎初始化告警（服务仍将启动）: {exc}")


@app.get("/api/health")
async def health() -> dict:
    r = get_engine().retriever
    return {
        "status": "ok",
        "corpus_chunks": r.corpus_size,
        "vector_index": r.has_vector,
        "rag_data_path": settings.rag_data_path or None,
    }


@app.post("/api/chat")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    engine = get_engine()
    conv_id = req.conversation_id or chat.new_conversation()

    async def event_stream():
        try:
            history = chat.get_history(conv_id)
            answer_parts: list[str] = []
            pipeline = (
                engine.stream_pro(req.message, history=history)
                if req.tier == "pro"
                else engine.stream_flash(req.message, history=history)
            )
            async for event, payload in pipeline:
                if event == "stage":
                    yield stage_event(payload["stage"])
                elif event == "token":
                    answer_parts.append(payload["text"])
                    yield token_event(payload["text"])
                elif event == "sources":
                    yield sources_event(payload["sources"])
            answer = "".join(answer_parts)
            chat.push_turn(conv_id, req.message, answer)
            yield done_event(conv_id)
        except Exception as exc:
            yield error_event(f"服务器处理失败：{exc}")

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/conversations/{conversation_id}/clear")
async def clear_conversation(conversation_id: str) -> dict:
    chat.clear(conversation_id)
    return {"ok": True, "conversation_id": conversation_id}


@app.post("/api/uploads")
async def upload_file(file: UploadFile = File(...)) -> dict:
    """补充资料：仅保存到私有 uploads/，不进入 Git。"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少文件")
    if file.filename.endswith((".py", ".js", ".exe", ".sh", ".bat", ".html")):
        raise HTTPException(status_code=400, detail="不允许上传可执行/脚本类文件")

    up_dir = Path(settings.upload_dir)
    up_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex[:8]}_{os.path.basename(file.filename)}"
    dest = up_dir / safe_name
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="文件超过 20MB")
    dest.write_bytes(data)

    # 可选：并入语料用于后续检索（默认关闭，避免污染主语料）
    ingested = False
    if settings.upload_enable_ingest and settings.rag_data_path:
        try:
            _append_upload_to_corpus(dest)
            ingested = True
        except Exception:
            ingested = False

    return {"ok": True, "filename": file.filename, "stored": dest.name, "ingested": ingested}


def _append_upload_to_corpus(path: Path) -> None:
    """把上传文本按块追加进 corpus.jsonl（仅处理 txt/md），并重载检索器缓存。"""
    corpus_path = Path(settings.rag_data_path)
    corpus_path.parent.mkdir(parents=True, exist_ok=True)
    text = path.read_text(encoding="utf-8", errors="replace")
    if not text.strip():
        return
    block_size = 600
    with open(corpus_path, "a", encoding="utf-8") as fh:
        for i in range(0, len(text), block_size):
            block = text[i : i + block_size].strip()
            if not block:
                continue
            row = {
                "chapter_index": None,
                "chapter": f"上传资料·{path.stem}",
                "title": path.stem,
                "text": block,
            }
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    # 重载检索器缓存（重新加载 JSONL）
    from .rag.retriever import BM25Retriever

    reloaded = BM25Retriever()
    reloaded.load_jsonl(settings.rag_data_path)
    # 简单生效：重建全局检索器
    from .rag.retriever import get_retriever

    _glob = get_retriever()
    _glob.bm25 = reloaded
