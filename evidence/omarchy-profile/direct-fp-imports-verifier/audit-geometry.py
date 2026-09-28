#!/usr/bin/env python3
"""Separate the fixed surface from legal GPU damage rectangles."""
from copy import deepcopy
from pathlib import Path
import hashlib
import json
import subprocess

repo = Path.cwd()
out = repo / 'evidence/omarchy-profile/direct-fp-imports-verifier'
path = repo / 'evidence/omarchy-profile/direct-fp-imports-r1/physical-input/desktop/report.json'
raw = path.read_bytes()
report = json.loads(raw)
states = [row['runtime']['presentation'] for row in report['observations'] if 'runtime' in row]


def validate(state):
    assert state['width'] == 1280 and state['height'] == 800
    assert state['gpu']['width'] == 1280 and state['gpu']['height'] == 800
    assert state['fixedViewport'] is True
    assert state['latest']['resourceWidth'] == 1280 and state['latest']['resourceHeight'] == 832
    rect = state['latest']['rect']
    assert all(type(rect[key]) is int for key in ['x', 'y', 'width', 'height'])
    assert rect['x'] >= 0 and rect['y'] >= 0 and rect['width'] > 0 and rect['height'] > 0
    assert rect['x'] + rect['width'] <= 1280 and rect['y'] + rect['height'] <= 832
    assert state['framesReceived'] > 0 and state['successfulPresents'] > 0
    assert state['errors'] == []


for state in states:
    validate(state)
assert states[0]['latest']['rect'] == {'x': 0, 'y': 0, 'width': 1280, 'height': 800}
assert states[-1]['latest']['rect'] == {'x': 10, 'y': 36, 'width': 118, 'height': 28}
mutations = [
    (['width'], 118), (['height'], 28), (['gpu', 'width'], 118), (['gpu', 'height'], 28),
    (['fixedViewport'], False), (['latest', 'resourceWidth'], 118), (['latest', 'resourceHeight'], 28),
    (['latest', 'rect', 'x'], -1), (['latest', 'rect', 'y'], -1),
    (['latest', 'rect', 'width'], 0), (['latest', 'rect', 'height'], 0),
    (['latest', 'rect', 'x'], 1280), (['latest', 'rect', 'y'], 832),
    (['latest', 'rect', 'width'], 0.5), (['errors'], ['corrupt']),
]
for keys, value in mutations:
    altered = deepcopy(states[-1])
    field = altered
    for key in keys[:-1]:
        field = field[key]
    field[keys[-1]] = value
    try:
        validate(altered)
    except AssertionError:
        pass
    else:
        raise AssertionError(('geometry mutation not rejected', keys, value))
source_paths = ['crates/core/src/dev/virtio/gpu/resources.rs', 'crates/wasm/src/lib.rs', 'web/src/sink/presentation.js', 'tools/verify/omarchy-opaque-foot-command.mjs']
sources = {}
for source_path in source_paths:
    data = (repo / source_path).read_bytes()
    old = subprocess.check_output(['git', 'show', '04ea9fe4:' + source_path])
    assert data == old
    sources[source_path] = hashlib.sha256(data).hexdigest()
receipt = {
    'rawReportSha256': hashlib.sha256(raw).hexdigest(),
    'canvasAndGpu': [1280, 800], 'resource': [1280, 832],
    'rectangles': [state['latest']['rect'] for state in states],
    'validObservedStates': len(states), 'rejectedMutations': [{'field': keys, 'value': value} for keys, value in mutations],
    'unchangedSources': sources,
    'sourceCitations': {
        'crates/core/src/dev/virtio/gpu/resources.rs:65': 'tracking sink publishes later changed-pixel bounds while Resource width/height stay separate',
        'crates/wasm/src/lib.rs:2336': 'browser FrameSink opts into transferred-damage tracking',
        'web/src/sink/presentation.js:499': 'state reports fixed viewport dimensions separately from raw latest rectangle/resource dimensions',
        'tools/verify/omarchy-opaque-foot-command.mjs:33': 'inherited verifier incorrectly requires every latest damage rectangle to remain full viewport',
    },
    'claim': 'actual fixed presentation is retained; partial damage is not a resize; nonce and visible response remain failed',
}
(out / 'geometry-inspection.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'validObservedStates': len(states), 'rejectedMutations': len(mutations), 'fixedGeometry': True, 'desktopAcceptance': False}, indent=2))
