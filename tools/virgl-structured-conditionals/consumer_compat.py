"""Replay unchanged E6a consumer oracles under an explicit successor envelope.

The historical harness's compilerAdmissionUnchanged flag describes its fourteen
unchanged inputs. This wrapper proves that limited statement with full native
and Wasm results, and makes no unchanged-compiler or historical full-gate claim.
"""
import json
from pathlib import Path
import re
import unit_compat

from compat_common import (ROOT, BASE, E6B, HELD_HEAD, require, sha, read, binding,
                           held, source, unchanged, consumer_modules, load, git, consumer_source, profile_delta)
from consumer_native_compat import FIXTURE, SCHEMA

modules = consumer_modules()
browser = modules['browser_receipt']
lifecycle_receipt = modules['lifecycle_receipt']
unit_receipt = modules['unit_receipt']
artifact = modules['common'].artifact
RUNTIME, MUTATIONS = browser.RUNTIME, browser.MUTATIONS

def envelope(directory, head, contract, mode):
    report = read(directory / 'report.json')
    status = 'failed' if mode == 'decoder-and-guard-bypass' else 'passed'
    require(report['task'] == 'E6-T12e7-consumer-regression' and report['schema'] == 1 and report['gitHead'] == head
            and report['status'] == status and report['mode'] == mode, 'browser task/head/mode/outcome')
    require(report['trackedChanges'] == [] and report['guestExecution'] is False
            and report['currentGuest3dAdvertisement'] is False and report['trustedHostMetadataWrapper'] is True,
            'frozen isolated host contract proof')
    require(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser has zero errors')
    sources = {}
    for item in report['sources']:
        source(item, head)
        require(item['path'] not in sources or item == sources[item['path']], 'consistent repeated source binding')
        sources[item['path']] = item
    mutations = {}
    for path, before, after in MUTATIONS[:0 if mode == 'normal' else 1 if mode == 'decoder-bypass' else 2]:
        raw = (ROOT / path).read_bytes()
        require(raw.count(before.encode()) == 1, 'unique exact source fault seam')
        mutations[path] = {'path': path, 'before': before, 'after': after, 'matches': 1,
                           'originalSha256': sha(raw), 'servedSha256': sha(raw.replace(before.encode(), after.encode()))}
    require(len(report['mutations']) == len(mutations)
            and {item['path']: item for item in report['mutations']} == mutations, 'complete exact source faults')
    served = {item['path']: item for item in report['servedFiles']}
    require(len(served) == len(report['servedFiles']), 'unique served files')
    for path, item in served.items():
        require(path in sources, f'every served input is source bound: {path}')
        raw = (ROOT / path).read_bytes()
        if path in mutations:
            mutation = mutations[path]
            raw = raw.replace(mutation['before'].encode(), mutation['after'].encode())
        require(item['sha256'] == sha(raw) and item['size'] == len(raw), 'exact served bytes')
    require(set(RUNTIME + [FIXTURE, 'renderer/virgl-shader/build/wasm/virgl-shader.wasm']) <= set(served),
            'actual runtime, fixture and built Wasm consumed')
    coverage = json.loads(artifact(directory, report['browserCoverage']))
    require({item['source'] for item in coverage['scripts']} == set(RUNTIME), 'complete browser coverage sources')
    for item in coverage['scripts']:
        require(item['sha256'] == served[item['source']]['sha256']
                and item['originalSha256'] == sources[item['source']]['sha256']
                and item['coverage']['url'].endswith('/' + item['source']), 'coverage of exact served implementation')
    artifact(directory, report['screenshot'] if status == 'passed' else report['failureScreenshot'])
    browser = report['browser']
    require(browser['launch']['headless'] is False
            and browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled'
            and not any(re.search(r'swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu', arg, re.I)
                        for arg in browser['actualCommandLine']), 'real hardware browser')
    qualified = {'browserVersion': browser['version'],
                 **{key: report['host'][key] for key in ('platform', 'architecture', 'release')},
                 'renderer': report['acceptance']['renderer']['renderer']}
    require(qualified in contract['browserMatrix']['qualified'], 'qualified GPU/browser tuple')
    return report


def verify_native(directory, head):
    report = read(directory / 'native-report.json')
    baseline = held(BASE + '/native/native-report.json')
    require(report['schema'] == SCHEMA and report['status'] == 'passed' and report['gitHead'] == head
            and report['heldHead'] == HELD_HEAD and report['predecessorFullGateClaimed'] is False,
            'explicit current-head successor native identity')
    require(report['baseline'] == binding(ROOT / BASE / 'native/native-report.json')
            and report['fixture'] == baseline['fixture'] == binding(ROOT / FIXTURE)
            and report['cases'] == baseline['cases'] and report['calls'] == 14,
            'all fourteen full native results and exact old input identities preserved')
    require(Path(report['binary']).resolve() == ROOT / 'renderer/virgl-shader/build/native/virgl-shader'
            and sha(Path(report['binary']).read_bytes()) == report['binarySha256'], 'actual current native compiler')
    compiler = [name for name in git('ls-files', 'renderer/virgl-shader').decode().splitlines() if '/build/' not in name]
    require([item['path'] for item in report['sources']] == compiler + [
            'tools/virgl-structured-conditionals/consumer_native_compat.py',
            'tools/virgl-structured-conditionals/compat_common.py', FIXTURE], 'complete current native source inventory')
    for item in report['sources']:
        source(item, head)
    raw = (directory / 'native.log').read_bytes()
    require(sha(raw) == report['logSha256'], 'complete current native transcript')
    records = [json.loads(line) for line in raw.splitlines()]
    fixtures = read(ROOT / FIXTURE)
    require(len(records) == len(fixtures) == len(report['cases']) == 14, 'complete native call sequence')
    for record, fixture, case in zip(records, fixtures, report['cases']):
        stdout = record['stdout'].encode('ascii')
        require(record['name'] == fixture['name'] == case['name']
                and record['inputSha256'] == case['inputSha256'] == sha(fixture['text'].encode('ascii'))
                and record['command'] == [report['binary'], fixture['stage']]
                and record['returnCode'] == 0 and record['stderr'] == ''
                and stdout.count(b'\n') == 1 and stdout.endswith(b'\n')
                and sha(stdout) == case['stdoutSha256'] and len(stdout) - 1 == case['resultBytes']
                and json.loads(stdout) == case['result'], 'actual full native input/result serialization')
    return report, {case['name']: case for case in report['cases']}


def verify(output, head, contract):
    output = Path(output).resolve()
    baseline = held(E6B + '/receipt.json')
    require(baseline['status'] == 'passed' and baseline['task'] == 'E6-T12e6b', 'held verified consumer baseline')
    for name in ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/resources.mjs',
                 'renderer/virgl-command/state.mjs', 'renderer/virgl-command/constant-domain.mjs',
                 'renderer/virgl-command/tests/constant-domains.mjs', FIXTURE,
                 'tools/verify-virgl-constant-domains.mjs', 'tools/virgl-constant-domains/regressions.py']:
        consumer_source(name)
    for path in (ROOT / 'tools/virgl-constant-domains').glob('*'):
        if path.is_file():
            unchanged(str(path.relative_to(ROOT)))
    unit = unit_compat.verify(output / 'unit', head)
    native, cases = verify_native(output / 'native', head)
    legacy_native = read(output / 'legacy/native/native-report.json')
    require(native['binarySha256'] == legacy_native['binarySha256'], 'same native compiler for all retained consumer inputs')
    originals = {item['sha256']: item['result'] for item in legacy_native['originals']}
    reports, summaries = [], []
    invalid_names = ['invalid-sync', *[f'invalid-async-{seed:x}' for seed, _ in browser.SCHEDULES]]
    lifecycle_names = ['lifecycle-sync', *[f'lifecycle-async-{seed:x}' for seed, _ in browser.SCHEDULES]]
    extent_names = ['high-vertex', 'high-fragment', 'low-both', 'order-both', 'inactive-both']
    for path, mode in [('hardware', 'normal'), ('decoder-bypass', 'decoder-bypass'),
                       ('sabotage', 'decoder-and-guard-bypass')]:
        report = envelope(output / path, head, contract, mode)
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
    for report in reports:
        require(report['compatibility'] == {'schema': 'wasm-vm-e6a-structured-consumer-replay-v1',
                'heldHead': HELD_HEAD, 'predecessorFullGateClaimed': False}, 'explicit successor browser claim')
    names = {item['path'] for report in reports for item in report['sources']}
    names.update(item['path'] for item in native['sources'] + unit['sources'])
    names.update([E6B + '/receipt.json', BASE + '/native/native-report.json',
                  'tools/virgl-structured-conditionals/consumer_compat.py',
                  'tools/virgl-structured-conditionals/consumer_compat.mjs',
                  'tools/virgl-structured-conditionals/compat_common.py'])
    names.update(str(path.relative_to(ROOT)) for path in (ROOT / 'tools/virgl-constant-domains').glob('*') if path.is_file())
    sources = []
    for name in sorted(names):
        if '/build/' not in name:
            item = binding(ROOT / name)
            source(item, head)
            sources.append(item)
    return {'schema': 'wasm-vm-e6a-structured-consumer-compat-v1', 'status': 'passed',
            'recordedHead': head, 'heldHead': HELD_HEAD, 'predecessorFullGateClaimed': False,
            'profileExtension': profile_delta(),
            'boundary': 'Exact closed profile8/9 extension; unchanged bank/runtime/helper inputs and independent oracles; current compiler gives identical full results for all 14 authored stages and 19 originals. Historical trusted-host metadata wrapper remains limited to this regression.',
            'baseline': binding(ROOT / E6B / 'receipt.json'),
            'native': binding(output / 'native/native-report.json', output),
            'unit': {key: value for key, value in unit.items() if key not in ('sources', 'records')},
            'browser': summaries, 'sources': sources,
            'compilerSha256': {'native': native['binarySha256'],
                              'wasm': sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())}}
