# -*- coding: utf-8 -*-
"""把私有小说文本切成语料块（JSONL），供后端 BM25 / 向量索引使用。

⚠️ 版权提示：本脚本只处理你自己合法拥有的资料文件；
输出 corpus.jsonl 属于私有数据，禁止提交进 Git 仓库。

用法：
  python scripts/prepare_corpus.py --input 原著.txt --output /mnt/rag-data/corpus.jsonl [--block 600]

可选：按“第N章”标题拆分章节（--split-chapters 默认开启）；
若源文件没有章节标记，则按固定字符块切分。
"""
from __future__ import annotations

import argparse
import json
import re

CHAPTER_RE = re.compile(r"^\s*(第\s*[0-9一二三四五六七八九十百千零两]+\s*章[^\n]{0,40})\s*$", re.M)


def split_by_chapters(text: str):
    """返回 [(chapter_title, body)]；无章节标记时返回单个 ('', text)。"""
    matches = list(CHAPTER_RE.finditer(text))
    if not matches:
        return [("", text)]
    parts = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        if body:
            parts.append((m.group(1).strip(), body))
    return parts


def chop(body: str, block: int):
    return [body[i : i + block] for i in range(0, len(body), block)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="私有原著 txt 路径")
    ap.add_argument("--output", required=True, help="输出 corpus.jsonl 路径")
    ap.add_argument("--block", type=int, default=600, help="每块字符数")
    ap.add_argument("--no-split-chapters", action="store_true", help="不做章节拆分，直接定长切块")
    args = ap.parse_args()

    with open(args.input, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    print(f"源文本 {len(text)} 字符")

    rows = []
    if args.no_split_chapters:
        for i, block in enumerate(chop(text, args.block)):
            if block.strip():
                rows.append({"chapter_index": None, "chapter": "", "title": "", "text": block.strip()})
    else:
        for ci, (title, body) in enumerate(split_by_chapters(text), 1):
            for block in chop(body, args.block):
                if block.strip():
                    rows.append({
                        "chapter_index": ci,
                        "chapter": title,
                        "title": title,
                        "text": block.strip(),
                    })

    with open(args.output, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"写出 {len(rows)} 块 → {args.output}")


if __name__ == "__main__":
    main()
