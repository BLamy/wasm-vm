import {compilerCases} from '../virgl-standard-uniform/cases.mjs';
import {textureOperationFixtures} from './hardware-fixtures.mjs';
const zero={signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0,bufferZeroMask:0};
export const selectorKeys=Object.keys(zero);
export function textureCompilerCases(readiness){
const oldCases=compilerCases();const cases=oldCases.map(c=>({...c,name:'retained-uniform-grammar/'+c.name}));
const ready=readiness.rows.filter(r=>r.profile==='standard');
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const add=(name,stage,a,okay=true,code=okay?null:'unsupported-feature')=>cases.push({name,kind:stage==='vertex'?0:1,a,b:'',selectors:{...zero},okay,code});
for(const r of ready) {
 const okay=!(r.opcode==='TXB'&&r.stage==='vertex');
 for(const slot of [0,3,15]) {
  const a=r.text.replaceAll('SAMP[0]',`SAMP[${slot}]`).replaceAll('SVIEW[0]',`SVIEW[${slot}]`);
  add(`${r.stage}/${r.opcode}/slot${slot}`,r.stage,a,okay);
  for(const mask of ['x','xy','w','xyw'])add(`${r.stage}/${r.opcode}/slot${slot}/mask${mask}`,r.stage,a.replace(`0: ${r.opcode} TEMP[0],`,`0: ${r.opcode} TEMP[0].${mask},`),okay);
  if(r.opcode!=='TXQ')for(const suffix of ['_SAT','_PRECISE'])add(`${r.stage}/${r.opcode}/slot${slot}/${suffix}`,r.stage,a.replace(`0: ${r.opcode} `,`0: ${r.opcode}${suffix} `),okay);
  if(r.opcode==='TXQ')for(const suffix of ['_SAT','_PRECISE'])add(`${r.stage}/${r.opcode}/slot${slot}/${suffix}`,r.stage,a.replace('0: TXQ ','0: TXQ'+suffix+' '),false);
  if(['TXL','TXB','TXD'].includes(r.opcode))for(const operand of ['IMM[0].yxzw','-IMM[0]','|IMM[0]|','-|IMM[0]|'])add(`${r.stage}/${r.opcode}/slot${slot}/source${operand}`,r.stage,a.replace(`0: ${r.opcode} TEMP[0], IMM[0],`,`0: ${r.opcode} TEMP[0], ${operand},`),okay);
 }
 for(const operand of ['IMM[0].yxzw','-IMM[0]','|IMM[0]|'])if(['TXF','TXQ'].includes(r.opcode))add(`${r.stage}/${r.opcode}/integer-source${operand}`,r.stage,r.text.replace(`0: ${r.opcode} TEMP[0], IMM[0],`,`0: ${r.opcode} TEMP[0], ${operand},`),!operand.includes('|'));
 for(const [name,a] of [
   ['missing-view',r.text.replace('DCL SVIEW[0], 2D, FLOAT\n','')],
   ['integer-view',r.text.replace('SVIEW[0], 2D, FLOAT','SVIEW[0], 2D, UINT')],
   ['cube',r.text.replaceAll(', 2D',', CUBE')],
   ['modified-sampler',r.text.replace(/SAMP\[0\], 2D/g,'-SAMP[0], 2D')],
   ['partial-sampler',r.text.replace(/SAMP\[0\], 2D/g,'SAMP[0].xxxx, 2D')],
   ['missing-target',r.text.replace(/SAMP\[0\], 2D/g,'SAMP[0]')],
   ['undeclared-sampler',r.text.replace(/SAMP\[0\], 2D/g,'SAMP[2], 2D')],
   ['extra-offset',r.text.replace(/SAMP\[0\], 2D/g,'SAMP[0], 2D, IMM[0]')],
 ]) add(`${r.stage}/${r.opcode}/${name}`,r.stage,a,false);
 for(const kind of [r.stage==='vertex'?7:8,r.stage==='vertex'?12:13])cases.push({name:`historical${kind}/${r.stage}/${r.opcode}`,kind,a:r.text,b:'',selectors:{...zero},okay:false,code:'unsupported-feature'});
 if(r.stage==='fragment'&&okay)cases.push({name:`pair/${r.opcode}`,kind:2,a:vertex,b:r.text,selectors:{...zero},okay:true,code:null});
}
for(const r of ready.filter(r=>r.stage==='fragment'))for(const opcode of ['TXL2','TXB2','TXP','TG4','LODQ','TXQS'])add(`unsupported-family/${r.opcode}`,r.stage,r.text.replace(`0: ${r.opcode} `,`0: ${opcode} `),false);

for(const stage of ['vertex','fragment']) {
 const prefix=stage==='vertex'?'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n':'FRAG\nDCL OUT[0], COLOR\n';
 const declarations=Array.from({length:16},(_,index)=>`DCL SAMP[${index}]\nDCL SVIEW[${index}], 2D, FLOAT\n`).join('');
 const lines=['MOV TEMP[0], IMM[1]',...Array.from({length:16},(_,index)=>`TXQ TEMP[0].w, IMM[0], SAMP[${15-index}], 2D`),'U2F TEMP[0], TEMP[0]'];
 if(stage==='vertex')lines.push('MOV OUT[0], IN[0]');lines.push(`MOV OUT[${stage==='vertex'?1:0}], TEMP[0]`,'END');
 const source=prefix+'DCL TEMP[0]\n'+declarations+'IMM[0] INT32 {1,0,0,0}\nIMM[1] UINT32 {11,22,33,44}\n'+lines.map((line,index)=>index+': '+line+'\n').join('');
 add(stage+'/all16-sorted-query-uniforms',stage,source);
}

for(const f of textureOperationFixtures())cases.push({name:'hardware/'+f.name,kind:2,a:f.vertexText,b:f.fragmentText,selectors:f.selectors,okay:true,code:null});
return cases;
}
