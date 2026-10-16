import fs from 'node:fs';
import {textureCompilerCases} from '../virgl-standard-texture/cases.mjs';
import {integerImageFixtures,passVertex,selectorKeys} from './fixtures.mjs';
const zero=()=>Object.fromEntries(selectorKeys.map(k=>[k,0]));
export function compilerCases(){
 const readiness=JSON.parse(fs.readFileSync(new URL('../../evidence/virgl-production-readiness/standard-texture-operation-gap.json',import.meta.url)));
 const cases=textureCompilerCases(readiness).map(c=>({...c,name:'old/'+c.name,selectors:{...zero(),...c.selectors}}));
 const negative=JSON.parse(fs.readFileSync(new URL('../../evidence/virgl-production-readiness/standard-integer-image-shader-gap.json',import.meta.url)));
 const add=(name,kind,a,b='',selectors=zero(),okay=true,code=okay?null:'unsupported-feature')=>cases.push({name,kind,a,b,selectors,okay,code});
 for(const r of readiness.rows.filter(r=>r.profile==='standard'))add(`${r.stage}/FLOAT/${r.opcode}/selected`,r.stage==='vertex'?15:16,r.text,'',zero(),!(r.stage==='vertex'&&r.opcode==='TXB'));
 for(const r of negative.records)for(const slot of [0,3,15])for(const fields of [1,2,3,4]){
  const text=r.text.replaceAll('SAMP[0]',`SAMP[${slot}]`).replaceAll('SVIEW[0]',`SVIEW[${slot}]`).replace(`2D, ${r.type}\n`,`2D, ${Array(fields).fill(r.type).join(', ')}\n`),kind=r.stage==='vertex'?15:16,m=zero();
  if(r.stage==='fragment')m[r.type==='SINT'?'signedColorMask':'unsignedColorMask']=1;
  add(`${r.stage}/${r.type}/${r.op}/slot${slot}/fields${fields}`,kind,text,'',m);
  if(fields===1){
   for(const suffix of ['_SAT','_PRECISE'])add(`${r.stage}/${r.type}/${r.op}/slot${slot}/${suffix}`,kind,text.replace(`0: ${r.op} `,`0: ${r.op}${suffix} `),'',m,r.op!=='TXQ');
   for(const mask of ['x','xy','w','xyw'])add(`${r.stage}/${r.type}/${r.op}/slot${slot}/mask${mask}`,kind,text.replace(`0: ${r.op} OUT[${r.stage==='vertex'?1:0}],`,`0: ${r.op} OUT[${r.stage==='vertex'?1:0}].${mask},`),'',m);
   if(r.op==='TXL')for(const operand of ['-CONST[0]','|CONST[0]|','-|CONST[0]|','CONST[0].yxzw'])add(`${r.stage}/${r.type}/${r.op}/source${operand}`,kind,text.replace('0: TXL OUT[','0: TXL OUT[').replace(', CONST[0], SAMP',`, ${operand}, SAMP`),'',m);
  }
 }
 for(const r of negative.records){
  const kind=r.stage==='vertex'?15:16;
  for(const replacement of ['UNORM','SNORM','DOUBLE',`${r.type}, ${r.type==='SINT'?'UINT':'SINT'}`,Array(5).fill(r.type).join(', ')])add(`${r.stage}/${r.type}/${r.op}/bad-return/${replacement}`,kind,r.text.replace(`2D, ${r.type}`,`2D, ${replacement}`),'',zero(),false);
  for(const [label,text]of [['bad-target',r.text.replaceAll('2D','CUBE')],['bad-slot',r.text.replaceAll('[0], 2D','[16], 2D').replace('SAMP[0]\n','SAMP[16]\n')],['missing-view',r.text.replace(`DCL SVIEW[0], 2D, ${r.type}\n`,'')]])add(`${r.stage}/${r.type}/${r.op}/${label}`,kind,text,'',zero(),false);
  for(const m of [{signedColorMask:16},{unsignedColorMask:0xffffffff},{signedColorMask:1,unsignedColorMask:1},{unsignedColorMask:r.stage==='vertex'?1:2}])add(`${r.stage}/${r.type}/${r.op}/bad-mask/${JSON.stringify(m)}`,kind,r.text,'',{...zero(),...m},false,'invalid-input');
  add(`${r.stage}/${r.type}/${r.op}/old-refusal`,r.stage==='vertex'?0:1,r.text,'',zero(),false);
 }
 const broadcast='FRAG\nDCL OUT[5], COLOR\nPROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1\nIMM[0] UINT32 {1048576000,1075838976,3196059648,1065353216}\n0: MOV OUT[5], IMM[0]\n1: END\n';
 for(let types=0;types<81;types++){let n=types,signedColorMask=0,unsignedColorMask=0;for(let i=0;i<4;i++){const t=n%3;n=Math.floor(n/3);if(t===1)signedColorMask|=1<<i;if(t===2)unsignedColorMask|=1<<i;}add(`broadcast/${types}`,17,passVertex,broadcast,{...zero(),signedColorMask,unsignedColorMask});}
 add('old-broadcast',2,passVertex,broadcast);
 add('old-uniform-pair',14,passVertex,broadcast);
 const system='VERT\nDCL IN[0]\nDCL SV[0], VERTEXID\nDCL SV[1], INSTANCEID\nDCL OUT[0], POSITION\nDCL OUT[1], PSIZE\nDCL TEMP[0]\n0: MOV OUT[0], IN[0]\n1: I2F TEMP[0], SV[0]\n2: I2F TEMP[0].y, SV[1]\n3: MOV OUT[1].x, TEMP[0].xxxx\n4: END\n';
 add('old-system-point-metadata',7,system);
 add('selected-system-point-metadata',15,system);
 for(const m of [{signedColorMask:16},{unsignedColorMask:0xffffffff},{signedColorMask:1,unsignedColorMask:1},{unsignedColorMask:2}])add('paired-color-mask/'+JSON.stringify(m),17,passVertex,negative.records.find(r=>r.stage==='fragment').text,{...zero(),...m},false,'invalid-input');
 const sparse='FRAG\nDCL OUT[7], COLOR[3]\nIMM[0] UINT32 {1,2147483648,4294967295,17}\n0: MOV OUT[7], IMM[0]\n1: END\n';
 for(const mask of [0,8])add('sparse-good/'+mask,16,sparse,'',{...zero(),signedColorMask:mask});
 add('sparse-wrong-register',16,sparse,'',{...zero(),signedColorMask:1},false,'invalid-input');
 for(const stage of ['vertex','fragment'])for(const type of ['FLOAT','SINT','UINT']){
  const prefix=stage==='vertex'?'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n':'FRAG\nDCL OUT[0], COLOR\n';
  const declarations=Array.from({length:16},(_,i)=>`DCL SAMP[${i}]\n`).join('')+`DCL SVIEW[0..15], 2D, ${type}\nDCL TEMP[0]\nIMM[0] INT32 {0,0,0,0}\n`;
  const lines=Array.from({length:16},(_,i)=>`TXQ TEMP[0].w, IMM[0], SAMP[${15-i}], 2D`);if(stage==='vertex')lines.push('MOV OUT[0], IN[0]');lines.push(`MOV OUT[${stage==='vertex'?1:0}], TEMP[0]`,'END');
  add(`${stage}/${type}/all16-range-query`,stage==='vertex'?15:16,prefix+declarations+lines.map((l,i)=>`${i}: ${l}\n`).join(''),'',{...zero(),unsignedColorMask:stage==='fragment'?1:0});
  add(`${stage}/${type}/sampler-declaration-range-refused`,stage==='vertex'?15:16,prefix+declarations.replace(/(?:DCL SAMP\[\d+\]\n){16}/,'DCL SAMP[0..15]\n')+lines.map((l,i)=>`${i}: ${l}\n`).join(''),'',{...zero(),unsignedColorMask:stage==='fragment'?1:0},false);
 }
 const base=negative.records.find(r=>r.stage==='fragment'&&r.type==='UINT'&&r.op==='TXL');
 add('null-stage',20,base.text,'',zero(),false,'invalid-input');add('bad-stage',21,base.text,'',zero(),false,'unsupported-stage');
 for(const [kind,label]of [[18,'null-vertex'],[19,'null-fragment']])add(label,kind,passVertex,base.text,zero(),false,'invalid-input');
 for(const f of integerImageFixtures())add('hardware/'+f.name,17,f.vertexText,f.fragmentText,f.selectors);
 return cases;
}
