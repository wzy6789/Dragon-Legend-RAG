# -*- coding: utf-8 -*-
"""可选向量检索（FAISS + sentence-transformers）。仅当 requirements-vector.txt 安装后可用。"""
from __future__ import annotations

import os
from typing import Optional

import numpy as np


class VectorRetriever:
    """加载由外部脚本构建的 FAISS 索引 + id → chunk 映射。"""

    def __init__(self, index_path: str) -> None:
        import faiss

        index_file = os.path.join(index_path, "index.faiss")
        meta_file = os.path.join(index_path, "chunks.jsonl")
        if not os.path.exists(index_file):
            raise FileNotFoundError(index_file)
        self.index = faiss.read_index(index_file)
        self.meta: list[dict] = []
        if os.path.exists(meta_file):
            import json

            with open(meta_file, encoding="utf-8") as fh:
                for line in fh:
                    if line.strip():
                        self.meta.append(json.loads(line))

        from sentence_transformers import SentenceTransformer

        self.encoder = SentenceTransformer(
            os.environ.get("EMBED_MODEL_NAME", "BAAI/bge-m3"), device="cpu"
        )

    def search(self, query: str, top_k: int = 8) -> list[dict]:
        vec = self.encoder.encode([query], normalize_embeddings=True)
        scores, idxs = self.index.search(np.asarray(vec, dtype="float32"), top_k)
        out = []
        for score, i in zip(scores[0], idxs[0]):
            if i < 0 or i >= len(self.meta):
                continue
            row = dict(self.meta[int(i)])
            row["_score"] = round(float(score), 4)
            out.append(row)
        return out
