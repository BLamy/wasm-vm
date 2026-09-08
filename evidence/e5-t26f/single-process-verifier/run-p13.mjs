// One authorized exact-commit local clone; retain clone/logs, never repair its sources.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const output = path.join(here, 'p13-v1');
mkdirSync(output); // A second invocation refuses before making another clone.
const head = '001e80864911863145f2127192bae5df8186e68b';
const removed = Object.keys(process.env).filter(k => k.startsWith('CARGO') || ['RUSTFLAGS','RUST_LOG'].includes(k));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CARGO') && !['RUSTFLAGS','RUST_LOG'].includes(k)));
env.GIT_TERMINAL_PROMPT = '0';
assert.ok(!Object.keys(env).some(k=>k.startsWith('CARGO')||['RUSTFLAGS','RUST_LOG'].includes(k)));
const root = execFileSync('/usr/bin/mktemp', ['-d', '/private/tmp/e5-t26f-single-process-p13.XXXXXX'], {env,encoding:'utf8'}).trim();
const clone = path.join(root, 'repo');
const result = { acceptance:false, scope:'same-host clean-clone test availability/portability only', head, root, clone,
  environment:{removedNames:removed,requiredAbsent:['RUSTFLAGS','RUST_LOG','CARGO*'],gitTerminalPrompt:'0'}, runs:[] };
const save = (f,b) => writeFileSync(path.join(output,f),b,{flag:'wx'});
save('invocation.json',JSON.stringify(result,null,2)+'\n');
async function run(name,command,args,cwd=repo) {
  console.log(JSON.stringify({name,command,args,cwd}));
  const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',b=>{stdout+=b;process.stdout.write(b);});
  child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});
  const completion=await new Promise(resolve=>{child.once('error',e=>resolve({error:String(e),code:null,signal:null}));child.once('close',(code,signal)=>resolve({code,signal,error:null}));});
  const record={name,command,args,cwd,...completion}; result.runs.push(record);
  save(name+'.stdout',stdout);save(name+'.stderr',stderr);save(name+'.json',JSON.stringify(record,null,2)+'\n');
  assert.equal(completion.error,null);assert.equal(completion.signal,null);assert.equal(completion.code,0,name);
  return stdout;
}
try {
  await run('01-clone','git',['-c','core.hooksPath=/dev/null','clone','--no-local','--no-checkout',repo,clone]);
  await run('02-checkout','git',['-c','core.hooksPath=/dev/null','checkout','--detach',head],clone);
  assert.equal((await run('03-head','git',['rev-parse','HEAD'],clone)).trim(),head);
  assert.equal((await run('04-clean-before','git',['status','--porcelain'],clone)).trim(),'');
  assert.equal(existsSync(path.join(clone,'.git/objects/info/alternates')),false);
  await run('05-observer-gate','make',['verify-E5-T26f-single-process-observer'],clone);
  await run('06-collector-tests','node',['--test','tools/verify/e5-t26f-discovery-observation.test.mjs','tools/verify/e5-t26f-compile-queue-observation.test.mjs'],clone);
  await run('07-clean-after','git',['status','--porcelain'],clone);
  await run('08-tracked-diff','git',['diff','--exit-code'],clone);
  result.held=true;
} catch(error) {result.failure=String(error);result.stack=error.stack;process.exitCode=1;}
save('result.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({held:result.held??false,failure:result.failure??null,clone,head}));
