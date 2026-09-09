// Verifier-owned local portability recording. Never launches browsers or builds web/pkg.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';

const evidence = path.dirname(new URL(import.meta.url).pathname);
const source = '/Users/blamy/Documents/Codex/wasm-vm';
const frozen = 'a53e51a6caf6eb542e4fa2ef4c039f84298a5ec6';
const scratch = mkdtempSync('/private/tmp/e5-t26k-verifier-');
const checkout = path.join(scratch, 'repo'), target = path.join(scratch, 'target');
const removed = Object.keys(process.env).filter(k => k.startsWith('CARGO_') || k.startsWith('E5_') ||
  ['RUSTFLAGS','RUST_LOG','RUSTDOCFLAGS','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER','RUSTC','RUSTDOC','NODE_OPTIONS'].includes(k));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !removed.includes(k)));
assert.equal(existsSync(target), false);
mkdirSync(target);
env.CARGO_TARGET_DIR = target;
env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1';
const record = { frozen, scratch, checkout, target, targetInitiallyAbsent: true, removedKeys: removed,
  effectiveCargoKeys: Object.keys(env).filter(k => k.startsWith('CARGO_')), startedAt: new Date().toISOString(), commands: [] };
const save = () => writeFileSync(path.join(evidence, 'pristine-run.json'), JSON.stringify(record, null, 2)+'\n');
save(); console.log(JSON.stringify({ scratch, checkout, target }));

async function run(label, cmd, args, cwd) {
  const file = path.join(evidence, `pristine-${label}.log`), output = createWriteStream(file, { flags: 'wx' });
  const entry = { label, command: [cmd,...args], cwd, startedAt: new Date().toISOString(), log: path.basename(file) };
  record.commands.push(entry); save();
  output.write(JSON.stringify(entry)+'\n'); console.log(`START ${label}`);
  const child = spawn(cmd,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:true});
  const deadline = Date.parse('2026-09-08T12:04:45Z');
  const timer = setTimeout(() => { entry.deadlineStop = true; try { process.kill(-child.pid,'SIGTERM'); } catch {} }, Math.max(1,deadline-Date.now()));
  child.stdout.on('data', b=>output.write(b)); child.stderr.on('data', b=>output.write(b));
  const result = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  clearTimeout(timer); Object.assign(entry,result,{endedAt:new Date().toISOString()});
  output.write(JSON.stringify(entry)+'\n'); await new Promise(resolve=>output.end(resolve));
  entry.sha256=createHash('sha256').update(readFileSync(file)).digest('hex');save();console.log(`END ${label} ${JSON.stringify(result)}`);
  assert.equal(result.signal,null,label);assert.equal(result.code,0,label);
}

try {
  await run('clone','git',['-c','core.hooksPath=/dev/null','clone','--no-local','--depth','1','--branch','codex/e5-t26k-decoded-cache-capacity',`file://${source}`,checkout],scratch);
  record.actualHead=execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,env,encoding:'utf8'}).trim();
  assert.equal(record.actualHead,frozen);
  record.initialStatus=execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:checkout,env,encoding:'utf8'});
  assert.equal(record.initialStatus,'');save();
  await run('deps','npm',['ci','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix','web'],checkout);
  await run('runtime','make',['verify-E5-T26k-runtime'],checkout);
  await run('wasm','wasm-pack',['test','--node','crates/wasm','--test','decoded_cache_capacity','--test','icount_divider','--test','guest_clock'],checkout);
  record.finalStatus=execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:checkout,env,encoding:'utf8'});
  assert.equal(record.finalStatus,'');record.completed=true;
} catch(error) { record.completed=false;record.error=String(error?.stack||error);process.exitCode=1; }
record.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(record,null,2));
