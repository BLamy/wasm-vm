#!/usr/bin/env python3
"""Bind live Wasm control proof, exact native parity and renderer-omission sabotage."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCES = (
    'Cargo.lock', 'Cargo.toml', 'crates/core/Cargo.toml', 'crates/wasm/Cargo.toml',
    'crates/core/src/lib.rs', 'crates/core/src/desktop_restore.rs',
    'crates/core/src/dev/virtio/gpu/mod.rs', 'crates/core/src/dev/virtio/gpu/protocol.rs',
    'crates/core/src/dev/virtio/gpu/snapshot.rs', 'crates/core/src/dev/virtio/gpu/control3d.rs',
    'crates/core/tests/virtio_gpu_control3d.rs',
    'crates/wasm/src/lib.rs', 'crates/wasm/src/virgl_control_proof.rs',
    'renderer/virgl-command/control-bridge.mjs', 'renderer/virgl-command/control-README.md',
    'crates/core/src/dev/virtio/gpu/scanout3d.rs',
    'crates/wasm/src/virgl_control_proof/scanout.rs',
    'renderer/virgl-command/scanout.mjs',
    'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/state.mjs',
    'renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/tests/control-acceptance.mjs',
    'renderer/virgl-shader/index.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
    'renderer/virgl-shader/build/wasm/virgl-shader.wasm', 'renderer/virgl-shader/bridge.c',
    'renderer/virgl-shader/UPSTREAM.json', 'renderer/virgl-shader/build.sh',
    'renderer/virgl-shader/verify_sources.py', 'tools/setup-virgl-emsdk.sh',
    'tools/virgl-command/fixtures.mjs', 'tools/verify-virgl-control.mjs',
    'tools/verify-virgl-control.sh', 'tools/virgl-command/control-receipt.py',
    'tools/virgl-command/control-cold.py', 'Makefile',
    'tools/verify-virgl-default-demo.mjs', 'web/dist/pkg/wasm_vm_wasm_bg.wasm', 'web/dist/sw.js',
)
LOGS = ('format', 'clippy-default', 'clippy-control', 'clippy-wasm', 'native-control',
        'native-gpu', 'native-machine', 'wasm-core-default', 'wasm-default',
        'wasm-gpu-protocol', 'wasm-proof', 'shader-build')
PARITY_KEYS = ('case', 'request', 'response', 'usedIndex', 'ring', 'transportCanonical', 'transportDigest')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def parse_records(text, marker):
    records = []
    for line in text.splitlines():
        if marker in line:
            record = json.loads(line.split(marker, 1)[1])
            require(isinstance(record, dict), 'native record is not an object')
            records.append(record)
    return records


def parity(record):
    result = {key: record[key] for key in PARITY_KEYS}
    for key in ('request', 'response', 'transportCanonical'):
        require(isinstance(result[key], str) and re.fullmatch(r'(?:[0-9a-f]{2})+', result[key]),
                f'{key} is not exact hexadecimal bytes')
    require(len(result['response']) == 48, 'portable response must contain the complete header')
    require(type(result['usedIndex']) is int and 0 < result['usedIndex'] <= 65535,
            'invalid used-ring index')
    ring_sizes = {'descriptors': 256, 'avail': 40, 'used': 136}
    require(isinstance(result['ring'], dict) and result['ring'].keys() == ring_sizes.keys(),
            'raw virtqueue ring fields missing')
    for key, size in ring_sizes.items():
        value = result['ring'][key]
        require(isinstance(value, str) and len(value) == size * 2
                and re.fullmatch(r'[0-9a-f]+', value), f'invalid raw {key} ring bytes')
    require(digest(bytes.fromhex(result['transportCanonical'])) == result['transportDigest'],
            'canonical transport digest mismatch')
    return result


def main():
    directory = Path(sys.argv[1]).resolve()
    reports = {name: json.loads((directory / name / 'report.json').read_text())
               for name in ('hardware', 'sabotage-skip-context')}
    good = reports['hardware']
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(good['gitHead'] == head and good['task'] == 'E6-T11a', 'wrong task/head')
    require(good['status'] == 'passed' and good['browserResult']['status'] == 'passed',
            'hardware control proof failed')
    result = good['browserResult']['result']
    require(result['status'] == 'passed', 'control suite failed')
    require(result['controlPlaneReplay'] is True and result['guestExecution'] is False,
            'wrong proof scope')
    summary = result['summary']
    require(summary['assertions'] > 0 and summary['portableCommands'] == 27,
            'missing portable ownership assertions')
    require(summary['actualGLAllocations']['Buffer'] > 0 and summary['actualGLAllocations']['Texture'] > 0,
            'no actual buffer/texture allocations')
    require(all(count == 0 for count in summary['finalLiveGL'].values()), 'live GL objects leaked')
    require(good['liveGuest3d'] is False, 'isolated control proof is not production guest 3D')
    require(good['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
    require(good['browser']['headless'] is False, 'headed hardware browser required')
    feature = good['browser']['webglFeature']
    require(good['browser']['gpu']['featureStatus'][feature] == 'enabled', 'hardware WebGL disabled')
    require(not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)', arg, re.I)
                    for arg in good['browser']['commandLine']), 'software rendering flags')

    sources = {entry['path']: entry for entry in good['sources']}
    require(len(sources) == len(good['sources']), 'duplicate source paths')
    required = set(SOURCES)
    required.update(str(file.relative_to(ROOT)) for file in (ROOT / 'target/virgl-control/pkg').rglob('*')
                    if file.is_file() and file.suffix in ('.js', '.wasm'))
    require('target/virgl-control/pkg/wasm_vm_wasm_bg.wasm' in required, 'missing proof Wasm package')
    require(required <= sources.keys(), f'missing bound sources: {sorted(required - sources.keys())}')
    for source in good['sources']:
        raw = (ROOT / source['path']).read_bytes()
        require(len(raw) == source['bytes'] and digest(raw) == source['sha256'],
                f"source drift: {source['path']}")

    records = []

    def record_file(file, expected=None):
        raw = file.read_bytes()
        sha = digest(raw)
        require(expected is None or sha == expected, f'evidence drift: {file}')
        records.append({'path': str(file.relative_to(directory)), 'bytes': len(raw), 'sha256': sha})
        return raw

    demo = json.loads(record_file(directory / 'default-demo/report.json'))
    require(demo['task'] == 'E6-T11a' and demo['gitHead'] == head and demo['status'] == 'passed',
            'ordinary built demo task/head/status mismatch')
    require(demo['passed'] == 127 and demo['failed'] == 0 and demo['errors'] == []
            and 'complete' in demo['suiteStatus'], 'ordinary built demo suite did not pass')
    require(demo['proofExportAbsent'] is True and re.search(r'\blive\b', demo['roadmapPip']),
            'ordinary built demo proof export or live roadmap regression')
    shipped_wasm = sources['web/dist/pkg/wasm_vm_wasm_bg.wasm']
    require(demo['servedWasmSha256'] == shipped_wasm['sha256'],
            'ordinary built demo did not serve the bound shipped Wasm')
    demo_served = {entry['path']: entry for entry in demo['served']}
    require(len(demo_served) == len(demo['served']) and shipped_wasm['path'] in demo_served,
            'ordinary built demo served source list is incomplete or duplicated')
    for source in demo['served']:
        require(source['path'].startswith('web/dist/'), 'ordinary demo served a non-dist source')
        raw = (ROOT / source['path']).read_bytes()
        require(len(raw) == source['bytes'] and digest(raw) == source['sha256'],
                f"ordinary demo source drift: {source['path']}")
    record_file(directory / 'default-demo' / demo['screenshot']['path'], demo['screenshot']['sha256'])

    for name in LOGS:
        raw = record_file(directory / f'{name}.log')
        require(raw or name == 'format', f'empty {name} log')
        if name.startswith('native-') or name == 'wasm-gpu-protocol':
            require(b'test result: ok.' in raw and b'FAILED' not in raw, f'{name} tests did not pass')
    transcript = (directory / 'native-control.log').read_text()
    native = [parity(entry) for entry in parse_records(transcript, 'CONTROL3D_PORTABLE_RECORD ')]
    browser = [parity(entry) for entry in result['portableRecords']]
    require(len(native) == 27, 'portable lifecycle record set is incomplete')
    require(native == browser, 'native/Wasm request, reply, ring or transport state diverged')
    require([entry['usedIndex'] for entry in native] == list(range(1, len(native) + 1)),
            'portable used-ring sequence is not complete and ordered')
    general = parse_records(transcript, 'CONTROL3D_RECORD ')
    require(len(general) >= len(native), 'native command/response transcript missing')
    parity_path = directory / 'native-browser-parity.json'
    parity_path.write_text(json.dumps({'schema': 1, 'status': 'passed', 'comparedFields': PARITY_KEYS,
                                      'records': native}, indent=2) + '\n')
    record_file(parity_path)

    for name, report in reports.items():
        require(report['task'] == 'E6-T11a' and report['gitHead'] == head, 'report task/head drift')
        require(report['sources'] == good['sources'], 'browser runs used different source sets')
        served = {entry['path']: entry for entry in report['servedFiles']}
        require(len(served) == len(report['servedFiles']), 'duplicate served paths')
        expected_mutation = None
        if name != 'hardware':
            require(report['status'] == 'failed' and report['browserResult']['status'] == 'failed',
                    'omitted renderer context escaped browser oracle')
            require('actual renderer context' in report['browserResult']['error']['message'],
                    'sabotage failed for a reason other than renderer ownership')
            mutation = report['sabotage']
            require(mutation['mode'] == 'skip-context' and mutation['path'] == 'renderer/virgl-command/control-bridge.mjs',
                    'wrong sabotage boundary')
            require(mutation['originalSha256'] == sources[mutation['path']]['sha256']
                    and mutation['servedSha256'] != mutation['originalSha256'], 'no source mutation')
            expected_mutation = mutation
        for source in report['sources']:
            if (source['path'].startswith(('renderer/', 'target/virgl-control/pkg/'))
                    and source['path'].endswith(('.mjs', '.js', '.wasm'))):
                # Some unrelated wasm-bindgen snippets are generated but never imported.
                if source['path'].startswith('target/virgl-control/pkg/snippets/') and '/' + source['path'] not in served:
                    continue
                expected = (expected_mutation['servedSha256'] if expected_mutation
                            and source['path'] == expected_mutation['path'] else source['sha256'])
                require(served['/' + source['path']]['sha256'] == expected, 'unexpected served source')
        coverage_path = directory / name / report['browserCoverage']['path']
        coverage = json.loads(record_file(coverage_path, report['browserCoverage']['sha256']))
        require(coverage['scripts'], 'no browser runtime coverage')
        for script in coverage['scripts']:
            require(script['sha256'] == served['/' + script['source']]['sha256'], 'coverage/served-source mismatch')
        screen = report.get('screenshot') or report.get('failureScreenshot')
        require(screen is not None, 'no browser screenshot')
        record_file(directory / name / screen['path'], screen['sha256'])
        record_file(directory / name / 'report.json')

    # This separate binary is built without the proof feature. The browser uses
    # the explicitly enabled package above; neither artifact substitutes for the other.
    default_binary = ROOT / 'target/wasm32-unknown-unknown/debug/wasm_vm_wasm_web.wasm'
    default_bytes = default_binary.read_bytes()
    require(default_bytes.startswith(b'\0asm'), 'default Wasm build missing')
    receipt = {'schema': 1, 'task': 'E6-T11a', 'status': 'passed', 'gitHead': head,
               'liveGuest3d': False, 'synchronousControlBridge': True,
               'portableRecordCount': len(native), 'nativeRecordCount': len(general),
               'sabotageRejected': ['skip-context'], 'sources': good['sources'],
               'defaultDemo': {'passed': demo['passed'], 'failed': demo['failed'],
                               'proofExportAbsent': demo['proofExportAbsent'],
                               'servedWasmSha256': demo['servedWasmSha256']},
               'defaultWasm': {'path': str(default_binary.relative_to(ROOT)), 'bytes': len(default_bytes),
                               'sha256': digest(default_bytes)},
               'records': records, 'browserResultSha256': good['browserResultSha256'],
               'browserMs': good['browserMs']}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'E6-T11a receipt passed: {len(native)} exact native/Wasm control records and renderer-omission oracle')


if __name__ == '__main__':
    main()
