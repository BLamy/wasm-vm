#!/usr/bin/env python3
"""Identify actual worker/Wasm runtime bytes used by a GPU pair, excluding its own stamp."""
from pathlib import Path
import hashlib
import json
import re
repo=Path(__file__).resolve().parents[1]
web=repo/'web'
names=set()
imports=re.compile(r'''(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]''')
def include(path):
    path=path.resolve()
    if path==web/'gpu-checkpoint-build.js' or path in names:return
    if not path.is_file():raise RuntimeError('Missing worker runtime input '+str(path))
    assert path.is_relative_to(web),path
    names.add(path)
    if path.suffix in ('.js','.mjs'):
        for match in imports.finditer(path.read_text()):include(path.parent/match.group(1))
for name in ['linux-worker.js','linux-worker-protocol.js','loader.js','gpu-checkpoint.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session_bg.wasm']:include(web/name)
for path in (web/'renderer').rglob('*'):
    if path.is_file() and path.suffix in ('.mjs','.wasm'):include(path)
identity=hashlib.sha256(b'wasm-vm-production-gpu-worker-v1\0')
for path in sorted(names):
    name=str(path.relative_to(web)).encode();body=path.read_bytes()
    identity.update(name+b'\0'+len(body).to_bytes(8,'little')+body)
value=identity.hexdigest()
(web/'gpu-checkpoint-build.js').write_text('// Generated from actual worker/Wasm runtime bytes; never hand edit.\nexport const GPU_CHECKPOINT_BUILD_ID='+json.dumps(value)+';\nexport const SOFTWARE_CHECKPOINT_WASM_SHA256='+json.dumps(hashlib.sha256((web/'pkg/wasm_vm_wasm_bg.wasm').read_bytes()).hexdigest())+';\nexport const SOFTWARE_CHECKPOINT_WASM_BYTES='+str((web/'pkg/wasm_vm_wasm_bg.wasm').stat().st_size)+';\n')
print('GPU checkpoint build '+value+' ('+str(len(names))+' runtime files)')
