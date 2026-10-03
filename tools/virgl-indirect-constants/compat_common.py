"""Source-bound successor compatibility utilities; no predecessor guard overrides."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = 'd3a57934cab34e62a274996c0a5559ed8db52645'
E6B = 'evidence/virgl-constant-compiler/cold-clone/acceptance'
BASE = E6B + '/consumer-regression'
E7 = 'evidence/virgl-structured-conditionals/cold-clone/acceptance'
NATIVE_BASELINE = E7 + '/native/native-report.json'
NATIVE_BASELINE_SHA = '2c1e5ff6bdc2ee4963eda5ef663fad5d758d572098e128554675f260650bb065'


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(Path(path).read_bytes())


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def binding(path, base=ROOT):
    path = Path(path)
    raw = path.read_bytes()
    return {'path': str(path.relative_to(base)), 'bytes': len(raw), 'sha256': sha(raw)}


def held(path):
    raw = git('show', f'{HELD_HEAD}:{path}')
    require(raw == (ROOT / path).read_bytes(), f'unchanged held evidence/helper: {path}')
    return json.loads(raw)


def unchanged(path):
    require(git('show', f'{HELD_HEAD}:{path}') == (ROOT / path).read_bytes(),
            f'unchanged predecessor oracle/runtime: {path}')


def source(item, head):
    raw = (ROOT / item['path']).read_bytes()
    require(sha(raw) == item['sha256'] and len(raw) == item.get('bytes', item.get('size')),
            f'actual source: {item["path"]}')
    if '/build/' not in item['path']:
        require(git('show', f'{head}:{item["path"]}') == raw, f'frozen source: {item["path"]}')


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def consumer_modules():
    """Resolve predecessor imports in their own namespace, without changing guards."""
    directory = ROOT / 'tools/virgl-constant-domains'
    names = ['common', 'browser_receipt', 'lifecycle_receipt', 'unit_receipt']
    saved = {name: sys.modules.get(name) for name in names}
    loaded = {}
    try:
        for name in names:
            path = str((directory / (name + '.py')).relative_to(ROOT))
            unchanged(path)
            loaded[name] = load('e8_predecessor_' + name, path)
            sys.modules[name] = loaded[name]
    finally:
        for name, value in saved.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value
    return loaded

DOMAIN = 'renderer/virgl-command/constant-domain.mjs'
STATE = 'renderer/virgl-command/state.mjs'
CHANGED_CONSUMERS = {DOMAIN, STATE}


def same(actual, expected):
    return json.dumps(actual, sort_keys=True, separators=(',', ':'), allow_nan=False) == \
        json.dumps(expected, sort_keys=True, separators=(',', ':'), allow_nan=False)


def profile_delta():
    """Bind the two deliberately changed consumers; do not claim they are held.

    The E8 unit and actual-GPU proof cover these implementations, including old
    profiles. Every other inherited runtime/fixture/oracle is pinned verbatim.
    This is an explicit successor boundary, never an override of an old gate.
    """
    entries = []
    for name in sorted(CHANGED_CONSUMERS):
        before = git('show', f'{HELD_HEAD}:{name}')
        entries.append({'path': name, 'beforeSha256': sha(before),
                        'current': binding(ROOT / name)})
    return {'heldHead': HELD_HEAD, 'changedConsumers': entries,
            'boundary': 'Current E8 metadata and immutable-bank admission are exercised by new proof and unchanged predecessor workload oracles; no byte-identical consumer claim.',
            'profilesAdded': ['virgl-webgl2-raw-bits-v10', 'virgl-webgl2-raw-bits-v11'],
            'existingConditionalRequired': ['virgl-webgl2-raw-bits-v7', 'virgl-webgl2-raw-bits-v9']}


def consumer_source(path):
    if path in CHANGED_CONSUMERS:
        require((ROOT / path).is_file(), 'explicit current consumer source')
        profile_delta()
    else:
        unchanged(path)


def strict_v8_coverage(coverage):
    """Coverage counters and offsets are typed evidence, never numeric aliases."""
    require(type(coverage) is list, 'V8 coverage is an array')
    for script in coverage:
        require(type(script) is dict and set(script) == {'scriptId', 'url', 'functions'}
                and type(script['scriptId']) is str and script['scriptId'].isdecimal()
                and type(script['url']) is str and type(script['functions']) is list,
                'complete typed V8 script coverage')
        for function in script['functions']:
            require(type(function) is dict and set(function) == {'functionName', 'ranges', 'isBlockCoverage'}
                    and type(function['functionName']) is str and type(function['isBlockCoverage']) is bool
                    and type(function['ranges']) is list and function['ranges'],
                    'complete typed V8 function coverage')
            for span in function['ranges']:
                require(type(span) is dict and set(span) == {'startOffset', 'endOffset', 'count'}
                        and all(type(span[key]) is int and span[key] >= 0 for key in span)
                        and span['startOffset'] <= span['endOffset'],
                        'integer-only V8 offsets and execution counters')
