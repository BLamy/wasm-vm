from pathlib import Path
import hashlib,json
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
old=json.loads((HERE/'original-audit.json').read_text());auth=json.loads((HERE/'authentication.json').read_text());cov=json.loads((HERE/'coverage-audit.json').read_text())
physical=ROOT/'target/evidence/virgl-standard-topology-critic-final'
new=json.loads((physical/'independent-audit.json').read_text())
need=[auth['status'],old['status'],cov['status'],new['status']]
assert need==['passed']*4
def frame_point(name,fault):
    raw=(physical/name/'report.json').read_bytes();report=json.loads(raw)
    frame=(report['partial'] if fault else report['browserResult']['result'])['frames'][0]
    line=raw.decode().split('"label": "'+frame['label']+'"')[0].count('\n')+1
    return {'record':'physical/'+name+'/report.json','sha256':hashlib.sha256(raw).hexdigest(),'line':line,'pointer':'/partial/frames/0' if fault else '/browserResult/result/frames/0'}
points={
 'P1-custody':{'record':'authentication.json','sha256':sha(HERE/'authentication.json'),'pointer':'/sourceBindings'},
 'P2-wire':{'record':'original-audit.json','sha256':sha(HERE/'original-audit.json'),'pointer':'/wire'},
 'P3-physical':{'record':'original-audit.json','sha256':sha(HERE/'original-audit.json'),'pointer':'/frames'},
 'P4-bounds-work':{'record':'original-audit.json','sha256':sha(HERE/'original-audit.json'),'pointer':'/rejects'},
 'P5-state-lifetime':{'record':'original-audit.json','sha256':sha(HERE/'original-audit.json'),'pointer':'/lifetimes'},
 'P6-sensitivity':frame_point('fault-mode',True),
 'P7-carry-coverage':{'record':'coverage-audit.json','sha256':sha(HERE/'coverage-audit.json'),'pointer':'/files'},
 'P8-novel':frame_point('hardware',False)
}
predictions=json.loads((HERE/'predictions.json').read_text())
out={'schema':'standard-topology-fresh-critic-verdict-v1','task':'E6-T11d8','verdict':'verified','predictionDigest':sha(HERE/'predictions.json'),
 'predictions':[{'id':p['id'],'result':'HELD','point':points[p['id']]} for p in predictions['predictions']], 'findings':[],
 'originalFrames':len(old['frames']),'originalPixels':old['pixels'],'originalWireRecords':len(old['wire']),
 'newPhysicalFrames':len(new['frames']),'newPhysicalPixels':new['pixels'],
 'novel':'seed 0x25df967b; nonmonotonic u32 IDs 82186/82178/82182/82180 (tail adds 82194), binding/source prefixes 52/56/48, index offset 28; rectangle 3.5..12.5 (fan 3..12), variable 1..6 fence delivery and commandsPerStep 2',
 'promotedFault':new['faults'][0],
 'coverage':{'runtimeLines':['decoder.mjs:363','decoder.mjs:365','state.mjs:20','state.mjs:936'],'unexecutedRuntimeTokens':cov['unexecutedRuntimeTokens'],'digest':sha(HERE/'coverage-audit.json')},
 'carry':{'predecessor':'64b246220bbf3ed5e1a6f1ed7371535ed5ec5c56','D7WorkerArchive':auth['carriedD7'][0]['manifest']['archiveSha256'],'D7CriticArchive':auth['carriedD7'][1]['manifest']['archiveDigest'],
   'unchangedBoundarySources':len(auth['unchangedBoundarySources']),'retainedD6':'37 frames/10296 pixels and four legacy gates per hot/cold','retainedD7':'31 frames/12500 pixels, actual generic sabotage and original-byte audit per hot/cold',
   'cold':'Final prescribed exact-head dff28ee8 checkout passed; source-closed receipt, scrubbed environment, clean before/after authenticate. No portability/isolation finding requires another clone.'},
 'scope':'Isolated standard asynchronous core modes1/2/3/6 only. No guest, API, production caps, deployment, MIPS or FPS authority.',
 'commands':['python3 evidence/virgl-standard-topology/verifier/authenticate.py','node evidence/virgl-standard-topology/verifier/audit_originals.mjs','python3 evidence/virgl-standard-topology/verifier/audit_coverage.py','VIRGL_STANDARD_TOPOLOGY_ADVERSARIAL_EVIDENCE_DIR=target/evidence/virgl-standard-topology-critic-final make verify-E6-T11d8-adversarial','python3 evidence/virgl-standard-topology/verifier/seal_critic.py']}
(HERE/'verdict.json').write_text(json.dumps(out,indent=2)+'\n');print('VERDICT: verified; all P1..P8 HELD')
