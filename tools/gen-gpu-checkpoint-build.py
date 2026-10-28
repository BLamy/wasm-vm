#!/usr/bin/env python3
"""Identify actual worker/Wasm runtime bytes used by a GPU pair, excluding its own stamp."""
from pathlib import Path
import argparse
import hashlib
import json
import re


def generate(runtime_root, wasm_package_root=None):
    web=Path(runtime_root).resolve()
    package=Path(wasm_package_root).resolve() if wasm_package_root is not None else None
    inputs={}
    imports=re.compile(r'''(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]''')

    def physical(path):
        if package is not None and path.is_relative_to(web/'pkg'):
            return package/path.relative_to(web/'pkg')
        return path

    def include(path):
        path=path.resolve()
        if path==web/'gpu-checkpoint-build.js' or path in inputs:return
        assert path.is_relative_to(web),path
        source=physical(path)
        if not source.is_file():raise RuntimeError('Missing worker runtime input '+str(source))
        body=source.read_bytes();inputs[path]=body
        if path.suffix in ('.js','.mjs'):
            for match in imports.finditer(body.decode()):include(path.parent/match.group(1))

    for name in ['linux-worker.js','linux-worker-protocol.js','loader.js','gpu-checkpoint.js','session-gpu-replay.js','session-gpu-history-reader.js','session-gpu-replay-worker.js','session-branches.js','session-gpu-branch-worker.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session_bg.wasm']:include(web/name)
    for path in (web/'renderer').rglob('*'):
        if path.is_file() and path.suffix in ('.mjs','.wasm'):include(path)
    identity=hashlib.sha256(b'wasm-vm-production-gpu-worker-v1\0')
    for path in sorted(inputs):
        name=str(path.relative_to(web)).encode();body=inputs[path]
        identity.update(name+b'\0'+len(body).to_bytes(8,'little')+body)
    value=identity.hexdigest();wasm=inputs[web/'pkg/wasm_vm_wasm_bg.wasm']
    stamp='// Generated from actual worker/Wasm runtime bytes; never hand edit.\nexport const GPU_CHECKPOINT_BUILD_ID='+json.dumps(value)+';\nexport const SOFTWARE_CHECKPOINT_WASM_SHA256='+json.dumps(hashlib.sha256(wasm).hexdigest())+';\nexport const SOFTWARE_CHECKPOINT_WASM_BYTES='+str(len(wasm))+';\n'
    return stamp,value,len(inputs)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-root',type=Path,default=Path(__file__).resolve().parents[1]/'web')
    parser.add_argument('--wasm-package-root',type=Path)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--check',action='store_true',help='refuse a stale or relabeled stamp without writing')
    args=parser.parse_args();output=args.output or args.runtime_root/'gpu-checkpoint-build.js'
    stamp,value,count=generate(args.runtime_root,args.wasm_package_root)
    if args.check:
        if output.read_bytes()!=stamp.encode():raise RuntimeError('GPU checkpoint stamp does not match actual runtime bytes')
    else:
        output.parent.mkdir(parents=True,exist_ok=True);output.write_text(stamp)
    print('GPU checkpoint build '+value+' ('+str(count)+' runtime files)'+(' verified' if args.check else ''))


if __name__=='__main__':main()
