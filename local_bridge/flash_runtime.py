"""Private Flash version adapters. No corpus or credentials are shipped to Pages."""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import asdict
import hashlib
import importlib
import json
from pathlib import Path
import sys
import threading
import types

# id, generation, caption, source package, config manifest, rebased
VERSIONS = (
    ('flash-v20-original', '20', '初版', 'data/flash20/experiments/20261027-evening/source/src/flash20', 'flash-2.0_full_20261027_evening', False),
    ('flash-v20', '20', '质量修正版', 'data/flash20/experiments/20261027-quality-eval-full/source', 'flash-2.0_quality_full_20261027_r1', False),
    ('flash-v21-r3', '21', '语境恢复版', 'data/flash21/backups/20261029-before-field-routing/src/flash21', 'flash-2.1_full_20261028_r3', False),
    ('flash-v21', '21', '代表版 · 单次证据视图', 'data/flash21/dev/20261029-readiness-cold/code-snapshot', 'flash-2.1_full_20261029_ready_r1', False),
    ('flash-v22-frozen-r1', '22', '冻结 r1 · 质量代表', 'data/flash22/releases/flash-2.2_20261030_candidate_r1/code/flash22', 'flash-2.2_full_20261030_frozen_r1', True),
    ('flash-v22-frozen-r2', '22', '冻结 r2 · 速度代表', 'data/flash22/releases/flash-2.2_20261031_candidate_r2/code/flash22', 'flash-2.2_full_20261031_frozen_r2', True),
)


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
                   notes='按该版代码与配置运行，使用本机当前资料；运行成绩不等于历史成绩。',
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


class FlashRuntime:
    """Two CPU runtime slots, one shared modern model pair, per-request BYOK."""
    def __init__(self, root):
        self.root = Path(root)
        self._lock = threading.RLock()
        self._runtimes = OrderedDict()
        self._models = None

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
        settings = system['config']
        m = modules(self.root, settings)
        cfg = m['config']
        backend = m['resources'].load_backend(self.root)
        if self._models is not None:
            backend.encoder, backend.ranker = self._models
        backend.warmup()
        self._models = backend.encoder, backend.ranker
        gpu = m['scheduler'].GpuScheduler(cfg.queue_capacity)
        try:
            backend.prime_kernels(gpu)
            engine = m['engine'](m['retriever'](backend, gpu, cfg), None, backend.names, cfg)
        except BaseException:
            gpu.close()
            raise
        row = dict(modules=m, engine=engine, gpu=gpu, histories=OrderedDict(), turn=0)
        self._runtimes[sid] = row
        if len(self._runtimes) > 2:
            _, old = self._runtimes.popitem(last=False)
            old['gpu'].close()
        return row

    def stream(self, system, question, *, api_key, base_url, session_id, history, cancel_event):
        with self._lock:
            if cancel_event.is_set():
                yield 'cancelled', {}
                return
            row = self._runtime(system)
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
            # Each request owns its client. No key is cached on a shared runtime.
            transport = m['generation'].OpenAITransport(api_key, base_url)
            generator = m['generation'].Generator(transport, m['config'])
            engine.generator = generator
            calls, terminal, retrieval_ms = [], None, None
            try:
                yield 'runtime', {'generation_model': m['config'].model,
                                 'runtime_config': asdict(m['config']), 'system_id': system['id']}
                for event in engine.stream(task, cancel_event):
                    data = event.data
                    if event.kind == 'token':
                        yield 'token', {'text': data['text']}
                    elif event.kind == 'retrieval_end':
                        retrieval_ms = event.t_ms
                    elif event.kind == 'sources':
                        yield 'sources', {'sources': [public_source(s, i) for i, s in enumerate(data['sources'], 1)],
                                          'retrieval_ms': retrieval_ms}
                    elif event.kind == 'llm_request':
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
                generator.close()
                engine.generator = None

    def forget(self, owner, conversation):
        session = owner + ':' + conversation
        with self._lock:
            for row in self._runtimes.values():
                row['engine']._sessions.pop(('web', session), None)
                row['histories'].pop(session, None)

    def close(self):
        with self._lock:
            for row in self._runtimes.values():
                row['gpu'].close()
            self._runtimes.clear()
            self._models = None


def public_source(source, index):
    """Keep the complete evidence and citation identity, not just a preview."""
    chapter = source.get('chapter_index')
    title = f'第{chapter}章' if chapter is not None else source.get('file_name', '')
    return {**source, 'chunk_id': source['id'],
            'citation_id': f'E{index}', 'title': title, 'chapter': title,
            'chapter_title': title, 'snippet': source.get('text', ''),
            'text_full': source.get('text', '')}
