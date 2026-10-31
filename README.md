# 龙王传说 RAG 官网

这是《斗罗大陆III 龙王传说》知识问答网站的 GitHub Pages 前端。网站访问的完整知识库和 RAG 算法运行在独立的私有服务中；本仓库不包含原著、索引、知识图谱、模型 API Key 或用户对话记录。

## 官网结构

- 前端：Next.js 静态导出，部署到 GitHub Pages。
- RAG 服务：私有工作站上的 FastAPI `src/web_bridge.py`，通过 Cloudflare Tunnel 暴露 HTTPS 接口。
- 历史与任务：浏览器 IndexedDB 保存用户界面的对话；私有 RAG 服务的本机 `data/web_runs.sqlite3` 保存任务快照和可恢复事件。删除对话会请求清理服务端任务记录。
- 模型 Key：用户发送问题时通过请求头交给私有服务，仅在任务运行期间保存在服务进程内存，不进入网站仓库或任务数据库。

仓库内的 `backend/` 是早期独立演示后端，不接入私有完整 RAG，也不应作为官网的生产 RAG 服务部署。

## 官网档位

| 页面档位 | 私有 RAG 路由 | 用途 |
| --- | --- | --- |
| Flash | flash-1.6～flash-2.2，每代 1～2 个代表版 | 快速问答与跨版本对比，默认仍为 1.9 `sem_select` |
| Pro | 2.0 / 2.1 / 2.2 / 2.5，各一版 | 复杂问题、多轮补检与终稿审校，默认 2.5 |
| Max | 3.0 / 3.1 / 3.2，各一版 | 自主调查、结论核验与证据闭环，默认 3.1 |

每条回答按实际运行版本显示标签。Pro/Max 的实时初稿会标记为“待核验”，只有审校后的终稿才作为最终答案。

Pro 仅包含 2.x，Max 仅包含 3.x，每代一版。Max 3.2 使用 `src/pro32` 的历史代表架构及 32 次调用预算；代码中的历史名称不改变官网所属档位，也不自动切换到 48 次预算。所有版本按所选配置执行，请求结束恢复配置，避免跨版本串用。2.3 缺少独立运行配置、2.4 主要为轨迹观测，保留历史报告，不列作独立可运行代表。

Flash 代表版：1.6；1.7 patch2；1.8 slot2c；1.9 sem / sem_select；2.0 初版 / 质量修正版；2.1 语境恢复版 / 单次证据视图版；2.2 冻结 r1 / r2。其他实验身份保留在历史记录中，不进入常用选择列表。

同代变体在界面使用英文特征名：2.0 为 `budget_rag` / `evidence_select`，2.1 为 `context_repair` / `single_view`，2.2 为 `scene_memory` / `facet_binding`，依次对应上面的两版。名称只描述结构特征，原系统 ID、配置、代码快照与历史批次保持原有对应关系。

2.x 由 `local_bridge/flash_runtime.py` 加载本机保留的对应代码与配置，使用当前本地资料。网页重新运行不等同于历史模型、资料与服务环境的完整复现。代码、索引、原文与模型凭据不进入静态网站。生成模型、实际调用数、来源全文与时延写入本次运行记录；评分协议保持原样。

本机服务从 `local_bridge/server.py` 启动。2.x 与原有入口共用串行队列和本地模型权重；服务就绪前准备六个固定代表版，字节一致的资源包共享只读后端。六个运行时常驻，切换版本不会因两个缓存槽淘汰而重新加载。每版复用网络线程和 HTTP 连接池，用户 Key 只在当次请求绑定，完成或取消后清除。

Flash 首段非空文字立即推送，后续按 50ms 窗口或 32 字阈值合并；SSE 使用事件通知唤醒。运行详情分别记录版本初始化、客户端准备、内核首字和模型首字等待；网页端到端指标仍包括排队和准备开销，历史缺失指标显示“未记录”。启动预热只加载本地资源并创建客户端，不发送远程模型请求。

## GitHub Pages 部署

GitHub Actions 工作流会构建 `frontend/` 的静态导出。当前网站脚本会在启动本机服务和 Cloudflare Tunnel 后，将新 Tunnel 地址写入工作流并更新 Pages。若手动配置地址：

- `NEXT_PUBLIC_API_URL`：工作流中的当前私有 RAG 服务 HTTPS 地址，不要带末尾斜杠。
- `NEXT_PUBLIC_BASE_PATH`：GitHub Pages 子路径，当前仓库使用 `/Dragon-Legend-RAG`。

Cloudflare 临时域名更换后，启动脚本会更新工作流并触发前端重新部署。手动改动后，在 GitHub Actions 中重新运行 **Deploy frontend to GitHub Pages**。模型 API Key、隧道凭据和其他私密信息都不要放进前端代码；NEXT_PUBLIC 变量会公开给浏览器。

## 本地前端开发

在 `frontend/` 中设置 `.env.local`：

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_BASE_PATH=
```

再安装依赖并启动 Next.js 开发服务。前端只调用私有桥接服务，不会从 GitHub Pages 直接运行 Python 或加载本机索引。

## 私有服务接口

新前端使用可恢复的任务接口：

- `POST /api/runs`：创建任务，`X-RAG-Access-Key` 与 `X-LLM-API-Key` 使用同一个用户 API Key；该 Key 的哈希用于隔离各自的服务端对话。
- `GET /api/runs/{run_id}`：读取任务快照。
- `GET /api/runs/{run_id}/events?after={seq}`：从事件序号续接 SSE。
- `GET /api/runs/by-request/{client_request_id}`：恢复创建请求响应丢失时的任务。
- `POST /api/runs/{run_id}/cancel`：停止指定任务。
- `DELETE /api/conversations/{conversation_id}`：清理该对话的服务端任务数据。
- `GET /api/health`：查看私有服务就绪状态与三档版本映射。

浏览器切换对话或刷新页面只会断开当前事件订阅；后台任务会继续运行，重新打开对话时可从最后收到的序号恢复。私有服务当前使用单任务队列来保护共享 RAG 配置和 GPU，其他对话会显示排队状态。

## 数据与安全边界

- 小说资料、FAISS/BM25 索引和知识图谱仅保存在私有 RAG 项目及本机数据目录。
- GitHub Pages 是公开静态站点；不要在任何 `NEXT_PUBLIC_*` 变量、前端文件或页面事件中放密钥。
- 登录只需 DeepSeek API Key。用户选择记住后，浏览器本地只保存这一把 Key；旧版保存的双凭据会自动迁移。
- 本机服务重启会将当时未完成的任务标记为中断，并保留已保存的部分内容；任务不会伪装成成功完成。
