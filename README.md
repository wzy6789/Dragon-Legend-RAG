# Dragon King Legend — RAG Web

面向《斗罗大陆III 龙王传说》知识问答的**前后端分离** RAG 站点。

- **前端**：Next.js + TypeScript + Tailwind CSS（适配 Vercel）
- **后端**：FastAPI + Python，SSE 流式回答（适配 Docker / Railway / Render）
- **模式**：单一聊天入口；Flash（RAG1.0 快速简洁）/ Pro（RAG2.1 深度分析与证据核验）

> ⚠️ 版权与数据边界：本仓库**不含**任何小说正文、向量索引、API Key、用户上传资料或聊天记录。
> 推理所需的资料语料与索引必须在部署时通过**私有卷/环境变量路径**挂载（见 [数据挂载](#数据挂载私有卷)）。

---

## 目录结构

```
dragon-king-rag-site/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI 入口：/api/chat (SSE)、/api/uploads、/api/health
│   │   ├── config.py          # 环境变量读取（纯变量名，无密钥默认值）
│   │   ├── schemas.py         # 请求/事件数据模型
│   │   ├── chat.py            # 会话历史（内存）+ 流式组装
│   │   └── rag/
│   │       ├── retriever.py   # 检索器（BM25 over JSONL 语料；可选 FAISS 向量）
│   │       ├── engine.py      # RAG1.0 / RAG2.1 两级管线（拆解→检索→核验→组织）
│   │       └── prompts.py     # 提示词模板
│   ├── scripts/prepare_corpus.py   # 把私有 txt 语料切块 → corpus.jsonl（离线、自行运行）
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .dockerignore
│   └── .env.example
└── frontend/
    ├── app/                   # Next.js App Router
    ├── components/            # 聊天 UI（统一入口 / Flash / Pro / 来源 / 进度）
    ├── lib/                   # SSE 客户端、类型
    ├── package.json
    ├── next.config.mjs / tailwind / tsconfig
    └── .env.example
```

## 快速开始

### 0. 准备后端环境变量

```bash
cd backend
cp .env.example .env
# 填写真实值：
#   LLM_API_KEY=sk-xxxx
#   LLM_BASE_URL=https://api.deepseek.com/v1   # 任意 OpenAI 兼容端点
#   LLM_MODEL=deepseek-chat
#   RAG_DATA_PATH=/mnt/rag-data/corpus.jsonl   # 私有挂载的语料（见“数据挂载”）
#   CORS_ORIGINS=http://localhost:3000
```

### 1. 后端（本地）

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
# 健康检查: http://localhost:8000/api/health
```

### 2. 后端（Docker）

```bash
cd backend
docker build -t dragon-king-rag-backend .
docker run --rm -p 8000:8000 \
  --env-file .env \
  -v /absolute/path/to/private-corpus:/mnt/rag-data \
  dragon-king-rag-backend
```

### 3. 前端（本地）

```bash
cd frontend
cp .env.example .env.local       # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
# http://localhost:3000
```

### 4. 前端部署到 Vercel

1. 把 `frontend/` 作为独立项目导入 Vercel（Framework Preset: Next.js）。
2. 设置环境变量 `NEXT_PUBLIC_API_URL=https://<your-backend-domain>`。
3. Deploy。前端为纯静态可访问页面，SSE 由浏览器直连后端域名。

### 5. 后端部署到 Railway / Render

Railway / Render 均可直接识别根 `backend/Dockerfile`：

- **Railway**：New Project → Deploy from GitHub → Root Directory = `backend`；设置环境变量；可选 Volume 挂载语料目录到 `RAG_DATA_PATH`。
- **Render**：New Web Service → Root Directory = `backend`，Runtime = Docker；设置环境变量；可挂载 Disk 存放语料。
- 部署后把公网域名填到前端 `NEXT_PUBLIC_API_URL`，并在后端 `CORS_ORIGINS` 加入前端域名（如 `https://*.vercel.app`）。

#### Render 一键入口

仓库根目录的 `render.yaml` 已预设 Docker 服务、健康检查和私有数据盘。登录 Render 后选择 **New + → Blueprint** 并连接本仓库；只需在创建页填写 `LLM_API_KEY`。服务创建后：

1. 在 Render 的 Shell / Disk 中把你自己拥有的 `corpus.jsonl` 上传到 `/mnt/rag-data/corpus.jsonl`；
2. 复制服务的 `https://...onrender.com` 地址；
3. 在 GitHub 仓库 `Settings → Secrets and variables → Actions → Variables` 新增 `NEXT_PUBLIC_API_URL`，值为该地址；
4. 在 Actions 手动重跑 **Deploy frontend to GitHub Pages**。

默认跨域已允许 `https://wzy6789.github.io`，无需为 GitHub Pages 额外设置 CORS。

---

## 接口约定

### `POST /api/chat`（SSE）

请求：

```json
{ "message": "……", "tier": "flash", "conversation_id": "abc123" }
```

- `tier = "flash"` → 映射 **RAG1.0**：单轮轻量检索，回答快速简洁。
- `tier = "pro"` → 映射 **RAG2.1**：拆解 → 多路检索 → 证据核验 → 组织回答。
- `conversation_id` 可选；不传则后端自动生成。历史保存在后端内存，重启即清空（多副本场景建议外接 Redis，见文末）。

响应（`text/event-stream`），事件类型：

```
event: stage     data: {"stage":"拆解问题"}          # 仅 pro
event: token     data: {"text":"……"}                # 流式增量
event: sources   data: {"sources":[{"chapter":"第12章","chapter_index":12,"title":"…","snippet":"…"}]}
event: done      data: {"conversation_id":"abc123"}
event: error     data: {"message":"……"}
```

### `POST /api/uploads`

补充资料（保留入口）。Multipart 字段 `file`，`tier` 忽略。文件保存到私有 `uploads/`（不入 Git；生产建议独立卷）。可选地加入语料库用于后续检索（默认关闭，置 `UPLOAD_ENABLE_INGEST=true` 开启）。

### `GET /api/health`

```json
{ "status":"ok", "corpus_chunks": 12345, "vector_index": false }
```

---

## 数据挂载（私有卷）

语料与向量索引属于**受版权保护资料**，绝不进 Git。部署时二选一：

1. **BM25 JSONL 语料（推荐，零向量依赖）**
   - 在本地用 `python backend/scripts/prepare_corpus.py --input 原著.txt --output corpus.jsonl` 把**你自己拥有的资料**切成块（每块带 `chapter`/`chapter_index`/`title`/`text`）。
   - 上传/挂载 `corpus.jsonl` 到容器内 `RAG_DATA_PATH` 指向的路径（例如 `-v /mnt/private:/mnt/rag-data`）。

2. **FAISS 向量索引（可选，增强召回）**
   - 自行构建后挂载到 `VECTOR_INDEX_PATH`；安装 `requirements-vector.txt` 中的可选依赖（faiss-cpu、sentence-transformers）。
   - 检索器优先使用向量索引，缺失时回退 BM25。

`prepare_corpus.py` 与检索器都**只处理用户提供的私有文件**；仓库内不附带任何正文。

---

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `LLM_API_KEY` | 是 | OpenAI 兼容推理服务密钥 |
| `LLM_BASE_URL` | 是 | 推理服务 Base URL（如 `https://api.deepseek.com/v1`） |
| `LLM_MODEL` | 否 | 模型名（默认 `deepseek-chat`） |
| `RAG_DATA_PATH` | 是* | JSONL 语料路径（部署时挂载）。*缺失时服务仍启动，检索结果为空并提示 |
| `VECTOR_INDEX_PATH` | 否 | FAISS 索引路径（可选） |
| `EMBED_MODEL_NAME` | 否 | 向量模型名（可选，默认 `BAAI/bge-m3`） |
| `UPLOAD_DIR` | 否 | 上传资料保存目录（默认 `./uploads`） |
| `UPLOAD_ENABLE_INGEST` | 否 | 是否把上传资料并入语料（默认 false） |
| `CORS_ORIGINS` | 否 | 逗号分隔的允许来源（默认 `http://localhost:3000`） |
| `MAX_HISTORY_TURNS` | 否 | 内存会话保留轮数（默认 12） |

前端：

| 变量 | 说明 |
|---|---|
| `NEXT_PUBLIC_API_URL` | 后端公网/本地地址，如 `http://localhost:8000` |

---

## 聊天记录与数据隐私

- 会话历史仅存后端进程内存（`conversation_id` 键控），进程重启即清空；不做持久化，避免把聊天记录带入任何存储。
- 前端不上传历史，仅保留 `conversation_id` 引用。
- 多实例/水平扩展场景：将历史外置到 Redis 需要自行扩展 `chat.py`（当前为单进程内存实现）。

## 许可与版权

代码部分可按你的项目约定授权；**任何受版权保护的小说正文、向量库、密钥均不随仓库分发**。
