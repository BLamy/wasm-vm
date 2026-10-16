// Independent little-endian TGSI word decoding against the pinned public ABI.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const dir=path.resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex');
const header=fs.readFileSync(dir+'/unpacked/source/renderer/virgl-shader/vendor/src/gallium/include/pipe/p_shader_tokens.h','utf8');
function enumeration(name){
 const body=header.match(new RegExp('enum '+name+'\\s*\\{([\\s\\S]*?)\\};'));assert.ok(body);
 let next=0;return Object.fromEntries(body[1].replace(/\/\*[\s\S]*?\*\//g,'').split(',').flatMap(item=>{
  const m=item.trim().match(/^(\w+)(?:\s*=\s*(\d+))?$/);if(!m)return [];if(m[2])next=+m[2];return [[m[1],next++]];
 }));
}
const file=enumeration('tgsi_file_type'),op=enumeration('tgsi_opcode'),target=enumeration('tgsi_texture_type'),ret=enumeration('tgsi_return_type'),imm=enumeration('tgsi_imm_type');
const bits=(word,offset,width)=>(word>>>offset)&(2**width-1),signed=n=>(n<<16)>>16;
function decoded(words){
 assert.equal((words[0]&255)+(words[0]>>>8),words.length);assert.equal(words[0]&255,2);
 const result={textureInstructions:[],samplerViews:[],immediates:[],constantDeclarations:[],constantSources:[],systemDeclarations:[],systemSources:[]};let instruction=0;
 for(let at=2;at<words.length;){
  // Pinned tgsi_build.c initializes instruction NrTokens to zero; declarations
  // and immediates start at one. The legacy instruction count excludes its head.
  const start=at,w=words[at++],type=w&15,count=bits(w,4,type===1?14:type===2?9:8),size=count+(type===2?1:0),end=start+size;assert.ok(end<=words.length&&size>0);
  if(type===0){
   const range=words[at++],first=range&65535,last=range>>>16,f=bits(w,12,4),mask=bits(w,16,4),dimension=bits(w,20,1),interpolation=bits(w,22,1),semantic=bits(w,21,1);let slot=0;
   if(dimension)slot=words[at++]&65535;if(interpolation)at++;let meaning=0;if(semantic)meaning=words[at++];
   if(f===file.TGSI_FILE_SAMPLER_VIEW){const view=words[at++];result.samplerViews.push({first,last,target:view&255,returnTypes:[8,14,20,26].map(n=>bits(view,n,6))});}
   if(f===file.TGSI_FILE_CONSTANT)result.constantDeclarations.push({slot,first,last,dimensional:Boolean(dimension)});
   if(f===file.TGSI_FILE_SYSTEM_VALUE)result.systemDeclarations.push({first,last,semantic:meaning&255,semanticIndex:bits(meaning,8,16),mask});
   if(bits(w,25,1))at++;
  }else if(type===1){assert.equal(count,5);result.immediates.push({index:result.immediates.length,type:bits(w,18,4),words:words.slice(at,end)});at=end;
  }else if(type===2){
   if(bits(w,28,1))at++;let texture=0,offsets=0;if(bits(w,29,1)){const t=words[at++];texture=t&255;offsets=bits(t,8,4);at+=offsets;}
   if(bits(w,30,1))at++;
   const destinations=[],sources=[];
   for(let n=0;n<bits(w,22,2);n++){const d=words[at++];destinations.push({mask:bits(d,4,4)});if(bits(d,8,1))at++;if(bits(d,9,1)){const dim=words[at++];if(dim&1)at++;}}
   for(let n=0;n<bits(w,24,4);n++){
    const s=words[at++],f=s&15,indirect=bits(s,4,1),dimension=bits(s,5,1),index=signed(bits(s,6,16));let slot=0,indirectDimension=false;
    if(indirect)at++;if(dimension){const d=words[at++];slot=signed(d>>>16);indirectDimension=Boolean(d&1);if(d&1)at++;}
    const source={file:f,index,slot,negate:bits(s,31,1),absolute:bits(s,30,1),swizzle:[22,24,26,28].map(n=>bits(s,n,2)),indirect};sources.push(source);
    if(f===file.TGSI_FILE_CONSTANT)result.constantSources.push({instruction,slot,index,indirect:Boolean(indirect),indirectDimension});
    if(f===file.TGSI_FILE_SYSTEM_VALUE)result.systemSources.push({instruction,source:n,index,negate:source.negate,absolute:source.absolute,swizzle:source.swizzle});
   }
   if(bits(w,29,1))result.textureInstructions.push({instruction,opcode:bits(w,13,8),target:texture,writeMask:destinations[0].mask,saturate:bits(w,21,1),precise:bits(w,31,1),offsets,sources});
   instruction++;
  }else assert.equal(type,3);
  if(type!==3)assert.equal(at,end,'complete raw token boundary '+JSON.stringify({start,type,count,words:words.slice(start,end)}));at=end;
 }
 return result;
}
function sourceOperand(term){
 const m=term.match(/^(-)?(\|)?(IN|TEMP|IMM|SAMP|CONST|SV)\[(\d+)\](?:\[(\d+)\])?(?:\.([xyzw]{1}|[xyzw]{4}))?(\|)?$/);assert.ok(m,term);assert.equal(Boolean(m[2]),Boolean(m[7]));
 const names={IN:'INPUT',TEMP:'TEMPORARY',IMM:'IMMEDIATE',SAMP:'SAMPLER',CONST:'CONSTANT',SV:'SYSTEM_VALUE'},sw=m[6]??'xyzw';
 return {file:file['TGSI_FILE_'+names[m[3]]],index:+(m[5]??m[4]),slot:m[5]?+m[4]:0,negate:+Boolean(m[1]),absolute:+Boolean(m[2]),swizzle:[...sw.padEnd(4,sw)].slice(0,4).map(c=>'xyzw'.indexOf(c)),indirect:0};
}
function original(text,record){
 const raw=decoded(record.rawWords);for(const [key,value]of Object.entries(raw))assert.deepEqual(record[key],value,'independently decoded '+key);
 const textures=[...text.matchAll(/^(\d+): (TEX|TXL|TXF|TXD|TXB|TXQ|TXP)(_SAT)?(_PRECISE)? ([^\n]+)$/gm)].map(m=>{
  const args=m[5].split(',').map(v=>v.trim()),dest=args.shift(),kind=args.pop(),mask=dest.match(/\.([xyzw]+)$/)?.[1]??'xyzw';
  return {instruction:+m[1],opcode:op['TGSI_OPCODE_'+m[2]],target:target['TGSI_TEXTURE_'+kind],writeMask:[...mask].reduce((w,c)=>w|(1<<'xyzw'.indexOf(c)),0),saturate:+Boolean(m[3]),precise:+Boolean(m[4]),offsets:0,sources:args.map(sourceOperand)};
 });assert.deepEqual(raw.textureInstructions,textures,'original textual texture words and modifiers');
 const views=[...text.matchAll(/^DCL SVIEW\[(\d+)(?:\.\.(\d+))?\], (2D|SHADOW2D), (.+)$/gm)].map(m=>{
  const types=m[4].split(',').map(v=>ret['TGSI_RETURN_TYPE_'+v.trim()]);assert.ok(types.length>=1&&types.length<=4);while(types.length<4)types.push(types.at(-1));
  return {first:+m[1],last:+(m[2]??m[1]),target:target['TGSI_TEXTURE_'+m[3]],returnTypes:types};
 });assert.deepEqual(raw.samplerViews,views,'original declared sampler ranges/targets/returns');
 const immediates=[...text.matchAll(/^IMM\[(\d+)\] (FLT32|INT32|UINT32) \{([^}]+)\}$/gm)].map(m=>({index:+m[1],type:imm['TGSI_IMM_'+({FLT32:'FLOAT32',INT32:'INT32',UINT32:'UINT32'}[m[2]])],words:m[3].split(',').map(value=>{const b=Buffer.alloc(4);if(m[2]==='FLT32'&&!/^\s*[-+]?0x/i.test(value))b.writeFloatLE(Number(value));else b.writeUInt32LE(Number(value)>>>0);return b.readUInt32LE();})}));assert.deepEqual(raw.immediates,immediates,'original immediate whole words');
 return {words:record.rawWords.length,textures:textures.length,rawSha256:sha(Buffer.from(new Uint32Array(record.rawWords).buffer))};
}
const summaries=[];
for(const name of ['hot','cold','independent']){
 const base=name==='independent'?dir+'/independent':dir+'/unpacked/'+name+'/native';
 const cases=JSON.parse(fs.readFileSync(base+'/cases.json')).cases,rows=fs.readFileSync(base+'/native.jsonl','utf8').trim().split('\n').map(JSON.parse);let words=0,textures=0,stages=0;const citations=[];
 for(const [i,c]of cases.entries())if(rows[i].result.ok){
  const tokens=rows[i].originalTokens;assert.ok(tokens.length===1||tokens.length===2);
  for(const [stage,t]of tokens.entries()){const facts=original(stage?c.b:c.a,t);stages++;words+=facts.words;textures+=facts.textures;citations.push({line:i+1,name:c.name,stage,...facts});}
 }
 summaries.push({name,status:'passed',stages,words,textures,citations});console.log('Independent original raw-word/text audit:',name,stages,words,textures);
}
fs.writeFileSync(dir+'/original-token-audit.json',JSON.stringify({status:'passed',schema:'independently-decoded-original-tgsi-token-words-v1',headerSha256:sha(Buffer.from(header)),records:summaries},null,2)+'\n');
