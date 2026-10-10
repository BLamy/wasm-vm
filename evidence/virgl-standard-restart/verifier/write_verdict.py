from pathlib import Path
import hashlib, json, re, subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()
def record(name):
    raw=(OUT/name).read_bytes(); return {'path':name,'sha256':sha(raw)}, json.loads(raw)
auth_ref, auth=record('authentication.json')
hot_ref, hot=record('hot-physical-audit.json')
cold_ref, cold=record('cold-physical-audit.json')
bounds_ref, bounds=record('boundary-audit.json')
coverage_ref, coverage=record('coverage-audit.json')
carry_ref, carry=record('carry-forward.json')
fresh_ref, fresh=record('final-promoted/fresh-physical-audit.json')
for row in [auth,hot,cold,bounds,coverage,carry,fresh]:assert row['status']=='passed'
assert not coverage['semanticCoverageGaps']
source_points=[]
def point(name,label):
    p=OUT/name; raw=p.read_bytes(); text=raw.decode(); report=json.loads(raw)
    # Locate the actual original JSON frame, rather than a repeated history label.
    pattern=re.compile(r'"label": '+re.escape(json.dumps(label))+r',\n\s+"width":')
    match=pattern.search(text)
    if match is None:
        match=re.search(r'"label": '+re.escape(json.dumps(label)),text)
    assert match is not None,(name,label)
    row={'path':name,'line':text.count('\n',0,match.start())+1,'sha256':sha(raw),'label':label}; source_points.append(row); return row
points={name:point('unpacked/hot/hardware/report.json',label)for name,label in [
    ('custom','mode-2-custom-0'),('wide','mode-2-wide-custom-0'),('disabledByte','mode-2-byte-maximum-0'),
    ('disabledShort','mode-2-short-maximum-0'),('outOfType','mode-2-out-of-type-0'),('empty','all-custom-empty'),
    ('exact','scratch-exact-64'),('oneShort','scratch-minus-one'),('collected','pending-collected-index'),
    ('reuse','pending-reuse'),('nativeUpload','native-upload-fails'),('ownedCancel','owned-cancel-finishing'),('dispose','owned-dispose')]}
points['fresh']=point('final-promoted/hardware/report.json','critic-mode-2-wide-custom-per-fence')
points['freshEmptyBounds']=point('final-promoted/hardware/report.json','critic-all-restart-budget-65536')
points['fault']=point('final-promoted/fault-restart/report.json','critic-mode-2-wide-custom-per-fence')
(OUT/'citations.json').write_text(json.dumps({'schema':'standard-restart-point-citations-v1','points':points},indent=2)+'\n')
predictions=json.loads((OUT/'predictions.json').read_bytes())
evidence={
 'P0':[auth_ref,carry_ref], 'P1':[hot_ref,cold_ref,fresh_ref], 'P2':[hot_ref,cold_ref,fresh_ref],
 'P3':[hot_ref,cold_ref,fresh_ref], 'P4':[bounds_ref,hot_ref,cold_ref,fresh_ref],
 'P5':[bounds_ref], 'P6':[bounds_ref,hot_ref,cold_ref,fresh_ref], 'P7':[coverage_ref,bounds_ref],
 'P8':[fresh_ref,bounds_ref], 'P9':[fresh_ref,bounds_ref],
}
verdict={
 'schema':'standard-restart-fresh-verdict-v1','task':'E6-T11d9','verdict':'verified',
 'workerSubmission':'13e0f7b26276cc1dd20bd3c67b82d463d07e4df0',
 'runtimeHead':'31e4b3ff907d36f54689513796927acc16b5fd62',
 'finalWorkerSourceClosure':'ef30bcccb02f006a72da6c4796134b9c780a828d',
 'verifiedPredecessor':'bef7040804a1c71ad37112e35adcfebefbc4be21',
 'authority':'isolated-standard-primitive-restart','guestExecution':False,'productionNegotiation':False,
 'fullGuestApiClaim':False,'provokingStateQualified':False,
 'predictions':[dict(p,result='HELD',evidence=evidence[p['id']])for p in predictions['predictions']],
 'runtimeHunks':len(coverage['hunks']), 'runtimeAddedLines':sum(f['addedLines']for f in coverage['files']),
 'executedRuntimeLines':sum(f['executedLines']for f in coverage['files']),
 'structuralCommentLines':sum(f['waivedLines']for f in coverage['files']), 'semanticCoverageGaps':0,
 'workerRecordsAuthenticated':auth['records'],'originalFramesChecked':len(hot['frames'])+len(cold['frames']),
 'originalPixelsChecked':hot['pixels']+cold['pixels'],'originalNativeDrawsChecked':hot['nativeDraws']+cold['nativeDraws'],
 'originalNormalizedBuffersChecked':hot['normalizedBuffers']+cold['normalizedBuffers'],
 'freshFrames':len(fresh['frames']),'freshPixels':fresh['pixels'],'freshNativeDraws':fresh['nativeDraws'],
 'freshNormalizedBuffers':fresh['normalizedBuffers'],'freshLaterTaskYieldPoints':bounds['freshActualYieldPoints'],
 'requiredOracleRegression':'Actual served wrong marker mapping completes the native draw and real final fence, retains original marker in GPU bytes, and fails the promoted independent full-pixel oracle. First mismatch at(0,3): clear expected, [58,53,41,128] observed.',
 'priorAttempt':'The preserved initial sensitivity attempt used an out-of-storage marker and hit the native WebGL range guard before pixel comparison. It is not counted as the required oracle proof; the seed-derived in-storage marker reaches the required completed draw/fence and independent pixel failure.',
 'honestOriginalHotOutcome':'The original hot full make failed only at receipt KeyError: bytes. Runtime/browser/offline gates passed at their actual31e4 head, the receipt correction alone is source-equivalent, and the final pristine ef30 clone passed the complete corrected make. The earlier full invocation is never relabeled passed.',
 'suite':['renderer/virgl-command/tests/standard-primitive-restart-adversarial.mjs','tools/virgl-command/standard-restart-adversarial-oracle.mjs','tools/virgl-command/standard-restart-adversarial-pixels.mjs','tools/verify-virgl-standard-restart-adversarial.sh','make verify-E6-T11d9-adversarial'],
 'commands':['python3 evidence/virgl-standard-restart/verifier/authenticate.py',
   'node tools/virgl-command/standard-restart-adversarial-pixels.mjs evidence/virgl-standard-restart/verifier/unpacked/hot evidence/virgl-standard-restart/verifier/hot-physical-audit.json',
   'node tools/virgl-command/standard-restart-adversarial-pixels.mjs evidence/virgl-standard-restart/verifier/unpacked/cold evidence/virgl-standard-restart/verifier/cold-physical-audit.json',
   'VIRGL_STANDARD_RESTART_ADVERSARIAL_EVIDENCE_DIR=evidence/virgl-standard-restart/verifier/final-promoted make verify-E6-T11d9-adversarial',
   'python3 evidence/virgl-standard-restart/verifier/boundary_audit.py','python3 evidence/virgl-standard-restart/verifier/coverage_audit.py'],
 'nonRuntimeDiffCoverage':[
   {'paths':['renderer/virgl-command/tests/standard-instanced-draws.mjs'],'classification':'executed','reason':'Direct retained D6 hot/cold hardware runs exercise renewed legal-maximum one-byte-short source negatives; original historical records stay unchanged.'},
   {'paths':['renderer/virgl-command/tests/standard-primitive-restart.mjs','tools/virgl-command/standard-restart-oracle.mjs'],'classification':'executed','reason':'Hot/cold headed native frames, positive and rejection/failure/lifetime branches, and the recorded pixel regression run through these harnesses; source/coverage and physical bytes authenticate.'},
   {'paths':['tools/verify-virgl-standard-restart.mjs','tools/verify-virgl-standard-restart.sh','tools/virgl-command/standard-restart-pixels.mjs','tools/virgl-command/standard-restart-receipt.py','tools/virgl-command/standard-restart-cold.py','tools/virgl-command/standard-restart-seal.py','Makefile'],'classification':'executed','reason':'Exact local logs and final pristine clone run the actual gate, compiler build, records parser, archive sealer and Node/GPU/offline paths. Receipt-only carry and forced-createBuffer-null correction execute in hot/cold records. Unclaimed tool I/O error reporting is waived.'},
   {'paths':['renderer/virgl-command/draw-README.md','tasks/QUEUE.md','tasks/epic-6-transcendence/E6-T11d9-standard-primitive-restart.md','tasks/epic-6-transcendence/E6-T11d-truthful-guest-virgl-bringup.md'],'classification':'waived','reason':'Documentation/task metadata/dependency changes do not execute runtime behavior; no production negotiation or demo import changes.'},
   {'paths':['evidence/virgl-standard-restart/worker','evidence/virgl-production-readiness/standard-restart-gap.json'],'classification':'waived','reason':'Evidence/declarative historical negative fixture carries no runtime authority. Full worker archive custody is authenticated; the historical restart-gap artifact stays scoped to its pre-D9 source.'}
 ],
 'findings':[], 'carry':carry_ref,
 'scopeExclusions':['per-vertex flat provoking convention','complete GLES/API','production capsets/import','actual guest rendering','demo deployment','MIPS/FPS']}
(OUT/'verdict.json').write_text(json.dumps(verdict,indent=2)+'\n')
print(json.dumps({'verdict':verdict['verdict'],'runtimeHunks':verdict['runtimeHunks'],'executedRuntimeLines':verdict['executedRuntimeLines'],'freshFrames':verdict['freshFrames'],'freshPixels':verdict['freshPixels'],'verdictSha256':sha((OUT/'verdict.json').read_bytes())}))
