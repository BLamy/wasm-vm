"""Source-bound successor compatibility utilities; no predecessor guard overrides."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HELD_HEAD = '26ed74a31e0ee3c1d43b4e174c8096d67898d920'
E6B = 'evidence/virgl-constant-compiler/cold-clone/acceptance'
BASE = E6B + '/consumer-regression'
NATIVE_BASELINE = E6B + '/native/native-report.json'
NATIVE_BASELINE_SHA = '4888a39ad6de35d31cdc6466d10895d6634d232a8042cf669572e5525bd0a014'


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
            loaded[name] = load('e7_predecessor_' + name, path)
            sys.modules[name] = loaded[name]
    finally:
        for name, value in saved.items():
            if value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = value
    return loaded

DOMAIN = 'renderer/virgl-command/constant-domain.mjs'
PROFILE_EDITS = [
    ('export const CONDITIONAL_PROFILE = "virgl-webgl2-raw-bits-v7";\n',
     'export const CONDITIONAL_PROFILE = "virgl-webgl2-raw-bits-v7";\n'
     'export const STRUCTURED_PROFILE = "virgl-webgl2-raw-bits-v8";\n'
     'export const STRUCTURED_CONDITIONAL_PROFILE = "virgl-webgl2-raw-bits-v9";\n'),
    ('const UNCONDITIONAL_PROFILES = new Set(',
     'const CONDITIONAL_PROFILES = new Set([CONDITIONAL_PROFILE, STRUCTURED_CONDITIONAL_PROFILE]);\n'
     'const UNCONDITIONAL_PROFILES = new Set('),
    ('...[1, 2, 3, 4, 5, 6].map((version) => `virgl-webgl2-raw-bits-v${version}`)]);',
     '...[1, 2, 3, 4, 5, 6].map((version) => `virgl-webgl2-raw-bits-v${version}`), STRUCTURED_PROFILE]);'),
    ('value.profile === CONDITIONAL_PROFILE || UNCONDITIONAL_PROFILES.has(value.profile)',
     'CONDITIONAL_PROFILES.has(value.profile) || UNCONDITIONAL_PROFILES.has(value.profile)'),
    ('if (value.profile !== CONDITIONAL_PROFILE)', 'if (!CONDITIONAL_PROFILES.has(value.profile))'),
]


def profile_delta():
    old = git('show', f'{HELD_HEAD}:{DOMAIN}')
    expected = old.decode('utf-8')
    edits = []
    for before, after in PROFILE_EDITS:
        require(expected.count(before) == 1, 'unique exact closed-profile extension seam')
        expected = expected.replace(before, after)
        edits.append({'before': before, 'after': after, 'matches': 1})
    current = (ROOT / DOMAIN).read_bytes()
    require(current == expected.encode('utf-8'), 'consumer differs only by explicit profiles8/9; bank rules and ownership remain byte-identical')
    return {'path': DOMAIN, 'heldHead': HELD_HEAD, 'beforeSha256': sha(old),
            'afterSha256': sha(current), 'edits': edits,
            'unconditionalAdded': ['virgl-webgl2-raw-bits-v8'],
            'conditionalAdded': ['virgl-webgl2-raw-bits-v9'],
            'existingConditionalRequired': ['virgl-webgl2-raw-bits-v7']}


def consumer_source(path):
    if path == DOMAIN:
        profile_delta()
    else:
        unchanged(path)
