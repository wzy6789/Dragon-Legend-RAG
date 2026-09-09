# -*- coding: utf-8 -*-
"""请求 / SSE 事件模型。"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="用户消息")
    tier: Literal["flash", "pro"] = Field("flash", description="flash=v1.2 知识档案，pro=v2.1 Ewe+覆盖规划")
    conversation_id: Optional[str] = Field(None, description="会话 id；不传则由后端生成")


class SourceItem(BaseModel):
    chapter_index: Optional[int] = None
    chapter: str = ""
    title: str = ""
    snippet: str = ""


# ---- SSE 事件负载（data 字段的 JSON）----


def stage_event(stage: str) -> str:
    return _payload("stage", {"stage": stage})


def token_event(text: str) -> str:
    return _payload("token", {"text": text})


def sources_event(sources: list[dict]) -> str:
    return _payload("sources", {"sources": sources})


def done_event(conversation_id: str) -> str:
    return _payload("done", {"conversation_id": conversation_id})


def error_event(message: str) -> str:
    return _payload("error", {"message": message})


def _payload(event: str, data: dict) -> str:
    import json

    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
