"""Successor compatibility entry point; preserves historical validators verbatim."""
from pathlib import Path

from compat_common import ROOT, require, read, binding, source
import constant_compat
import consumer_compat
import legacy_compat
import shader_compat
import structured_compat
import indirect_compat


def verify(output, head):
    output = Path(output).resolve()
    contract = read(ROOT / 'docs/gpu-3d-contract.json')
    native = read(output / 'native/native-report.json')
    require(native['status'] == 'passed', 'native compiler proof completed before compatibility verification')
    shaders = shader_compat.verify(output, head, native, contract)
    constants = constant_compat.verify(output, head, native)
    structured = structured_compat.verify(output, head, native)
    indirect = indirect_compat.verify(output, head, native)
    directory = output / 'consumer-regression'
    legacy = legacy_compat.verify(directory, head, contract)
    consumer = consumer_compat.verify(directory, head, contract)
    sources = {item['path']: item for group in (shaders, constants, structured, indirect, legacy, consumer) for item in group['sources']}
    for name in ('tools/virgl-bounded-loops/regressions.py', 'tools/virgl-bounded-loops/legacy_compat.py'):
        item = binding(ROOT / name)
        source(item, head)
        sources[name] = item
    return {'schema': 'wasm-vm-bounded-loops-regressions-v1', 'status': 'passed',
            'recordedHead': head, 'predecessorFullGatesClaimed': False,
            'shaders': {key: value for key, value in shaders.items() if key != 'sources'},
            'constantCompiler': {key: value for key, value in constants.items() if key != 'sources'},
            'structuredConditionals': {key: value for key, value in structured.items() if key != 'sources'},
            'indirectConstants': {key: value for key, value in indirect.items() if key != 'sources'},
            'consumer': {key: value for key, value in consumer.items() if key != 'sources'},
            'legacyRenderer': {key: value for key, value in legacy.items() if key != 'sources'},
            'sources': sorted(sources.values(), key=lambda item: item['path'])}
