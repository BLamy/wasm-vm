#!/usr/bin/env python3
"""Seal the completed independent review; no implementation or status writes."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json

out=Path(__file__).resolve().parent;repo=out.parents[2]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
read=lambda name:json.loads((out/name).read_text())
assert sha(out/'predictions.md')=='36478d0700a25f2909eccd87e4c146922df8ac3c8fe63fdd3b0182e6fc547f11'
submission=read('submission-inspection.json');cold=read('cold-inspection.json')
physical=read('physical-inspection.json');fidelity=read('physical-fidelity.json')
public=read('public-inspection.json');profile=read('profile-inspection.json')
ci=read('ci-inspection.json');sabotage=read('sabotage.json')
frozen=read('frozen-inspection.json');views=read('visual-inspection.json')
assert submission['passed'] and submission['frozenSourceClosureUnchanged']
assert len(submission['files'])==83
assert cold['passed'] and cold['testCounts']==[1,1,3,5,2,6]
assert cold['hotColdCriticLinesIdentical']==33
assert public['passed'] and len(public['artifacts'])==12
assert all(row['status']==200 and row['sha256']==row['expectedSha256'] for row in public['artifacts'])
assert physical['outcome']=='nonce-readback-failed' and not physical['desktopAccepted']
assert physical['trustedPhysicalEvents']==128 and physical['matchedKeyboardRPCs']==256
assert physical['completedReads']==11 and physical['pendingReads']==0 and not physical['nonceVerified']
assert physical['noPostVerdictGuestInput'] and physical['cleanupElapsedMs']==10138
assert fidelity['passed'] and fidelity['frames']==[2,2]
assert profile['profileSha256']==physical['capture']['sha256']
assert len(profile['nonCustomSections'])==11 and profile['summary']['samples']==19792
assert profile['summary']['totalUs']==30011697 and profile['profileSpanUs']==30012977
assert len(views['images'])==9 and all(row['personallyViewed'] for row in views['images'])
for row in views['images']:assert sha(repo/row['path'])==row['sha256']
assert ci['exitCode']==2 and ci['broadCiPassed'] is False
assert ci['sameFailedTargets'] and ci['noNewCompilerError']
assert sabotage['mutant_exit']==101 and sabotage['restored_exit']==0
assert frozen['independentNativeRuntimeMatchesFrozen'] and frozen['sabotageWitnessAndAssertionUnchanged']
worker_index=repo/'evidence/omarchy-profile/fmadd-single-r1/sha256.txt'
assert sha(worker_index)==submission['indexSha256']
receipts=['predictions.md','oracle-review.md','goldens.json','native-first.json','sabotage.json',
          'frozen-inspection.json','page-inspection.json','task-manifest-inspection.json',
          'production-inspection.json','cold-production-inspection.json','cold-inspection.json',
          'public-inspection.json','ci-inspection.json','physical-inspection.json',
          'physical-fidelity.json','profile-inspection.json','visual-inspection.json',
          'submission-inspection.json','coverage.md','final-verdict.md','task-entry.md']
result={'verdict':'verified','task':'E5.5-T03an','critic':'/root/fmadd_single_verifier',
        'sealedAt':datetime.now(timezone.utc).isoformat(),
        'submissionCommit':submission['submissionCommit'],
        'sourceHead':submission['sourceHead'],'artifactAndColdHead':submission['artifactAndColdHead'],
        'wasmSha256':submission['runtimeWasmSha256'],
        'workerIndexSha256':submission['indexSha256'],'workerFilesChecked':83,
        'predictions':{f'P{i}':'HELD' for i in range(1,11)},
        'scope':'FMADD.S correctness and the required recorded physical trial only',
        'desktopResponsive':False,'releaseQRemainsGated':True,'broadCiPassed':False,
        'physicalReportSha256':physical['reportSha256'],
        'physicalOutcome':physical['outcome'],'cleanup':physical['cleanup'],
        'cleanupElapsedMs':physical['cleanupElapsedMs'],
        'limitations':['One negative physical trial does not establish a speedup.',
                       'The post-verdict CPU profile is diagnostic only.',
                       'Inherited broad CI failures remain explicitly recorded.'],
        'receiptDigests':{name:sha(out/name) for name in receipts},
        'promotedTestDigests':{name:sha(repo/name) for name in [
          'tests/support/jit_fp_fmadd_verifier.rs',
          'crates/jit-runtime/tests/fp_fmadd_verifier.rs',
          'crates/wasm/tests/jit_fp_fmadd_verifier.rs']}}
(out/'final-audit.json').write_text(json.dumps(result,indent=2)+'\n')
paths=[p for p in sorted(out.rglob('*')) if p.is_file() and p.name!='sha256.txt' and '__pycache__' not in p.parts]
entries=[(sha(p),str(p.relative_to(repo))) for p in paths]
index=out/'sha256.txt'
index.write_text(''.join(digest+'  '+name+'\n' for digest,name in entries))
assert all(sha(repo/name)==digest for digest,name in entries)
print(json.dumps({'verdict':'verified','desktopResponsive':False,'files':len(entries),
                  'indexSha256':sha(index),'finalAuditSha256':sha(out/'final-audit.json')},indent=2))
