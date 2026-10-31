"""Owner-scoped experiment sidecars and a separate, durable judging queue.

The bridge owns generation and the runs table. This module never publishes run
events, changes generation configuration, or retries an interrupted paid judge.
Only the transport uses OpenAI; storage, protocol loading and scheduling use the
standard library. Import/install are safe before the bridge creates its tables.
"""
from __future__ import annotations

import ast
import hashlib
import hmac
import importlib
import json
import math
import os
import re
import secrets
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

from fastapi import Header, HTTPException, Request

PROTOCOLS = {
    "free": ("ONLINE_DIAGNOSTIC_7D_V1", "qwen3.8-flash", "自由提问 · 七维在线诊断"),
    "new49": ("SCORING_STANDARD_7D49_R2", "qwen3.8-flash", "新49题 · 7D49 R2"),
    "legacy50": ("SCORING_STANDARD_8.86_老50题", "qwen3.7-plus", "老50题 · 8.86口径"),
    "flashbench": ("FLASHBENCH_CLAIM_1.0", "qwen3.7-plus", "FlashBench · 核验门禁"),
}
DIMS = ("rel", "fact", "reas", "comp", "lang", "tone", "cite")
DIM_NAMES = dict(zip(DIMS, ("检索相关度", "事实准确", "推理严密", "覆盖完整", "表达自然", "语气适配", "引用规范")))
FREE_PROMPT = """你是严格的七维在线诊断裁判。本协议 ONLINE_DIAGNOSTIC_7D_V1。
这是自由提问的在线诊断，不是正式基准分数。仅依据问题、回答及实际资料判断。
comp 是根据问题要求估计的完整度 estimated_comp，不是 gold 原子点覆盖率；
没有 gold，不得编造 gold、coverage_rate 或套用 gold 覆盖率封顶。
资料未覆盖不等于事实错误。区分资料缺失与明确矛盾。
先将题型分类为以下枚举之一：<<TYPES>>。
七维 rel/fact/reas/comp/lang/tone/cite 分别为相关、事实、推理、估计完整、表达、语气、引用，均为0到10有限数值。
只输出 JSON：{"type":"枚举之一","dimensions":{"rel":0,"fact":0,"reas":0,"comp":0,"lang":0,"tone":0,"cite":0},"reasons":{"fact":"具体理由","comp":"估计完整度及其局限"}}。
【问题】<<QUESTION>>
【回答】<<ANSWER>>
【实际资料】<<SOURCES>>"""
_SECRET_KEY = re.compile(r"api_?key|access_?key|secret|password|authorization|base_url|endpoint|^(?:token|admin_token)$", re.I)
_service = None
_bridge = None


class Unavailable(RuntimeError):
    pass


class Malformed(ValueError):
    pass


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _definitions(path, names, namespace=None, source=None):
    """Load reviewed definitions without scorer CLI/config/agent import effects.

    Legacy imports load the GPU agent and change process-global judge settings.
    Compiling only named definitions preserves their exact pure calculation and
    prompt construction while routing paid transport through this service.
    """
    if source is None:
        source = Path(path).read_text(encoding="utf-8-sig")
    tree = ast.parse(source, filename=str(path))
    nodes = []
    found = set()
    for node in tree.body:
        identifiers = ([node.name] if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) else
                       [t.id for t in node.targets if isinstance(t, ast.Name)] if isinstance(node, ast.Assign) else [])
        if set(identifiers) & set(names):
            nodes.append(node)
            found.update(identifiers)
    if set(names) - found:
        raise Unavailable("pinned scorer definitions unavailable")
    scope = {"json": json, "re": re, "__name__": "experiment_pinned_scorer", **(namespace or {})}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), scope)
    return scope


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 10:
        raise Malformed("dimensions must be finite numbers between 0 and 10")
    return float(value)


def _dimensions(value, required=DIMS):
    if not isinstance(value, dict) or any(key not in value for key in required):
        raise Malformed("missing required dimensions")
    # Validate optional dimensions too; never silently clamp malformed input.
    for key, number in value.items():
        if key in DIMS or key in DIM_NAMES.values():
            _number(number)
    return {key: _number(value[key]) for key in required}


def _parse(raw):
    if not isinstance(raw, str):
        raise Malformed("judge response has no text")
    raw = raw.strip()
    if raw.startswith("```") and raw.endswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)[:-3].strip()
    try:
        return json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(Malformed("nonfinite JSON")))
    except (TypeError, ValueError) as exc:
        raise Malformed("judge response is not valid JSON") from exc


class ExperimentService:
    def __init__(self, bridge):
        self.bridge = bridge
        self.root = Path(os.environ.get("RAG_PROJECT_ROOT", "F:/龙王传说智能体"))
        self.config = getattr(bridge, "config", None)
        if self.config is None:
            self.config = importlib.import_module("config")
        self._lock = threading.RLock()
        self._tokens = {}
        self._login_windows = {}
        self._clocks = {}
        self._closed = False
        self._admin_password = os.environ.get("RAG_EXPERIMENT_ADMIN_PASSWORD", "")
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="experiment-judge")
        with bridge._run_db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS run_experiments (
                    run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
                    owner_id TEXT NOT NULL, system_id TEXT NOT NULL,
                    system_json TEXT NOT NULL, request_json TEXT NOT NULL,
                    benchmark_id TEXT NOT NULL, question_id TEXT, protocol_id TEXT NOT NULL,
                    scoring_json TEXT NOT NULL, generation_model TEXT,
                    runtime_json TEXT NOT NULL DEFAULT '{}', answer_hash TEXT,
                    metrics_json TEXT NOT NULL, timeline_json TEXT NOT NULL,
                    context_json TEXT NOT NULL DEFAULT '[]', diagnostics_json TEXT NOT NULL DEFAULT '{}',
                    created_at REAL NOT NULL, terminal INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS experiment_evaluations (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL REFERENCES run_experiments(run_id) ON DELETE CASCADE,
                    status TEXT NOT NULL, judge_model TEXT NOT NULL, protocol_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL, input_json TEXT NOT NULL DEFAULT '{}',
                    result_json TEXT NOT NULL DEFAULT '{}', error TEXT,
                    calls INTEGER NOT NULL DEFAULT 0, usage_json TEXT NOT NULL DEFAULT '{}',
                    created_at REAL NOT NULL, finished_at REAL,
                    UNIQUE(run_id, idempotency_key)
                );
                CREATE INDEX IF NOT EXISTS experiment_judge_queue
                    ON experiment_evaluations(status, created_at);
                CREATE TABLE IF NOT EXISTS experiment_admin_auth (
                    id INTEGER PRIMARY KEY CHECK(id=1),
                    password_salt TEXT NOT NULL, password_stamp TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS experiment_admin_sessions (
                    token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
                    password_stamp TEXT NOT NULL, created_at REAL NOT NULL,
                    expires_at REAL
                );
            """)
            db.execute("INSERT OR IGNORE INTO experiment_admin_auth VALUES(1,?, '')", (secrets.token_hex(32),))
            salt = db.execute("SELECT password_salt FROM experiment_admin_auth WHERE id=1").fetchone()[0]
            # A salted, slow verifier identifies the startup password without
            # persisting it. Delete old sessions so reverting a password cannot revive them.
            self._password_stamp = (hashlib.scrypt(self._admin_password.encode(), salt=bytes.fromhex(salt),
                                                  n=16384, r=8, p=1).hex() if self._admin_password else "")
            db.execute("DELETE FROM experiment_admin_sessions WHERE password_stamp<>? OR ?=''",
                       (self._password_stamp, self._password_stamp))
            db.execute("UPDATE experiment_admin_auth SET password_stamp=? WHERE id=1", (self._password_stamp,))
            db.execute("UPDATE experiment_evaluations SET status='error',error=?,finished_at=? "
                       "WHERE status='judging'", ("interrupted_judging; explicit rejudge required to avoid duplicate billing", time.time()))
        self._executor.submit(self._drain)

    def close(self):
        if not self._closed:
            self._closed = True
            self._executor.shutdown(wait=True)

    def _clean(self, value):
        if isinstance(value, dict):
            return {str(k): self._clean(v) for k, v in value.items() if not _SECRET_KEY.search(str(k))}
        if isinstance(value, (list, tuple)):
            return [self._clean(v) for v in value]
        if isinstance(value, str):
            for name in ("QWEN_API_KEY", "QWEN_BASE_URL", "DEEPSEEK_API_KEY", "MIMO_API_KEY"):
                secret = str(getattr(self.config, name, "") or "")
                if secret:
                    value = value.replace(secret, "[redacted]")
            return re.sub(r"\bsk-[A-Za-z0-9_-]{8,}", "[redacted]", value)
        if value is None or isinstance(value, (bool, int)):
            return value
        if isinstance(value, float):
            return value if math.isfinite(value) else None
        return str(value)

    def _generation_model(self):
        provider = getattr(self.config, "GENERATION_PROVIDER", "deepseek")
        name = "MIMO_MODEL" if provider == "mimo" else "LLM_MODEL"
        return self._clean(getattr(self.config, name, None))

    def _runtime_config(self):
        safe = {"GENERATION_PROVIDER", "LLM_MODEL", "MIMO_MODEL", "EMBED_MODEL_NAME", "RERANKER_MODEL_NAME"}
        safe.update(getattr(self.bridge, "_PROFILE_FLAGS", ()))
        safe.update(getattr(self.bridge, "_V19_PROFILE_KEYS", ()))
        for name in vars(self.config):
            if name.startswith(("FLASH_", "PRO_", "CRAG_", "AGENTIC_")) and not _SECRET_KEY.search(name):
                value = getattr(self.config, name)
                if isinstance(value, (bool, int, float)) or name.endswith(("VERSION", "PROFILE", "MODEL")):
                    safe.add(name)
        return self._clean({name: getattr(self.config, name) for name in sorted(safe) if hasattr(self.config, name)})

    def _admin_session(self, token):
        if self._closed or not self._admin_password or not isinstance(token, str) or not token:
            return None
        with self._lock, self.bridge._run_db() as db:
            # The database is authoritative even when another service revoked
            # the token or changed the configured password since startup.
            return db.execute("SELECT s.owner_id FROM experiment_admin_sessions s "
                              "JOIN experiment_admin_auth a ON a.id=1 AND a.password_stamp=s.password_stamp "
                              "WHERE s.token_hash=? AND s.password_stamp=? "
                              "AND (s.expires_at IS NULL OR s.expires_at>?)",
                              (_hash(token), self._password_stamp, time.time())).fetchone()

    def authorize_admin(self, token):
        return self._admin_session(token) is not None

    def require_admin_owner(self, token, owner_id):
        entry = self._admin_session(token)
        if entry is None or entry["owner_id"] != owner_id:
            raise HTTPException(403, "管理员令牌无效、已过期或不属于此访问身份")

    def logout(self, token, owner_id):
        with self._lock:
            self.require_admin_owner(token, owner_id)
            with self.bridge._run_db() as db:
                db.execute("DELETE FROM experiment_admin_sessions WHERE token_hash=? AND owner_id=?",
                           (_hash(token), owner_id))
            self._tokens.pop(_hash(token), None)
        return {"authorized": False, "authenticated": False}

    def login(self, request, owner_id, password):
        expected = self._admin_password
        if not expected:
            raise HTTPException(503, "实验管理员密码未配置")
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        with self._lock:
            # Both owner and peer limits prevent swapping access keys to bypass throttling.
            keys = ("ip:" + ip, "owner:" + owner_id)
            for key in list(self._login_windows):
                self._login_windows[key] = [t for t in self._login_windows[key] if now - t < 300]
                if not self._login_windows[key]:
                    del self._login_windows[key]
            if any(len(self._login_windows.get(key, [])) >= 5 for key in keys):
                raise HTTPException(429, "管理员登录尝试过多，请稍后再试")
            if not isinstance(password, str) or not hmac.compare_digest(password.encode(), expected.encode()):
                for key in keys:
                    self._login_windows.setdefault(key, []).append(now)
                raise HTTPException(403, "管理员密码错误")
            token = secrets.token_urlsafe(36)
            with self.bridge._run_db() as db:
                inserted = db.execute("INSERT INTO experiment_admin_sessions "
                    "(token_hash,owner_id,password_stamp,created_at,expires_at) "
                    "SELECT ?,?,password_stamp,?,NULL FROM experiment_admin_auth WHERE id=1 AND password_stamp=?",
                    (_hash(token), owner_id, time.time(), self._password_stamp))
                if inserted.rowcount != 1:
                    raise HTTPException(503, "管理员密码配置已变更，请重启实验服务")
        return {"token": token, "authorized": True, "expires_in": None, "expires_at": None}

    def _seven(self, identity=None):
        scope = _definitions(self.root / "src/evaluate_7d49.py", (
            "TYPE_WEIGHTS", "EXCLUDED", "MODEL", "SCORING_STANDARD", "load_data", "prompt_for",
            "valid_judgement_schema", "clamp10", "score"),
            source=identity["sources"]["src/evaluate_7d49.py"]["text"] if identity else None)
        if scope["MODEL"] != "qwen3.8-flash" or scope["SCORING_STANDARD"] != PROTOCOLS["new49"][0]:
            raise Unavailable("7D49 pinned protocol changed")
        scope.update(BENCHMARK=str(self.root / "data/dragon_king_rag_benchmark_v4.json"),
                     RUBRIC=str(self.root / "data/phase2_gold_rubric_v8.json"))
        return scope

    def _weights(self, identity=None):
        return _definitions(self.root / "src/scoring_weights.py", (
            "TYPE_WEIGHTS", "DIM_KEYS", "DIM_NAMES", "get_weights", "weighted_score"),
            source=identity["sources"]["src/scoring_weights.py"]["text"] if identity else None)

    def _freeze_scorer(self, bank, scoring):
        paths = {
            "free": ("src/scoring_weights.py",),
            "new49": ("src/evaluate_7d49.py", "data/dragon_king_rag_benchmark_v4.json", "data/phase2_gold_rubric_v8.json"),
            "legacy50": ("src/evaluate_50q.py", "src/scoring_weights.py", "data/questions_50.txt", "results/legacy50/v19_sem_select_50q.json"),
        }
        if bank not in paths:
            raise Unavailable("scorer protocol unavailable")
        sources = {}
        for name in paths[bank]:
            raw = (self.root / name).read_bytes()
            sources[name] = {"sha256": hashlib.sha256(raw).hexdigest()}
            if name.endswith(".py"):
                sources[name]["text"] = raw.decode("utf-8-sig")
        identity = {"version": 1, "benchmark_id": bank, "protocol_id": PROTOCOLS[bank][0],
                    "judge_model": PROTOCOLS[bank][1], "sources": sources,
                    "adapter_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    "rubric": scoring.get("_rubric"), "type": scoring.get("type")}
        if bank == "new49":
            scope = self._seven(identity)
            identity["weights"] = scope["TYPE_WEIGHTS"][scoring["_rubric"]["profile"]]
            tree = ast.parse(sources["src/evaluate_7d49.py"]["text"])
            definition = next(x for x in tree.body if isinstance(x, ast.FunctionDef) and x.name == "prompt_for")
            identity["prompt_template"] = ast.get_source_segment(sources["src/evaluate_7d49.py"]["text"], definition)
        else:
            identity["weights"] = self._weights(identity)["TYPE_WEIGHTS"]
            if bank == "free":
                identity["prompt_template"] = FREE_PROMPT
            else:
                scope = _definitions(self.root / "src/evaluate_50q.py", ("JUDGE_PROMPT", "TYPE_SPECIFIC_RULES"),
                                     source=sources["src/evaluate_50q.py"]["text"])
                identity["prompt_template"] = scope["JUDGE_PROMPT"]
                identity["type_specific_rules"] = scope["TYPE_SPECIFIC_RULES"]
        identity["fingerprint"] = _hash(_json(identity))
        self._verify_scorer(identity, identity["protocol_id"], identity["judge_model"])
        return identity

    def _verify_scorer(self, identity, protocol, model):
        if not isinstance(identity, dict) or not identity.get("fingerprint"):
            raise Unavailable("immutable scorer identity unavailable; explicit rejudge required")
        contents = {k: v for k, v in identity.items() if k != "fingerprint"}
        bank = identity.get("benchmark_id")
        pinned = {"free": "qwen3.8-flash", "new49": "qwen3.8-flash", "legacy50": "qwen3.7-plus"}
        if (_hash(_json(contents)) != identity["fingerprint"] or bank not in pinned or
                (protocol, model) != (identity.get("protocol_id"), identity.get("judge_model")) or
                model != pinned[bank] or PROTOCOLS.get(bank, ())[:2] != (protocol, model)):
            raise Unavailable("pinned scorer protocol/model unavailable or changed")
        try:
            if hashlib.sha256(Path(__file__).read_bytes()).hexdigest() != identity["adapter_sha256"]:
                raise Unavailable("scorer adapter changed since evaluation was frozen")
            for name, source in identity["sources"].items():
                if hashlib.sha256((self.root / name).read_bytes()).hexdigest() != source["sha256"]:
                    raise Unavailable("scorer source changed since evaluation was frozen: " + name)
        except OSError as exc:
            raise Unavailable("frozen scorer source unavailable") from exc
        if bank == "free" and identity["prompt_template"] != FREE_PROMPT:
            raise Unavailable("pinned diagnostic prompt changed")

    def _bank(self, bank):
        if bank == "free":
            return []
        if bank == "new49":
            questions, rubrics = self._seven()["load_data"]()
            if set(questions) != set(range(1, 51)) - {20}:
                raise Unavailable("new49 frozen question IDs unavailable")
            return [{**q, "id": str(qid), "runnable": True, "_rubric": rubrics[qid]}
                    for qid, q in sorted(questions.items())]
        if bank == "legacy50":
            rows = []
            for line in (self.root / "data/questions_50.txt").read_text(encoding="utf-8-sig").splitlines():
                if line.strip():
                    match = re.fullmatch(r"\s*(\d+)\s+(.+?)\s*", line)
                    if not match:
                        raise Unavailable("invalid frozen legacy question bank")
                    rows.append({"id": match[1], "question": match[2]})
            # This local generation archive explicitly preserves the v2.1 frozen
            # types (run_v19_on_legacy50.py); never substitute local classification.
            archive = json.loads((self.root / "results/legacy50/v19_sem_select_50q.json").read_text(encoding="utf-8"))
            if archive.get("standard") != PROTOCOLS[bank][0]:
                raise Unavailable("legacy frozen type provenance unavailable")
            types = {str(x["id"]): x for x in archive["results"]}
            if len(rows) != 50 or [x["id"] for x in rows] != [str(i) for i in range(1, 51)] or set(types) != {x["id"] for x in rows}:
                raise Unavailable("legacy50 frozen IDs unavailable")
            weights = self._weights()["TYPE_WEIGHTS"]
            for row in rows:
                old = types[row["id"]]
                if row["question"] != old.get("question") or old.get("type") not in weights:
                    raise Unavailable("legacy frozen question/type mismatch")
                row.update(type=old["type"], runnable=True)
            return rows
        questions = json.loads((self.root / "benchmarks/flashbench_v1/questions.json").read_text(encoding="utf-8"))
        # Draft rubrics and unbound F5 sessions are never silently relabelled as
        # formal gold. Claim timing requires verified gold + a bound trace/session.
        return [{"id": str(x["id"]), "question": x.get("question") or
                 ((x.get("turns") or [{}])[0].get("question", "多轮会话")),
                 "type": x.get("category"), "runnable": False,
                 "reason": "F5 需要绑定指定多轮会话，当前入口未实现" if str(x["id"]).startswith("F5") else
                           "FlashBench 草稿 gold 尚未通过原著证据与人工核验；正式评分 blocked",
                 **({"context": x["turns"]} if x.get("turns") else {})} for x in questions.get("cases", [])]

    def benchmarks(self):
        result = []
        for bank, (protocol, _, label) in PROTOCOLS.items():
            try:
                rows = self._bank(bank)
                questions = [{k: v for k, v in row.items() if k in
                              {"id", "question", "type", "runnable", "reason", "context"}} for row in rows]
                extra = {}
            except (OSError, ValueError, KeyError, Unavailable):
                questions, extra = [], {"status": "unavailable", "reason": "冻结题库或评分材料不可用"}
            result.append({"id": bank, "label": label, "protocol_id": protocol, "questions": questions, **extra})
        return {"benchmarks": result}

    def create_metadata(self, run_id, owner_id, req, system, admin_token):
        bank = req.get("benchmark_id") or "free"
        if bank not in PROTOCOLS:
            raise HTTPException(422, "未知 benchmark_id")
        protocol, model, _ = PROTOCOLS[bank]
        if req.get("protocol_id") not in (None, "", protocol):
            raise HTTPException(422, "protocol_id 与冻结评分协议不匹配")
        if admin_token is not None or bank != "free":
            self.require_admin_owner(admin_token, owner_id)
        message = req.get("message", "")
        if not isinstance(message, str) or not message.strip():
            raise HTTPException(422, "问题不能为空")
        qid = req.get("question_id")
        scoring = {}
        if bank == "free":
            if qid not in (None, ""):
                raise HTTPException(422, "自由提问不能指定基准题号")
        else:
            try:
                question = next((x for x in self._bank(bank) if x["id"] == str(qid)), None)
            except (OSError, ValueError, KeyError, Unavailable) as exc:
                raise HTTPException(422, "冻结评分材料不可用") from exc
            if question is None or message != question["question"]:
                raise HTTPException(422, "题号和题面必须与冻结基准完全一致")
            if not question.get("runnable"):
                raise HTTPException(422, question["reason"])
            scoring = question
        comparison = req.get("comparison_parent_run_id")
        if comparison:
            parent = self.bridge._get_owned_run(str(comparison), owner_id)
            if parent is None:
                raise HTTPException(404, "对照父任务不存在")
        clean_req = {"message": message, "benchmark_id": bank, "question_id": str(qid) if qid is not None else None,
                     "comparison_parent_run_id": comparison}
        system_id = system.get("id") or system.get("system_id")
        if not system_id:
            raise HTTPException(422, "system identity required")
        try:
            scoring["_scorer"] = self._freeze_scorer(bank, scoring)
        except (OSError, ValueError, KeyError, Unavailable) as exc:
            raise HTTPException(422, "冻结评分器不可用，未发起评分调用") from exc
        snapshot = self._clean(system)
        now = time.time()
        metrics = {"queue_ms": None, "execution_ms": None, "ttft_ms": None, "draft_ttft_ms": None,
                   "e2e_ms": None, "delivery_mode": "unknown"}
        with self.bridge._run_db() as db:
            row = db.execute("SELECT owner_id FROM runs WHERE run_id=?", (run_id,)).fetchone()
            if row is None or row["owner_id"] != owner_id:
                raise HTTPException(404, "任务不存在")
            existing = db.execute("SELECT * FROM run_experiments WHERE run_id=?", (run_id,)).fetchone()
            if existing:
                if (existing["owner_id"], existing["system_id"], existing["benchmark_id"], existing["question_id"]) != (
                        owner_id, system_id, bank, str(qid) if qid is not None else None):
                    raise HTTPException(409, "任务元数据已冻结")
                return
            db.execute("INSERT INTO run_experiments(run_id,owner_id,system_id,system_json,request_json,benchmark_id,"
                       "question_id,protocol_id,scoring_json,generation_model,metrics_json,timeline_json,created_at) "
                       "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (run_id, owner_id, system_id, _json(snapshot), _json(clean_req),
                       bank, str(qid) if qid is not None else None, protocol, _json(scoring), snapshot.get('generation_model') or self._generation_model(),
                       _json(metrics), _json([]), now))
            self._insert_evaluation(db, run_id, "pending_generation" if admin_token else "not_authorized", model, protocol, "auto",
                                    {"scorer": scoring["_scorer"]})
        with self._lock:
            self._clocks[run_id] = time.monotonic()

    def _insert_evaluation(self, db, run_id, status, model, protocol, key, input_data=None):
        eid = uuid.uuid4().hex
        db.execute("INSERT INTO experiment_evaluations(id,run_id,status,judge_model,protocol_id,idempotency_key,input_json,created_at,finished_at) "
                   "VALUES(?,?,?,?,?,?,?,?,?)", (eid, run_id, status, model, protocol, key, _json(input_data or {}),
                   time.time(), time.time() if status == "not_authorized" else None))
        return eid

    def get_experiment(self, run_id):
        with self.bridge._run_db() as db:
            row = db.execute("SELECT * FROM run_experiments WHERE run_id=?", (run_id,)).fetchone()
            if row is None:
                return None
            evaluations = db.execute("SELECT * FROM experiment_evaluations WHERE run_id=? ORDER BY created_at,id", (run_id,)).fetchall()
        request = json.loads(row["request_json"])
        context = json.loads(row["context_json"])
        records = []
        for evaluation in evaluations:
            result = json.loads(evaluation["result_json"])
            usage = json.loads(evaluation["usage_json"])
            usage["calls"] = evaluation["calls"]
            frozen = json.loads(evaluation["input_json"])
            identity = frozen.get("scorer") or {}
            records.append({"id": evaluation["id"], "status": evaluation["status"], "judge_model": evaluation["judge_model"],
                "protocol_id": evaluation["protocol_id"], "score": None, "dimensions": {}, "weights": {}, "reasons": {},
                **result, "error": evaluation["error"], "usage": usage,
                "scorer_fingerprint": identity.get("fingerprint"),
                "scorer_identity": {"source_fingerprints": {name: value["sha256"] for name, value in identity.get("sources", {}).items()},
                                    "adapter_sha256": identity.get("adapter_sha256"),
                                    "prompt_template_sha256": _hash(identity["prompt_template"]) if identity.get("prompt_template") else None},
                "prompt_hashes": [x["prompt_sha256"] for x in frozen.get("judge_requests", [])],
                "created_at": evaluation["created_at"], "finished_at": evaluation["finished_at"]})
        return {"system_id": row["system_id"], "system_snapshot": json.loads(row["system_json"]),
                "system_snapshot_hash": _hash(row["system_json"]), "generation_model": row["generation_model"],
                "runtime_config": json.loads(row["runtime_json"]), "benchmark_id": row["benchmark_id"],
                "question_id": row["question_id"], "protocol_id": row["protocol_id"], "answer_hash": row["answer_hash"],
                "comparison_parent_run_id": request.get("comparison_parent_run_id"),
                "context_snapshot": context, "context_hash": _hash(_json(context)),
                "diagnostics": json.loads(row["diagnostics_json"]), "metrics": json.loads(row["metrics_json"]),
                "timeline": json.loads(row["timeline_json"]), "evaluations": records}

    def started(self, run_id):
        self.on_event(run_id, "started", {})

    def on_event(self, run_id, event, payload):
        kick = False
        with self._lock, self.bridge._run_db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM run_experiments WHERE run_id=?", (run_id,)).fetchone()
            if row is None:
                return
            metrics, timeline = json.loads(row["metrics_json"]), json.loads(row["timeline_json"])
            clock = self._clocks.get(run_id)
            # Never derive durations from adjustable wall time. After restart,
            # retain recorded durations and leave unknown intervals unknown.
            elapsed = round(max(0.0, (time.monotonic() - clock) * 1000), 3) if clock is not None else None
            if elapsed is not None and timeline:
                elapsed = max(elapsed, timeline[-1]["at_ms"])
            values = {}
            public_event = event
            if event in ('runtime', 'latency'):
                for key in ('initialization_ms','client_prepare_ms','engine_first_token_ms','model_first_token_ms'):
                    value=payload.get(key)
                    if isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and value>=0:
                        metrics[key]=round(value,3)
            if event == "context":
                messages = payload.get("messages")
                if isinstance(messages, list) and not json.loads(row["context_json"]):
                    values["context_json"] = _json(self._clean(messages))
                public_event = None
            elif event == "runtime":
                # Modern Flash uses an explicit transport/config, not the
                # legacy global provider. Record the route actually executed.
                values['generation_model'] = self._clean(payload['generation_model'])
                values['runtime_json'] = _json(self._clean(payload['runtime_config']))
                public_event = None
            elif event == "diagnostics":
                diagnostics = self._clean(payload)
                values["diagnostics_json"] = _json(diagnostics)
                count = diagnostics.get("call_count")
                if isinstance(count, int) and not isinstance(count, bool) and count >= 0:
                    metrics["call_count"] = count
                public_event = None
            elif event == 'latency':
                public_event = None
            elif row["terminal"]:
                return
            elif event == "started":
                if metrics["queue_ms"] is not None:
                    return
                metrics["queue_ms"] = elapsed
                system=json.loads(row['system_json'])
                settings=system.get('config',{})
                modern=settings.get('adapter')=='modern_flash'
                values["generation_model"] = settings['parameters']['model'] if modern else self._generation_model()
                values["runtime_json"] = _json(settings['parameters'] if modern else self._runtime_config())
            elif event in ("token", "draft_token"):
                key = "ttft_ms" if event == "token" else "draft_ttft_ms"
                if not payload.get("text") or metrics[key] is not None:
                    return
                metrics[key] = elapsed
                public_event = "first_token" if event == "token" else "first_draft_token"
                if event == "token":
                    metrics["delivery_mode"] = "streaming"
            elif event == "final":
                if payload.get("text") and not payload.get("use_streamed_answer"):
                    if metrics["ttft_ms"] is None:
                        metrics["ttft_ms"] = elapsed
                    metrics["delivery_mode"] = "buffered"
            elif event in ("sources", "retrieval_end"):
                retrieval = payload.get("retrieval_ms")
                if isinstance(retrieval, (int, float)) and not isinstance(retrieval, bool) and math.isfinite(retrieval) and retrieval >= 0:
                    metrics["retrieval_ms"] = retrieval
            elif event in ("done", "error", "cancelled", "interrupted"):
                values["terminal"] = 1
                metrics["e2e_ms"] = elapsed
                if elapsed is not None and metrics["queue_ms"] is not None:
                    metrics["execution_ms"] = max(0.0, round(elapsed - metrics["queue_ms"], 3))
                run = db.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
                if event == "done" and run and run["status"] == "done":
                    answer = run["answer"] or ""
                    values["answer_hash"] = _hash(answer)
                    frozen = {"answer": answer, "answer_hash": _hash(answer), "question": json.loads(row["request_json"])["message"],
                              "sources": json.loads(run["sources_json"] or "[]"), "scoring": json.loads(row["scoring_json"]),
                              "benchmark_id": row["benchmark_id"]}
                    frozen["scorer"] = frozen["scoring"].get("_scorer")
                    db.execute("UPDATE experiment_evaluations SET status='queued',input_json=? "
                               "WHERE run_id=? AND status='pending_generation'", (_json(frozen), run_id))
                    kick = True
                else:
                    db.execute("UPDATE experiment_evaluations SET status='blocked',error=?,finished_at=? "
                               "WHERE run_id=? AND status='pending_generation'", ("generation did not complete", time.time(), run_id))
            if public_event in {"queued", "started", "stage", "first_token", "first_draft_token", "sources", "final", "done",
                                "error", "cancelled", "interrupted", "retrieval_start", "retrieval_end", "draft_reset"} and elapsed is not None:
                item = {"event": public_event, "at_ms": elapsed}
                if event == "stage":
                    item["stage"] = self._clean(str(payload.get("stage", ""))[:240])
                if len(timeline) < 400 and (not timeline or (timeline[-1]["event"], timeline[-1].get("stage")) != (item["event"], item.get("stage"))):
                    timeline.append(item)
            values.update(metrics_json=_json(metrics), timeline_json=_json(timeline))
            db.execute("UPDATE run_experiments SET " + ",".join(k + "=?" for k in values) + " WHERE run_id=?", [*values.values(), run_id])
        if kick and not self._closed:
            self._executor.submit(self._drain)

    def evaluate(self, run_id, owner_id, token, key=None):
        self.require_admin_owner(token, owner_id)
        run = self.bridge._get_owned_run(run_id, owner_id)
        if run is None:
            raise HTTPException(404, "任务不存在")
        if run["status"] != "done" or not (run["answer"] or "").strip():
            raise HTTPException(409, "只能评判已完成且有答案的任务")
        if key is not None and (not isinstance(key, str) or not key or len(key) > 128):
            raise HTTPException(422, "无效的评判幂等标识")
        with self.bridge._run_db() as db:
            db.execute("BEGIN IMMEDIATE")
            meta = db.execute("SELECT * FROM run_experiments WHERE run_id=?", (run_id,)).fetchone()
            if meta is None:
                raise HTTPException(409, "历史任务缺少可复现的实验元数据")
            previous = db.execute("SELECT id FROM experiment_evaluations WHERE run_id=? AND " +
                                  ("idempotency_key=?" if key else "status IN ('queued','judging')") + " LIMIT 1",
                                  (run_id, "manual:" + key) if key else (run_id,)).fetchone()
            if previous:
                eid = previous["id"]
            else:
                frozen = {"answer": run["answer"], "answer_hash": _hash(run["answer"]),
                          "question": json.loads(meta["request_json"])["message"], "sources": json.loads(run["sources_json"] or "[]"),
                          "scoring": json.loads(meta["scoring_json"]), "benchmark_id": meta["benchmark_id"]}
                try:
                    frozen["scorer"] = self._freeze_scorer(meta["benchmark_id"], frozen["scoring"])
                except (OSError, ValueError, KeyError, Unavailable) as exc:
                    raise HTTPException(422, "冻结评分器不可用，未发起评分调用") from exc
                eid = self._insert_evaluation(db, run_id, "queued", PROTOCOLS[meta["benchmark_id"]][1], meta["protocol_id"],
                                              "manual:" + (key or uuid.uuid4().hex), frozen)
        self._executor.submit(self._drain)
        return {"evaluation_id": eid, "experiment": self.get_experiment(run_id)}

    def _make_client(self):
        key = getattr(self.config, "QWEN_API_KEY", "")
        base = getattr(self.config, "QWEN_BASE_URL", "")
        if not key or str(key).startswith("your-") or not base:
            raise Unavailable("QWEN server configuration unavailable")
        from openai import OpenAI
        return OpenAI(api_key=key, base_url=base, timeout=60.0, max_retries=0)

    def _drain(self):
        while not self._closed:
            with self.bridge._run_db() as db:
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT * FROM experiment_evaluations WHERE status='queued' ORDER BY created_at,id LIMIT 1").fetchone()
                if row is None:
                    return
                db.execute("UPDATE experiment_evaluations SET status='judging' WHERE id=? AND status='queued'", (row["id"],))
            self._judge(dict(row))

    def _judge(self, row):
        usage = {"calls": row["calls"], "prompt_tokens": 0, "completion_tokens": 0,
                 "total_tokens": 0, "reported_calls": 0}
        retry_left = [1]
        client = None
        identity = None

        def call(prompt, *, max_tokens=2400, array=False, legacy=False):
            nonlocal client
            self._verify_scorer(identity, row["protocol_id"], row["judge_model"])
            if client is None:
                client = self._make_client()
            while True:
                self._verify_scorer(identity, row["protocol_id"], row["judge_model"])
                self._save_judge_request(row["id"], prompt, row["judge_model"], max_tokens, legacy)
                usage["calls"] += 1
                self._save_usage(row["id"], usage)
                try:
                    response = client.chat.completions.create(
                        model=row["judge_model"], messages=[{"role": "user", "content": prompt}],
                        temperature=0.0, max_tokens=max_tokens,
                        extra_body={"thinking": {"type": "disabled"}} if legacy else {"reasoning_effort": "medium"})
                except Exception as exc:
                    transient = isinstance(exc, (TimeoutError, ConnectionError)) or type(exc).__name__ in {
                        "APITimeoutError", "APIConnectionError", "RateLimitError", "InternalServerError"} or getattr(exc, "status_code", 0) in {408, 409, 429, 500, 502, 503, 504}
                    if transient and retry_left[0]:
                        retry_left[0] -= 1
                        time.sleep(0.1)
                        continue
                    raise
                reported = getattr(response, "usage", None)
                if reported is not None:
                    usage["reported_calls"] += 1
                    for name in ("prompt_tokens", "completion_tokens", "total_tokens"):
                        value = getattr(reported, name, None)
                        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                            usage[name] += value
                self._save_usage(row["id"], usage)
                if not getattr(response, "choices", None):
                    raise Malformed("judge response has no choices")
                obj = _parse(response.choices[0].message.content)
                if not isinstance(obj, list if array else dict):
                    raise Malformed("judge JSON has the wrong shape")
                return obj

        try:
            data = json.loads(row["input_json"])
            identity = data.get("scorer")
            self._verify_scorer(identity, row["protocol_id"], row["judge_model"])
            # Public bridge sources use snippet/chapter/title. The pinned
            # scorers consume text_full/chapter_title/file_name instead.
            # Preserve the actual source content and identity in both shapes.
            sources = []
            for source in data.get("sources") or []:
                if not isinstance(source, dict):
                    raise Malformed("invalid stored source")
                source = dict(source)
                source.setdefault("text_full", source.get("text_preview") or source.get("text") or source.get("snippet") or "")
                source.setdefault("chapter_title", source.get("chapter") or source.get("title") or "")
                source.setdefault("file_name", source.get("title") or "")
                sources.append(source)
            data["sources"] = sources
            bank = data["benchmark_id"]
            if not data.get("answer", "").strip():
                raise Unavailable("completed answer unavailable")
            if bank == "new49":
                scorer = self._seven(identity)
                question = data["scoring"]
                rubric = question["_rubric"]
                obj = call(scorer["prompt_for"](question, rubric, data["answer"], data["sources"]))
                if not scorer["valid_judgement_schema"](obj, len(rubric["atoms"])):
                    raise Malformed("invalid atom coverage or premise handling")
                _dimensions(obj.get("dimensions"), ("rel", "fact", "reas", "lang", "tone", "cite"))
                if obj.get("critical_error_type") not in {"none", "major", "fatal"}:
                    raise Malformed("invalid critical error severity")
                for name in ("unsupported_claims", "conflicting_claims", "fabricated_citations"):
                    if not isinstance(obj.get(name), list):
                        raise Malformed("invalid claim diagnostics")
                obj["_has_sources"] = bool(data["sources"])
                calculated = scorer["score"](obj, rubric)
                result = {"score": calculated["final_score"], "score_scale": 100, "dimensions": calculated["dimensions"],
                          "weights": scorer["TYPE_WEIGHTS"][rubric["profile"]], "reasons": obj.get("short_reason", ""),
                          "raw": obj, "calculation": calculated, "comp_mode": "gold_atoms"}
            elif bank == "legacy50":
                result = self._judge_legacy(data, call, identity)
            elif bank == "free":
                weights = self._weights(identity)
                prompt = identity["prompt_template"]
                for key, value in {"TYPES": "、".join(weights["TYPE_WEIGHTS"]), "QUESTION": data["question"],
                                   "ANSWER": data["answer"], "SOURCES": _json(data["sources"])[:20000]}.items():
                    prompt = prompt.replace("<<" + key + ">>", value)
                obj = call(prompt)
                qtype = obj.get("type")
                if qtype not in weights["TYPE_WEIGHTS"]:
                    raise Malformed("judge classification outside frozen enum")
                dims = _dimensions(obj.get("dimensions"))
                if not isinstance(obj.get("reasons"), (dict, str)):
                    raise Malformed("missing diagnostic reasons")
                result = {"score": weights["weighted_score"](dims, qtype), "score_scale": 10, "dimensions": dims,
                          "weights": weights["TYPE_WEIGHTS"][qtype], "type": qtype, "raw": obj,
                          "reasons": obj["reasons"], "comp_mode": "estimated", "coverage_rate": None,
                          "diagnostic_note": "在线诊断；完整度为 estimated_comp，不具备正式 gold 覆盖率"}
            else:
                raise Unavailable("FlashBench unverified gold/session protocol blocked")
            status, error = "done", None
        except Exception as exc:
            status = "unavailable" if isinstance(exc, Unavailable) or getattr(exc, "status_code", 0) in {401, 403, 404} else "error"
            error = str(exc) if isinstance(exc, (Unavailable, Malformed)) else "judge transport/protocol failed; " + type(exc).__name__
            result = {}
        finally:
            if client is not None:
                close = getattr(client, "close", None)
                if close:
                    close()
        with self.bridge._run_db() as db:
            db.execute("UPDATE experiment_evaluations SET status=?,result_json=?,error=?,finished_at=? WHERE id=? AND status='judging'",
                       (status, _json(self._clean(result)), self._clean(error), time.time(), row["id"]))

    def _save_usage(self, eid, usage):
        with self.bridge._run_db() as db:
            db.execute("UPDATE experiment_evaluations SET calls=?,usage_json=? WHERE id=? AND status='judging'",
                       (usage["calls"], _json(usage), eid))

    def _save_judge_request(self, eid, prompt, model, max_tokens, legacy):
        with self.bridge._run_db() as db:
            row = db.execute("SELECT input_json FROM experiment_evaluations WHERE id=? AND status='judging'", (eid,)).fetchone()
            if row is None:
                raise Unavailable("evaluation no longer active")
            frozen = json.loads(row["input_json"])
            frozen.setdefault("judge_requests", []).append({"prompt": prompt, "prompt_sha256": _hash(prompt),
                "model": model, "max_tokens": max_tokens, "temperature": 0.0,
                "extra_body": {"thinking": {"type": "disabled"}} if legacy else {"reasoning_effort": "medium"}})
            db.execute("UPDATE experiment_evaluations SET input_json=? WHERE id=? AND status='judging'", (_json(frozen), eid))

    def _judge_legacy(self, data, call, identity):
        path = self.root / "src/evaluate_50q.py"
        names = ("JUDGE_PROMPT", "TYPE_SPECIFIC_RULES", "_build_citation_report", "_verify_answer_facts",
                 "_format_verify_report", "_count_sub_questions", "score_completeness")
        source = identity["sources"]["src/evaluate_50q.py"]["text"]
        scope = _definitions(path, names, source=source)

        class Transport:
            def create(inner, **kwargs):
                obj = call(kwargs["messages"][0]["content"], max_tokens=kwargs["max_tokens"], array=True, legacy=True)
                # The old helper swallowed malformed/transport failures. Reject
                # incomplete verdicts before they can become a silent neutral score.
                claims = re.findall(r"^\[(\d+)\] ", kwargs["messages"][0]["content"], flags=re.M)
                if len(obj) != len(claims) or sorted(x.get("i", -1) for x in obj if isinstance(x, dict)) != list(range(len(claims))):
                    raise Malformed("incomplete legacy assertion verification")
                if any(x.get("verdict") not in {"supported", "uncovered", "conflict"} for x in obj):
                    raise Malformed("invalid legacy assertion verdict")
                return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=_json(obj)))])

        transport = SimpleNamespace(chat=SimpleNamespace(completions=Transport()))
        scope.update(_judge_client=lambda: transport, _judge_model=lambda: "qwen3.7-plus")
        tree = ast.parse(source)
        verifier = next(x for x in tree.body if isinstance(x, ast.FunctionDef) and x.name == "_verify_answer_facts")
        for node in ast.walk(verifier):
            if isinstance(node, ast.ExceptHandler):
                node.body = [ast.Raise()]
        builder = next(x for x in tree.body if isinstance(x, ast.FunctionDef) and x.name == "judge_answer")
        body = []
        for statement in builder.body:
            body.append(statement)
            if isinstance(statement, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "prompt" for t in statement.targets):
                body.append(ast.Return(value=ast.Name(id="prompt", ctx=ast.Load())))
                break
        else:
            raise Unavailable("legacy pinned prompt builder unavailable")
        builder.body, builder.name = body, "build_prompt"
        module = ast.fix_missing_locations(ast.Module(body=[verifier, builder], type_ignores=[]))
        exec(compile(module, str(path), "exec"), scope)
        qtype = data["scoring"]["type"]
        prompt = scope["build_prompt"](data["question"], data["answer"], data["sources"], qtype)
        obj = call(prompt, max_tokens=200, legacy=True)
        required = tuple(DIM_NAMES[k] for k in DIMS if k != "cite")
        judged = _dimensions(obj, required)
        dims = {key: judged[DIM_NAMES[key]] for key in DIMS if key != "cite"}
        _, dims["cite"] = scope["score_completeness"](data["question"], data["answer"], qtype)
        if len(data["answer"].strip()) < 120 and qtype != "事实查询":
            dims["comp"] = min(dims["comp"], 3.0)
        weights = self._weights(identity)
        return {"score": weights["weighted_score"](dims, qtype), "score_scale": 10, "dimensions": dims,
                "weights": weights["TYPE_WEIGHTS"][qtype], "type": qtype, "raw": obj,
                "reasons": "冻结题型；机械引用分；非事实查询短答案完整度按8.86规则封顶", "comp_mode": "legacy_judge"}


def initialize(bridge):
    global _service, _bridge
    if _service is not None and not _service._closed:
        if _service.bridge is bridge:
            return _service
        _service.close()
    _bridge = bridge
    _service = ExperimentService(bridge)
    return _service


def _current():
    if _service is None or _service._closed:
        raise HTTPException(503, "实验服务尚未初始化")
    return _service


def create_metadata(run_id, owner_id, req: dict, system: dict, admin_token: str | None):
    return _current().create_metadata(run_id, owner_id, req, system, admin_token)


def authorize_admin(token):
    return bool(_service and not _service._closed and _service.authorize_admin(token))


def require_admin_owner(token, owner_id):
    if not _service or _service._closed:
        raise HTTPException(403, "管理员令牌无效或服务尚未初始化")
    return _service.require_admin_owner(token, owner_id)


def get_experiment(run_id):
    return _service.get_experiment(run_id) if _service and not _service._closed else None


def decorate_snapshot(snapshot: dict):
    run_id = snapshot.get("run_id")
    experiment = get_experiment(run_id)
    # The bridge commits its event before invoking this sidecar. A concurrent
    # GET can observe that commit first; reconcile through the same idempotent
    # hook so a terminal snapshot includes its final metrics and queue state.
    status = snapshot.get("status")
    terminal_event = {"done": "done", "error": "error", "stopped": "cancelled", "interrupted": "interrupted"}.get(status)
    if experiment and terminal_event and experiment["metrics"]["e2e_ms"] is None:
        _service.on_event(run_id, terminal_event, {})
        experiment = get_experiment(run_id)
    return {**snapshot, "experiment": experiment}


def on_event(run_id, event, payload):
    if _service and not _service._closed:
        _service.on_event(run_id, event, payload)


def started(run_id):
    if _service and not _service._closed:
        _service.started(run_id)


def install(app, bridge):
    """Register once; initialize is explicitly called by bridge startup."""
    if getattr(app.state, "experiment_service_installed", False):
        return
    app.state.experiment_service_installed = True

    def owner(request, access_key):
        bridge._authorize(request, access_key)
        return bridge._owner_id(access_key or "")

    @app.get("/api/admin/status")
    def admin_status(request: Request, access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
                     admin_token: str | None = Header(None, alias="X-Experiment-Admin")):
        owner_id = owner(request, access_key)
        service = _current()
        try:
            service.require_admin_owner(admin_token, owner_id)
            authorized = True
        except HTTPException:
            authorized = False
        configured = bool(service._admin_password)
        return {"enabled": configured, "authorized": authorized,
                "configured": configured, "authenticated": authorized}

    @app.post("/api/admin/login")
    async def admin_login(request: Request, access_key: str | None = Header(None, alias="X-RAG-Access-Key")):
        owner_id = owner(request, access_key)
        try:
            body = await request.json()
        except Exception as exc:
            raise HTTPException(422, "需要 JSON 登录请求") from exc
        if not isinstance(body, dict):
            raise HTTPException(422, "需要 JSON 对象")
        return _current().login(request, owner_id, body.get("password"))

    @app.post("/api/admin/logout")
    def admin_logout(request: Request, access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
                     admin_token: str | None = Header(None, alias="X-Experiment-Admin")):
        owner_id = owner(request, access_key)
        return _current().logout(admin_token, owner_id)

    @app.get("/api/benchmarks")
    def benchmarks():
        return _current().benchmarks()

    @app.get("/api/runs/{run_id}/experiment")
    def experiment(run_id: str, request: Request,
                   access_key: str | None = Header(None, alias="X-RAG-Access-Key")):
        owner_id = owner(request, access_key)
        if bridge._get_owned_run(run_id, owner_id) is None:
            raise HTTPException(404, "任务不存在")
        return _current().get_experiment(run_id)

    @app.post("/api/runs/{run_id}/evaluate")
    async def evaluate(run_id: str, request: Request,
                       access_key: str | None = Header(None, alias="X-RAG-Access-Key"),
                       admin_token: str | None = Header(None, alias="X-Experiment-Admin"),
                       idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
        owner_id = owner(request, access_key)
        if bridge._get_owned_run(run_id, owner_id) is None:
            raise HTTPException(404, "任务不存在")
        key = idempotency_key
        if await request.body():
            try:
                body = await request.json()
            except Exception as exc:
                raise HTTPException(422, "需要 JSON 评判请求") from exc
            if not isinstance(body, dict):
                raise HTTPException(422, "需要 JSON 对象")
            key = key or body.get("client_request_id")
        return _current().evaluate(run_id, owner_id, admin_token, key)
