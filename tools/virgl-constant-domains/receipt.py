#!/usr/bin/env python3
"""Bind the complete conditional constant consumer proof at its frozen source head."""
import json
import sys
from pathlib import Path

from common import ROOT, HELD_HEAD, require, read, sha, binding, git, source, verify_native
import browser_receipt as browser
import lifecycle_receipt
import regressions
import unit_receipt


def verify(output, head):
    output = Path(output).resolve()
    contract = read(ROOT / 'docs/gpu-3d-contract.json')
    held_contract = json.loads(git('show', f'{HELD_HEAD}:docs/gpu-3d-contract.json'))
    require(contract['production'] == held_contract['production'], 'production guest graphics remains disabled')
    require(contract['conditionalConstantConsumer']['task'] == 'E6-T12e6a'
            and contract['conditionalConstantConsumer']['profile'] == browser.PROFILE
            and contract['conditionalConstantConsumer']['kind'] == browser.KIND, 'declared consumer contract')
    unit = unit_receipt.verify(output / 'unit', head)
    native, cases = verify_native(output / 'native', head)
    legacy = regressions.verify(output, head, contract)
    legacy_native = read(output / 'legacy/native/native-report.json')
    require(native['binarySha256'] == legacy_native['binarySha256'], 'new and retained inputs use the same native compiler')
    originals = {item['sha256']: item['result'] for item in legacy_native['originals']}
    reports, summaries = [], []
    invalid_names = ['invalid-sync', *[f'invalid-async-{seed:x}' for seed, _ in browser.SCHEDULES]]
    lifecycle_names = ['lifecycle-sync', *[f'lifecycle-async-{seed:x}' for seed, _ in browser.SCHEDULES]]
    extent_names = ['high-vertex', 'high-fragment', 'low-both', 'order-both', 'inactive-both']
    for path, mode in [('hardware', 'normal'), ('decoder-bypass', 'decoder-bypass'),
                       ('sabotage', 'decoder-and-guard-bypass')]:
        report = browser.envelope(output / path, head, contract, mode)
        reports.append(report)
        proof = report['acceptance']
        require(proof['schema'] == 'wasm-vm-constant-domain-browser-v1' and proof['mode'] == mode
                and proof['status'] == report['status'] and proof['guestExecution'] is False
                and proof['productionVirgl'] is False and proof['trustedHostMetadataWrapper'] is True
                and proof['compilerAdmissionUnchanged'] is True, 'honest consumer-only browser claim')
        names = lifecycle_names + extent_names + ['raw-sync', 'raw-async'] + invalid_names if mode == 'normal' else (
            invalid_names if mode == 'decoder-bypass' else ['invalid-sync'])
        require([rig['name'] for rig in proof['rigs']] == names, 'complete ordered browser workload')
        metadata_names = [f'{stage}-{fault}' for stage in ('vertex', 'fragment') for fault in browser.FAULTS]
        require([rig['name'] for rig in proof['metadataRigs']] == (metadata_names if mode == 'normal' else []),
                'complete metadata attack matrix')
        by_body = browser.translations(proof, cases, originals)
        total = {'pixels': 0, 'rawWords': 0, 'invalidUploads': 0}
        lifecycle = []
        for rig in proof['rigs'] + proof['metadataRigs']:
            expected_stages = rig['name'][5:] if rig['name'] in ('high-vertex', 'high-fragment') else 'both'
            require(rig['contractStages'] == expected_stages, 'stage-local conditional/unconditional mixture')
            schedule = next(({'seed': seed, 'commandsPerStep': budget} for seed, budget in browser.SCHEDULES
                             if rig['name'].endswith(f'-async-{seed:x}')), None)
            if rig['name'] == 'raw-async':
                seed, budget = browser.SCHEDULES[1]
                schedule = {'seed': seed, 'commandsPerStep': budget}
            require(rig.get('schedule') == schedule, 'four explicit varied command/fence schedules')
            counts = browser.gpu(rig, mode, by_body)
            for key, value in counts.items(): total[key] += value
            lifecycle.append({'name': rig['name'], **lifecycle_receipt.verify_rig(rig, mode)})
        if mode == 'decoder-and-guard-bypass':
            require(total == {'pixels': 1024, 'rawWords': 0, 'invalidUploads': 1}
                    and 'finite guard omission: actual invalid conditional uniform upload' in proof['failure']['message']
                    and 'finite guard omission: actual invalid conditional uniform upload' in report['failure']['message'],
                    'only the measured invalid native upload refutes the deliberate source fault')
        else:
            expected_pixels, expected_raw = (110592, 64) if mode == 'normal' else (10240, 0)
            require(total == {'pixels': expected_pixels, 'rawWords': expected_raw, 'invalidUploads': 0}
                    and proof['checkedPixels'] == expected_pixels and proof['rawWords'] == expected_raw
                    and proof['invalidCases'] == 120, 'independently reconstructed complete hardware counts')
        summaries.append({'mode': mode, **total, 'rigs': lifecycle,
                          'report': binding(output / path / 'report.json', output)})
    require(all(report['sources'] == reports[0]['sources'] for report in reports[1:]), 'fault runs preserve every original source/input')
    names = {item['path'] for report in reports for item in report['sources']}
    names.update(item['path'] for item in native['sources'] + unit['sources'] + legacy['sources'])
    names.update(str(path.relative_to(ROOT)) for path in (ROOT / 'tools/virgl-constant-domains').glob('*') if path.is_file())
    names.update(('tools/verify-virgl-constant-domains.sh', 'Makefile', 'docs/gpu-3d-contract.json', 'docs/gpu-3d-decision.md'))
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            source(item, head)
            sources.append(item)
    records = [binding(path, output) for path in sorted(output.rglob('*')) if path.is_file()
               and path != output / 'receipt.json' and path.name != 'acceptance.log']
    return {'schema': 1, 'task': 'E6-T12e6a', 'status': 'passed', 'gitHead': head,
            'heldCompilerHead': HELD_HEAD, 'production': contract['production'], 'guestExecution': False,
            'boundary': 'Shared synchronous/asynchronous renderer enforces trusted host finite-bank contracts. No compiler admission or production graphics activation.',
            'unit': {key: value for key, value in unit.items() if key not in ('sources', 'records')},
            'nativeCases': len(cases), 'browser': summaries,
            'regressions': {key: value for key, value in legacy.items() if key != 'sources'},
            'sources': sources, 'records': records,
            'compilerSha256': {'native': native['binarySha256'],
                'wasm': sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())}}


def main():
    require(len(sys.argv) == 2, 'usage: receipt.py EVIDENCE_DIRECTORY')
    output = Path(sys.argv[1]).resolve()
    receipt = verify(output, git('rev-parse', 'HEAD').decode().strip())
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12e6a passed: checked immutable raw constants, real GPU pixels, varied async schedules, fault controls and preserved legacy workloads.')


if __name__ == '__main__':
    main()
