// Verifier-only scratch command recorder; records the child's real exit, including expected sabotage failures.
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [label,command,...args]=process.argv.slice(2);
const evidence=path.dirname(new URL(import.meta.url).pathname);
const base=JSON.parse(readFileSync(path.join(evidence,'pristine-run.json')));
if(!base.completed)throw Error('pristine proof must finish before scratch mutations');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('CARGO_')&&!k.startsWith('E5_')&&
  !['RUSTFLAGS','RUST_LOG','RUSTDOCFLAGS','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER','RUSTC','RUSTDOC','NODE_OPTIONS'].includes(k)));
env.CARGO_TARGET_DIR=base.target;
const cwd=path.join(base.scratch,'attack-repo'),file=path.join(evidence,`${label}.log`);
const output=createWriteStream(file,{flags:'wx'});
const record={command:[command,...args],cwd,target:env.CARGO_TARGET_DIR,startedAt:new Date().toISOString()};
output.write(JSON.stringify(record)+'\n');
const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:true});
const timer=setTimeout(()=>{record.deadlineStop=true;try{process.kill(-child.pid,'SIGTERM')}catch{}},Math.max(1,Date.parse('2026-09-08T12:04:45Z')-Date.now()));
child.stdout.on('data',b=>output.write(b));child.stderr.on('data',b=>output.write(b));
Object.assign(record,await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}))}));
clearTimeout(timer);record.endedAt=new Date().toISOString();
output.write(JSON.stringify(record)+'\n');await new Promise(resolve=>output.end(resolve));
record.sha256=createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(path.join(evidence,`${label}.json`),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(record));process.exitCode=record.code??1;
