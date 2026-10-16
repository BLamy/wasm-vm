#!/usr/bin/env python3
"""Assemble the fresh critic's point-addressable verdict after interrogation."""
from pathlib import Path
import hashlib,json
HERE=Path(__file__).resolve().parent
sha=lambda raw:hashlib.sha256(raw).hexdigest()
pred=json.loads((HERE/'predictions.json').read_text())
def ref(name,line=None,point=None):
 raw=(HERE/name).read_bytes();r=dict(path=name,sha256=sha(raw))
 if line is not None:r.update(line=line,lineSha256=sha(raw.splitlines()[line-1]))
 if point is not None:r['point']=point
 return r
observations={
 'P1':('All17,844 worker record sizes/digests authenticated;1596 hot/cold source pins match freeze. Only worker evidence/task/queue follow freeze. Pristine exact-freeze cold status before/after empty, exit0, scrub rule and log authenticated.',[ref('authentication.json')]),
 'P2':('Original four-byte enums and immutable separate descriptors held. Corrected critic exclusive-end arithmetic: offset0xfffffffb admits;0xfffffffc rejects under the unchanged <=0xffffffff policy. Original mistaken prediction preserved, followed by independently predicted corrected boundary before final proof.',[ref('prediction-correction.json'),ref('narrow-admission.json'),ref('promoted/suite-report.json')]),
 'P3':('Original signed fields[-512,-511,511,-2] remain scaled and become[-1,-1,1,-1] normalized. Signed arrays use original native type33640 unnormalized and actual C helper. Exact alpha words0xc0000000/0xbf800000 and full original pixels hold.',[ref('promoted-hardware-audit.jsonl',91),ref('promoted-hardware-audit.jsonl',92),ref('hot-hardware-audit.jsonl',103),ref('hot-hardware-audit.jsonl',143)]),
 'P4':('Original four-byte packed constants and16-byte float position constants supply disabled Float32Array generic attributes. Shared batches use zero packed masks, exact words and one original source copy per constant; independent final audit checked34 exact source-copy ranges.',[ref('promoted-hardware-audit.jsonl',15),ref('promoted-hardware-audit.jsonl',16),ref('independent-audit.json')]),
 'P5':('Native stride252 exact four-byte end holds at effective offset4194300/end4194304, including stride0; byte-short/misaligned/256/255 layouts reject before draw. Full original storage matched all1288 worker and306 independent buffer records.',[ref('promoted-hardware-audit.jsonl',91),ref('promoted-hardware-audit.jsonl',92),ref('boundary-audit.jsonl'),ref('recording-audit.json'),ref('independent-audit.json')]),
 'P6':('Work6/staging10 admits; work5/staging9 rejects before draw, short staging before any native copy. Both pending phases hold original generations on name reuse and reject stale revision/cancel with completed fences. Disposal releases reads/staging; all recorded native fences retire and jobs drain.',[ref('boundary-audit.jsonl')]),
 'P7':('Actual native/sanitized/Wasm59 literal cases and own13 literal mask cases agree. Four masks enforce16-bit compatible declaration/subset/disjoint boundaries; six fieldwise proxy mutations demonstrate primitive ownership; getters0, peer factory memory isolation and exact16MiB recovery hold. Old entry points have zero packed helpers.',[ref('promoted/compiler/report.json'),ref('boundary-audit.jsonl')]),
 'P8':('Same-source scaled/normalized/constant variants retain complete identities. Novel simultaneous packed attr1+15 normalized subsets yield32770/32768,32770/2,32768/0,0/0; native program reuse holds without eviction and recompiles with eviction.',[ref('promoted-hardware-audit.jsonl',17),ref('promoted-hardware-audit.jsonl',18),ref('boundary-audit.jsonl')]),
 'P9':('Actual poisoned native VAO/pointer/generic/divisor/EBO state restores original full pixels and all pointer/generic/native reflection values across contexts, delays and original storage restoration for three independent seeds.',[ref('promoted-hardware-audit.jsonl',28),ref('promoted-hardware-audit.jsonl',29),ref('promoted-hardware-audit.jsonl',30)]),
 'P10':('All6 worker and3 independently promoted served faults complete native draws/fences and fail original pixels. Promoted normalization error112, constant alpha error132 and signed alpha error128 at x1,y2; signed alpha expected[0,0,0,192],observed[0,0,0,64].', [ref('promoted-fault-native-normalize-audit.jsonl',1),ref('promoted-fault-constant-field-audit.jsonl',1),ref('promoted-fault-shader-sign-audit.jsonl',1),ref('recording-audit.json')]),
 'P11':('All34 files/53 hunks classified.507 full narrow V8 intervals,191 LLVM regions and51 branch records interrogated; no zero production region or missing production direction. Explicit scaffolding/declaration/documentation waivers remain; narrow retained admission and healthy scalar/packed smokes close harness gaps. All8 LLVM exports independently re-created from exact raw counters/binaries.',[ref('coverage-classification.json'),ref('coverage-regions.json'),ref('reexport-coverage.json')]),
 'P12':('All199 historical HELD evidence records retain predecessor/source/dependency digests. No crates/web/guest changes or production/capset/deployment/throughput claim. Freeze-to-submission and later verifier-only changes preserve the actual runtime boundary.',[ref('authentication.json')]),
 'P13':('The promoted independent oracle has no imports and uses original packets/upload bytes/radix field reconstruction/original TGSI, not renderer unpacker or emitted ESSL. Headed M4 Metal has native WebGL2 enabled, no software-renderer flags and zero browser errors; full generated/served/storage/source pins and pristine scrubbed clone authenticated.',[ref('recording-audit.json'),ref('independent-audit.json'),ref('authentication.json'),ref('promoted/hardware/report.json',point='browser,browserErrors,sources,servedFiles')]),
 'P14':('Own three seeds667232977,3074299532,1766686783 complete92 native frames/23,552 pixels,14 pre-draw rejections,9 delayed shared/mixed lifetime attacks and6 simultaneous-mask/cache ownership records. Signed minima/alpha, high15, maxstride/maxoffset and native restoration hold.',[ref('promoted/suite-report.json'),ref('independent-audit.json'),ref('boundary-audit.jsonl')]),
 'P15':('All40 genuine packed failures and40 exact recoveries per hot/cold run hold, both caller sources owned before semantic allocation. Typed48+40 faults and standard669/129 hardware retained; conservative optimized Wasm191856<262144.',[ref('boundary-audit.jsonl'),ref('reexport-coverage.json')])}
rows=[]
for p in pred['predictions']:
 observed,citations=observations[p['id']]
 rows.append(dict(id=p['id'],boundary=p['boundary'],prediction=p['prediction'],status='HELD',observed=observed,citations=citations,
  **({'originalPredictionStatus':'FAILED_CRITIC_ARITHMETIC','correctedPredictionStatus':'HELD','correction':ref('prediction-correction.json')} if p['id']=='P2' else {})))
for name in ['authentication.json','recording-audit.json','independent-audit.json','coverage-classification.json','reexport-coverage.json','promoted/suite-report.json','promoted/compiler/report.json']:
 assert json.loads((HERE/name).read_text())['status']=='passed'
out=dict(schema='standard-packed-fresh-critic-verdict-v1',verdict='verified',task='E6-T11d15',predecessor=pred['predecessor'],submission=pred['submission'],sourceFreeze=pred['sourceFreeze'],
 predictionsSha256=sha((HERE/'predictions.json').read_bytes()),predictions=rows,productRefutations=[],needsEvidence=[],runtimeFixes=False,
 suite=['make verify-E6-T11d15-adversarial','original-byte/TGSI oracle','three independent seeded hardware attacks','literal actual native/Wasm mask attacks','three completed native GPU pixel sabotages'],
 scope='Isolated original packed standard async vertex fetch only. No production graphics completion, guest instruction, API/capset, deployment, portable interior normalized word or throughput certification.',
 environment='Existing exact-freeze scrubbed cold proof independently authenticated once; no unnecessary second pristine clone or unrelated broad gauntlet.')
(HERE/'verdict.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(dict(verdict=out['verdict'],predictions=len(rows),productRefutations=0,needsEvidence=0)))
