from pathlib import Path, PurePosixPath
import gzip, hashlib, json, subprocess, tarfile

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
WORKER = OUT.parent / 'worker'
FROZEN = 'ef30bcccb02f006a72da6c4796134b9c780a828d'
RUNTIME = '31e4b3ff907d36f54689513796927acc16b5fd62'
PREVIOUS = 'bef7040804a1c71ad37112e35adcfebefbc4be21'
sha = lambda b: hashlib.sha256(b).hexdigest()
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)
def need(value, reason):
    if not value: raise AssertionError(reason)
def read_json(p): return json.loads(p.read_bytes())

predictions = read_json(OUT / 'predictions.json')
need(predictions['writtenBeforeOpeningEvidence'], 'predictions were not written first')
need(git('rev-parse', 'HEAD').decode().strip() == predictions['submissionHead'], 'submission drift')
manifest = read_json(WORKER / 'manifest.json')
index_bytes = (WORKER / 'records.json').read_bytes()
archive_bytes = (WORKER / 'recording.tar.gz').read_bytes()
need(sha(index_bytes) == manifest['recordIndexSha256'] == '3508f8a5acec1ed9ee54ed54e3ab886f37d9ee4083fd3ad3b8c08f74fa4ce779', 'record index')
need(sha(archive_bytes) == manifest['archiveSha256'] == 'bc713cc04fc443130c36a98abcd87586d4df52fad6ff2ffea16416b7ed618764', 'archive')
index = json.loads(index_bytes)
need(index['sourceHead'] == manifest['sourceHead'] == FROZEN, 'actual source closure')
rows = index['records']; wanted = {row['path']: row for row in rows}
need(len(wanted) == len(rows) == manifest['records'] == 6862, 'unique record count')
need(len(archive_bytes) == manifest['archiveBytes'] == 14118238, 'archive length')
unpacked = OUT / 'unpacked'; unpacked.mkdir(exist_ok=True)
with tarfile.open(WORKER / 'recording.tar.gz') as tar:
    members = tar.getmembers()
    need(len(members) == len(wanted), 'archive count')
    need(len(set(m.name for m in members)) == len(members), 'duplicate archive record')
    need({m.name for m in members} == set(wanted), 'archive closure')
    for m in members:
        p = PurePosixPath(m.name)
        need(m.isfile() and not p.is_absolute() and '..' not in p.parts, 'unsafe member')
        raw = tar.extractfile(m).read(); row = wanted[m.name]
        need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], m.name + ' authentication')
        dest = unpacked / m.name; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(raw)

delta = git('diff', '--name-only', RUNTIME, FROZEN).decode().splitlines()
need(delta == ['tools/virgl-command/standard-restart-receipt.py'], 'source-equivalence scope')
need(not git('diff', '--name-only', FROZEN, 'HEAD', '--', 'renderer', 'tools', 'Makefile').strip(), 'submission modifies recorded source')
receipts = {}
source_count = generated_count = file_count = 0
for prefix in ['hot', 'cold']:
    receipt = read_json(unpacked / prefix / 'receipt.json'); receipts[prefix] = receipt
    need(receipt['gitHead'] == FROZEN and receipt['status'] == 'passed', prefix + ' final receipt')
    physical = RUNTIME if prefix == 'hot' else FROZEN
    need(receipt['physicalSourceHead'] == physical, prefix + ' truthful physical head')
    for name, digest in receipt['files'].items():
        row = wanted[prefix + '/' + name]; need(row['sha256'] == digest, 'receipt record digest ' + name); file_count += 1
    for name, digest in receipt['sources'].items():
        need(sha(git('show', FROZEN + ':' + name)) == digest, 'receipt final frozen source ' + name)
        if name != 'tools/virgl-command/standard-restart-receipt.py':
            need(sha(git('show', RUNTIME + ':' + name)) == digest, 'exact hot physical source ' + name)
        need(sha((ROOT / name).read_bytes()) == digest, 'current source ' + name); source_count += 1
    for name, digest in receipt['generated'].items():
        need(wanted[prefix + '-generated/' + name]['sha256'] == digest, 'generated custody ' + name); generated_count += 1
    log = (unpacked / prefix / 'acceptance.log').read_text()
    need('STANDARD_RESTART_RECORDING_COMPLETE' in log, prefix + ' completed physical block')
    need(('KeyError: \'bytes\'' in log) == (prefix == 'hot'), prefix + ' actual original receipt result')
    for name in ['hardware', 'fault-restart', 'retained-constant/hardware', 'retained-constant/fault-generic', 'retained-topology/hardware', 'retained-topology/fault-mode']:
        report = read_json(unpacked / prefix / name / 'report.json')
        need(report['gitHead'] == physical, prefix + '/' + name + ' report head')
        need(report['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}, 'fixed memory')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
        browser = report['browser']; need(not browser['headless'], 'headed')
        need(browser['gpu']['featureStatus'].get('webgl2', browser['gpu']['featureStatus'].get('webgl')) == 'enabled', 'native WebGL')
        need(not any(any(w in arg.lower() for w in ['swiftshader','llvmpipe','softpipe','lavapipe','--disable-gpu']) for arg in browser['commandLine']), 'GPU software flag')
        served = {r['path']: r['sha256'] for r in report['servedFiles']}
        for row in report['sources']:
            n = row['path']; actual = receipt['generated'].get(n, receipt['sources'].get(n))
            need(actual == row['sha256'], 'report source closure ' + n)
            if '/' + n in served:
                expected = report['mutation']['servedSha256'] if report.get('mutation', {}).get('path') == n else actual
                need(expected == served['/' + n], 'actual served source ' + n)
        for key in ['screenshot', 'browserCoverage']:
            r = report[key]; need(wanted[prefix+'/'+name+'/'+r['path']]['sha256'] == r['sha256'], 'browser custody')
        coverage = read_json(unpacked/prefix/name/report['browserCoverage']['path'])
        for script in coverage['scripts']: need(script['sha256'] == served['/'+script['source']], 'executed source digest')
        result = report.get('partial') if report['status'] == 'failed' else report['browserResult']['result']
        for blob in result['blobs']:
            b = (unpacked/prefix/name/blob['path']).read_bytes(); raw = gzip.decompress(b)
            need(sha(b) == blob['gzipSha256'] and sha(raw) == blob['sha256'] and len(raw) == blob['bytes'], 'decompressed blob ' + name + '/' + blob['path'])
        if report.get('mutation'):
            mutation = report['mutation']; original = git('show', physical + ':' + mutation['path'])
            altered = (unpacked/prefix/name/'mutation-source.mjs').read_bytes()
            need(sha(original) == mutation['originalSha256'] and sha(altered) == mutation['servedSha256'], 'sabotage digest')
            need(original.count(mutation['needle'].encode()) == 1 and original.replace(mutation['needle'].encode(), mutation['replacement'].encode()) == altered, 'actual served single mutation')

cold = read_json(unpacked/'cold/report.json')
need(cold['cloneHead'] == cold['gitHead'] == FROZEN and cold['exitCode'] == 0 and cold['status'] == 'passed', 'pristine exact head')
need(cold['statusBefore'] == cold['statusAfter'] == '', 'pristine status')
need(cold['command'] == ['make', 'verify-E6-T11d9'], 'prescribed cold command')
need(sha((unpacked/'cold/receipt.json').read_bytes()) == cold['receiptSha256'] == manifest['coldReceiptSha256'], 'cold receipt identity')
need(sha((unpacked/'cold/cold.log').read_bytes()) == cold['logSha256'], 'cold log identity')
need(sha((unpacked/'hot/receipt.json').read_bytes()) == manifest['hotReceiptSha256'], 'hot receipt identity')
need(sha((unpacked/'cold/report.json').read_bytes()) == manifest['coldReportSha256'], 'cold report identity')
historical = {}
for facet in ['draw','constant','topology']:
    for part in ['worker','verifier']:
        folder = ROOT / ('evidence/virgl-standard-'+facet) / part
        names = [folder/'manifest.json', folder/'records.json', folder/'recording.tar.gz']
        for p in names:
            name = p.relative_to(ROOT).as_posix(); raw = p.read_bytes()
            need(raw == git('show', PREVIOUS + ':' + name), 'unchanged earlier HELD record ' + name)
            need(receipts['hot']['carriedVerifiedEvidence'][name] == sha(raw), 'receipt carry digest'); historical[name] = sha(raw)
        old_manifest = read_json(names[0]); old_index = read_json(names[1]); old_archive = names[2].read_bytes()
        need(sha(names[1].read_bytes()) == old_manifest.get('recordIndexSha256', old_manifest.get('recordIndexDigest'))
             and sha(old_archive) == old_manifest.get('archiveSha256', old_manifest.get('archiveDigest')), 'historical seal')
        old_records = {r['path']: r for r in old_index['records']}
        with tarfile.open(names[2]) as tar:
            ms = tar.getmembers(); need(len(ms) == len(old_records) and {m.name for m in ms} == set(old_records), 'historical record closure')
            for m in ms:
                raw = tar.extractfile(m).read(); r = old_records[m.name]
                need(sha(raw) == r['sha256'] and len(raw) == r['bytes'], 'historical record digest')
boundary = git('ls-files','renderer/virgl-shader','renderer/virgl-command/resources.mjs','renderer/virgl-command/cache.mjs','renderer/virgl-command/constant-domain.mjs').decode().splitlines()
for name in boundary: need(git('show', PREVIOUS+':'+name) == git('show', FROZEN+':'+name), 'unchanged boundary ' + name)
result = {'schema':'standard-restart-fresh-authentication-v1','status':'passed','records':len(rows),'archiveSha256':sha(archive_bytes),'indexSha256':sha(index_bytes),'sourcesAuthenticated':source_count,'generatedAuthenticated':generated_count,'receiptFilesAuthenticated':file_count,'sourceEquivalentDelta':delta,'actualHotFullMake':'failed only in original receipt KeyError: bytes','actualHotPhysicalHead':RUNTIME,'actualFinalColdHead':FROZEN,'coldReport':cold,'carriedHistorical':historical,'unchangedBoundaryFiles':len(boundary),'predictionsSha256':sha((OUT/'predictions.json').read_bytes())}
(OUT/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['status','records','sourcesAuthenticated','generatedAuthenticated','receiptFilesAuthenticated','unchangedBoundaryFiles','actualHotFullMake']}))
