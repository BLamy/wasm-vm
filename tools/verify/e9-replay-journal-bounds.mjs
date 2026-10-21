#!/usr/bin/env node
// Exercise exact receipt ownership and ordering through the built browser module.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const web=path.join(root,'web/dist');
const output=path.resolve(process.argv[process.argv.indexOf('--output')+1]);
await fs.mkdir(output,{recursive:true});
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm'};
const report={task:'E9-T14',status:'running',checks:[],errors:[]};
let server,browser,context;
try{
 server=createServer(async(req,res)=>{
  try{
   const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   if(name==='/favicon.ico'){res.writeHead(204).end();return;}
   const release=name.startsWith('/releases/');
   const file=release?path.resolve(root,'.'+name):path.resolve(web,'.'+name);
   if(release?!file.startsWith(path.join(root,'releases')+path.sep):!file.startsWith(web+path.sep))throw Error('path');
   const bytes=await fs.readFile(file);
   res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream',
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
    'Cache-Control':'no-store'}).end(bytes);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({serviceWorkers:'block'});
 const page=await context.newPage();
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__ready===true,null,{timeout:60000});
 report.checks=await page.evaluate(async()=>{
  const {SessionInputJournal}=await import('./session-inputs.js');
  const {openNetworkProvider}=await import('./session-network.js');
  const begin={transition:'0',retired:'0',phase:'before',ordinal:0,sequence:'0'};
  const manifest={end:begin,policy:{mode:'exact-replay',required_inputs:['uart']}};
  const journal=()=>new SessionInputJournal({},structuredClone(manifest));
  const receipt=()=>({channel:1,transition:'0',retired:'0',phase:'before',ordinal:1,sequence:'1',
   outcome:['0','1','0','0'],bytes:new Uint8Array([120]),ticket:'1'});
  const cases=[
   ['channel',r=>r.channel=22,'unsupported input channel'],
   ['numeric-coordinate',r=>r.transition=0,'exact input position required'],
   ['noncanonical-coordinate',r=>r.transition='00','exact input position required'],
   ['ordinal',r=>r.ordinal=0,'exact input position required'],
   ['retired',r=>r.retired='1','input prefix order'],
   ['sequence',r=>r.sequence='2','input prefix order'],
   ['phase',r=>r.phase='observe','exact input position required'],
   ['outcome',r=>r.outcome=['5','1','0','0'],'input outcome'],
   ['bytes-type',r=>r.bytes=[120],'owned input bytes'],
   ['bytes-bound',r=>r.bytes=new Uint8Array(1048577),'owned input bytes'],
   ['ticket-missing',r=>delete r.ticket,'exact event ticket required'],
   ['ticket-overflow',r=>r.ticket='18446744073709551616','exact event ticket'],
   ['source-not-owned',r=>{r.channel=17;r.phase='observe';r.outcome=['0','1','8','0'];r.bytes=new Uint8Array(8);},'source adapter is absent from this prefix'],
  ];
  const checks=[];
  let released=0,providerError='';
  try{openNetworkProvider({networkSessionReplay:()=>false,
   leaseNetworkRequest:()=>({free:()=>{released++;}})},()=>{throw Error('provider failed');});}
  catch(error){providerError=String(error);}
  if(!providerError.includes('provider failed')||released!==1)throw Error('provider factory did not release its lease');
  checks.push({name:'network-provider-factory',error:providerError,released});
  const accepted=journal();accepted.stage([receipt()]);
  if(accepted.pending!==1)throw Error('valid exact receipt did not stage');
  checks.push({name:'valid-exact-receipt',pending:1});
  for(const [name,mutate,expected] of cases){
   const current=journal(),value=receipt();mutate(value);
   let message='';try{current.stage([value]);}catch(error){message=String(error);}
   if(!message.includes(expected)||current.pending!==0)throw Error(`${name}: ${message}; pending=${current.pending}`);
   checks.push({name,error:message});
  }
  const tooMany=journal();let message='';
  try{tooMany.stage(Array.from({length:257},()=>receipt()));}catch(error){message=String(error);}
  if(!message.includes('input receipt bound')||tooMany.pending!==0)throw Error('receipt-count bound failed: '+message);
  checks.push({name:'receipt-count-bound',error:message});
  const tooLarge=journal();message='';
  try{tooLarge.stage(Array.from({length:5},(_,index)=>({...receipt(),ordinal:index+1,
   sequence:String(index+1),ticket:String(index+1),bytes:new Uint8Array(1048576)})));}
  catch(error){message=String(error);}
  if(!message.includes('input payload budget')||tooLarge.pending!==0)throw Error('aggregate-byte bound failed: '+message);
  checks.push({name:'aggregate-byte-bound',error:message});
  const reordered=journal();message='';
  try{reordered.stage([receipt(),{...receipt(),ordinal:2,sequence:'3',ticket:'3'}]);}
  catch(error){message=String(error);}
  if(!message.includes('input prefix order')||reordered.pending!==0)throw Error('atomic order refusal failed: '+message);
  checks.push({name:'atomic-order-refusal',error:message});
  const encoder=new TextEncoder();
  const persisted=()=>({version:{major:1,minor:0},kind:'uart',required:true,
   ...begin,ordinal:1,sequence:'1',device:'uart16550',
   intent:[...encoder.encode(JSON.stringify({version:1,channel:1,outcome:['0','1','0','0'],ticket:'1'}))],
   status:'applied',payload:{storage:'inline',bytes:[120]}});
  const stored=(records,mutation=()=>{})=>{
   const bytes=encoder.encode(JSON.stringify(records));
   const saved={...structuredClone(manifest),begin,end:{...begin,sequence:String(records.length)},
    events:[{content:{sha256:'0'.repeat(64),length:String(bytes.length)}}],extensions:[]};
   mutation(saved);
   return {openSession:async()=>({manifest:encoder.encode(JSON.stringify(saved))}),
    stream:async function*(){yield bytes;}};
  };
  const durableCases=[
   ['unpublished',null,'input prefix unavailable'],
   ['short-object',stored([persisted()],m=>m.events[0].content.length='999'), 'object length'],
   ['extra-record',stored([persisted(),persisted()]),'input prefix order'],
   ['wrong-status',stored([{...persisted(),status:'failed'}]),'input adapter identity'],
   ['wrong-version',stored([{...persisted(),intent:[...encoder.encode(JSON.stringify({version:2,channel:1,outcome:['0','1','0','0'],ticket:'1'}))]}]),'input adapter version'],
  ];
  for(const [name,store,expected] of durableCases){
   let error='';try{await SessionInputJournal.read(store??{openSession:async()=>null},'recorded',{exactMode:true});}
   catch(value){error=String(value);}
   if(!error.includes(expected))throw Error(`journal ${name}: ${error}`);
   checks.push({name:'journal-'+name,error});
  }
  for(const [name,mutation,expected] of [
   ['missing-witnesses',()=>{},'exact state witnesses unavailable'],
   ['wrong-witness-end',m=>m.extensions.push({kind:'e9-exact-state-witnesses-v1',required:false,
    bytes:[...encoder.encode(JSON.stringify([{...begin,digest:Array(32).fill(0)},
     {...begin,transition:'1',retired:'1',digest:Array(32).fill(0)}]))]}),'exact state witness endpoints'],
  ]){
   const store=stored([],mutation);let error='';
   try{await SessionInputJournal.readExact(store,'recorded');}catch(value){error=String(value);}
   if(!error.includes(expected))throw Error(`journal ${name}: ${error}`);
   checks.push({name:'journal-'+name,error});
  }
  const exactWitness={...begin,digest:Array(32).fill(0)};
  const frameStore=frame=>{
   const saved={...structuredClone(manifest),begin,end:begin,events:[],
    checkpoints:[{machine:{sha256:'0'.repeat(64),length:String(frame.length)}}],
    extensions:[{kind:'e9-exact-state-witnesses-v1',required:false,
     bytes:[...encoder.encode(JSON.stringify([exactWitness,exactWitness]))]}]};
   return {openSession:async()=>({manifest:encoder.encode(JSON.stringify(saved))}),
    stream:async function*(){yield frame;}};
  };
  const frame=new Uint8Array(112),view=new DataView(frame.buffer);
  frame.set(encoder.encode('WVEXACT1'));view.setUint32(8,1,true);view.setBigUint64(12,84n,true);
  for(const [name,bytes,expected] of [
   ['checkpoint-magic',new Uint8Array(frame.length),'exact checkpoint magic'],
   ['checkpoint-bounds',(()=>{const value=frame.slice();new DataView(value.buffer).setUint32(20,1,true);return value;})(),'exact checkpoint bounds']
  ]){
   let error='';try{await SessionInputJournal.readExact(frameStore(bytes),'recorded');}
   catch(value){error=String(value);}
   if(!error.includes(expected))throw Error(`${name}: ${error}`);
   checks.push({name,error});
  }
  const {WasmLinux}=await import('./pkg/wasm_vm_wasm.js');
  const artifacts=await (await fetch('./artifacts.json')).json();
  const kernel=new Uint8Array(await (await fetch(artifacts.artifacts.kernel.url)).arrayBuffer());
  const imageManifest=await (await fetch('./session-alpine-image.json')).text();
  const make=replay=>WasmLinux.newExactSession(kernel,imageManifest,
   'root=/dev/vda rw console=ttyS0 earlycon=sbi init=/bin/sh -- +i',()=>{},replay);
  const original=make(false),replay=make(true);
  try{
   const initial=original.exactSessionWitness(true),before=[...replay.exactSessionWitness(false).digest].join(',');
   const row=()=>({kind:'host',transition:'0',retired:'0',phase:'before',ordinal:1,sequence:'1',
    ticket:'1',channel:2,bytes:new Uint8Array([120]),outcome:['0','1','0','0']});
   const admission=(events=[row()],witnesses=[initial],end=initial)=>replay.beginExactReplay(initial.resume,events,witnesses,end);
   const malformed=[
    ['phase',r=>r.phase='after','exact replay phase'],
    ['decimal',r=>r.transition=0,'exact replay decimal'],
    ['noncanonical-decimal',r=>r.ticket='01','decimal'],
    ['ordinal',r=>r.ordinal=NaN,'exact replay integer'],
    ['kind',r=>r.kind='unknown','exact replay event kind'],
    ['channel',r=>r.channel=65536,'exact replay integer'],
    ['byte-type',r=>r.bytes=[120],'exact replay owned bytes'],
    ['byte-limit',r=>r.bytes=new Uint8Array(1048577),'exact replay byte limit'],
    ['outcome',r=>r.outcome=['0'],'exact replay outcome'],
    ['ram-address',r=>{r.kind='ram';r.address='01';},'decimal'],
    ['pending-type',r=>{r.kind='pending';r.pending='true';},'exact replay pending'],
    ['observation-kind',r=>{r.kind='observation';r.sourceKind=0;},'exact replay source kind'],
    ['missing-kind',r=>delete r.kind,'exact replay kind'],
    ['missing-channel',r=>delete r.channel,'exact replay integer'],
    ['missing-outcome',r=>delete r.outcome,'exact replay outcome'],
    ['outcome-value',r=>r.outcome[2]=2,'exact replay outcome'],
    ['ram-bytes',r=>{r.kind='ram';r.address='0';delete r.bytes;},'exact replay owned bytes'],
    ['pending-missing',r=>{r.kind='pending';delete r.pending;},'exact replay pending'],
    ['observation-requested',r=>{r.kind='observation';r.phase='observe';r.sourceKind=1;delete r.requested;},'exact replay integer'],
    ['observation-status',r=>{r.kind='observation';r.phase='observe';r.sourceKind=1;r.requested=8;delete r.status;},'exact replay integer'],
    ['observation-bytes',r=>{r.kind='observation';r.phase='observe';r.sourceKind=1;r.requested=8;r.status=0;r.bytes=[1];},'exact replay owned bytes'],
    ['outcome-overflow',r=>r.outcome[0]='18446744073709551616','unsigned counter exceeds u64'],
   ];
   for(const [name,mutate,expected] of malformed){
    const candidate=row();mutate(candidate);let error='';
    try{admission([candidate]);}catch(value){error=String(value);}
    if(!error.includes(expected))throw Error(`ABI ${name}: ${error}`);
    const after=[...replay.exactSessionWitness(false).digest].join(',');
    if(after!==before)throw Error(`ABI ${name} mutated the guest before admission`);
    checks.push({name:'abi-'+name,error});
   }
   const trapped=new Proxy(row(),{get(target,key){if(key==='phase')throw Error('trap');return Reflect.get(target,key);}});
   let trappedError='';try{admission([trapped]);}catch(value){trappedError=String(value);}
   if(!trappedError.includes('exact replay field')||[...replay.exactSessionWitness(false).digest].join(',')!==before)
    throw Error('ABI Reflect refusal failed: '+trappedError);
   checks.push({name:'abi-reflect-get',error:trappedError});
   for(const [name,events,witnesses,end,expected] of [
    ['event-count',new Array(4097).fill(row()),[initial],initial,'exact replay plan limit'],
    ['witness-count',[],[],initial,'exact replay plan limit'],
    ['witness-digest',[],[{...initial,digest:new Uint8Array(31)}],initial,'exact replay'],
    ['end-phase',[],[initial],{...initial,phase:'after'},'exact replay phase'],
   ]){
    let error='';try{admission(events,witnesses,end);}catch(value){error=String(value);}
    if(!error.includes(expected))throw Error(`ABI ${name}: ${error}`);
    if([...replay.exactSessionWitness(false).digest].join(',')!==before)throw Error(`ABI ${name} mutated the guest`);
    checks.push({name:'abi-'+name,error});
   }
   admission([],[initial],initial);
   const done=replay.runExactReplayToEnd(1);
   if(done.status!=='Completed'||done.transition!=='0')throw Error('valid replay refused after malformed admissions');
   checks.push({name:'abi-valid-after-refusals',status:done.status});
   const complete=[...replay.exactSessionWitness(false).digest].join(',');
   let stopped='';try{replay.runExactReplayToEnd(1);}catch(value){stopped=String(value);}
   if(!stopped.includes('Exhausted')||[...replay.exactSessionWitness(false).digest].join(',')!==complete)
    throw Error('completed replay reentry changed state: '+stopped);
   checks.push({name:'abi-completed-reentry',error:stopped});
   let restart='';try{admission([],[initial],initial);}catch(value){restart=String(value);}
   if(!restart.includes('fresh, empty host queues')||[...replay.exactSessionWitness(false).digest].join(',')!==complete)
    throw Error('re-admission after completion changed state: '+restart);
   checks.push({name:'abi-completed-readmission',error:restart});
  }finally{original.free();replay.free();}
  return checks;
 });
 assert.equal(report.checks.length,57);
 assert.deepEqual(report.errors,[]);
 report.status='passed';
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 await context?.close();await browser?.close();
 if(server)await new Promise(resolve=>server.close(resolve));
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,errors:report.errors,failure:report.failure}));
}
