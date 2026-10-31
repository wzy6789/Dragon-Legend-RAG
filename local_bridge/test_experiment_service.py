"""Offline contract tests: real SQLite/routes/scorers, fake paid transport only."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

HERE = Path(__file__).resolve().parent
SOURCE_ROOT = Path(os.environ.get("RAG_PROJECT_ROOT", "F:/龙王传说智能体"))
sys.path.insert(0, str(HERE))
try:
    import experiment_service as E
except ModuleNotFoundError:
    E = None


class FakeBridge:
    def __init__(self, path):
        self.path = path
        self.config = SimpleNamespace(
            GENERATION_PROVIDER="deepseek", LLM_MODEL="actual-generator",
            QWEN_API_KEY="sk-server-only-secret", QWEN_BASE_URL="https://private.invalid/v1",
            DEEPSEEK_API_KEY="sk-byok-secret", FLASH_V19_ENABLED=True,
        )
        with self._run_db() as db:
            db.execute("CREATE TABLE runs(run_id TEXT PRIMARY KEY, owner_id TEXT, "
                       "message TEXT, answer TEXT DEFAULT '', sources_json TEXT DEFAULT '[]', "
                       "status TEXT DEFAULT 'queued', created_at REAL)")

    @contextmanager
    def _run_db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _owner_id(key):
        return hashlib.sha256(key.encode()).hexdigest()

    @staticmethod
    def _authorize(request, access_key):
        if not access_key:
            raise HTTPException(401, "access key required")

    def _get_owned_run(self, run_id, owner_id):
        with self._run_db() as db:
            return db.execute("SELECT * FROM runs WHERE run_id=? AND owner_id=?",
                              (run_id, owner_id)).fetchone()


class FakeClient:
    def __init__(self, responses, gate=None):
        self.responses = iter(responses)
        self.calls = []
        self.gate = gate
        self.entered = threading.Event()
        self.chat = SimpleNamespace(completions=self)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        self.entered.set()
        if self.gate:
            if not self.gate.wait(5):
                raise TimeoutError("test gate timed out")
        item = next(self.responses)
        if isinstance(item, Exception):
            raise item
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(item)))],
            usage=SimpleNamespace(prompt_tokens=11, completion_tokens=7, total_tokens=18),
        )


def free_result(**changes):
    value = dict(type="事实查询", dimensions={k: 8 for k in
                 ("rel", "fact", "reas", "comp", "lang", "tone", "cite")},
                 reasons={"fact": "Supported by the supplied passage."})
    value.update(changes)
    return value


class ExperimentServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if E is None:
            raise AssertionError("experiment_service implementation is missing")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "src").mkdir()
        (self.root / "data").mkdir()
        (self.root / "results/legacy50").mkdir(parents=True)
        for name in ("evaluate_7d49.py", "evaluate_50q.py", "scoring_weights.py", "agents.py"):
            shutil.copyfile(SOURCE_ROOT / "src" / name, self.root / "src" / name)
        questions = [{"id": n, "question": f"Frozen question {n}?", "type": "事实查询"}
                     for n in range(1, 51)]
        rubric = [{"id": n, "profile": "L1", "atoms": [
            {"text": "The one required fact.", "critical": True}]} for n in range(1, 51) if n != 20]
        self.write("data/dragon_king_rag_benchmark_v4.json", {"questions": questions})
        self.write("data/phase2_gold_rubric_v8.json", {"items": rubric})
        (self.root / "data/questions_50.txt").write_text(
            "\n".join(f"{q['id']} {q['question']}" for q in questions), encoding="utf-8")
        self.write("results/legacy50/v19_sem_select_50q.json", {
            "benchmark": "legacy50 / questions_50.txt", "standard": "SCORING_STANDARD_8.86_老50题",
            "results": [{**q, "type": "原因分析"} for q in questions]})
        self.write("benchmarks/flashbench_v1/questions.json", {
            "status": "candidate_draft", "cases": [
                {"id": "F1-001", "question": "Draft flash question?"},
                {"id": "F5-001", "turns": [{"question": "Follow-up?"}]}]})
        self.write("benchmarks/flashbench_v1/rubrics.json", {
            "status": "phase2_stage1_draft", "rubrics": {"F1-001": {
                "gold_points": [{"id": "g1", "proposition": "Unverified!"}],
                "draft": {"verified_against_novel": False}}}})
        self.env = patch.dict(os.environ, {"RAG_PROJECT_ROOT": str(self.root),
                                          "RAG_EXPERIMENT_ADMIN_PASSWORD": "test-admin-password"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.bridge = FakeBridge(str(self.root / "runs.sqlite"))
        self.app = FastAPI()
        E.install(self.app, self.bridge)
        self.service = E.initialize(self.bridge)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.addCleanup(lambda: self.service.close())
        self.key = "owner-access-key"
        self.owner = self.bridge._owner_id(self.key)
        self.headers = {"X-RAG-Access-Key": self.key}
        self.system = {"id": "flash-v19-sem_select", "label": "Flash", "config": {
            "profile": "RAG1", "kg": True, "api_key": "never-public"}}

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def login(self, key=None):
        response = self.client.post("/api/admin/login", headers={
            "X-RAG-Access-Key": key or self.key}, json={"password": "test-admin-password"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["token"]

    def make_run(self, run_id="r1", token=None, benchmark="free", question_id=None, message=None):
        message = message or ("Frozen question 1?" if benchmark != "free" else "A visitor question?")
        with self.bridge._run_db() as db:
            db.execute("INSERT INTO runs(run_id,owner_id,message,created_at) VALUES(?,?,?,?)",
                       (run_id, self.owner, message, time.time()))
        req = {"message": message, "benchmark_id": benchmark, "question_id": question_id,
               "system_id": self.system["id"]}
        E.create_metadata(run_id, self.owner, req, self.system, token)
        return E.get_experiment(run_id)

    def finish(self, run_id="r1", answer="A supported answer."):
        with self.bridge._run_db() as db:
            db.execute("UPDATE runs SET status='done',answer=?,sources_json=? WHERE run_id=?",
                       (answer, json.dumps([{"source_type": "novel", "chapter_index": 1,
                                            "snippet": "Actual supporting passage."}]), run_id))
        E.on_event(run_id, "done", {})

    def idle(self):
        self.service._executor.submit(lambda: None).result(8)

    def latest(self, run_id="r1"):
        return E.get_experiment(run_id)["evaluations"][-1]

    def test_login_is_owner_bound_persistent_and_rate_limits(self):
        token = self.login()
        self.assertTrue(E.authorize_admin(token))
        other = {"X-RAG-Access-Key": "other-owner", "X-Experiment-Admin": token}
        response = self.client.get("/api/admin/status", headers=other)
        self.assertFalse(response.json()["authorized"])
        self.assertFalse(response.json()["authenticated"])
        self.assertTrue(response.json()["configured"])
        with self.assertRaises(HTTPException) as caught:
            self.make_run(token="invalid-token")
        self.assertEqual(caught.exception.status_code, 403)
        with patch.object(E.time, "monotonic", return_value=time.monotonic() + 43201):
            self.assertTrue(E.authorize_admin(token))
        codes = [self.client.post("/api/admin/login", headers=self.headers,
                                 json={"password": "wrong"}).status_code for _ in range(8)]
        self.assertIn(429, codes)

    def test_admin_session_survives_service_and_browser_restart_without_paid_calls(self):
        token = self.login()
        self.make_run()
        before = E.get_experiment("r1")
        self.client.close()
        self.service.close()
        with patch.object(E.ExperimentService, "_make_client") as paid_client:
            self.service = E.initialize(self.bridge)
            with TestClient(self.app) as restored_client:
                response = restored_client.get("/api/admin/status", headers={
                    **self.headers, "X-Experiment-Admin": token})
                self.assertTrue(response.json()["authenticated"])
                response = restored_client.get("/api/admin/status", headers={
                    "X-RAG-Access-Key": "other-owner", "X-Experiment-Admin": token})
                self.assertFalse(response.json()["authenticated"])
                with self.assertRaises(HTTPException) as caught:
                    self.service.require_admin_owner(token, self.bridge._owner_id("other-owner"))
                self.assertEqual(caught.exception.status_code, 403)
                self.idle()
            paid_client.assert_not_called()
        self.assertEqual(E.get_experiment("r1"), before)

    def test_admin_session_storage_contains_no_raw_credentials(self):
        response = self.client.post("/api/admin/login", headers=self.headers,
                                    json={"password": "test-admin-password"})
        self.assertEqual(response.status_code, 200)
        login = response.json()
        self.assertIsNone(login["expires_at"])
        self.assertIsNone(login["expires_in"])
        with self.bridge._run_db() as db:
            row = db.execute("SELECT * FROM experiment_admin_sessions").fetchone()
            dump = "\n".join(db.iterdump())
        self.assertEqual(row["token_hash"], hashlib.sha256(login["token"].encode()).hexdigest())
        self.assertEqual(row["owner_id"], self.owner)
        self.assertIsNone(row["expires_at"])
        for raw in (login["token"], "test-admin-password", self.key):
            self.assertNotIn(raw, dump)

    def test_admin_validation_uses_database_instead_of_memory_cache(self):
        token = self.login()
        self.service._tokens.clear()
        self.assertTrue(E.authorize_admin(token))
        forged = "cache-only-token"
        self.service._tokens[E._hash(forged)] = (self.owner, time.monotonic() + 43200, time.time() + 43200)
        self.assertFalse(E.authorize_admin(forged))
        with self.bridge._run_db() as db:
            db.execute("DELETE FROM experiment_admin_sessions WHERE token_hash=?", (E._hash(token),))
        self.assertFalse(E.authorize_admin(token))

    def test_admin_password_change_on_restart_invalidates_previous_sessions(self):
        token = self.login()
        with patch.dict(os.environ, {"RAG_EXPERIMENT_ADMIN_PASSWORD": "rotated-test-password"}):
            # Environment changes are applied when a fresh service is initialized.
            self.assertTrue(E.authorize_admin(token))
            self.service.close()
            self.service = E.initialize(self.bridge)
            self.assertFalse(E.authorize_admin(token))
            self.assertEqual(self.client.post("/api/admin/login", headers=self.headers,
                json={"password": "test-admin-password"}).status_code, 403)
            response = self.client.post("/api/admin/login", headers=self.headers,
                                       json={"password": "rotated-test-password"})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(E.authorize_admin(response.json()["token"]))
        self.service.close()
        self.service = E.initialize(self.bridge)
        self.assertFalse(E.authorize_admin(token), "changing a password back must not revive old sessions")
        self.assertFalse(E.authorize_admin(response.json()["token"]))

    def test_admin_password_removal_disables_persisted_sessions(self):
        token = self.login()
        with patch.dict(os.environ, {"RAG_EXPERIMENT_ADMIN_PASSWORD": ""}):
            self.service.close()
            self.service = E.initialize(self.bridge)
            self.assertFalse(E.authorize_admin(token))
            status = self.client.get("/api/admin/status", headers={
                **self.headers, "X-Experiment-Admin": token}).json()
            self.assertFalse(status["configured"])
            self.assertFalse(status["authenticated"])
            self.assertEqual(self.client.post("/api/admin/login", headers=self.headers,
                json={"password": "test-admin-password"}).status_code, 503)

    def test_admin_logout_requires_owner_and_revokes_only_its_token_durably(self):
        token, other_token = self.login(), self.login()
        self.assertEqual(self.client.post("/api/admin/logout", headers={
            "X-Experiment-Admin": token}).status_code, 401)
        self.assertEqual(self.client.post("/api/admin/logout", headers=self.headers).status_code, 403)
        self.assertEqual(self.client.post("/api/admin/logout", headers={
            "X-RAG-Access-Key": "other-owner", "X-Experiment-Admin": token}).status_code, 403)
        self.assertTrue(E.authorize_admin(token))
        response = self.client.post("/api/admin/logout", headers={
            **self.headers, "X-Experiment-Admin": token})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["authorized"])
        self.assertFalse(E.authorize_admin(token))
        self.assertTrue(E.authorize_admin(other_token))
        self.service.close()
        self.service = E.initialize(self.bridge)
        self.assertFalse(E.authorize_admin(token))
        self.assertTrue(E.authorize_admin(other_token))

    def test_admin_session_honors_explicit_database_expiry(self):
        token = self.login()
        with self.bridge._run_db() as db:
            db.execute("UPDATE experiment_admin_sessions SET expires_at=?", (time.time() + 3600,))
        self.assertTrue(E.authorize_admin(token))
        with self.bridge._run_db() as db:
            db.execute("UPDATE experiment_admin_sessions SET expires_at=?", (time.time() - 1,))
        self.assertFalse(E.authorize_admin(token))

    def test_routes_enforce_run_owner_and_admin_owner(self):
        token = self.login()
        self.make_run()
        self.finish()
        self.assertEqual(self.client.get("/api/runs/r1/experiment").status_code, 401)
        self.assertEqual(self.client.get("/api/runs/r1/experiment", headers={
            "X-RAG-Access-Key": "stranger"}).status_code, 404)
        self.assertEqual(self.client.post("/api/runs/r1/evaluate", headers=self.headers).status_code, 403)
        stranger_token = self.login("stranger")
        self.assertEqual(self.client.post("/api/runs/r1/evaluate", headers={
            **self.headers, "X-Experiment-Admin": stranger_token}).status_code, 403)
        self.assertEqual(self.latest()["status"], "not_authorized")
        self.assertTrue(E.authorize_admin(token))
        self.assertEqual(self.client.get("/api/runs/r1/experiment", headers=self.headers).json()["system_id"], self.system["id"])

    def test_frozen_question_and_protocol_are_validated_before_work(self):
        token = self.login()
        for bank, qid, message in [("new49", "20", "Frozen question 20?"),
                                  ("new49", "1", "Edited question"),
                                  ("legacy50", "999", "Frozen question 1?"),
                                  ("free", "1", "Arbitrary")]:
            with self.subTest(bank=bank, qid=qid), self.assertRaises(HTTPException):
                self.make_run(f"bad-{bank}-{qid}", token, bank, qid, message)
        with self.assertRaises(HTTPException):
            self.make_run("no-admin", None, "new49", "1")
        self.make_run("valid", token, "new49", "1")
        with self.assertRaises(HTTPException):
            E.create_metadata("valid", self.owner, {"benchmark_id": "new49", "question_id": "1",
                "message": "Frozen question 1?", "protocol_id": "wrong"}, self.system, token)

    def test_benchmarks_exclude_twenty_and_block_draft_flash_gold(self):
        data = self.client.get("/api/benchmarks").json()
        banks = {x["id"]: x for x in data["benchmarks"]}
        self.assertEqual(set(banks), {"free", "new49", "legacy50", "flashbench"})
        self.assertEqual(len(banks["new49"]["questions"]), 49)
        self.assertNotIn("20", {str(x["id"]) for x in banks["new49"]["questions"]})
        self.assertEqual(banks["legacy50"]["questions"][0]["type"], "原因分析")
        self.assertTrue(all(not x["runnable"] and x["reason"] for x in banks["flashbench"]["questions"]))

    def test_immutable_metadata_historical_rows_and_cascade_delete(self):
        initial = self.make_run()
        self.system["label"] = "mutated"
        self.system["config"]["profile"] = "mutated"
        E.create_metadata("r1", self.owner, {"message": "A visitor question?"}, {
            "id": "flash-v19-sem_select", "label": "different"}, None)
        result = E.get_experiment("r1")
        self.assertEqual(result["system_snapshot"], initial["system_snapshot"])
        context = [{"role": "user", "content": "An earlier owner question."}]
        E.on_event("r1", "context", {"messages": context})
        E.on_event("r1", "diagnostics", {"calls": [{"model": "actual-generator", "prompt_tokens": 0,
                   "requested_max_tokens": 600}], "call_count": 1})
        result = E.get_experiment("r1")
        self.assertEqual(result["context_snapshot"], context)
        self.assertEqual(result["diagnostics"]["calls"][0]["prompt_tokens"], 0)
        self.assertEqual(result["diagnostics"]["calls"][0]["requested_max_tokens"], 600)
        self.assertEqual(result["metrics"]["call_count"], 1)
        encoded = json.dumps(result)
        for secret in ["never-public", "sk-server-only-secret", "sk-byok-secret", "private.invalid"]:
            self.assertNotIn(secret, encoded)
        self.assertIsNone(E.decorate_snapshot({"run_id": "historical"})["experiment"])
        with self.bridge._run_db() as db:
            db.execute("DELETE FROM runs WHERE run_id='r1'")
        self.assertIsNone(E.get_experiment("r1"))

    def test_metrics_use_generation_lock_start_and_keep_first_delivery(self):
        clock = [100.0]
        with patch.object(E.time, "monotonic", side_effect=lambda: clock[0]):
            self.make_run()
            clock[0] = 100.2
            E.on_event("r1", "stage", {"stage": "queued outside lock"})
            clock[0] = 100.5
            E.started("r1")
            clock[0] = 100.7
            E.on_event("r1", "draft_token", {"text": "private draft body"})
            clock[0] = 100.9
            E.on_event("r1", "token", {"text": "final"})
            E.on_event("r1", "sources", {"retrieval_ms": 72.5})
            for invalid in (True, -1, float("inf"), "123"):
                E.on_event("r1", "sources", {"retrieval_ms": invalid})
            E.on_event("r1", "retrieval_start", {})
            E.on_event("r1", "retrieval_end", {})
            clock[0] = 101.0
            self.finish(answer="final")
            clock[0] = 102.0
            E.on_event("r1", "done", {})
        result = E.get_experiment("r1")
        self.assertEqual(result["generation_model"], "actual-generator")
        self.assertEqual(result["metrics"], {"queue_ms": 500.0, "execution_ms": 500.0,
            "ttft_ms": 900.0, "draft_ttft_ms": 700.0, "e2e_ms": 1000.0,
            "delivery_mode": "streaming", "retrieval_ms": 72.5})
        self.assertEqual(result["answer_hash"], hashlib.sha256(b"final").hexdigest())
        times = [x["at_ms"] for x in result["timeline"]]
        self.assertEqual(times, sorted(times))
        self.assertNotIn("private draft body", json.dumps(result["timeline"]))

    def test_done_enqueues_once_and_rejudge_appends_with_idempotency(self):
        token = self.login()
        fake = FakeClient([free_result(), free_result()])
        with patch.object(self.service, "_make_client", return_value=fake):
            self.make_run(token=token)
            E.started("r1")
            self.finish()
            self.finish()
            self.idle()
            first = self.latest()
            self.assertEqual(first["status"], "done")
            self.assertEqual(first["score"], 8.0)
            self.assertEqual(first["usage"]["calls"], 1)
            self.assertEqual(first["usage"]["total_tokens"], 18)
            self.assertEqual(first["comp_mode"], "estimated")
            headers = {**self.headers, "X-Experiment-Admin": token, "Idempotency-Key": "rejudge-1"}
            self.assertEqual(self.client.post("/api/runs/r1/evaluate", headers=headers).status_code, 200)
            self.idle()
            self.client.post("/api/runs/r1/evaluate", headers=headers)
            self.idle()
        records = E.get_experiment("r1")["evaluations"]
        self.assertEqual(len(records), 2)
        self.assertNotEqual(records[0]["id"], records[1]["id"])
        self.assertEqual(len(fake.calls), 2)
        self.assertEqual(fake.calls[0]["model"], "qwen3.8-flash")

    def test_malformed_dimensions_fail_without_retry_or_fake_score(self):
        for value in [float("nan"), float("inf"), -1, 11, "8", True, None]:
            with self.subTest(value=value):
                token = self.login()
                run_id = f"malformed-{value}"
                response = free_result()
                response["dimensions"]["fact"] = value
                fake = FakeClient([response])
                with patch.object(self.service, "_make_client", return_value=fake):
                    self.make_run(run_id, token)
                    self.finish(run_id)
                    self.idle()
                result = self.latest(run_id)
                self.assertEqual(result["status"], "error")
                self.assertIsNone(result["score"])
                self.assertEqual(result["usage"]["calls"], 1)

    def test_only_transient_transport_failures_retry_once(self):
        token = self.login()
        fake = FakeClient([TimeoutError("sk-server-only-secret"), free_result()])
        with patch.object(self.service, "_make_client", return_value=fake):
            self.make_run(token=token)
            self.finish()
            self.idle()
        self.assertEqual(self.latest()["status"], "done")
        self.assertEqual(self.latest()["usage"]["calls"], 2)
        fake = FakeClient([RuntimeError("sk-server-only-secret")])
        with patch.object(self.service, "_make_client", return_value=fake):
            self.make_run("permanent", token)
            self.finish("permanent")
            self.idle()
        self.assertEqual(self.latest("permanent")["status"], "error")
        self.assertEqual(self.latest("permanent")["usage"]["calls"], 1)
        self.assertNotIn("sk-server-only-secret", json.dumps(self.latest("permanent")))

    def test_fixed_new49_sample_matches_existing_score_function(self):
        token = self.login()
        judged = {"dimensions": dict(rel=8, fact=9, reas=7, lang=8, tone=9, cite=9),
            "coverage": [{"atom": 1, "status": "met", "support": "direct"}],
            "premise_handling": "not_applicable", "critical_error_type": "none",
            "unsupported_claims": [], "conflicting_claims": [], "fabricated_citations": [],
            "short_reason": "All required atoms covered."}
        fake = FakeClient([judged])
        with patch.object(self.service, "_make_client", return_value=fake):
            self.make_run(token=token, benchmark="new49", question_id="1")
            self.finish()
            self.idle()
        result = self.latest()
        self.assertEqual(result["score"], 89.2)
        self.assertIn("Actual supporting passage.", fake.calls[0]["messages"][0]["content"])
        self.assertEqual(result["dimensions"]["comp"], 10.0)
        self.assertEqual(result["protocol_id"], "SCORING_STANDARD_7D49_R2")
        spec = importlib.util.spec_from_file_location("reference_7d49", SOURCE_ROOT / "src/evaluate_7d49.py")
        module = importlib.util.module_from_spec(spec)
        # Its config import has no network side effects; avoid executing the CLI.
        with patch.dict(sys.modules, {"config": self.bridge.config}):
            spec.loader.exec_module(module)
        self.assertEqual(result["score"], module.score({**judged, "_has_sources": True}, {
            "profile": "L1", "atoms": [{"critical": True} ]})["final_score"])

    def test_legacy_frozen_type_short_answer_cap_and_mechanical_cite(self):
        token = self.login()
        judged = {name: 8 for name in ("检索相关度", "事实准确", "推理严密", "覆盖完整", "表达自然", "语气适配")}
        fake = FakeClient([judged])
        with patch.object(self.service, "_make_client", return_value=fake):
            self.make_run(token=token, benchmark="legacy50", question_id="1")
            self.finish(answer="This answer is long enough to judge, but under 120 characters.")
            self.idle()
        result = self.latest()
        self.assertEqual(result["status"], "done", result)
        self.assertEqual(result["dimensions"]["comp"], 3.0)
        self.assertEqual(result["dimensions"]["cite"], 5)
        self.assertEqual(result["score"], 7.1)
        self.assertEqual(fake.calls[0]["model"], "qwen3.7-plus")

    def test_reload_marks_judging_error_without_automatic_rebilling(self):
        token = self.login()
        self.make_run(token=token)
        self.service.close()
        with self.bridge._run_db() as db:
            db.execute("UPDATE experiment_evaluations SET status='judging',calls=1 WHERE run_id='r1'")
        fresh = E.initialize(self.bridge)
        self.service = fresh
        self.assertEqual(self.latest()["status"], "error")
        self.assertIsNone(self.latest()["score"])
        self.assertEqual(self.latest()["usage"]["calls"], 1)
        self.assertIn("interrupted", self.latest()["error"])

    def test_judging_queue_has_one_worker_and_does_not_hold_generation_lock(self):
        token = self.login()
        gate = threading.Event()
        fake = FakeClient([free_result(), free_result()], gate)
        self.addCleanup(gate.set)
        with patch.object(self.service, "_make_client", return_value=fake):
            self.make_run("r1", token)
            self.make_run("r2", token)
            self.finish("r1")
            self.assertTrue(fake.entered.wait(3))
            self.finish("r2")
            self.assertEqual(self.latest("r1")["status"], "judging")
            self.assertEqual(self.latest("r2")["status"], "queued")
            E.started("r2")
            gate.set()
            self.idle()
        self.assertEqual(self.latest("r2")["status"], "done")

    def test_missing_qwen_configuration_is_unavailable_with_no_calls(self):
        self.bridge.config.QWEN_API_KEY = ""
        token = self.login()
        self.make_run(token=token)
        self.finish()
        self.idle()
        result = self.latest()
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["score"])
        self.assertEqual(result["usage"]["calls"], 0)

    def test_scorer_source_rubric_or_model_drift_blocks_before_billing(self):
        token = self.login()
        cases = [("free", "src/scoring_weights.py"), ("new49", "src/evaluate_7d49.py"),
                 ("new49", "data/phase2_gold_rubric_v8.json"), ("legacy50", "src/evaluate_50q.py")]
        for index, (bank, name) in enumerate(cases):
            with self.subTest(bank=bank, source=name):
                run_id = f"drift-{index}"
                self.make_run(run_id, token, bank, None if bank == "free" else "1")
                path = self.root / name
                original = path.read_bytes()
                path.write_bytes(original + b"\n ")
                fake = FakeClient([free_result()])
                try:
                    with patch.object(self.service, "_make_client", return_value=fake):
                        self.finish(run_id)
                        self.idle()
                    result = self.latest(run_id)
                    self.assertEqual(result["status"], "unavailable", result)
                    self.assertEqual(result["usage"]["calls"], 0)
                    self.assertIsNone(result["score"])
                    self.assertEqual(len(result["scorer_fingerprint"]), 64)
                finally:
                    path.write_bytes(original)
        self.make_run("model-drift", token)
        with patch.dict(E.PROTOCOLS, {"free": ("ONLINE_DIAGNOSTIC_7D_V1", "unavailable-model", "free")}):
            self.finish("model-drift")
            self.idle()
        self.assertEqual(self.latest("model-drift")["status"], "unavailable")
        self.assertEqual(self.latest("model-drift")["usage"]["calls"], 0)

    def test_legacy_calculation_uses_frozen_weights_after_transport(self):
        token = self.login()
        judged = {name: 8 for name in ("检索相关度", "事实准确", "推理严密", "覆盖完整", "表达自然", "语气适配")}
        fake = FakeClient([judged])
        original_create = fake.create
        def change_after_call(**kwargs):
            response = original_create(**kwargs)
            path = self.root / "src/scoring_weights.py"
            source = path.read_text(encoding="utf-8").replace("return round(total, 1)", "return 0.1")
            path.write_text(source, encoding="utf-8")
            return response
        fake.create = change_after_call
        with patch.object(self.service, "_make_client", return_value=fake):
            self.make_run(token=token, benchmark="legacy50", question_id="1")
            self.finish(answer="This answer is long enough to judge, but under 120 characters.")
            self.idle()
        self.assertEqual(self.latest()["score"], 7.1)

    def test_rejudge_captures_own_fingerprint_and_actual_prompt(self):
        token = self.login()
        fake = FakeClient([free_result(), free_result()])
        with patch.object(self.service, "_make_client", return_value=fake):
            self.make_run(token=token)
            self.finish()
            self.idle()
            first = self.latest()
            path = self.root / "src/scoring_weights.py"
            path.write_text(path.read_text(encoding="utf-8") + "\n# reviewed source revision\n", encoding="utf-8")
            self.service.evaluate("r1", self.owner, token, "new-identity")
            self.idle()
        records = E.get_experiment("r1")["evaluations"]
        self.assertNotEqual(first["scorer_fingerprint"], records[-1]["scorer_fingerprint"])
        self.assertEqual([x["score"] for x in records], [8.0, 8.0])
        with self.bridge._run_db() as db:
            stored = db.execute("SELECT input_json FROM experiment_evaluations WHERE id=?", (records[-1]["id"],)).fetchone()
        frozen = json.loads(stored["input_json"])
        self.assertEqual(frozen["judge_requests"][0]["prompt"], fake.calls[-1]["messages"][0]["content"])
        self.assertEqual(frozen["scorer"]["weights"]["事实查询"]["fact"], 0.4)
        self.assertEqual(frozen["scorer"]["prompt_template"], E.FREE_PROMPT)


if __name__ == "__main__":
    unittest.main()
