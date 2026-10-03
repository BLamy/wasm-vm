#!/usr/bin/env python3
"""Bind certified counted-table loops to actual native, Wasm and GPU evidence."""
import json
from pathlib import Path
import sys

from compat_common import ROOT, HELD_HEAD, require, read, binding, source, git, sha, same
import browser_receipt
import faults
import native_receipt
import regressions
import profile_receipt
import consumer_receipt
import wasm_receipt


def verify(output, head):
    output = Path(output).resolve()
    contract = read(ROOT / 'docs/gpu-3d-contract.json')
    held_contract = json.loads(git('show', f'{HELD_HEAD}:docs/gpu-3d-contract.json'))
    require(contract['production'] == held_contract['production'], 'production guest graphics remains disabled')
    for retained in ('structuredConditionals', 'indirectConstants'):
        require(same(contract[retained], held_contract[retained]), 'preceding compiler contract is preserved')
    require(contract['boundedTableLoops']['task'] == 'E6-T12e9'
            and contract['boundedTableLoops']['profile'] == 'virgl-webgl2-raw-bits-v12',
            'closed counted-table loop compiler profile')
    native = native_receipt.verify(output / 'native', head)
    wasm = wasm_receipt.verify(output / 'wasm', head, native)
    profiles = profile_receipt.verify(output / 'profiles', head)
    consumer = consumer_receipt.verify(output / 'consumer-unit', head)
    clean_by_sha = {}
    for entry in native['cases']:
        digest = entry['inputSha256']
        require(digest not in clean_by_sha or same(clean_by_sha[digest], entry['result']),
                'identical literal shader bodies have identical full native results')
        clean_by_sha[digest] = entry['result']
    fault_proof = faults.verify(output / 'fault-artifacts', head, clean_by_sha)
    fault_manifest = read(output / 'fault-artifacts/manifest.json')
    browser = browser_receipt.verify(output, head, native, fault_manifest)
    legacy = regressions.verify(output, head)
    names = {item['path'] for proof in (native, wasm, browser, legacy, profiles, consumer) for item in proof['sources']}
    names.update(item['path'] for item in fault_manifest['sources'])
    names.update(str(path.relative_to(ROOT)) for path in (ROOT / 'tools/virgl-bounded-loops').iterdir()
                 if path.is_file())
    names.update(('Makefile', 'docs/gpu-3d-contract.json', 'docs/gpu-3d-decision.md',
                  'renderer/virgl-shader/README.md', 'tools/verify-virgl-bounded-loops.sh'))
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            source(item, head)
            sources.append(item)
    records = [binding(path, output) for path in sorted(output.rglob('*')) if path.is_file()
               and path != output / 'receipt.json' and path.name != 'acceptance.log']
    summary = lambda proof: {key: value for key, value in proof.items() if key not in ('sources', 'records')}
    return {'schema': 1, 'task': 'E6-T12e9', 'status': 'passed', 'gitHead': head,
            'heldHead': HELD_HEAD, 'production': contract['production'], 'guestExecution': False,
            'boundary': 'Certified counted-table loop execution and address bounds with immutable finite/count bank validation through decoded commands and the shared renderer; no production guest GPU or performance claim.',
            'native': {key: native[key] for key in ('schema', 'status', 'stats', 'layout', 'flow', 'recordedMaxima',
                                                   'compatibility', 'seeds', 'mutationsPerSeed', 'sanitizers')},
            'wasm': summary(wasm), 'browser': summary(browser), 'profiles': summary(profiles), 'consumer': summary(consumer),
            'faults': fault_proof, 'regressions': summary(legacy), 'sources': sources, 'records': records,
            'compilerSha256': {'nativeSanitized': native['binarySha256'],
                'native': sha((ROOT / 'renderer/virgl-shader/build/native/virgl-shader').read_bytes()),
                'wasm': sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())}}


def main():
    require(len(sys.argv) == 2, 'usage: receipt.py EVIDENCE_DIRECTORY')
    output = Path(sys.argv[1]).resolve()
    receipt = verify(output, git('rev-parse', 'HEAD').decode().strip())
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12e9 passed: counted-table termination and complete address bounds, immutable bank validation, full native/Wasm parity, actual GPU words, source faults and retained compatibility.')


if __name__ == '__main__':
    main()
