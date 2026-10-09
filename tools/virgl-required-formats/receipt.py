#!/usr/bin/env python3
"""Authenticate the original requirement join, fresh GPU records and held leaves."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = '3f0db236825e4389c4cd78e82192f81dc9b5cf90'
LEAVES = [
    ('E6-T12g1', 'guest-format-inventory', 'virgl-workload-inventory', 'fd2b5faf08ab77133937fa8d09183a24f16bfe2f88913ca4f08d2fbacc14e7dc'),
    ('E6-T12g2', 'color-format-storage', 'virgl-color-formats', 'ef5cd601c77585b597b85fda5f77e227694d6ddb1a3041dd50ae398b6920b273'),
    ('E6-T12g3', 'depth-format-storage', 'virgl-depth-formats', 'dbf7a0fbd12cc4e3711e4fc4745738d9cd3ac2ae4d9d60974f19077e148996eb'),
    ('E6-T12g4', 'texture-view-specialization', 'virgl-texture-views', 'de6d0334fed7059bb9af7dfaa5bd52ed2531089091ef1ce74e65970bb0789830'),
    ('E6-T12g5', 'inline-texture-uploads', 'virgl-inline-uploads', '04553ec60232a633120c7de041e13e297ce46134684712f6a6d39d75c76df157'),
    ('E6-T12g6a', 'original-shader-execution', 'virgl-gears-shaders', '9941036d869021078ce41f67e219b568c24a5b00294598dba4b6873c67b3af6e'),
    ('E6-T12g6m', 'larger-original-programs', 'virgl-original-programs', 'a90cd34bf49f9dbe9dc8ebb54e2f0a95f544a1f72c78d28e436f1ba16beb5a12'),
]
FAULTS = {
    'channel-order': ('E6-T12g2', 'physical sampled RGBA 2 keeps channels/precision/alpha/origin'),
    'destination-alpha': ('E6-T12g2', 'draw 233 physical channels and destination alpha at 8,8'),
    'byte-order': ('E6-T12g3', 'all65536 independent normalized depth sampling'),
    'swizzle': ('E6-T12g4', 'swizzle 2,1,0,3 physical RGBA 67 at 8,8'),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, message):
    if not value:
        raise ValueError(message)


def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    sources, generated = {}, {}

    def source(name, expected=None):
        raw = (ROOT / name).read_bytes()
        require(expected is None or sha(raw) == expected, 'source drift: ' + name)
        if '/build/' in name:
            generated[name] = sha(raw)
        else:
            require(raw == subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT), 'unfrozen source: ' + name)
            sources[name] = sha(raw)
        return raw

    def report(name, task, passed=True):
        value = json.loads((directory / name / 'report.json').read_bytes())
        require(value['gitHead'] == head and value['task'] == task, 'wrong report head/task: ' + name)
        require(value['status'] == ('passed' if passed else 'failed'), 'wrong report status: ' + name)
        for item in value['sources'] + value['inputs']:
            raw = source(item['path'], item['sha256'])
            require(len(raw) == item['bytes'], 'source length: ' + item['path'])
        require(value['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors: ' + name)
        browser = value['browser']
        require(browser['headless'] is False, 'headless proof: ' + name)
        require(browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'GPU disabled')
        require(not any(s in str(browser['commandLine']).lower() for s in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe', '--disable-gpu']), 'software renderer launch')
        result = value['browserResult']
        require(result['status'] == ('passed' if passed else 'failed'), 'browser verdict: ' + name)
        screen = value.get('screenshot') or value.get('failureScreenshot')
        require(screen and sha((directory / name / screen['path']).read_bytes()) == screen['sha256'], 'capture drift: ' + name)
        coverage = value['browserCoverage']
        require(sha((directory / name / coverage['path']).read_bytes()) == coverage['sha256'], 'coverage drift: ' + name)
        return value

    closure = json.loads((directory / 'closure.json').read_bytes())
    require(closure['status'] == 'passed' and closure['gitHead'] == head and closure['task'] == 'E6-T12g6', 'original closure head')
    require(not closure['productionNegotiation'] and not closure['guestExecution'], 'closure exceeded isolated authority')
    require(len(closure['roles']) == 38 and len(closure['originalPackets']) == 536, 'complete client inventory missing')
    require(all(a['held'] for a in closure['assertions']), 'original requirement guard failed')
    require([t['metadata']['id'] for t in closure['uploads']] == [5, 4, 36, 37, 38], 'original upload matrix missing')
    require(sorted({r['metadata']['format'] for r in closure['unavailable']}) == [1, 20, 177], 'supporting unmeasured formats must remain explicit')
    require(all(t['requiredMips'] == t['requiredCubeFaces'] == t['requiredArrayLayers'] == 0 for t in closure['topology']), 'original topology requirements changed')
    for item in closure['inputs']:
        source(item['path'], item['sha256'])
    inline = json.loads((directory / 'runtime/receipt.json').read_bytes())
    require(inline['gitHead'] == head and inline['status'] == 'passed' and inline['task'] == 'E6-T12g5', 'retained affected runtime receipt')
    for item in inline['sources'] + inline['inputs']:
        source(item['path'], item['sha256'])
    for item in inline['records']:
        raw = (directory / 'runtime' / item['path']).read_bytes()
        require(len(raw) == item['bytes'] and sha(raw) == item['sha256'], 'retained runtime recording drift')
    colors = report('runtime/regression/colors', 'E6-T12g2')['browserResult']['result']
    depth = report('runtime/regression/depth', 'E6-T12g3')['browserResult']['result']
    views = report('runtime/regression/views', 'E6-T12g4')['browserResult']['result']
    uploads = report('runtime/hardware', 'E6-T12g5')['browserResult']['result']
    for result in (colors, depth, views, uploads):
        require(result['status'] == 'passed' and all(a['held'] for a in result['assertions']), 'physical role oracle failed')
    require([(r['citation']['event'], r['citation']['byteOffset']) for r in colors['originals']] == [(176, 4104), (5115, 5544), (140, 0)], 'original color packets not executed')
    require(depth['original']['citation']['event'] == 5115 and depth['original']['citation']['byteOffset'] == 5568, 'original Z16 packet not executed')
    require(depth['encodings']['encodings'] == 65536 and depth['literal']['attachment']['bits'] == 16, 'physical depth encoding/occlusion proof absent')
    require(views['original']['viewCitation'] == closure['view']['view']['citation'], 'different view packet executed')
    require(views['original']['samplerCitation'] == closure['view']['sampler']['citation'], 'different sampler packet executed')
    require([(r['workload'], r['metadata']['id'], r['citation'], r['snapshotEvent']) for r in uploads['original']] ==
            [(r['workload'], r['metadata']['id'], r['citation'], r['snapshotEvent']) for r in closure['uploads']], 'different CPU uploads executed')
    for fault, (task, message) in FAULTS.items():
        bad = report('fault-' + fault, task, False)
        require(bad['sabotage']['mode'] == fault and bad['sabotage']['originalSha256'] != bad['sabotage']['servedSha256'], 'fault source unchanged')
        require(sha((directory / ('fault-' + fault) / 'fault-source.mjs').read_bytes()) == bad['sabotage']['servedSha256'], 'actual fault bytes missing')
        require(message in bad['browserResult']['error']['message'], 'fault failed outside independent pixel oracle: ' + fault)
    custody = json.loads((directory / 'custody.log').read_bytes())
    require(custody['status'] == 'passed' and custody['ownedSnapshots'] and not custody['productionDrawAuthority'], 'promoted private compiler custody regression')
    changed = subprocess.check_output(['git', 'diff', '--name-only', BASE, head, '--', 'renderer/virgl-command', 'renderer/virgl-shader'], cwd=ROOT, text=True).splitlines()
    runtime_changed = [name for name in changed if '/tests/' not in name and '/native_tests/' not in name]
    require(not runtime_changed, 'held compiler/resource dependency changed: ' + str(runtime_changed))
    held = []
    for task, suffix, evidence, expected in LEAVES:
        task_name = f'tasks/epic-6-transcendence/{task}-{suffix}.md'
        require('\nstatus: verified\n' in source(task_name).decode(), 'dependency not verified: ' + task)
        folder = ROOT / 'evidence' / evidence / 'worker'
        manifest = json.loads(source(str((folder / 'manifest.json').relative_to(ROOT))))
        archive_name = manifest.get('archive', {}).get('path', 'recording.tar.gz')
        archive = source(str((folder / archive_name).relative_to(ROOT)), expected)
        index = source(str((folder / 'records.json').relative_to(ROOT)))
        records = json.loads(index)
        if isinstance(records, dict):
            records = records['records']
        require(len(records) == manifest['records'], 'held record count: ' + task)
        with tarfile.open(folder / archive_name) as recording:
            members = recording.getmembers()
            require(len(members) == len(records) and all(m.isfile() for m in members), 'held archive members')
            require({m.name for m in members} == {r['path'] for r in records}, 'held record names')
            for item in records:
                raw = recording.extractfile(item['path']).read()
                require(len(raw) == item['bytes'] and sha(raw) == item['sha256'], 'held record digest: ' + item['path'])
            if task == 'E6-T12g6m':
                original = json.load(recording.extractfile('hot/receipt.json'))
                require(original['pixels'] == 1612644 and original['powerSites'] == 29, 'complete original physical proof absent')
                # All numerical original execution and its harness dependencies
                # are unchanged; only the queue/task prose and this new Make target
                # differ from their reviewed source head.
                for name, digest in original['sources'].items():
                    if name != 'Makefile' and not name.startswith('tasks/'):
                        source(name, digest)
        source_head = manifest.get('sourceHead', manifest.get('frozenSourceHead'))
        require(source_head is not None, 'held source head absent: ' + task)
        held.append({'task':task, 'sourceHead':source_head, 'archiveSha256':sha(archive),
                     'indexSha256':sha(index), 'records':len(records)})
    verifier = 'evidence/virgl-original-programs/verifier/manifest.json'
    verdict = json.loads(source(verifier))
    require(verdict['verdict'] == 'verified' and verdict['workerSourceHead'] == BASE, 'fresh complete-original verdict absent')
    source('evidence/virgl-original-programs/verifier/recording.tar.gz', verdict['archiveSha256'])
    source('evidence/virgl-original-programs/verifier/records.json', verdict['recordIndexSha256'])
    for name in ['Makefile','tools/verify-virgl-required-formats.sh',
                 *['tools/virgl-required-formats/' + p.name for p in (ROOT / 'tools/virgl-required-formats').iterdir() if p.suffix in ['.py','.mjs','.md']],
                 'renderer/virgl-shader/tests/original-programs-custody.mjs']:
        source(name)
    files = {str(p.relative_to(directory)):sha(p.read_bytes()) for p in sorted(directory.rglob('*'))
             if p.is_file() and p.name != 'receipt.json' and p != directory / 'acceptance.log'}
    # Nested leaf receipt is essential evidence too (exclude only this receipt).
    files['runtime/receipt.json'] = sha((directory / 'runtime/receipt.json').read_bytes())
    value = {'schema':'virgl-required-format-receipt-v1','task':'E6-T12g6','status':'passed','gitHead':head,
             'guestExecution':False,'productionNegotiation':False,'clientResources':38,'originalPackets':536,
             'requiredFormats':[2,16,64,67,233],'supportingFormatsGated':[1,20,177],
             'originalShaderBodies':closure['shaderBodies'],'held':held,'unchangedRuntimeBase':BASE,
             'physicalFaults':list(FAULTS),'sources':sources,'generated':generated,'files':files}
    (directory / 'receipt.json').write_text(json.dumps(value,indent=2)+'\n')
    print('E6-T12g6: complete original client format/view closure and held six-body GPU proofs passed')


if __name__ == '__main__':
    main()
