# -*- coding: utf-8 -*-
"""检索器。

优先：
1) FAISS 向量索引（VECTOR_INDEX_PATH）— 需可选依赖 requirements-vector.txt；
2) 否则 BM25 over JSONL 语料（RAG_DATA_PATH），纯标准库，零向量依赖。

语料格式（prepare_corpus.py 生成）：
  {"chapter_index": 12, "chapter": "第12章 xxx", "title": "xxx", "text": "……"}
"""
from __future__ import annotations

import json
import math
import os
import re
from collections import Counter
from typing import Optional

from ..config import settings

_WS_RE = re.compile(r"[\s，。！？、；：\"''（）《》·…—-]+")


def _tokenize(text: str) -> list[str]:
    """极简中文切分：按非字边界切出词，字频统计用于 BM25 术语权重。"""
    text = _WS_RE.sub(" ", text)
    return [t for t in text.split(" ") if t]


class _Chunk:
    __slots__ = ("chapter_index", "chapter", "title", "text")

    def __init__(self, row: dict):
        self.chapter_index = row.get("chapter_index")
        self.chapter = row.get("chapter") or ""
        self.title = row.get("title") or ""
        self.text = row.get("text") or ""

    def to_dict(self) -> dict:
        return {
            "chapter_index": self.chapter_index,
            "chapter": self.chapter,
            "title": self.title,
            "text": self.text,
        }


class BM25Retriever:
    """标准 BM25 实现，正文块为检索单元。"""

    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self._chunks: list[_Chunk] = []
        self._docs: list[list[str]] = []
        self._df: Counter[str] = Counter()
        self._avgdl = 0.0
        self._k1, self._b = k1, b
        self._n = 0

    def add(self, row: dict) -> None:
        c = _Chunk(row)
        toks = _tokenize(c.text)
        if not toks:
            return
        self._chunks.append(c)
        self._docs.append(toks)
        self._df.update(set(toks))

    def load_jsonl(self, path: str) -> int:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    self.add(json.loads(line))
                except json.JSONDecodeError:
                    continue
        self._n = len(self._docs)
        if self._n:
            self._avgdl = sum(len(d) for d in self._docs) / self._n
        return self._n

    def search(self, query: str, top_k: int = 8) -> list[dict]:
        if self._n == 0:
            return []
        q_toks = _tokenize(query)
        if not q_toks:
            return []
        # 术语频率（在查询中）
        qf = Counter(q_toks)
        scores: list[float] = []
        for toks in self._docs:
            dl = len(toks)
            tf = Counter(toks)
            score = 0.0
            for term, c in qf.items():
                f = tf.get(term, 0)
                if f == 0:
                    continue
                df = self._df.get(term, 0)
                idf = math.log(1 + (self._n - df + 0.5) / (df + 0.5))
                denom = f + self._k1 * (1 - self._b + self._b * dl / max(self._avgdl, 1e-6))
                score += c * idf * f * (self._k1 + 1) / denom
            scores.append(score)
        ranked = sorted(range(self._n), key=lambda i: scores[i], reverse=True)[:top_k]
        out = []
        for i in ranked:
            if scores[i] <= 0:
                continue
            c = self._chunks[i]
            out.append({**c.to_dict(), "_score": round(float(scores[i]), 4)})
        return out


class Retriever:
    """向量优先、BM25 兜底的外观。"""

    def __init__(self) -> None:
        self.bm25 = BM25Retriever()
        self._vector = None
        self._load()

    def _load(self) -> None:
        if settings.rag_data_path and os.path.exists(settings.rag_data_path):
            self.bm25.load_jsonl(settings.rag_data_path)
        if settings.vector_index_path and os.path.exists(settings.vector_index_path):
            try:
                from .vector_retriever import VectorRetriever  # 延迟导入（可选依赖）

                self._vector = VectorRetriever(settings.vector_index_path)
            except Exception:
                self._vector = None

    @property
    def corpus_size(self) -> int:
        return self.bm25._n

    @property
    def has_vector(self) -> bool:
        return self._vector is not None

    def search(self, query: str, top_k: int = 8) -> list[dict]:
        if self._vector is not None:
            try:
                hits = self._vector.search(query, top_k=top_k)
                if hits:
                    return hits
            except Exception:
                pass
        return self.bm25.search(query, top_k=top_k)


_retriever: Optional[Retriever] = None


def get_retriever() -> Retriever:
    global _retriever
    if _retriever is None:
        _retriever = Retriever()
    return _retriever
