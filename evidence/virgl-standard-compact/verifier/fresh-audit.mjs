import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {criticModel,criticCompare,criticFormat} from '../../../tools/virgl-command/standard-compact-adversarial-oracle.mjs';
const here=path.dirname(new URL(import.meta.url).pathname),repo=path.resolve(here,'../../..'),hash=x=>createHash('sha256').update(x).digest('hex'),read=async p=>JSON.parse(await fs.readFile(p)),same=assert.deepEqual;
const head='4fd889f2',fullHead=execFileSync('git',['rev-parse',head],{cwd:repo,encoding:'utf8'}).trim(),pins=(await read(path.join(repo,'evidence/virgl-standard-points/verifier/manifest.json'))).sources;
const out={schema:'standard-compact-fresh-critic-audit-v1',sourceHead:fullHead,seed:0x6b82d1f3,frames:[],faults:[],files:{},sources:{},status:'running'};
for(const name of ['final-gpu','final-sabotage-native','final-sabotage-constant']){
 const dir=path.join(here,name),report=await read(path.join(dir,'report.json')),fault=name!=='final-gpu';
 same(report.gitHead,fullHead);same(report.status,fault?'failed':'passed');same(report.browserErrors,{console:[],page:[],requests:[]});same(report.fixedMemory,{bytes:16777216,stageExport:'function',pairExport:'function'});
 assert.ok(!report.browser.headless);assert.ok((report.browser.gpu.featureStatus.webgl2??report.browser.gpu.featureStatus.webgl)==='enabled');assert.ok(!report.browser.commandLine.some(a=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu/i.test(a)));
 same(hash(await fs.readFile(report.browser.executable)),report.browser.sha256);
 const served=new Map(report.servedFiles.map(s=>[s.path,s])),coverage=await read(path.join(dir,'browser-coverage.json'));
 for(const s of report.sources){const bytes=s.path.includes('/build/wasm/')?await fs.readFile(path.join(repo,s.path)):execFileSync('git',['show',fullHead+':'+s.path],{cwd:repo});same(hash(bytes),s.sha256);same(bytes.length,s.bytes);out.sources[s.path]=s.sha256;
  if(s.path.includes('/build/wasm/'))same(hash(bytes),pins[s.path]);
  let expected=s.sha256;if(report.mutation?.path===s.path){const m=report.mutation;same(bytes.toString().split(m.needle).length,2);const changed=Buffer.from(bytes.toString().replace(m.needle,m.replacement));same(hash(changed),m.servedSha256);same(changed,await fs.readFile(path.join(dir,'mutation-source.mjs')));expected=m.servedSha256;}
  if(served.has('/'+s.path))same(served.get('/'+s.path).sha256,expected);
 }
 for(const s of coverage.scripts)same(s.sha256,served.get('/'+s.source).sha256);
 const result=report.partial??report.browserResult.result;assert.equal(result.seed,out.seed);const blobs=new Map(result.blobs.map(b=>[b.key,b]));
 const raw=async ref=>{const b=blobs.get(ref.key),packed=await fs.readFile(path.join(dir,b.path)),data=new Uint8Array(gunzipSync(packed));same(hash(packed),b.gzipSha256);same(hash(data),b.sha256);same(ref.sha256,b.sha256);same(data.length,b.bytes);return data;};
 for(const row of result.wire){const b=Buffer.from(row.hex,'hex'),format=b.readUInt32LE(20),offset=b.readUInt32LE(8),divisor=b.readUInt32LE(12);let spec;try{spec=criticFormat(format);}catch{}const expected=Boolean(spec)&&offset+spec.bytes*spec.components<=0xffffffff,legacy=Boolean(spec)&&format>=28&&format<=31&&divisor===0&&offset%4===0&&expected;same(row.standard.ok,expected);same(row.legacy.ok,legacy);}
 for(const [i,f]of result.frames.entries()){
  const inputs=new Map(),gpu=new Map();for(const b of f.native.buffers){gpu.set(b.resourceId,await raw(b.blob));inputs.set(b.resourceId,new Uint8Array(b.blob.bytes));}
  for(const r of f.inputs){same(r.direction,'upload');same(r.layout.rowCount,1);const b=await raw(r.blob);same(b.length,r.layout.rowBytes);inputs.get(r.resource.id).set(b,r.layout.offset);}
  for(const [id,b]of gpu)same(b,inputs.get(id),'fresh original full GPU storage');
  const predicted=criticModel(f.history,inputs,f.range),pixels=await raw(f.pixels),audit=criticCompare(pixels,predicted,f.width,f.height),draw=f.history.at(-1).result.draws.at(-1);
  same(f.history.at(-1).result.gpuComplete,true);same(f.native.calls.length,1);same(audit.held,!fault);same(audit,f.audit);
  const state=f.native.state[0];for(const fetch of predicted.fetches){const actual=draw.vertexFetches.find(g=>g.attributeIndex===fetch.attributeIndex),a=state.attributes.find(a=>a.name==='in_'+fetch.attributeIndex),source=f.native.buffers.find(b=>b.resourceId===fetch.resourceId);same(actual.resourceGeneration,source.generation);
   for(const key of ['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])same(actual[key],fetch[key]);
   if(!fault){same([a.enabled,a.integer,a.divisor],[!fetch.constant,false,fetch.nativeDivisor]);if(fetch.constant)same(actual.componentWords,fetch.componentWords);else same([a.buffer,a.type,a.normalized,a.components,a.stride,a.offset],[source.nativeBuffer,fetch.nativeType,fetch.normalized,fetch.components,fetch.stride,fetch.offset]);}
   else if(name==='final-sabotage-native'&&fetch.attributeIndex===1)same(a.normalized,false);
   else if(name==='final-sabotage-constant'&&fetch.attributeIndex===1){assert.notDeepEqual(actual.componentWords,fetch.componentWords);same(a.genericWords.slice(0,fetch.components),actual.componentWords);}
  }
  const r={name,index:i,label:f.label,pixelsSha256:hash(pixels),originalWireSha256:hash(Buffer.from(f.history.map(h=>h.hex).join(''),'hex')),nativeSources:f.native.buffers,fetches:predicted.fetches,...audit};(fault?out.faults:out.frames).push(r);
 }
 if(fault){same(result.frames.length,1);assert.ok(report.browserResult.error.message.includes('critic original TGSI pixels'));same(result.status,'running');}
 else {same(result.frames.length,44);same(result.wire.length,297);same(result.rejections.length,5);same(result.suspensions.length,3);same(result.ownership.length,1);
  for(const r of result.runs)for(const k of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])same(r.inspection.jobs[k],0);
  for(const s of result.suspensions){same(s.before.jobs.status,'waiting-attributes');same(s.record.result.gpuComplete,true);same(s.record.result.ok,s.action==='reuse');if(s.action==='reuse'){const generations=s.record.result.draws[0].vertexFetches.map(f=>f.resourceGeneration);same(generations[0],generations[1]);}else same(s.record.result.draws,[]);}
  for(const o of result.ownership){same(o.before.jobs.status,'waiting-attributes');same(o.after.reads,0);same(o.after.stagingBytes,0);}
  out.rejections=result.rejections.map(r=>({label:r.record.label,error:r.record.result.error,wireSha256:hash(Buffer.from(r.record.hex,'hex'))}));out.suspensions=result.suspensions.map(s=>({action:s.action,before:s.before.jobs,result:s.record.result}));out.ownership=result.ownership.map(o=>({before:o.before.jobs,after:o.after}));
 }
 for(const file of await fs.readdir(dir)){const full=path.join(dir,file);if((await fs.stat(full)).isFile())out.files[name+'/'+file]=hash(await fs.readFile(full));}
}
same(out.frames.length,44);same(out.faults.length,2);out.pixels=out.frames.reduce((n,f)=>n+f.pixels,0);out.status='passed';await fs.writeFile(path.join(here,'fresh-audit.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({status:out.status,head:fullHead,frames:out.frames.length,pixels:out.pixels,faults:out.faults.length}));
