#!/usr/bin/env python3
"""Read-only cold clone, environment scrub, and claim-commit identity audit."""
import ast, hashlib, json, re, subprocess, types
from pathlib import Path
ROOT=Path('/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm')
FROZEN='81cd3a4c403176be4b0191fa00ed37f4fd1e1e35'
CLAIM='68186f6edf63a6f3c0e2160892a2bc5b868ab8f8'
OUT=ROOT/'evidence/virgl-constants/verifier/binding-cold-claim-audit.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def check(v,msg):
 if not v:raise AssertionError(msg)
def git(*args,cwd=ROOT):return subprocess.check_output(['git',*args],cwd=cwd)
def read(path):return json.loads(path.read_bytes())
cold_path=ROOT/'evidence/virgl-constants/cold-clone';cold=read(cold_path/'report.json');clone=Path(cold['clone'])
check(sha((cold_path/'report.json').read_bytes())=='66cd6d29faf2546c1c46171f4ef86f4947c3f041482887732538030d3bd1118c','specified cold report digest')
check(cold['gitHead']==cold['cloneHead']==cold['cloneHeadAfter']==FROZEN,'cold exact head')
check(cold['status']=='passed' and cold['exitCode']==0 and cold['statusBefore']==cold['statusAfter']=='','clean cold pass')
check(cold['command']==['make','verify-E6-T12e3b'],'exact acceptance target')
check(git('rev-parse','HEAD',cwd=clone).decode().strip()==FROZEN,'retained clone current head')
check(git('status','--porcelain','--untracked-files=all',cwd=clone).strip()==b'','retained clone currently pristine')
for record in cold['acceptanceFiles']:
 raw=(cold_path/record['path']).read_bytes();check(len(raw)==record['bytes'] and sha(raw)==record['sha256'],'copied cold artifact digest '+record['path'])
 corresponding=clone/'target/evidence/virgl-constants-cold'/Path(record['path']).relative_to('acceptance')
 check(corresponding.read_bytes()==raw,'retained clone artifact bytes '+record['path'])
check(sha((cold_path/'cold.log').read_bytes())==cold['logSha256']=='6fd21e47c64838b559906456e434e204ea9a24a57529aec28ae8e459dd5334be','cold log digest')
check(sha((cold_path/'acceptance/receipt.json').read_bytes())==cold['receiptSha256']=='3a17a70e164e0a43704473efa6e52dbd0a6233ffcfdfaeb045cbdb174ba3589a','cold receipt digest')
source=(clone/'tools/virgl-constants/cold.py').read_bytes();check(sha(source)==cold['harnessSha256'],'frozen harness digest')
check(source==git('show',FROZEN+':tools/virgl-constants/cold.py'),'frozen harness code')
# Adversarially exercise the actual scrub fragment with a fully poisoned inherited
# environment. Extract only the assignments/deletion loop, never invoke cold.main().
tree=ast.parse(source);main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
start=next(i for i,n in enumerate(main.body) if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='env')
end=next(i for i,n in enumerate(main.body) if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='head')
poison_names=['CARGO_TARGET_DIR','CARGO_HOME','CARGO_ENCODED_RUSTFLAGS','RUSTFLAGS','RUST_LOG','RUSTUP_HOME','RUST_TEST_THREADS','VIRGL_CONSTANT_EVIDENCE_DIR','VIRGL_ASYNC_EVIDENCE_DIR','npm_config_cache','NPM_CONFIG_PREFIX','GIT_DIR','EMCC_DEBUG','NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','CHROME','CC','CXX','CFLAGS','CXXFLAGS','CPPFLAGS','LDFLAGS','AR','RANLIB','EMCC','EMSDK','EMSDK_NODE','EMSDK_PYTHON','EM_CONFIG','EM_CACHE','MAKEFLAGS','MFLAGS','MAKEOVERRIDES','BASH_ENV','ENV']
poison={key:'poison' for key in poison_names};poison.update(PATH='/usr/bin:/bin',HOME='/tmp/probe-home')
ns={'os':types.SimpleNamespace(environ=poison)}
exec(compile(ast.Module(body=main.body[start:end],type_ignores=[]),'<frozen cold scrub>','exec'),ns)
check(ns['env']=={'PATH':'/usr/bin:/bin','HOME':'/tmp/probe-home'},'all build toolchain and rust/cargo environment scrubbed')
# Every actual clone checkout/build subprocess receives the same sanitized dictionary.
process_calls=[n for n in ast.walk(main) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id=='subprocess']
check(all(any(k.arg=='env' and isinstance(k.value,ast.Name) and k.value.id=='env' for k in call.keywords) for call in process_calls),'cold subprocesses inherit scrubbed dictionary')
acceptance=read(cold_path/'acceptance/receipt.json')
for item in acceptance['sources']:
 check((clone/item['path']).read_bytes()==git('show',FROZEN+':'+item['path']),'clone exact frozen source '+item['path'])
for path,digest in acceptance['compilerSha256'].items():check(sha((clone/path).read_bytes())==digest,'retained cold compiler binary')
changed=git('diff','--name-only',FROZEN,CLAIM).decode().splitlines()
check(all(p.startswith('evidence/virgl-constants/worker/') or p.startswith('evidence/virgl-constants/cold-clone/') or p in ['tasks/QUEUE.md','tasks/epic-6-transcendence/E6-T12e3b-constant-transport-reflection.md'] for p in changed),'claim commit is evidence/metadata only')
task_path='tasks/epic-6-transcendence/E6-T12e3b-constant-transport-reflection.md';task=git('show',CLAIM+':'+task_path).decode()
check('status: implemented' in task and FROZEN in task,'claim names implemented frozen head')
section=None;claim_digests=[]
for line in task.splitlines():
 if line.startswith('Evidence (`evidence/virgl-constants/worker/`):'):section='worker'
 if line.startswith('Cold clone (`evidence/virgl-constants/cold-clone/`):'):section='cold-clone'
 match=re.fullmatch(r'- `([^`]+)`: `([0-9a-f]{64})`\.',line)
 if match:
  check(section is not None,'known claim path prefix');rel='evidence/virgl-constants/'+section+'/'+match[1];raw=(ROOT/rel).read_bytes()
  check(sha(raw)==match[2],'claim digest matches actual bytes '+rel)
  check(raw==git('show',CLAIM+':'+rel),'claim commit evidence exact bytes '+rel)
  claim_digests.append(rel)
check(len(claim_digests)==13,'all worker + cold cited digests')
worker_audit=read(ROOT/'evidence/virgl-constants/verifier/binding-worker-audit.json');cold_audit=read(ROOT/'evidence/virgl-constants/verifier/binding-cold-acceptance-audit.json')
wframes=next(c['detail']['frames'] for c in worker_audit['checks'] if c['prediction']=='B4');cframes=next(c['detail']['frames'] for c in cold_audit['checks'] if c['prediction']=='B4');check(wframes==cframes,'cold full44 independently reconstructed framebuffers exactly reproduce worker')
result={'status':'passed','prediction':'B5','frozenHead':FROZEN,'claimHead':CLAIM,'coldReportSha256':sha((cold_path/'report.json').read_bytes()),'coldReceiptSha256':cold['receiptSha256'],'coldLogSha256':cold['logSha256'],'coldClone':str(clone),'coldArtifactBindings':len(cold['acceptanceFiles']),'retainedCloneCleanNow':True,'poisonedEnvironmentNamesRejected':poison_names,'subprocessCallsUseSanitizedEnvironment':len(process_calls),'claimedDigestsChecked':claim_digests,'claimOnlyAddsEvidenceAndMetadata':True,'framebuffersReproducedInBothRuns':len(wframes),'coldAcceptanceIndependentAuditSha256':sha((ROOT/'evidence/virgl-constants/verifier/binding-cold-acceptance-audit.json').read_bytes()),'auditSha256':sha(Path(__file__).read_bytes())}
OUT.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'passed','path':str(OUT),'sha256':sha(OUT.read_bytes())}))
