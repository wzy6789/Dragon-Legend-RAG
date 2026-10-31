# RAG实验服务

静态前端由GitHub Pages提供，完整检索和私有研究资料仍在本机。此目录是独立实验入口，不导入原著、索引或密钥到仓库。

## 本机启动

```powershell
$env:RAG_PROJECT_ROOT = 'F:\龙王传说智能体'
D:\envs\douluo\python.exe local_bridge\server.py --port 8011
```

第一次启动以SQLite在线备份复制现有会话到`data/experiment_web_runs.sqlite3`，原官网数据库保持原位。任务、指标和评测在实验库中持续保存。重启保留已有内容，中断的生成/评分显示中断，不自动重新收费。

管理员密码从环境变量`RAG_EXPERIMENT_ADMIN_PASSWORD`或本机`D:\RAG实验网站\experiment-admin.env`读取；后者不进入仓库。作答使用访客自填DeepSeek Key。裁判使用项目本地配置的Qwen Key，前端不接收该密钥。

## 版本与评分

- `GET /api/systems`是唯一版本目录；不可运行条目返回待验证/归档原因，不降级到别的系统。
- 默认Flash v1.9 sem_select、Pro v2.5、Max v3.1。历史版本和变体全部可查看，通过接线验证后才可运行。
- `GET /api/benchmarks`返回冻结题库和协议；自由提问不自动匹配题库。
- `POST /api/runs`接受明确`system_id`和题库身份。对照第二次运行附`comparison_parent_run_id`，复用第一次的冻结上下文。
- `GET /api/runs/{id}/experiment`查看指标与历次评测；生成结束不代表评分结束。
- 管理员通过`POST /api/admin/login`登录，后续使用`X-Experiment-Admin`；会话绑定同一作答凭据身份。
- `POST /api/runs/{id}/evaluate`新增重评，不覆盖旧判。访客无权调用管理员付费评分。
- `GET /api/archives`与`GET /api/archives/{id}`仅管理员可读取本机批次档案。

FlashBench与老50题固定Qwen3.7 Plus，新49题与在线诊断固定Qwen3.8 Flash。精确API ID随每次评测记录。服务不可用、无效JSON、未核验gold、缺失指标都是明确状态，不等价0分；不自动更换裁判。

## 时间与比较

服务端区分排队和执行，保存公开阶段与最终答案时间；浏览器另记接收首字/完成耗时。草稿、正式答案分开计时；非流式答案不伪装实时流式。

没有可靠gold的自由问答是在线诊断；覆盖维度属于估计，不能进入正式benchmark榜单。不同题目、上下文、裁判或协议不可直接计算分差。缺少旧指标时显示未记录。

## 本地检查

```powershell
D:\envs\douluo\python.exe -m unittest discover -s local_bridge -p 'test_*.py'
cd frontend
npm test
npm run typecheck
npm run build
```

现有模型、索引及语料由`RAG_PROJECT_ROOT`提供；新增运行和评分不会触发历史全量重评。
