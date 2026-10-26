#!/usr/bin/env node
// Independently resolve the complete exported GPU session object graph.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import initSession,{sessionValidateManifest,sessionValidateLocalManifest,sessionLocalManifestReferences,
  sessionValidateDiskRoot,sessionDiskRootReferences,sessionLocalEventReferences} from '../../web/session-pkg/wasm_vm_session.js';
import {decodeKeyframeDescriptor,isKeyframeDescriptorPrefix} from '../../web/session-keyframes.js';
const at=process.argv.indexOf('--directory');assert(at>0&&process.argv[at+1]);
const development=process.argv.includes('--allow-incomplete'),prefix=process.argv.includes('--prefix'),out=path.resolve(process.argv[at+1]);
assert(!(development&&prefix),'prefix closure requires a finished graph');
const proof=path.join(out,'retained-closure'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(proof,{recursive:false});
const report={task:prefix?'E9-T22r':'E9-T22c',scope:'Exported session graph and ordered-object digest oracle; no timing claim',
  development,status:'running',sourceSha256:sha(await fs.readFile(new URL(import.meta.url))),roots:0,
  eventChunks:0,descriptorFrames:0,ramChunks:0,witnessPages:0,objects:0,chunks:0,references:0};
try{
  const browserBytes=await fs.readFile(path.join(out,'report.json')),browser=JSON.parse(browserBytes);
  report.browserSha256=sha(browserBytes);
  if(!development)assert(prefix?['cold-prefix-frame','cold-prefix-frontier'].includes(browser.status)
    :browser.status==='desktop-full-workload-replay-passed','finished browser recording');
  const seal=browser.executedSources?.find(row=>row.path==='tools/verify/e9-workload-retained-closure.mjs');
  if(!development)assert.equal(seal?.sha256,report.sourceSha256,'executed graph oracle source');
  const sessionWasm=await fs.readFile(new URL('../../web/session-pkg/wasm_vm_session_bg.wasm',import.meta.url));
  await initSession({module_or_path:sessionWasm});report.sessionWasmSha256=sha(sessionWasm);
  const saved=JSON.parse(await fs.readFile(path.join(out,'saved/storage.json'))),chunks=new Map(saved.stores.chunks.map(row=>[row.key,row])),
    objects=new Map(saved.stores.objects.map(row=>[row.key,row.value]));
  assert.equal(chunks.size,saved.stores.chunks.length);assert.equal(objects.size,saved.stores.objects.length);
  for(const [key,row]of chunks){const bytes=await fs.readFile(path.join(out,'saved/chunks',key+'.bin'));
    assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),key);}
  report.chunks=chunks.size;
  async function object(ref,{materialize=false}={}){
    assert(ref&&/^[a-f0-9]{64}$/.test(ref.sha256),'object reference hash');
    const descriptor=objects.get(ref.sha256);assert(descriptor,'missing object '+ref.sha256);
    assert.equal(String(descriptor.length),String(ref.length));assert.equal(descriptor.sha256,ref.sha256);
    const hash=createHash('sha256'),pieces=[];let length=0;
    for(const part of descriptor.parts){assert(chunks.has(part.sha256),'missing physical part '+part.sha256);
      const bytes=await fs.readFile(path.join(out,'saved/chunks',part.sha256+'.bin'));
      assert.equal(bytes.length,Number(part.length));hash.update(bytes);length+=bytes.length;
      if(materialize)pieces.push(bytes);}
    assert.equal(length,Number(ref.length));assert.equal(hash.digest('hex'),ref.sha256);
    return materialize?Buffer.concat(pieces,length):null;
  }
  for(const [key,value]of objects)await object({sha256:key,length:value.length});
  report.objects=objects.size;
  const session=saved.stores.sessions.find(row=>row.key===(browser.result?.sessionId??(development?saved.stores.sessions[0]?.key:null)));
  assert(session,'exported named session');const manifestBytes=Buffer.from(session.value.manifest);
  assert.deepEqual(Buffer.from(sessionValidateLocalManifest(manifestBytes)),manifestBytes,'canonical exported local manifest');
  if(!development&&!prefix){
    assert.throws(()=>sessionValidateManifest(manifestBytes),/TooLarge\("session payload"\)/,
      'complete local history must remain outside portable bundle admission');
    report.portableAdmission='rejected-above-4-GiB';
  }
  if(!development)assert.equal(sha(manifestBytes),browser.result?.authenticatedHistory?.manifestSha256,'live/export manifest identity');
  const manifest=JSON.parse(manifestBytes),references=new Map();
  const add=ref=>{assert(ref&&/^[a-f0-9]{64}$/.test(ref.sha256));const value=objects.get(ref.sha256);
    assert(value,'missing reachable object '+ref.sha256);assert.equal(String(value.length),String(ref.length));
    references.set(ref.sha256,ref);};
  const fromHash=hash=>{const value=objects.get(hash);assert(value,'missing bare-hash object '+hash);
    return {sha256:hash,length:String(value.length)};};
  const direct=JSON.parse(Buffer.from(sessionLocalManifestReferences(manifestBytes)).toString());
  for(const ref of direct.blobs)add(ref);
  for(const hash of direct.roots){const ref=fromHash(hash);add(ref);
    const bytes=await object(ref,{materialize:true});
    assert.deepEqual(Buffer.from(sessionValidateDiskRoot(bytes)),bytes,'canonical disk root');
    assert.equal(JSON.parse(bytes).base,manifest.machine.base_image);
    for(const child of JSON.parse(Buffer.from(sessionDiskRootReferences(bytes)).toString()))add(child);
    report.roots++;}
  for(const event of manifest.events){add(event.content);const bytes=await object(event.content,{materialize:true});
    for(const ref of JSON.parse(Buffer.from(sessionLocalEventReferences(manifestBytes,bytes)).toString()))add(ref);
    report.eventChunks++;}
  for(const point of manifest.checkpoints){add(point.machine);if(point.gpu)add(point.gpu);
    const descriptor=objects.get(point.machine.sha256),first=descriptor.parts[0];assert(first);
    const prefix=(await fs.readFile(path.join(out,'saved/chunks',first.sha256+'.bin'))).subarray(0,8);
    if(!isKeyframeDescriptorPrefix(new Uint8Array(prefix)))continue;
    const delta=decodeKeyframeDescriptor(new Uint8Array(await object(point.machine,{materialize:true})));
    add(delta.parent);add(delta.frame);report.descriptorFrames++;
    for(const chunk of delta.chunks){add(chunk);report.ramChunks++;}}
  const ext=manifest.extensions.find(value=>value.kind==='e9-exact-witness-pages-v2');assert(ext?.required);
  const commitment=JSON.parse(Buffer.from(ext.bytes).toString());
  if(!development)assert.equal(commitment.finished,true);
  let cursor=commitment.tail,remaining=commitment.count;const positions=new Set();
  while(cursor){add(cursor);const page=JSON.parse((await object(cursor,{materialize:true})).toString());
    assert.equal(page.before+page.rows.length,remaining);
    for(const row of page.rows)positions.add(JSON.stringify([row.transition,row.phase,row.ordinal,row.sequence,row.retired]));
    remaining=page.before;cursor=page.previous;report.witnessPages++;assert(report.witnessPages<=4096);}
  assert.equal(remaining,0);assert.equal(report.witnessPages,commitment.pages);
  for(const point of manifest.checkpoints)assert(positions.has(JSON.stringify([point.position.transition,point.position.phase,
    point.position.ordinal,point.position.sequence,point.position.retired])),'checkpoint witness membership');
  report.references=references.size;report.status='retained-closure-passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.sourceUnchanged=sha(await fs.readFile(new URL(import.meta.url)))===report.sourceSha256;
  if(!report.sourceUnchanged){report.status='failed';process.exitCode=1;}
  await fs.writeFile(path.join(proof,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,objects:report.objects,references:report.references,error:report.error}));
