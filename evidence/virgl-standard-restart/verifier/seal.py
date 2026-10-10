from pathlib import Path
import gzip, hashlib, io, json, tarfile, subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()
verdict = json.loads((OUT/'verdict.json').read_bytes())
assert verdict['verdict']=='verified' and verdict['semanticCoverageGaps']==0
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==verdict['workerSubmission']
for n in ['decoder','state']:
    name='renderer/virgl-command/'+n+'.mjs'
    assert (ROOT/name).read_bytes()==subprocess.check_output(['git','show',verdict['runtimeHead']+':'+name],cwd=ROOT)
members={}; snapshots={}
def add(name,raw):
    if name in members: assert members[name]==raw
    members[name]=raw
initial=(OUT/'initial-harness.mjs').read_bytes()
def snapshot(name,digest):
    raw=(ROOT/name).read_bytes()
    if sha(raw)!=digest:
        assert name=='renderer/virgl-command/tests/standard-primitive-restart-adversarial.mjs' and sha(initial)==digest
        raw=initial
    assert sha(raw)==digest
    key='sources/'+digest+'/'+name; add(key,raw); snapshots.setdefault(name,{})[digest]=key

for directory in [OUT/'final-promoted',OUT/'independent/initial-fault-native-range']:
    for p in directory.rglob('*'):
        if p.is_file():add(p.relative_to(OUT).as_posix(),p.read_bytes())
    for p in directory.rglob('report.json'):
        report=json.loads(p.read_bytes())
        assert report['gitHead']==verdict['workerSubmission']
        served={r['path']:r['sha256']for r in report['servedFiles']}
        for row in report['sources']:
            snapshot(row['path'],row['sha256'])
            if '/'+row['path']in served:
                expected=report['mutation']['servedSha256']if report.get('mutation',{}).get('path')==row['path']else row['sha256']
                assert served['/'+row['path']]==expected
        for row in (report.get('partial')if report['status']=='failed'else report['browserResult']['result'])['blobs']:
            packed=(p.parent/row['path']).read_bytes(); raw=gzip.decompress(packed)
            assert sha(packed)==row['gzipSha256']and sha(raw)==row['sha256']and len(raw)==row['bytes']
        if report.get('mutation'):
            altered=(p.parent/'mutation-source.mjs').read_bytes(); m=report['mutation']; before=(ROOT/m['path']).read_bytes()
            assert sha(before)==m['originalSha256']and sha(altered)==m['servedSha256']
            assert before.count(m['needle'].encode())==1 and before.replace(m['needle'].encode(),m['replacement'].encode())==altered

for p in OUT.iterdir():
    if p.is_file() and p.name not in ['manifest.json','records.json','recording.tar.gz']:add(p.name,p.read_bytes())
for name in verdict['suite']:
    if name.startswith('make '):continue
    raw=(ROOT/name).read_bytes(); snapshot(name,sha(raw))
snapshot('Makefile',sha((ROOT/'Makefile').read_bytes()))
sources={'schema':'standard-restart-fresh-source-custody-v1','physicalReportsHead':verdict['workerSubmission'],
         'runtimeHead':verdict['runtimeHead'],'sourceSnapshots':snapshots,
         'sourceEquivalence':'Fresh physical reports retain their actual13e0 submission head. Source snapshots include the exact newly promoted harness/oracle bytes used by each report. Runtime decoder/state and unchanged compiler/resource closure authenticate independently; no report is relabeled to the later metadata/test commit.'}
add('source-custody.json',(json.dumps(sources,indent=2)+'\n').encode())
records={'schema':'standard-restart-fresh-records-v1','task':'E6-T11d9','workerSubmission':verdict['workerSubmission'],
         'records':[{'path':n,'bytes':len(raw),'sha256':sha(raw)}for n,raw in sorted(members.items())]}
index=(json.dumps(records,indent=2)+'\n').encode();(OUT/'records.json').write_bytes(index)
archive=io.BytesIO()
with gzip.GzipFile(fileobj=archive,mode='wb',mtime=0)as gz:
    with tarfile.open(fileobj=gz,mode='w')as tar:
        for n,raw in sorted(members.items()):
            info=tarfile.TarInfo(n);info.size=len(raw);info.mode=0o644;info.mtime=0;tar.addfile(info,io.BytesIO(raw))
packed=archive.getvalue();(OUT/'recording.tar.gz').write_bytes(packed)
manifest={'schema':'standard-restart-fresh-seal-v1','task':'E6-T11d9','verdict':'verified',
          'workerSubmission':verdict['workerSubmission'],'runtimeSourceHead':verdict['runtimeHead'],'finalWorkerSourceClosure':verdict['finalWorkerSourceClosure'],
          'workerArchiveSha256':'bc713cc04fc443130c36a98abcd87586d4df52fad6ff2ffea16416b7ed618764',
          'workerRecordIndexSha256':'3508f8a5acec1ed9ee54ed54e3ab886f37d9ee4083fd3ad3b8c08f74fa4ce779',
          'records':len(members),'archiveBytes':len(packed),'archiveSha256':sha(packed),'recordIndexSha256':sha(index),
          'verdictSha256':sha((OUT/'verdict.json').read_bytes()),'predictionsSha256':sha((OUT/'predictions.json').read_bytes()),
          'coverageAuditSha256':sha((OUT/'coverage-audit.json').read_bytes()),'boundaryAuditSha256':sha((OUT/'boundary-audit.json').read_bytes()),
          'physicalFrames':verdict['freshFrames'],'checkedPhysicalPixels':verdict['freshPixels'],'nativeDraws':verdict['freshNativeDraws'],
          'normalizedBuffers':verdict['freshNormalizedBuffers'],'originalFramesChecked':verdict['originalFramesChecked'],'originalPixelsChecked':verdict['originalPixelsChecked'],
          'runtimeHunks':verdict['runtimeHunks'],'executedRuntimeLines':verdict['executedRuntimeLines'],'structuralCommentLines':verdict['structuralCommentLines'],
          'semanticCoverageGaps':0,'authority':'isolated-standard-primitive-restart','guestExecution':False,'productionNegotiation':False,'provokingStateQualified':False}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
# Re-open every sealed member immediately, independent of in-memory packing.
with tarfile.open(OUT/'recording.tar.gz')as tar:
    ms=tar.getmembers();expected={r['path']:r for r in records['records']};assert len(ms)==len(expected)
    assert len({m.name for m in ms})==len(ms)and {m.name for m in ms}==set(expected)
    for m in ms:
        raw=tar.extractfile(m).read();r=expected[m.name];assert sha(raw)==r['sha256']and len(raw)==r['bytes']
print(json.dumps(manifest))
