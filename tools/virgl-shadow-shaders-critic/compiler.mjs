import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {request,selectors,vertexText,fragmentText} from './fixtures.mjs';
const [mode,directory]=process.argv.slice(2),dir=path.resolve(directory),root=path.resolve(import.meta.dirname,'../..');
const keys=['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask','bufferZeroMask','signedColorMask','unsignedColorMask'];
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function stageText(stage,{slot=7,declaration='2D',opcode='TEX',source='IN[1]',conflict=null,query=null,type='FLOAT'}={}){
 const vertex=stage==='vertex',out=vertex?'OUT[1]':'OUT[0]';
 const decl=[vertex?'VERT':'FRAG','DCL IN[0]'+(vertex?'':', GENERIC[1], CONSTANT'),'DCL IN[1]'+(vertex?'':', GENERIC[0], CONSTANT'),...(vertex?['DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]']:['DCL OUT[0], COLOR']),'DCL TEMP[0..1]',`DCL SAMP[${slot}]`,`DCL SVIEW[${slot}], ${declaration}, ${type}`,'IMM[0] INT32 {0,0,0,0}','IMM[1] FLT32 {0.25,0,0,0}'];
 const sample=`${opcode} TEMP[0].yw, ${opcode==='TXQ'?'IMM[0]':source}${opcode==='TXD'?', IMM[1], IMM[1]':''}, SAMP[${slot}], SHADOW2D`;
 const ordinary=`TEX TEMP[1], IN[1], SAMP[${slot}], 2D`,size=`TXQ TEMP[1].xyw, IMM[0], SAMP[${slot}], ${query?.endsWith('shadow')?'SHADOW2D':'2D'}`;
 const ops=[...(vertex?['MOV OUT[0], IN[0]']:[]),'MOV TEMP[0], IMM[0]',...(conflict==='before'?[ordinary]:[]),...(query?.startsWith('before')?[size]:[]),sample,...(query?.startsWith('after')?[size]:[]),...(conflict==='after'?[ordinary]:[]),`MOV ${out}, TEMP[0]`,'END'];
 return decl.join('\n')+'\n'+ops.map((text,i)=>i+': '+text+'\n').join('');
}
function cases(){
 const rows=[{name:'independent-original-novel',kind:31,a:vertexText,b:fragmentText,selectors,okay:true}];
 for(const seed of [0x4a913ec7,0x9621bd5f,0xd0574af3]){
  let state=seed;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  for(const stage of ['vertex','fragment'])for(const slot of [0,7,15])for(const declaration of ['2D','SHADOW2D'])for(const opcode of ['TEX','TXL','TXD','TXP','TXB','TXQ','TXF']){
   const option={slot,declaration,opcode,source:['IN[1].zxyw','-|IN[1].xyzw|','|IN[1].wzyx|'][random()%3]};
   const okay=opcode!=='TXF'&&!(stage==='vertex'&&opcode==='TXB');
   rows.push({name:seed.toString(16)+'/'+stage+'/'+slot+'/'+declaration+'/'+opcode,kind:stage==='vertex'?29:30,a:stageText(stage,option),b:'',selectors:{...selectors,unsignedColorMask:0},okay});
  }
  for(const stage of ['vertex','fragment'])for(const slot of [0,7,15])for(const declaration of ['2D','SHADOW2D']){
   for(const conflict of ['before','after'])rows.push({name:`${seed}/conflict/${stage}/${slot}/${declaration}/${conflict}`,kind:stage==='vertex'?29:30,a:stageText(stage,{slot,declaration,conflict}),b:'',selectors:{...selectors,unsignedColorMask:0},okay:false});
   for(const query of ['before','after','before-shadow','after-shadow'])rows.push({name:`${seed}/neutral/${stage}/${slot}/${declaration}/${query}`,kind:stage==='vertex'?29:30,a:stageText(stage,{slot,declaration,query}),b:'',selectors:{...selectors,unsignedColorMask:0},okay:true});
   for(const type of ['UINT','SINT'])rows.push({name:`${seed}/integer/${stage}/${slot}/${declaration}/${type}`,kind:stage==='vertex'?29:30,a:stageText(stage,{slot,declaration,type}),b:'',selectors:{...selectors,unsignedColorMask:0},okay:false});
  }
 }
 for(const slot of [16,65535])for(const stage of ['vertex','fragment'])rows.push({name:'slot-bound/'+slot+'/'+stage,kind:stage==='vertex'?29:30,a:stageText(stage,{slot}),b:'',selectors:{...selectors,unsignedColorMask:0},okay:false});
 return rows;
}
function direct(module,c){
 const pointers=[];
 try{
  for(const text of [c.a,c.b]){const p=module._malloc(Buffer.byteLength(text)+1);assert.ok(p);module.HEAPU8.set(Buffer.from(text),p);module.HEAPU8[p+Buffer.byteLength(text)]=0;pointers.push(p);}
  const [a,b]=pointers,m=keys.map(k=>c.selectors[k]);
  const result=c.kind===31?module._bridge_translate_standard_shadow_texture_pair(a,c.a.length,b,c.b.length,...m):module._bridge_translate_standard_shadow_texture(c.kind-29,a,c.a.length,m[5],m[6]);
  return module.UTF8ToString(result);
 }finally{for(const p of pointers.reverse())module._free(p);}
}
fs.mkdirSync(dir,{recursive:true});
if(mode==='prepare'){
 const rows=cases(),word=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;},bodies=[word(rows.length)];
 for(const c of rows){const a=Buffer.from(c.a),b=Buffer.from(c.b);bodies.push(word(c.kind),...keys.map(k=>word(c.selectors[k])),word(a.length),a,word(b.length),b);}
 fs.writeFileSync(dir+'/cases.bin',Buffer.concat(bodies));fs.writeFileSync(dir+'/cases.json',JSON.stringify({cases:rows},null,2)+'\n');
 console.log('Original independent cases:',rows.length);
}else if(mode==='audit'){
 const rows=JSON.parse(fs.readFileSync(dir+'/cases.json')).cases,native=fs.readFileSync(dir+'/native.jsonl'),sanitized=fs.readFileSync(dir+'/sanitize.jsonl');assert.deepEqual(native,sanitized);
 const results=native.toString().trim().split('\n').map(JSON.parse);assert.equal(results.length,rows.length);
 const {default:create}=await import(pathToFileURL(root+'/renderer/virgl-shader/build/wasm/virgl-shader.mjs'));
 const raw=await create(),peer=await create(),facadeModule=await import(pathToFileURL(root+'/renderer/virgl-shader/standard.mjs'));
 const observed=[];
 for(const [index,c]of rows.entries()){
  const response=direct(raw,c),result=JSON.parse(response);assert.deepEqual(result,results[index].result,c.name);assert.equal(result.ok,c.okay,c.name+': '+JSON.stringify(result));
  assert.equal(raw.HEAPU8.byteLength,16777216);assert.equal(peer.HEAPU8.byteLength,16777216);assert.notEqual(raw.HEAPU8.buffer,peer.HEAPU8.buffer);
  if(!result.ok)assert.deepEqual(Object.keys(result),['ok','error']);
  else{
   const parts=c.kind===31?[result.vertex,result.fragment]:[result],texts=c.kind===31?[c.a,c.b]:[c.a];
   for(const [i,body]of parts.entries()){
    const stage=body.metadata.stage,prefix=stage==='vertex'?'vs':'fs',text=texts[i];
    const sampled=[...new Set([...text.matchAll(/^\d+: (TEX|TXL|TXD|TXP|TXB)(?:_SAT)?(?:_PRECISE)? .* SAMP\[(\d+)\], SHADOW2D$/gm)].map(m=>+m[2]))].sort((a,b)=>a-b);
    assert.deepEqual(body.metadata.shadowUniforms,sampled.flatMap(slot=>[{index:slot,name:prefix+'shadmask'+slot,type:'vec4',semantic:'SHADOW_MASK'},{index:slot,name:prefix+'shadadd'+slot,type:'vec4',semantic:'SHADOW_ADD'}]));
    for(const slot of sampled)assert.equal(body.metadata.samplers.find(s=>s.index===slot)?.type,'sampler2DShadow');
   }
  }
  observed.push({index,name:c.name,response});
 }
 // Numerical token facts for the novel original fixture precede any emitted-source inference.
 const [v,f]=results[0].originalTokens;
 assert.deepEqual(v.textureInstructions.map(t=>[t.writeMask,t.saturate,t.precise,t.sources[0].swizzle,t.sources[0].absolute,t.sources[0].negate]),[[9,1,1,[3,2,1,0],1,0]]);
 assert.deepEqual(f.textureInstructions.map(t=>[t.writeMask,t.saturate,t.precise,t.sources[0].swizzle,t.sources[0].absolute]),[[6,1,1,[2,0,1,3],1],[11,0,0,[0,1,2,3],0]]);
 const bridge=await facadeModule.createVirglStandardShadowTextureShaderBridge(),baseline=bridge.translatePairImages(request),saved=JSON.stringify(baseline);assert.deepEqual(baseline,results[0].result);
 let getters=0;const rejections=[];
 for(const key of Object.keys(request)){const p={...request};Object.defineProperty(p,key,{get(){getters++;return request[key];},enumerable:true});const r=bridge.translatePairImages(p);assert.equal(r.ok,false);rejections.push({key,result:r});}assert.equal(getters,0);
 for(const extra of ['shadowUniforms','vsshadmask7','fsshadadd7','privateProfile','instanceBase']){const r=bridge.translatePairImages({...request,[extra]:[1,1,1,1]});assert.equal(r.ok,false);rejections.push({extra,result:r});}
 for(const p of [Object.create(request),new Proxy(request,{ownKeys(){throw new Error('critic ownKeys');}}),new Proxy(request,{getOwnPropertyDescriptor(){throw new Error('critic descriptor');}})]){const r=bridge.translatePairImages(p);assert.equal(r.ok,false);rejections.push({proxy:true,result:r});}
 const caller={...request};let changed=false;const proxy=new Proxy(caller,{getOwnPropertyDescriptor(t,k){const original=Reflect.getOwnPropertyDescriptor(t,k);if(k==='unsignedColorMask'){changed=true;t.vertexText='\0';t.unsignedColorMask=16;}return original;}});assert.deepEqual(bridge.translatePairImages(proxy),baseline);assert.ok(changed);assert.equal(bridge.translatePairImages(caller).ok,false);assert.equal(JSON.stringify(baseline),saved);
 const written=raw._malloc(32);assert.ok(written);raw.HEAPU8.fill(0x5a,written,written+32);raw._free(written);assert.deepEqual(bridge.translatePairImages(request),baseline);assert.deepEqual(direct(peer,rows[0]),observed[0].response);
 fs.writeFileSync(dir+'/wasm.jsonl',observed.map(row=>JSON.stringify(row)).join('\n')+'\n');
 fs.writeFileSync(dir+'/audit.json',JSON.stringify({status:'passed',cases:rows.length,admitted:rows.filter(c=>c.okay).length,rejected:rows.filter(c=>!c.okay).length,novelResult:baseline,novelTokens:[v,f],getters,rejections,ownedSnapshot:true,independentMemories:true,memoryBytes:raw.HEAPU8.byteLength,nativeSha256:sha(native),sanitizedSha256:sha(sanitized)},null,2)+'\n');
 console.log('Independent compiler matrix and custody passed:',rows.length);
}else throw Error('prepare or audit');
