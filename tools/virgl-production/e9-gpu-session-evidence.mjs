// E9-T17 evidence-only export at an explicit no-input recorder boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const MAX_BYTES=2**31,CHUNK=1048576;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function createSessionEvidenceArchive(output,head){
 const directory=path.join(output,'retained-session-objects');await fs.mkdir(directory,{recursive:false});await fs.mkdir(path.join(directory,'objects'));
 const source=await fs.readFile(fileURLToPath(import.meta.url));await fs.writeFile(path.join(directory,'executed-collector.mjs'),source);
 const prefix='/__session-evidence/'+randomBytes(24).toString('hex');
 const expected=new Map(),states=new Map(),done=new Map();let origin;
 const report={head,status:'armed',startedAt:new Date().toISOString(),collectorSha256:sha(source),objects:[],
  scope:'Read-only export of committed immutable objects after both points and trusted input complete; no guest pause, new capture, writer, mutation, input or navigation.'};
 const write=()=>fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify(report,null,2)+'\n');await write();
 const receive=async request=>{const parts=[];let size=0;for await(const part of request){size+=part.length;assert.ok(size<=CHUNK,'bounded recorder transfer');parts.push(part);}return Buffer.concat(parts);};
 return {
  prefix,
  async handle(request,response,record,pathname){
   if(!pathname.startsWith(prefix+'/'))return false;
   try{
    assert.ok(request.headers.origin===origin||(request.method==='GET'&&request.headers.origin===undefined&&request.headers.host===new URL(origin).host),'only the original recording origin');
    const route=pathname.slice(prefix.length+1);let result;
    if(route==='index'){
     const refs=JSON.parse((await receive(request)).toString());assert.ok(Array.isArray(refs)&&refs.length<=256);
     for(const ref of refs){assert.match(ref.sha256,/^[a-f0-9]{64}$/);assert.match(ref.length,/^[1-9][0-9]*$/);assert.ok(Number(ref.length)<=MAX_BYTES);
      const old=expected.get(ref.sha256);assert.ok(!old||old.length===ref.length);expected.set(ref.sha256,ref);}
     assert.ok(expected.size<=150000);assert.ok([...expected.values()].reduce((n,r)=>n+Number(r.length),0)<=MAX_BYTES);result={ok:true};
    }else if(route.startsWith('has/')){
     const hash=route.slice(4);assert.ok(expected.has(hash));result={ok:true,complete:done.has(hash)};
    }else{
     const match=route.match(/^blob\/([a-f0-9]{64})\/([0-9]+)$/);assert.ok(match,'indexed recorder route');
     const hash=match[1],offset=Number(match[2]),ref=expected.get(hash);assert.ok(ref&&!done.has(hash));let state=states.get(hash);
     if(!state){assert.equal(offset,0);state={offset:0,hash:createHash('sha256'),file:await fs.open(path.join(directory,'objects',hash+'.partial'),'wx')};states.set(hash,state);}
     assert.equal(offset,state.offset,'sequential original bytes');const bytes=await receive(request);assert.ok(bytes.length>0&&offset+bytes.length<=Number(ref.length));
     await state.file.writeFile(bytes);state.hash.update(bytes);state.offset+=bytes.length;record.uploadBytes=bytes.length;
     if(state.offset===Number(ref.length)){
      assert.equal(state.hash.digest('hex'),hash,'original object digest');await state.file.sync();await state.file.close();
      const filename='objects/'+hash+'.bin';await fs.rename(path.join(directory,'objects',hash+'.partial'),path.join(directory,filename));
      const row={...ref,path:filename};done.set(hash,row);report.objects.push(row);states.delete(hash);
     }
     result={ok:true,offset:state.offset};
    }
    Object.assign(record,{status:200,source:'session-checkpoint-evidence'});response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));return true;
   }catch(error){report.status='failed';report.failure=error.stack;await write();record.status=400;response.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,error:String(error)}));return true;}
  },
  async capture(page,fingerprint,{database='wasm-vm-sessions-v1-e9-gpu-desktop',id='omarchy-gpu-history',checkpointIds=['before-input','after-input']}={}){
   report.status='collecting';origin=new URL(page.url()).origin;report.origin=origin;await write();
   try{
    report.collection=await page.evaluate(collectInPage,{sink:prefix+'/',expected:fingerprint,head,database,id,checkpointIds});
    assert.equal(done.size,expected.size);assert.equal(done.size,report.collection.expectedObjectCount);assert.equal(states.size,0);
    report.status='complete';report.completedAt=new Date().toISOString();await write();
    return {path:'retained-session-objects/receipt.json',sha256:sha(await fs.readFile(path.join(directory,'receipt.json'))),
     status:report.status,manifest:report.collection.manifest,revision:report.collection.revision,objects:done.size,bytes:report.collection.expectedBytes};
   }catch(error){report.status='failed';report.failure=error.stack;await write();throw error;}
  },
  async close(){for(const state of states.values())await state.file.close().catch(()=>{});if(report.status==='armed'){report.status='cancelled-before-capture';await write();}},
 };
}

async function collectInPage({sink,expected,head,database,id,checkpointIds}){
 const need=(v,m)=>{if(!v)throw Error(m);};
 const held=globalThis.__keyboardCapture?.heldCodes?.()??[];need(Array.isArray(held)&&held.length===0,'no held trusted keys at idle boundary');
 const owner=globalThis.wvmDemo?.guestSession?.();
 const {SessionStore,SESSION_DATABASE_VERSION}=await import('/session-store.js');
 const {SessionDiskRoots}=await import('/session-disk-roots.js');
 const {checkpointHash}=await import('/session-checkpoints.js');
 const dbInfo=(await indexedDB.databases()).find(d=>d.name===database);need(dbInfo?.version===SESSION_DATABASE_VERSION,'existing exact database required');
 const db=await new Promise((yes,no)=>{const r=indexedDB.open(database,SESSION_DATABASE_VERSION);r.onupgradeneeded=()=>{r.transaction.abort();no(Error('refuse database creation or upgrade'));};r.onerror=()=>no(r.error);r.onsuccess=()=>yes(r.result);});
 const store=new SessionStore(db);
 const request=async(route,body)=>{const r=await fetch(sink+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});need(r.ok,'collector response');const v=await r.json();need(v.ok,v.error??'collector refused');return v;};
 try{return await store.withReadLease(async()=>{
  const opened=await store.openSession(id);need(opened,'original session present');
  const before={sha256:checkpointHash(opened.manifest),revision:String(opened.revision)};
  need(before.sha256===expected.sha256&&before.revision===expected.revision,'exact original manifest/revision');
  const manifest=JSON.parse(new TextDecoder().decode(opened.manifest));
  need(JSON.stringify(manifest.checkpoints.map(p=>p.id))===JSON.stringify(checkpointIds),'exact original two points');
  const refs=new Map();const add=r=>{const old=refs.get(r.sha256);need(!old||old.length===r.length,'reference length');refs.set(r.sha256,r);};
  const manifestRef={sha256:before.sha256,length:String(opened.manifest.length)};add(manifestRef);
  for(const a of manifest.assets)add(a.content);for(const p of manifest.checkpoints){add(p.machine);add(p.gpu);}
  for(const r of await new SessionDiskRoots(store).liveReferences(manifest.checkpoints.map(p=>p.disk_root)))add(r);
  const list=[...refs.values()];for(let i=0;i<list.length;i+=256)await request('index',new TextEncoder().encode(JSON.stringify(list.slice(i,i+256))));
  let next=0;
  const ordered=list.sort((a,b)=>Number(b.length)-Number(a.length));
  const send=async ref=>{if((await request('has/'+ref.sha256)).complete)return;let offset=0;
   const chunks=ref.sha256===manifestRef.sha256?(async function*(){yield opened.manifest;})():store.stream(ref);
   for await(const chunk of chunks){need(chunk.length<=1048576,'bounded original chunk');await request('blob/'+ref.sha256+'/'+offset,chunk);offset+=chunk.length;}
   need(offset===Number(ref.length),'exact original length');};
  await Promise.all(Array.from({length:8},async()=>{for(;;){const index=next++;if(index>=ordered.length)return;await send(ordered[index]);}}));
  const after=await store.openSession(id);const fingerprint={sha256:checkpointHash(after.manifest),revision:String(after.revision)};
  need(fingerprint.sha256===before.sha256&&fingerprint.revision===before.revision,'read-only collection preserved original bytes/revision');
  need(globalThis.wvmDemo?.guestSession?.()?.key===owner?.key,'original owner unchanged by observer');
  return {head,database,id,origin:location.origin,url:location.href,documentTimeOrigin:performance.timeOrigin,heldKeys:held,owner,
   manifest:manifestRef,revision:before.revision,after:fingerprint,checkpoints:manifest.checkpoints,expectedObjectCount:list.length,
   expectedBytes:list.reduce((n,r)=>n+Number(r.length),0)};
 });}finally{await store.close();}
}
