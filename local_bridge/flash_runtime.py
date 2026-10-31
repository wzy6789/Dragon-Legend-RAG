"""Private Flash version adapters. No corpus or credentials are shipped to Pages."""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import asdict
import asyncio
import hashlib
import importlib
import json
from pathlib import Path
import sys
import threading
import time
import types

# id, generation, caption, source package, config manifest, rebased
VERSIONS = (
    ('flash-v20-original', '20', 'budget_rag', 'data/flash20/experiments/20261027-evening/source/src/flash20', 'flash-2.0_full_20261027_evening', False),
    ('flash-v20', '20', 'evidence_select', 'data/flash20/experiments/20261027-quality-eval-full/source', 'flash-2.0_quality_full_20261027_r1', False),
    ('flash-v21-r3', '21', 'context_repair', 'data/flash21/backups/20261029-before-field-routing/src/flash21', 'flash-2.1_full_20261028_r3', False),
    ('flash-v21', '21', 'single_view', 'data/flash21/dev/20261029-readiness-cold/code-snapshot', 'flash-2.1_full_20261029_ready_r1', False),
    ('flash-v22-frozen-r1', '22', 'scene_memory', 'data/flash22/releases/flash-2.2_20261030_candidate_r1/code/flash22', 'flash-2.2_full_20261030_frozen_r1', True),
    ('flash-v22-frozen-r2', '22', 'facet_binding', 'data/flash22/releases/flash-2.2_20261031_candidate_r2/code/flash22', 'flash-2.2_full_20261031_frozen_r2', True),
)

FEATURE_DESCRIPTIONS = {
    'budget_rag': '预算约束的批次检索与单次生成。',
    'evidence_select': '题意和多轮对象恢复，按相关性改进证据选择。',
    'context_repair': '恢复回答所需的原文语境。',
    'single_view': '单次证据视图，减少重复输入。',
    'scene_memory': '继承多轮场景、实体与约束。',
    'facet_binding': '按问题分句分配证据并绑定主体。',
}


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def entries(root):
    for sid, number, caption, source, run, rebased in VERSIONS:
        manifest = f'results/flashbench/{run}/run_manifest.json'
        available = (root / source / 'runtime.py').is_file() and (root / manifest).is_file()
        config = read(root / manifest) if available else {}
        config = config.get('config', config)
        files = sorted((root / source).rglob('*.py'))
        fingerprint = hashlib.sha256(''.join(str(p.relative_to(root / source)) + ':' + hashlib.sha256(p.read_bytes()).hexdigest() for p in files).encode()).hexdigest()
        yield dict(id=sid, family='Flash', version='flash-2.' + number[-1], variant=caption,
                   label='flash-2.' + number[-1] + ' · ' + caption, tiers=['flash'],
                   source=source, status='runnable' if available else 'archive',
                   config={'adapter': 'modern_flash', 'number': number, 'rebased': rebased,
                           'parameters': config, 'source': source},
                   notes=FEATURE_DESCRIPTIONS[caption]+'按该版代码与配置运行，使用本机当前资料；运行成绩不等于历史成绩。',
                   results=[f'results/flashbench/{run}'], code_fingerprint=fingerprint)


def modules(root, settings):
    """Isolate each snapshot's relative imports, including its frozen siblings."""
    source = root / settings['source']
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    tag = '_web_flash_' + hashlib.sha256(str(source).encode()).hexdigest()[:12]
    if tag not in sys.modules:
        package = types.ModuleType(tag)
        package.__path__ = [str(source.parent), str(root / 'src')]
        sys.modules[tag] = package
        target = types.ModuleType(tag + '.flash' + settings['number'])
        target.__path__ = [str(source)]
        sys.modules[target.__name__] = target
    # Snapshot __file__ cannot be used to infer the live project's data location.
    for number in ('20', '21'):
        paths = importlib.import_module(tag + '.flash' + number + '.paths')
        paths.ROOT, paths.DATA = root, root / 'data' / ('flash' + number)
    prefix = tag + '.flash' + settings['number']
    implementation = prefix + ('.rebased' if settings['rebased'] else '')
    cfg_module = importlib.import_module(implementation + ('.config' if settings['rebased'] else '.contracts'))
    cfg = cfg_module.FlashConfig(**settings['parameters'])
    return dict(config=cfg,
                task=importlib.import_module(prefix + '.contracts').TaskSpec,
                engine=importlib.import_module(implementation + '.runtime').Engine,
                retriever=importlib.import_module(implementation + '.retrieval').Retriever,
                generation=importlib.import_module(implementation + '.generation'),
                resources=importlib.import_module(tag + ('.flash20' if settings['number'] == '20' else '.flash21') + '.resources'),
                scheduler=importlib.import_module(tag + ('.flash20' if settings['number'] == '20' else '.flash21') + '.scheduling'))


class _RankerView:
    """Limit modern input length per call without mutating legacy model modules."""
    def __init__(self, ranker):
        self.ranker = ranker

    def predict(self, pairs, **kwargs):
        return self.ranker.predict(pairs, processing_kwargs={'text': {'max_length': 512, 'truncation': True}}, **kwargs)


class RequestTransport:
    """Persistent connection pool; request credentials are bound only while in use."""
    def __init__(self, base_url, http_client=None):
        self.base_url = base_url
        self.http_client = http_client
        self.client = None
        self._key = ''
        self._active = set()

    async def prepare(self):
        if self.client is None:
            from openai import AsyncOpenAI
            self.client = AsyncOpenAI(api_key='unbound', base_url=self.base_url, max_retries=0,
                                      **({'http_client': self.http_client} if self.http_client else {}))
            self.client.api_key = ''

    async def bind(self, api_key, base_url):
        if not api_key:
            raise ValueError('A request API key is required')
        if self._key or self._active:
            raise RuntimeError('Previous request has not released its transport')
        if self.base_url != base_url:
            await self.aclose()
            self.base_url = base_url
        await self.prepare()
        self._key = api_key
        self.client.api_key = api_key

    async def stream(self, payload, timeout):
        if not self._key:
            raise RuntimeError('Transport is not bound to a request')
        task = asyncio.current_task()
        self._active.add(task)
        try:
            response = await self.client.chat.completions.create(**payload, timeout=timeout)
            try:
                async for chunk in response:
                    yield chunk.model_dump()
            finally:
                await response.close()
        finally:
            self._active.discard(task)

    async def release(self):
        try:
            pending = list(self._active)
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        finally:
            self._key = ''
            if self.client is not None:
                self.client.api_key = ''

    async def aclose(self):
        await self.release()
        if self.client is not None:
            await self.client.close()
            self.client = None


class FlashRuntime:
    """Six fixed runtimes, shared immutable resources, and request-scoped BYOK."""
    def __init__(self, root):
        self.root = Path(root)
        self._lock = threading.RLock()
        self._runtimes = OrderedDict()
        self._backends = {}
        self._models = None
        self._base_url = 'https://api.deepseek.com'

    def share_models(self, encoder, ranker):
        # The workstation has one GPU: reuse the already warmed legacy weights.
        # Input length is scoped to modern calls; legacy settings stay intact.
        with self._lock:
            self._models = encoder, _RankerView(ranker)

    def _runtime(self, system):
        sid = system['id']
        if sid in self._runtimes:
            self._runtimes.move_to_end(sid)
            return self._runtimes[sid]
        if sid not in {v[0] for v in VERSIONS}:
            raise ValueError('Unregistered Flash runtime')
        settings = system['config']
        m = modules(self.root, settings)
        cfg = m['config']
        # Share only byte-identical resource packages. Different historical
        # evidence/data implementations retain their own backend objects.
        resource_dir = Path(m['resources'].__file__).parent
        resource_key = (settings['number'] == '20', hashlib.sha256(b''.join(
            p.name.encode() + p.read_bytes() for p in sorted(resource_dir.glob('*.py')))).hexdigest())
        backend = self._backends.get(resource_key)
        if backend is None:
            backend = m['resources'].load_backend(self.root)
            if self._models is not None:
                backend.encoder, backend.ranker = self._models
            backend.warmup()
            self._models = backend.encoder, backend.ranker
            self._backends[resource_key] = backend
        gpu = m['scheduler'].GpuScheduler(cfg.queue_capacity)
        generator = None
        try:
            backend.prime_kernels(gpu)
            transport = RequestTransport(self._base_url)
            generator = m['generation'].Generator(transport, cfg)
            asyncio.run_coroutine_threadsafe(transport.prepare(), generator._loop).result(timeout=30)
            engine = m['engine'](m['retriever'](backend, gpu, cfg), generator, backend.names, cfg)
        except BaseException:
            if generator is not None:
                generator.close()
            gpu.close()
            raise
        row = dict(modules=m, engine=engine, gpu=gpu, generator=generator, transport=transport,
                   histories=OrderedDict(), turn=0)
        self._runtimes[sid] = row
        return row

    def prewarm(self, systems, base_url):
        with self._lock:
            self._base_url = base_url
            prepared = {}
            for system in systems:
                if system['status'] != 'runnable' or system['config'].get('adapter') != 'modern_flash':
                    continue
                start = time.perf_counter()
                self._runtime(system)
                prepared[system['id']] = round((time.perf_counter() - start) * 1000, 2)
            return {'versions_ms': prepared, 'resource_backends': len(self._backends), 'remote_calls': 0}

    def stream(self, system, question, *, api_key, base_url, session_id, history, cancel_event):
        with self._lock:
            if cancel_event.is_set():
                yield 'cancelled', {}
                return
            initialized = time.perf_counter()
            row = self._runtime(system)
            initialization_ms = (time.perf_counter() - initialized) * 1000
            m, engine = row['modules'], row['engine']
            if cancel_event.is_set():
                yield 'cancelled', {}
                return
            history = tuple(history[-16:])
            # Undo/deletion, comparison branches and switching versions must not
            # reuse a different conversation's event memory.
            expected = row['histories'].get(session_id)
            if expected != history and (not history or expected is None or expected[-len(history):] != history):
                engine._sessions.pop(('web', session_id), None)
            row['turn'] += 1
            task = m['task'](question, session_id=session_id, scope='web',
                             turn_id=row['turn'], user_history=history)
            transport, generator = row['transport'], row['generator']
            prepared = time.perf_counter()
            calls, terminal, retrieval_ms, llm_start_ms, first_token = [], None, None, None, True
            try:
                asyncio.run_coroutine_threadsafe(transport.bind(api_key, base_url), generator._loop).result(timeout=30)
                client_prepare_ms = (time.perf_counter() - prepared) * 1000
                yield 'runtime', {'generation_model': m['config'].model,
                                 'runtime_config': asdict(m['config']), 'system_id': system['id'],
                                 'initialization_ms': initialization_ms, 'client_prepare_ms': client_prepare_ms}
                for event in engine.stream(task, cancel_event):
                    data = event.data
                    if event.kind == 'token':
                        yield 'token', {'text': data['text']}
                        if first_token and data['text']:
                            first_token = False
                            yield 'latency', {'engine_first_token_ms': event.t_ms,
                                              'model_first_token_ms': event.t_ms - llm_start_ms if llm_start_ms is not None else None}
                    elif event.kind == 'retrieval_end':
                        retrieval_ms = event.t_ms
                    elif event.kind == 'sources':
                        yield 'sources', {'sources': [public_source(s, i) for i, s in enumerate(data['sources'], 1)],
                                          'retrieval_ms': retrieval_ms}
                    elif event.kind == 'llm_request':
                        llm_start_ms = event.t_ms
                        calls.append(dict(data))
                        yield 'stage', {'stage': '依据原文生成回答'}
                    elif event.kind == 'generation_end' and calls:
                        calls[-1].update(data)
                    elif event.kind == 'done':
                        terminal = data
                yield 'diagnostics', {'calls': calls, 'call_count': len(calls),
                                      'instrumentation': 'Flash llm_request/generation_end'}
                if terminal is None:
                    raise RuntimeError('Flash stream missing terminal event')
                if terminal['status'] == 'cancelled' or cancel_event.is_set():
                    yield 'cancelled', {}
                elif terminal['status'] == 'ok':
                    row['histories'][session_id] = (*history, question)[-16:]
                    row['histories'].move_to_end(session_id)
                    if len(row['histories']) > 128:
                        row['histories'].popitem(last=False)
                    yield 'final', {'text': '', 'sources': [], 'use_streamed_answer': True,
                                    'completion_status': 'complete', 'warning': ''}
                else:
                    yield 'error', {'message': 'Flash 未完成回答：' + str(terminal.get('reason', terminal['status']))}
            finally:
                try:
                    asyncio.run_coroutine_threadsafe(transport.release(), generator._loop).result(timeout=5)
                except BaseException:
                    # A loop that cannot drain must never be reused for another key.
                    generator.close()
                    row['gpu'].close()
                    self._runtimes.pop(system['id'], None)
                    raise

    def forget(self, owner, conversation):
        session = owner + ':' + conversation
        with self._lock:
            for row in self._runtimes.values():
                row['engine']._sessions.pop(('web', session), None)
                row['histories'].pop(session, None)

    def close(self):
        with self._lock:
            for row in self._runtimes.values():
                row['generator'].close()
                row['gpu'].close()
            self._runtimes.clear()
            self._backends.clear()
            self._models = None


def public_source(source, index):
    """Keep the complete evidence and citation identity, not just a preview."""
    chapter = source.get('chapter_index')
    title = f'第{chapter}章' if chapter is not None else source.get('file_name', '')
    return {**source, 'chunk_id': source['id'],
            'citation_id': f'E{index}', 'title': title, 'chapter': title,
            'chapter_title': title, 'snippet': source.get('text', ''),
            'text_full': source.get('text', '')}
