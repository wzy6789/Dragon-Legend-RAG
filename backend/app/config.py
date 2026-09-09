# -*- coding: utf-8 -*-
"""后端配置：只从环境变量读取，不内置任何密钥/资料路径默认值。"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@dataclass
class Settings:
    # --- LLM（OpenAI 兼容）---
    llm_api_key: str = field(default_factory=lambda: _env("LLM_API_KEY"))
    llm_base_url: str = field(default_factory=lambda: _env("LLM_BASE_URL", "https://api.deepseek.com/v1"))
    llm_model: str = field(default_factory=lambda: _env("LLM_MODEL", "deepseek-chat"))

    # --- 语料与索引（私有卷挂载）---
    rag_data_path: str = field(default_factory=lambda: _env("RAG_DATA_PATH", ""))
    vector_index_path: str = field(default_factory=lambda: _env("VECTOR_INDEX_PATH", ""))
    embed_model_name: str = field(default_factory=lambda: _env("EMBED_MODEL_NAME", "BAAI/bge-m3"))

    # --- 上传（补充资料，私有存储）---
    upload_dir: str = field(default_factory=lambda: _env("UPLOAD_DIR", "uploads"))
    upload_enable_ingest: bool = field(
        default_factory=lambda: _env("UPLOAD_ENABLE_INGEST", "false").lower() in ("1", "true", "yes")
    )

    # --- CORS / 会话 ---
    cors_origins: list[str] = field(default_factory=list)
    max_history_turns: int = field(default_factory=lambda: int(_env("MAX_HISTORY_TURNS", "12") or 12))

    def __post_init__(self) -> None:
        raw = _env(
            "CORS_ORIGINS",
            "http://localhost:3000,https://wzy6789.github.io",
        )
        self.cors_origins = [o.strip() for o in raw.split(",") if o.strip()]


settings = Settings()
