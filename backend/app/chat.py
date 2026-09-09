# -*- coding: utf-8 -*-
"""会话历史（进程内存）。conversation_id → messages。
生产多实例场景请替换为 Redis 等外部存储（本项目不持久化聊天记录）。"""
from __future__ import annotations

import time
import uuid
from typing import Optional

from .config import settings

_MAX_TURNS = settings.max_history_turns
_sessions: dict[str, list[dict]] = {}
_last: dict[str, float] = {}


def new_conversation() -> str:
    return uuid.uuid4().hex


def _expire(ttl_seconds: int = 7200) -> None:
    now = time.time()
    dead = [k for k, t in _last.items() if now - t > ttl_seconds]
    for k in dead:
        _sessions.pop(k, None)
        _last.pop(k, None)


def get_history(conversation_id: Optional[str]) -> list[dict]:
    if not conversation_id:
        return []
    return list(_sessions.get(conversation_id, []))


def push_turn(conversation_id: str, user_msg: str, answer: str) -> None:
    if not conversation_id:
        return
    _expire()
    msgs = _sessions.setdefault(conversation_id, [])
    msgs.append({"role": "user", "content": user_msg})
    if answer:
        msgs.append({"role": "assistant", "content": answer})
    # 截断历史：保留最近 N 轮
    if len(msgs) > _MAX_TURNS * 2:
        msgs[:] = msgs[-_MAX_TURNS * 2:]
    _last[conversation_id] = time.time()


def clear(conversation_id: str) -> None:
    _sessions.pop(conversation_id, None)
    _last.pop(conversation_id, None)
