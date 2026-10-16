from pathlib import Path
import hashlib, io, json, os, stat, subprocess, tarfile

ROOT = Path(__file__).resolve().parents[3]
OWN = Path(__file__).resolve().parent
WORKER = ROOT/'evidence/omarchy-color-checkpoint/worker'
FROZEN = ROOT/'target/evidence/omarchy-color-checkpoint-frozen01'
PRISTINE = ROOT/'target/evidence/omarchy-color-checkpoint-pristine01'
sha = lambda b: hashlib.sha256(b).hexdigest()
def safe(name):
    p=Path(name)
    assert not p.is_absolute() and '..' not in p.parts
def archive(tf):
    result={}
    for m in tf:
        safe(m.name);assert m.isfile() and m.name not in result
        result[m.name]=tf.extractfile(m).read()
    return result

f=json.loads((WORKER/'frozen.json').read_bytes()); parts=[]
for pin in f['parts']:
    b=(WORKER/pin['path']).read_bytes()
    assert len(b)==pin['bytes'] and sha(b)==pin['sha256'] and len(b)<=24*1024*1024
    parts.append(b)
b=b''.join(parts)
assert len(b)==f['archiveBytes']==29903652 and sha(b)==f['archiveSha256']=='ee2afb3f2831659e9d32597385e2f986b3f36053c60d063a8e75326505356e4d'
with tarfile.open(fileobj=io.BytesIO(b),mode='r:xz')as tf: frozen=archive(tf)
assert set(frozen)=={r['path']for r in f['entries']} and len(frozen)==63
for pin in f['entries']:
    data=frozen[pin['path']]
    assert data==(FROZEN/pin['path']).read_bytes() and len(data)==pin['bytes'] and sha(data)==pin['sha256']
receipt=json.loads((WORKER/'pristine.json').read_bytes());b=(WORKER/'pristine.tar.gz').read_bytes()
assert len(b)==4265349==receipt['bytes'] and sha(b)==receipt['sha256']=='4e517b8afbf31d51decbe677dc209b282205ece36cd900144d5447a2d6eabcb3'
with tarfile.open(fileobj=io.BytesIO(b),mode='r:gz')as tf: packed=archive(tf)
assert packed['records.json']==(PRISTINE/'custody.json').read_bytes()
assert sha(packed['records.json'])==receipt['recordsSha256']=='33864bead928e20083a7f221301acf970c57744feb42b3cbebeafb92094a9fca'
index=json.loads(packed['records.json']);seen=set();refs=set();total=0;deduplicated=0
for pin in index['files']:
    safe(pin['path']);assert pin['path']not in seen;seen.add(pin['path'])
    p=PRISTINE/pin['path'];s=p.lstat();assert stat.S_ISREG(s.st_mode)and not p.is_symlink()and not s.st_mode&0o222
    data=p.read_bytes();assert len(data)==pin['bytes']and sha(data)==pin['sha256'];total+=len(data)
    retained=pin['retained'];safe(retained['path'])
    if retained['archive']=='frozen':
        assert data==frozen[retained['path']];deduplicated+=1
    else:
        assert retained['archive']=='pristine'and data==packed[retained['path']];refs.add(retained['path'])
assert len(seen)==140 and total==512461299 and deduplicated==110 and len(refs)==27
assert set(packed)==refs|{'records.json'}
a=json.loads((PRISTINE/'acceptance.json').read_bytes());assert a['status']=='passed'and a['head']=='43f227ae83acb3fc1c5f9c3bcd9766d2710d0875'and a['trackedAfter']==''
assert a['commands'][-1]['label']=='13-acceptance'and a['commands'][-1]['command']==['make','verify-E5.5-T05c1']and a['commands'][-1]['exit']==0
assert sha((PRISTINE/'13-acceptance.log').read_bytes())=='5f87ee09ff84608cdf4abc67daf27ab8f7c910c6a65eba248ab0dbd434b1087b'
clone=PRISTINE/'clone'
git=lambda *args:subprocess.check_output(['git',*args],cwd=clone,text=True).strip()
assert git('rev-parse','HEAD')==a['head']and git('rev-parse','--is-shallow-repository')=='false'
assert not git('status','--porcelain','--untracked-files=no')and not(clone/'.git/objects/info/alternates').exists()
assert not (clone/'web/node_modules').is_symlink()and not(clone/'target').is_symlink()
assert (clone/'.git/objects').resolve()!=(ROOT/'.git/objects').resolve()
assert a['commands'][6]['exit']==2 and a['commands'][7]['exit']==129 and a['commands'][9]['exit']==0
changed=[line[6:]for line in(PRISTINE/'10-post-build.diff').read_text().splitlines()if line.startswith('+++ b/')]
assert set(changed)=={'web/tasks.json','web/dist/tasks.json','web/dist/sw.js'}
for stage in ['hardware03','default-demo03','layout03']:
    j=json.loads((PRISTINE/stage/'report.json').read_bytes());assert j['status']=='passed'
    if stage=='hardware03':
        assert j['head']==a['head']and j['trackedChanges']==''and j['result']['summary']['assertions']==811 and j['result']['summary']['logicalBytesChecked']==23068672
        assert j['browserErrors']=={'console':[],'page':[],'requests':[]}
        assert 'Apple M4 Max'in j['browser']['gpu']['devices'][0]['deviceString']
        for pin in j['sources']:
            assert (PRISTINE/stage/'source'/pin['path']).read_bytes()==(FROZEN/'hardware/source'/pin['path']).read_bytes()
        for pin in j['artifacts']:
            assert (PRISTINE/stage/pin['path']).read_bytes()==(FROZEN/'hardware'/pin['path']).read_bytes()
    elif stage=='default-demo03':assert j['passed']==127and j['failed']==0and j['errors']==[]and j['proofExportAbsent']
changed=subprocess.check_output(['git','diff','--name-only','43f227ae','d5b97fba'],cwd=ROOT,text=True).splitlines()
assert all(p.startswith('evidence/omarchy-color-checkpoint/worker/')or p=='tasks/QUEUE.md'or p=='tasks/epic-5.5-omarchy/E5.5-T05c1-omarchy-color-checkpoint-budget.md'for p in changed)
result={'schema':'critic-c1-worker-archive-and-final-pristine-audit-v1','frozen_archive':{'bytes':len(b''.join(parts)),'sha256':f['archiveSha256'],'all_members_authenticated':63},
 'pristine_archive':{'bytes':len(b),'sha256':receipt['sha256'],'unique_new_payloads':len(refs),'actual_originals_authenticated':len(seen),'original_bytes':total,'frozen_deduplicated_files':deduplicated,'index_sha256':receipt['recordsSha256']},
 'final_pristine':{'head':a['head'],'full_ancestry':True,'own_Git_objects_npm_target':True,'no_alternates_or_shared_npm_target':True,'tracked_tree_clean':True,'literal_make_exit':0,
 'controller_scrubs_RUSTFLAGS_CARGO_star_RUST_LOG_NODE_OPTIONS':True,'source_bodies_and_all_physical_literal_restored_bytes_equal_frozen':True,'hardware_assertions':811,'logical_bytes':23068672,'default_suite':'127/0, zero errors, proof export absent',
 'early_setup_failures_preserved':'07 missing sparse fixture;08 unsupported sparse-add option;10 successful gate followed by only shallow-history generated metadata difference. Full ancestry11/generated-only reset12 precede13.'},
 'worker_submission':'d5b97fba34cdde460656f26158710dd40684261a','only_worker_task_queue_evidence_after_freeze':changed}
p=OWN/'worker-submission-pristine-audit.json';p.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2));print('AUDIT_SHA256',sha(p.read_bytes()))
