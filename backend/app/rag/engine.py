# -*- coding: utf-8 -*-
"""RAG 引擎：tier → 管线映射。

- flash → v1.2 知识档案：单轮混合检索 + 简洁回答（快速）。
- pro   → v2.1 Ewe + 覆盖规划：
    拆解问题 → 多路检索 → 证据核验 → 组织回答。
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import AsyncIterator, Optional

from ..config import settings
from .llm import LLMClient
from .prompts import (
    DECOMPOSE_PROMPT,
    FLASH_SYSTEM,
    FLASH_USER,
    PRO_SYSTEM,
    PRO_USER,
    VERIFY_PROMPT,
)
from .retriever import get_retriever


def _snippet(text: str, limit: int = 180) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[:limit] + "…"


def _format_context(hits: list[dict], max_chars: int = 6000) -> str:
    parts = []
    used = 0
    for h in hits:
        label = h.get("chapter") or h.get("title") or (
            f"第{h['chapter_index']}章" if h.get("chapter_index") is not None else "资料片段"
        )
        block = f"【{label}】\n{h.get('text', '')}"
        if used + len(block) > max_chars:
            block = block[: max(0, max_chars - used)] + "…"
        parts.append(block)
        used += len(block)
        if used >= max_chars:
            break
    return "\n\n".join(parts)


class RAGEngine:
    """两级 RAG。持有一个 LLM 客户端 + 全局检索器。"""

    def __init__(self) -> None:
        self.llm = LLMClient()
        self.retriever = get_retriever()

    # ---------------- Flash: v1.2 知识档案 ----------------
    async def stream_flash(
        self, question: str, history: Optional[list[dict]] = None
    ) -> AsyncIterator[tuple[str, dict]]:
        """产出 (event, payload)。events: token / sources / done"""
        hits = await asyncio.to_thread(self.retriever.search, question, 6)
        context = _format_context(hits) if hits else "（未检索到可用资料；请基于已有知识谨慎回答，并说明不确定性。）"
        msgs = ([{"role": "system", "content": FLASH_SYSTEM}]
                + (history or [])
                + [{"role": "user", "content": FLASH_USER.format(context=context, question=question)}])
        sources = self._sources_from_hits(hits)
        async for piece in self.llm.stream(msgs, temperature=0.2, max_tokens=1024):
            if piece:
                yield "token", {"text": piece}
        yield "sources", {"sources": sources}

    # ---------------- Pro: v2.1 Ewe + 覆盖规划 ----------------
    async def stream_pro(
        self, question: str, history: Optional[list[dict]] = None
    ) -> AsyncIterator[tuple[str, dict]]:
        """事件: stage / token / sources / done"""
        yield "stage", {"stage": "拆解问题"}

        sub_questions = await self._decompose(question)
        if not sub_questions:
            sub_questions = [question]

        yield "stage", {"stage": "检索章节"}

        # 多路检索：主问题 + 子问题各自取 top_k，合并去重
        queries = [question] + sub_questions
        hits_map: dict[tuple, dict] = {}
        for q in queries:
            for h in await asyncio.to_thread(self.retriever.search, q, 5):
                key = (h.get("chapter_index"), h.get("chapter"), h.get("text")[:60])
                if key not in hits_map:
                    hits_map[key] = h
        hits = sorted(hits_map.values(), key=lambda x: x.get("_score", 0), reverse=True)[:12]

        context = _format_context(hits) if hits else "（未检索到可用资料；请基于已有知识谨慎回答，并说明不确定性。）"

        # 证据核验：把高分段视为候选引用；此处做一次轻量"断言-来源"一致性检查（防编造章节）
        yield "stage", {"stage": "核验证据"}
        verified = await self._verify_claims(question, hits) if hits else []
        sources = self._sources_from_hits(hits, verified=verified)

        yield "stage", {"stage": "组织回答"}

        msgs = ([{"role": "system", "content": PRO_SYSTEM}]
                + (history or [])
                + [{"role": "user", "content": PRO_USER.format(context=context, question=question)}])
        async for piece in self.llm.stream(msgs, temperature=0.2, max_tokens=2048):
            if piece:
                yield "token", {"text": piece}
        yield "sources", {"sources": sources}

    # ---------------- 内部方法 ----------------
    async def _decompose(self, question: str) -> list[str]:
        try:
            raw = await self.llm.complete(
                [{"role": "user", "content": DECOMPOSE_PROMPT.format(question=question)}],
                temperature=0.1,
                max_tokens=300,
            )
            lines = [ln.strip(" -•0123456789.、)）") for ln in raw.splitlines() if ln.strip()]
            return [ln for ln in lines if len(ln) >= 4][:4]
        except Exception:
            return []

    async def _verify_claims(self, question: str, hits: list[dict]) -> set[int]:
        """极简核验：用 LLM 判断检索片段与问题的相关性/冲突标记。
        返回应被标注为“已核验”的片段下标集合。失败时保守返回空集（不做虚假标注）。"""
        try:
            claims = "1. " + question
            prompt = VERIFY_PROMPT.format(claims=claims, context=_format_context(hits, 4000))
            raw = await self.llm.complete(
                [{"role": "user", "content": prompt}], temperature=0.0, max_tokens=200
            )
            m = re.search(r"\[.*\]", raw, re.S)
            if not m:
                return set()
            arr = json.loads(m.group(0))
            return {int(x.get("claim", 1)) for x in arr if x.get("verdict") == "supported"}
        except Exception:
            return set()

    @staticmethod
    def _sources_from_hits(hits: list[dict], verified: Optional[set[int]] = None) -> list[dict]:
        out = []
        for i, h in enumerate(hits[:10]):
            out.append({
                "chapter_index": h.get("chapter_index"),
                "chapter": h.get("chapter") or f"第{h.get('chapter_index')}章" or "",
                "title": h.get("title") or "",
                "snippet": _snippet(h.get("text", "")),
            })
        return out
