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
| Flash | v1.9 `sem_select` | 快速事实问答 |
| Pro | v2.5 Pro | 复杂问题、多轮补检与终稿审校 |
| Max | v3.0 MAX | 主动补证、独立反证审校与有据推演 |

每条回答按实际运行版本显示标签。Pro/Max 的实时初稿会标记为“待核验”，只有审校后的终稿才作为最终答案。

## GitHub Pages 部署

GitHub Actions 工作流会构建 `frontend/` 的静态导出。当前网站脚本会在启动本机服务和 Cloudflare Tunnel 后，将新 Tunnel 地址写入工作流并更新 Pages。若手动配置地址：

- `NEXT_PUBLIC_API_URL`：工作流中的当前私有 RAG 服务 HTTPS 地址，不要带末尾斜杠。
- `NEXT_PUBLIC_BASE_PATH`：GitHub Pages 子路径，当前仓库使用 `/Dragon-Legend-RAG`。

Cloudflare 临时域名更换后，启动脚本会更新工作流并触发前端重新部署。手动改动后，在 GitHub Actions 中重新运行 **Deploy frontend to GitHub Pages**。访问密码、模型 API Key、隧道凭据和其他私密信息都不要放进前端代码；`NEXT_PUBLIC_*` 值会公开给浏览器。

## 本地前端开发

在 `frontend/` 中设置 `.env.local`：

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_BASE_PATH=
```

再安装依赖并启动 Next.js 开发服务。前端只调用私有桥接服务，不会从 GitHub Pages 直接运行 Python 或加载本机索引。

## 私有服务接口

新前端使用可恢复的任务接口：

- `POST /api/runs`：创建任务，要求 `X-RAG-Access-Key` 和 `X-LLM-API-Key`。
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
- 访问密码和模型 Key 默认只存在当前页面内存；只有用户主动勾选“在此设备记住”才保存在该浏览器本地。
- 本机服务重启会将当时未完成的任务标记为中断，并保留已保存的部分内容；任务不会伪装成成功完成。
