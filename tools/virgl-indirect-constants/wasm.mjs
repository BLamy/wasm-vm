#!/usr/bin/env node
// Recorded actual fixed-memory Wasm equality, owned results and allocation recovery.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createVirglShaderBridge, LIMITS} from '../../renderer/virgl-shader/index.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2],process.argv[3+i*2]]));
const output=path.resolve(args['--output']),nativePath=path.resolve(args['--native']);
fs.mkdirSync(output,{recursive:true});
const require=(ok,message)=>{if(!ok)throw new Error(message);};
const encode=value=>JSON.stringify(value);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const equal=(a,b,message)=>require(encode(a)===encode(b),message);
const binding=p=>{const bytes=fs.readFileSync(path.join(ROOT,p));return {path:p,bytes:bytes.length,sha256:sha(bytes)};};
const native=JSON.parse(fs.readFileSync(nativePath));
require(native.schema==='wasm-vm-indirect-constants-native-v1'&&native.status==='passed','complete native baseline');
const labels=['raw','integer','float','numeric','component','dot','constant','structured'];
const cases=new Map(),pairs=new Map();
const reference=(label,name)=>name.includes('::')?name:label+'::'+name;
for(const label of labels){for(const entry of native[label+'Cases'])cases.set(label+'::'+entry.name,entry);for(const entry of native[label+'Pairs'])pairs.set(label+'::'+entry.name,{...entry,vertexCaseName:reference(label,entry.vertexCaseName),fragmentCaseName:reference(label,entry.fragmentCaseName)});}
for(const entry of native.cases)cases.set(entry.name,entry);
for(const entry of native.pairs)pairs.set(entry.name,entry);
require(cases.size===3466+native.cases.length&&pairs.size===236+native.pairs.length,'complete unique retained/new input matrix');
require(native.recoverySingles.length===24&&native.recoveryPairs.length===22,'complete indirect and historical recovery set');
const sourceNames=['renderer/virgl-shader/index.mjs','renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/raw_bits.h','renderer/virgl-shader/bridge.h','renderer/virgl-shader/build.sh',
 'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm',
 'tools/virgl-indirect-constants/wasm.mjs','tools/virgl-indirect-constants/wasm_receipt.py',...native.originals.map(entry=>entry.path)];
const report={schema:'wasm-vm-indirect-constants-wasm-v1',status:'running',node:{version:process.version,platform:process.platform,arch:process.arch},
 nativeReport:{path:path.relative(output,nativePath),bytes:fs.statSync(nativePath).size,sha256:sha(fs.readFileSync(nativePath))},
 sources:sourceNames.map(binding),limits:LIMITS,counts:{calls:0,originals:0,singles:0,pairs:0,recoverySingles:0,recoveryPairs:0,stress:0,pressure:0},
 ownership:[],stress:[],allocationPressure:{chunkBytes:4096,releaseSchedule:[0,1,4,8,12,13,14,16,20,24,32,40,48,64,96,128],targets:[]},
 maxima:{singleJSBytes:0,pairJSBytes:0,glslBytes:0}};
const logPath=path.join(output,'calls.jsonl'),fd=fs.openSync(logPath,'w');
let module,bridge,memory;
function observe(kind,name,result,full=false){
 require(module.HEAPU8.buffer===memory&&module.HEAPU8.byteLength===16777216,'fixed Wasm memory identity');
 const serialized=encode(result),bytes=Buffer.byteLength(serialized),paired=result.ok&&Object.hasOwn(result,'vertex');
 require(bytes<(paired?295936:147456),'bounded actual JS result');
 report.maxima[paired?'pairJSBytes':'singleJSBytes']=Math.max(report.maxima[paired?'pairJSBytes':'singleJSBytes'],bytes);
 for(const stage of result.ok?(paired?[result.vertex,result.fragment]:[result]):[]){const length=Buffer.byteLength(stage.glsl);require(length<=65536,'bounded GLSL');report.maxima.glslBytes=Math.max(report.maxima.glslBytes,length);}
 const record={index:report.counts.calls++,kind,name,resultBytes:bytes,resultSha256:sha(serialized),...(full?{result}:{})};
 fs.writeSync(fd,encode(record)+'\n');return result;
}
function single(name,kind='single',full=true){const entry=cases.get(name);require(entry,'known single');const result=observe(kind,name,bridge.translate({stage:entry.stage,text:entry.text}),full);equal(result,entry.result,'native/Wasm full single equality: '+name);return result;}
function pair(name,kind='pair',full=true){const entry=pairs.get(name);require(entry,'known pair');const result=observe(kind,name,bridge.translatePair({vertexText:cases.get(entry.vertexCaseName).text,fragmentText:cases.get(entry.fragmentCaseName).text}),full);equal(result,entry.result,'native/Wasm full pair equality: '+name);return result;}
function recover(label){for(const name of native.recoverySingles){single(name,'recovery-single',false);report.counts.recoverySingles++;}for(const name of native.recoveryPairs){pair(name,'recovery-pair',false);report.counts.recoveryPairs++;}}
function capacity(){const pointers=[];try{for(let i=0;i<4096;i++){const pointer=module._malloc(4096);if(!pointer)return {chunkBytes:4096,availableChunks:pointers.length,availableRequestedBytes:pointers.length*4096};pointers.push(pointer);}throw new Error('bounded capacity exhaustion');}finally{for(const pointer of pointers)module._free(pointer);}}
try{
 bridge=await createVirglShaderBridge({wasmBinary:fs.readFileSync(path.join(ROOT,'renderer/virgl-shader/build/wasm/virgl-shader.wasm')),onRuntimeInitialized(){module=this;}});
 require(module?.HEAPU8,'actual Wasm module');memory=module.HEAPU8.buffer;equal(memory.byteLength,16777216,'fixed initial 16MiB');
 report.memory={initialBytes:memory.byteLength,finalBytes:null,bufferIdentityStable:true};
 for(const entry of native.originals){const input=fs.readFileSync(path.join(ROOT,entry.path));require(sha(input)===entry.sha256,'exact original input bytes');const text=input.toString('utf8');const result=observe('original',entry.sha256,bridge.translate({stage:entry.stage,text}),true);equal(result,entry.result,'original full native equality');report.counts.originals++;}
 for(const [name]of cases){single(name);report.counts.singles++;if(!name.includes('::'))recover(name);}
 for(const [name]of pairs){pair(name);report.counts.pairs++;if(!name.includes('::'))recover(name);}
 // Requests/results remain owned after another conversion overwrites C response storage.
 for(const name of ['coupled-vertex','coupled-fragment']){const entry=cases.get(name),request={stage:entry.stage,text:entry.text},result=observe('ownership-single',name,bridge.translate(request),true),before=encode(result);request.stage='invalid';request.text='invalid';single(native.recoverySingles[0],'ownership-overwrite',false);equal(encode(result),before,'owned single response');report.ownership.push({kind:'single',name,requestAfter:request,result});}
 {const entry=pairs.get('coupled-pair'),request={vertexText:cases.get(entry.vertexCaseName).text,fragmentText:cases.get(entry.fragmentCaseName).text},result=observe('ownership-pair','coupled-pair',bridge.translatePair(request),true),before=encode(result);request.vertexText='invalid';request.fragmentText='invalid';pair(native.recoveryPairs[0],'ownership-overwrite-pair',false);equal(encode(result),before,'owned pair response');report.ownership.push({kind:'pair',name:'coupled-pair',requestAfter:request,result});}
 for(const stage of ['vertex','fragment']){const name='instruction-limit-'+stage,entry=cases.get(name),text=entry.text+'\n'.repeat(16384-entry.text.length);const record={name,iterations:32,textBytes:16384,textSha256:sha(text),result:entry.result};for(let i=0;i<32;i++){const result=observe('stress',name,bridge.translate({stage,text}),false);equal(result,entry.result,'max-text 179-instruction indirect constant recovery');report.counts.stress++;}report.stress.push(record);recover(name);}
 for(const [kind,name]of [['single','coupled-vertex'],['single','coupled-fragment'],['pair','coupled-pair']]){
  const entry=(kind==='single'?cases:pairs).get(name),request=kind==='single'?{stage:entry.stage,text:entry.text}:{vertexText:cases.get(entry.vertexCaseName).text,fragmentText:cases.get(entry.fragmentCaseName).text};
  const record={kind,name,capacityBefore:capacity(),reservedChunks:0,releasedChunks:0,attempts:[],capacityAfter:null,recoveredResult:null};
  const held=[];let exhausted=false,released=0,success=false;
  try{for(let i=0;i<4096;i++){const pointer=module._malloc(4096);if(!pointer){exhausted=true;break;}held.push(pointer);}require(exhausted&&held.length>128,'real fixed-heap exhaustion');record.reservedChunks=held.length;
   for(const release of report.allocationPressure.releaseSchedule){while(released<release){module._free(held.pop());released++;}const before=capacity(),result=observe('pressure',name,kind==='single'?bridge.translate(request):bridge.translatePair(request),true),after=capacity();report.counts.pressure++;equal(after,before,'no 4KiB allocation capacity leak after attempt');record.attempts.push({releasedChunks:released,heldChunks:held.length,capacityBefore:before,capacityAfter:after,result});
    if(result.ok){equal(result,entry.result,'full pressure success');success=true;break;}
    require(['allocation-failed','translation-error','unsupported-feature'].includes(result.error?.code),'only owned OOM/original retry rejection');
   }require(success&&record.attempts.some(a=>!a.result.ok),'pressure fails then recovers');
   require(released*4096>53248&&record.attempts.some(a=>a.result.error?.message==='Structured flow allocation failed.'),'real structured arena allocation fails before full recovery beyond its 52KiB bound');
  }finally{record.releasedChunks=released+held.length;for(const pointer of held)module._free(pointer);}
  equal(record.releasedChunks,record.reservedChunks,'release every pressure allocation');record.recoveredResult=kind==='single'?single(name,'pressure-recovered',true):pair(name,'pressure-recovered',true);recover(name);record.capacityAfter=capacity();equal(record.capacityAfter,record.capacityBefore,'full capacity recovered');report.allocationPressure.targets.push(record);
 }
 report.memory.finalBytes=module.HEAPU8.byteLength;
 for(const item of report.sources)equal(binding(item.path),item,'source unchanged during run');
 equal(sha(fs.readFileSync(nativePath)),report.nativeReport.sha256,'native result evidence immutable');
 report.status='passed';
}catch(error){report.status='failed';report.error={name:error.name,message:error.message};process.exitCode=1;}
finally{fs.closeSync(fd);const raw=fs.readFileSync(logPath);report.records=[{path:'calls.jsonl',bytes:raw.length,sha256:sha(raw)}];fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,counts:report.counts,error:report.error,report:path.join(output,'report.json')}));
