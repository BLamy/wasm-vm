import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {criticIntegerModel,criticIntegerCompare} from '../../../tools/virgl-command/standard-integer-adversarial-oracle.mjs';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../..'),freeze='700f424c8a9af222c00be63146016df2417a488d';
const sha=b=>createHash('sha256').update(b).digest('hex'),j=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const worker=await j(path.join(out,'unpacked/hot/receipt.json'));
const {default:create}=await import(pathToFileURL(path.join(out,'unpacked/hot-generated/renderer/virgl-shader/build/wasm/virgl-shader.mjs')));const module=await create();
const compile=(vertexText,fragmentText,signedMask,unsignedMask)=>{const ps=[];try{for(const text of [vertexText,fragmentText]){const p=module._malloc(text.length+1);assert.ok(p);ps.push(p);module.HEAPU8.set(Buffer.from(text),p);module.HEAPU8[p+text.length]=0;}return JSON.parse(module.UTF8ToString(module._bridge_translate_standard_pair_typed(ps[0],vertexText.length,ps[1],fragmentText.length,signedMask,unsignedMask)));}finally{ps.reverse().forEach(p=>module._free(p));}};
const summary={schema:'standard-integer-critic-fresh-audit-v1',status:'running',head:freeze,frames:[],faults:[],pixels:0,sources:[],blobs:0,hardware:'M4 Metal'};
for(const name of ['final-gpu','final-fault-native-signedness','final-fault-constant-word','final-fault-shader-conversion']){
 const dir=path.join(out,name),report=await j(path.join(dir,'report.json')),fault=name!=='final-gpu',result=fault?report.partial:report.browserResult.result,blobs=new Map(result.blobs.map(b=>[b.key,b]));
 assert.equal(report.gitHead,freeze);assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});assert.equal(report.fixedMemory.bytes,16777216);assert.equal(report.browser.headless,false);assert.ok(report.browser.gpu.devices[0].deviceString.includes('M4 Max'));
 const served=new Map(report.servedFiles.map(r=>[r.path,r]));
 for(const source of report.sources){const bytes=await fs.readFile(path.join(root,source.path));assert.equal(sha(bytes),source.sha256);let frozen;
  if(source.path.includes('/build/'))assert.equal(worker.generated[source.path],source.sha256);
  else {frozen=execFileSync('git',['show',freeze+':'+source.path],{cwd:root});assert.equal(sha(frozen),source.sha256);}
  const loaded=served.get('/'+source.path);if(loaded)assert.equal(loaded.sha256,report.mutation?.path===source.path?report.mutation.servedSha256:source.sha256);
  summary.sources.push({record:name,source:source.path,sha256:source.sha256,served:!!loaded});
 }
 if(fault){const mutation=report.mutation,original=await fs.readFile(path.join(root,mutation.path));assert.equal(sha(original),mutation.originalSha256);const changed=Buffer.from(original.toString().replace(mutation.needle,mutation.replacement));assert.deepEqual(changed,await fs.readFile(path.join(dir,'mutation-source.mjs')));assert.equal(sha(changed),mutation.servedSha256);}
 const raw=async ref=>{const b=blobs.get(ref.key);assert.equal(b.sha256,ref.sha256);const packed=await fs.readFile(path.join(dir,b.path));assert.equal(sha(packed),b.gzipSha256);const bytes=gunzipSync(packed);assert.equal(bytes.length,b.bytes);assert.equal(sha(bytes),b.sha256);return new Uint8Array(bytes);};
 for(const b of result.blobs){await raw(b);summary.blobs++;}
 const coverage=await j(path.join(dir,report.browserCoverage.path));assert.equal(sha(await fs.readFile(path.join(dir,report.browserCoverage.path))),report.browserCoverage.sha256);for(const script of coverage.scripts)assert.equal(script.sha256,served.get('/'+script.source).sha256);
 for(const frame of result.frames){
  const buffers=new Map(),native=new Map();for(const b of frame.native.buffers){const bytes=await raw(b.blob);native.set(b.resourceId,bytes);buffers.set(b.resourceId,new Uint8Array(bytes.length));}
  for(const row of frame.inputs){const bytes=await raw(row.blob);assert.equal(row.layout.rowCount,1);buffers.get(row.resource.id).set(bytes,row.layout.offset);}for(const [id,bytes]of native)assert.deepEqual(bytes,buffers.get(id));
  const m=criticIntegerModel(frame.history,buffers,frame.range),comparison=criticIntegerCompare(await raw(frame.pixels),m,frame.width,frame.height);assert.deepEqual([m.signedMask,m.unsignedMask],frame.prediction.masks);assert.deepEqual(m.points,frame.prediction.points);assert.deepEqual(m.fetches,frame.prediction.fetches);
  const draw=frame.history.at(-1).result.draws.at(-1),state=frame.native.state[0];assert.equal(frame.history.at(-1).result.gpuComplete,true);assert.equal(frame.native.calls.length,1);assert.deepEqual(frame.native.calls[0].args,[0,3,5123,10,3]);
  if(fault){assert.equal(comparison.held,false);assert.ok(report.browserResult.error.message.includes('critic original TGSI pixels'));}
  else {assert.equal(comparison.held,true,frame.label);assert.equal(comparison.nanPixels,0);for(const fetch of m.fetches){const a=state.attributes.find(a=>a.name==='in_'+fetch.attributeIndex),d=draw.vertexFetches.find(a=>a.attributeIndex===fetch.attributeIndex);assert.ok(a);assert.equal(a.shaderType,fetch.shaderType);assert.equal(a.enabled,!fetch.constant);assert.equal(a.divisor,fetch.nativeDivisor);for(const key of ['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])assert.equal(d[key],fetch[key]);if(fetch.constant){assert.deepEqual(a.genericWords,fetch.genericWords);assert.deepEqual(d.componentWords,fetch.componentWords);assert.equal(a.genericKind,fetch.integer?fetch.signed?'Int32Array':'Uint32Array':'Float32Array');}else {assert.equal(a.integer,fetch.integer);assert.equal(a.buffer,frame.native.buffers.find(b=>b.resourceId===fetch.resourceId).nativeBuffer);}}
  }
  // Authenticate even faulty supplied output: descriptor faults change masks;
  // only the explicit supplied-ESSL fault may change the original compiler body.
  let s=m.signedMask,u=m.unsignedMask;if(fault&&report.mutation.mode==='native-signedness'){s=0;u=0;for(const a of state.attributes)if(a.location>=0){const index=Number(a.name.slice(3));if(a.shaderType===35669)s|=1<<index;else if(a.shaderType===36296)u|=1<<index;}}
  const pair=compile(m.state.shaders.get(0),m.state.shaders.get(1),s,u);assert.ok(pair.ok);let vertex=pair.vertex.glsl;if(fault&&report.mutation.mode==='shader-conversion')vertex=vertex.replaceAll('uvec4(in_1)','floatBitsToUint(vec4(in_1))');assert.equal(state.shaders.find(a=>a.type===35633).source,vertex);assert.equal(state.shaders.find(a=>a.type===35632).source,pair.fragment.glsl);
  const row={label:frame.label,record:name+'/report.json',pixels:comparison.pixels,pixelSha256:frame.pixels.sha256,masks:[m.signedMask,m.unsignedMask],attributes:m.fetches.length,originalFullGpu:true,gpuComplete:true,compiledSource:true,maxError:comparison.maxError,misses:comparison.misses};(fault?summary.faults:summary.frames).push(row);if(!fault)summary.pixels+=comparison.pixels;
 }
 if(!fault){assert.equal(result.frames.length,69);assert.equal(result.rejections.length,2);assert.equal(result.suspensions.length,3);for(const r of result.runs)for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])assert.equal(r.inspection.jobs[key],0);for(const r of result.rejections){assert.equal(r.record.result.ok,false);const run=result.runs.find(run=>run.history.at(-1).label===r.record.label);assert.equal(run.calls.length,0);}for(const r of result.suspensions){assert.equal(r.record.result.ok,r.action==='reuse');assert.equal(r.record.result.gpuComplete,true);if(r.action!=='reuse')assert.equal(result.runs.find(run=>run.history.at(-1).label===r.record.label).calls.length,0);}
  summary.pending=result.suspensions.map(r=>({action:r.action,before:r.before.jobs,okay:r.record.result.ok,gpuComplete:r.record.result.gpuComplete}));summary.ownership=result.ownership;
 }
}
summary.status='HELD';await fs.writeFile(path.join(out,'fresh-audit.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({status:summary.status,frames:summary.frames.length,pixels:summary.pixels,faults:summary.faults.length,blobs:summary.blobs}));
