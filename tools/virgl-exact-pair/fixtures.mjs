// Literal original programs and independent admission/interface predictions.
import fs from 'node:fs';
import {bytesFragment} from '../virgl-fragment-coordinates/cases.mjs';
import {spatial} from '../virgl-fragment-discard/cases.mjs';
export const SEEDS = [0x6a09e667, 0xbb67ae85, 0x3c6ef372];
export const VERTEX = 'VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL CONST[0..45]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[1]\nEND\n';
export const FRAGMENT = 'FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL CONST[0..45]\nMOV OUT[0], IN[0]\nEND\n';
export const WORDS = [{register:0,component:0,word:1},{register:0,component:3,word:0},{register:45,component:2,word:5}];
export const clone = x => JSON.parse(JSON.stringify(x));
function guarded(stage, flat=true) {
 return `${stage==='vertex'?'VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]':'FRAG\nDCL IN[0], GENERIC[0], '+(flat?'CONSTANT':'PERSPECTIVE')+'\nDCL OUT[0], COLOR'}
DCL TEMP[0..2]
DCL CONST[0..45]
IMM[0] UINT32 {1,0,0,0}
IMM[1] FLT32 {0,1,0,1}
USEQ TEMP[0].x, CONST[0].xxxx, IMM[0].xxxx
UIF TEMP[0].xxxx
MOV TEMP[2], IN[${stage==='vertex'?1:0}]
ELSE
SIN TEMP[1].x, CONST[0].wwww
MOV TEMP[2], IMM[1]
MOV TEMP[2].x, TEMP[1].xxxx
ENDIF
MOV OUT[${stage==='vertex'?1:0}], TEMP[2]
${stage==='vertex'?'MOV OUT[0], IN[0]\n':''}END
`;
}
export const EXACT_VERTEX=guarded('vertex'), EXACT_FRAGMENT=guarded('fragment');
export function bank(components){const words=Array(184).fill(0);for(const x of components)words[x.register*4+x.component]=x.word;return words;}
function maxText(text, instructions=768){
 let lines=text.trimEnd().split('\n');
 if(!lines.some(x=>x.startsWith('DCL TEMP')))lines.splice(2,0,'DCL TEMP[0..511]','IMM[1] FLT32 {0,1,0,1}');
 else lines=lines.map(x=>x.startsWith('DCL TEMP')?'DCL TEMP[0..511]':x);
 const count=lines.filter(x=>/^(?:USEQ|UIF|MOV|ELSE|SIN|ENDIF)\b/.test(x)).length;
 lines.splice(lines.length-1,0,...Array(instructions-count).fill('MOV TEMP[511], IMM[1]'));
 if(lines.filter(x=>/^(?:USEQ|UIF|MOV|ELSE|SIN|ENDIF)\b/.test(x)).length!==instructions)throw new Error('literal instruction count');
 let remaining=49152-lines.reduce((n,x)=>n+x.length+1,0);
 for(let i=0;i<lines.length&&remaining;i++){const take=Math.min(511-lines[i].length,remaining);lines[i]+=' '.repeat(take);remaining-=take;}
 if(remaining)throw new Error('bounded padding');const result=lines.join('\n')+'\n';if(result.length!==49152)throw new Error('literal text bound');return result;
}
export function cases(){
 const list=[],add=(name,vertexText,fragmentText,vertexComponents,fragmentComponents,ok,defaultOk=false,extra={})=>list.push({name,vertexText,fragmentText,vertexComponents:clone(vertexComponents),fragmentComponents:clone(fragmentComponents),ok,defaultOk,...extra});
 add('both-qualified-flat',EXACT_VERTEX,EXACT_FRAGMENT,WORDS,WORDS,true,false,{physical:'flat',interfaceKey:'generic-interpolation-v1:g0/15/flat'});
 add('vertex-only-flat',EXACT_VERTEX,FRAGMENT,WORDS,[],true,false,{physical:'flat',interfaceKey:'generic-interpolation-v1:g0/15/flat'});
 add('fragment-only-flat',VERTEX,EXACT_FRAGMENT,[],WORDS,true,false,{physical:'flat',interfaceKey:'generic-interpolation-v1:g0/15/flat'});
 add('ordinary-flat-wins',VERTEX,FRAGMENT,WORDS,WORDS,true,true,{physical:'flat',interfaceKey:'generic-interpolation-v1:g0/15/flat'});
 const smoothVertex=guarded('vertex',false).replace('DCL OUT[1], GENERIC[0]','DCL OUT[1], GENERIC[0]\nDCL OUT[2].xy, GENERIC[7]').replace('MOV OUT[0], IN[0]','MOV OUT[2].xy, IN[1].xyyy\nMOV OUT[0], IN[0]');
 const smoothFragment=guarded('fragment',false).replace('DCL OUT[0], COLOR','DCL IN[7].xy, GENERIC[7], CONSTANT\nDCL OUT[0], COLOR');
 add('both-qualified-smooth',smoothVertex,smoothFragment,WORDS,WORDS,true,false,{physical:'smooth',interfaceKey:'generic-interpolation-v1:g0/15/smooth;g7/3/flat'});
 const coordKey='|tgsi-fragment-position-v1:in0/linear/lower-left/half-integer/window-z/reciprocal-w';
 const dead='UIF CONST[45].wwww\nSIN TEMP[5].x, IN[0].xxxx\nENDIF\n';
 const coordinate=bytesFragment(0,'direct','xyzw',15,'CONSTANT').replace('DCL TEMP[0..4]','DCL TEMP[0..5]\nDCL CONST[0..45]').replace('MOV TEMP[0], IMM[0]',dead+'MOV TEMP[0], IMM[0]');
 const fsWords=[{register:0,component:0,word:1},{register:45,component:3,word:0}];
 add('both-qualified-coordinate-bytes',EXACT_VERTEX,coordinate,WORDS,fsWords,true,false,{physical:'coordinate-bytes',interfaceKey:'generic-interpolation-v1:g0/15/flat'+coordKey});
 const discard=spatial('conditional','x').replace('DCL TEMP[0]','DCL TEMP[0..5]').replace('DCL CONST[0]','DCL CONST[0..45]').replace('FSLT TEMP[0]',dead+'FSLT TEMP[0]');
 add('both-qualified-coordinate-discard',EXACT_VERTEX,discard,WORDS,[{register:0,component:0,word:0x40800000},{register:45,component:3,word:0}],true,false,{physical:'spatial-discard',interfaceKey:'generic-interpolation-v1:'+coordKey+'|tgsi-fragment-discard-v1:ordered-any-negative/raw-words/always-0'});
 const killed='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL TEMP[0..5]\nDCL CONST[0..45]\n'+dead+'KILL\nEND\n';
 add('both-qualified-guaranteed-discard',EXACT_VERTEX,killed,WORDS,fsWords,true,false,{physical:'always-discard',interfaceKey:'generic-interpolation-v1:g0/15/flat|tgsi-fragment-discard-v1:ordered-any-negative/raw-words/always-1'});
 for(const s of [0,1])for(const reg of [0,45])for(const lane of [0,1,2,3]){
  const swizzle='xyzw'[lane].repeat(4),text=guarded(s===0?'vertex':'fragment').replace('CONST[0].xxxx',`CONST[${reg}].${swizzle}`),words=[{register:reg,component:lane,word:1}];
  // The else arm is dead, so only the predicate's post-swizzle lane is needed.
  add(`stage${s}-reg${reg}-lane${lane}`,s===0?text:VERTEX,s===1?text:FRAGMENT,s===0?words:[],s===1?words:[],true);
 }
 const raw=JSON.parse(fs.readFileSync(new URL('../virgl-exact-producer/fixtures.json',import.meta.url)));
 for(const c of raw){
  const partner=c.stage==='vertex'?FRAGMENT:VERTEX;
  // Old inherited compositions may declare more varyings; provide all complete
  // matching normal outputs, independently of which declarations are live.
  let v=c.stage==='vertex'?c.text:partner;
  if(c.stage==='fragment'&&/GENERIC\[1\]/.test(c.text))v=v.replace('DCL OUT[1], GENERIC[0]','DCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL OUT[3], GENERIC[2]').replace('MOV OUT[1], IN[1]','MOV OUT[1], IN[1]\nMOV OUT[2], IN[1]\nMOV OUT[3], IN[1]');
  if(c.role==='full-original')continue;
  add('stage-carry/'+c.name,v,c.stage==='fragment'?c.text:partner,c.stage==='vertex'?c.components:[],c.stage==='fragment'?c.components:[],c.ok,c.defaultOk,{stageCarry:c.name});
 }
 const radial=raw.find(c=>c.name==='ordinary/inherited-radial');
 add('ordinary-conditional-undeclared',VERTEX,radial.text,[],[{register:45,component:0,word:0}],false,true);
 for(const s of [0,1]){
  const text=s===0?EXACT_VERTEX:EXACT_FRAGMENT;
  for(const [name,changed,words] of [
   ['missing-predicate',text,[]],['other-lane',text,[{register:0,component:1,word:1}]],
   ['float-one',text,[{register:0,component:0,word:0x3f800000}]],
   ['dead-invalid-grammar',text.replace('SIN TEMP[1].x','BOGUS TEMP[1].x'),WORDS],
   ['undeclared-obligation',text.replace('DCL CONST[0..45]','DCL CONST[0..44]'),WORDS],
   ['unsupported-loop',text.replace('MOV TEMP[2], IMM[1]','BGNLOOP :0\nENDLOOP :0\nMOV TEMP[2], IMM[1]'),WORDS],
   ['duplicate',text,[WORDS[0],WORDS[0]]],['unsorted',text,[WORDS[2],WORDS[0]]],
   ['wrong-header',text.replace(s===0?'VERT':'FRAG',s===0?'FRAG':'VERT'),WORDS],
  ])add(`negative-stage${s}/${name}`,s===0?changed:VERTEX,s===1?changed:FRAGMENT,s===0?words:WORDS,s===1?words:WORDS,false);
 }
 add('missing-generic',EXACT_VERTEX.replace('GENERIC[0]','GENERIC[1]'),EXACT_FRAGMENT,WORDS,WORDS,false);
 add('incomplete-mask',EXACT_VERTEX.replace('MOV OUT[1],','MOV OUT[1].xy,'),EXACT_FRAGMENT,WORDS,WORDS,false);
 add('unused-full-flat-interface',EXACT_VERTEX.replace('DCL OUT[1], GENERIC[0]','DCL OUT[1], GENERIC[0]\nDCL OUT[2].xy, GENERIC[7]').replace('MOV OUT[0], IN[0]','MOV OUT[2].xy, IN[1].xyyy\nMOV OUT[0], IN[0]'),EXACT_FRAGMENT.replace('DCL OUT[0], COLOR','DCL IN[7].xy, GENERIC[7], CONSTANT\nDCL OUT[0], COLOR'),WORDS,WORDS,true,false,{interfaceKey:'generic-interpolation-v1:g0/15/flat;g7/3/flat'});
 const all=Array.from({length:184},(_,i)=>({register:i>>2,component:i%4,word:i===0?1:0}));
 add('both-max-conditional',maxText(EXACT_VERTEX),maxText(EXACT_FRAGMENT),all,all,true,false,{instructions:768,textBytes:49152,temporaries:512,tuplesPerStage:184});
 add('both-max-ordinary',maxText(EXACT_VERTEX.replace('SIN TEMP[1].x, CONST[0].wwww','MOV TEMP[1].x, IMM[1].xxxx')),maxText(EXACT_FRAGMENT.replace('SIN TEMP[1].x, CONST[0].wwww','MOV TEMP[1].x, IMM[1].xxxx')),all,all,true,true,{instructions:768,textBytes:49152,temporaries:512,tuplesPerStage:184});
 add('vertex-instruction-769',maxText(EXACT_VERTEX,769),EXACT_FRAGMENT,all,WORDS,false);
 add('fragment-instruction-769',EXACT_VERTEX,maxText(EXACT_FRAGMENT,769),WORDS,all,false);
 add('vertex-too-long',EXACT_VERTEX+' '.repeat(49153-EXACT_VERTEX.length),EXACT_FRAGMENT,WORDS,WORDS,false);
 add('fragment-too-long',EXACT_VERTEX,EXACT_FRAGMENT+' '.repeat(49153-EXACT_FRAGMENT.length),WORDS,WORDS,false);
 const full=[['7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e','92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba'],['403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c','c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f']];
 for(const [vh,fh]of full){const path='evidence/virgl-workload-inventory/captures/es2gears/shaders/',v=fs.readFileSync(path+vh+'.tgsi','utf8'),f=fs.readFileSync(path+fh+'.tgsi','utf8'),old=raw.find(c=>c.name==='full-original/'+fh);add('full-original/'+fh,v,f,[],old.components,false,false,{vertexSource:path+vh+'.tgsi',fragmentSource:path+fh+'.tgsi'});}
 return list;
}
