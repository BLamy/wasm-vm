"""Source-bound successor compatibility utilities; no predecessor guard overrides."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '9497f3da026092db1eb53e8d6187bceff214656a'
BASE = 'evidence/virgl-constant-domains/worker'
E6_NATIVE = 'evidence/virgl-dot-reciprocals/worker/native/native-report.json'
E6_SHA = '781960b68e1cb49d03b02ec4e6264183dc52fec408825d37ecb93daa7f189dcb'


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
            loaded[name] = load('e6b_predecessor_' + name, path)
            sys.modules[name] = loaded[name]
    finally:
        for name, value in saved.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value
    return loaded
