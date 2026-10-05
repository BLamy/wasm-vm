// Hand-authored source shapes; expected words use binary exponent arithmetic.
import fs from 'node:fs';
export const VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n';
const imm='IMM[0] FLT32 {0.25,0.0,0.0,1.0}';
const result=(word)=>((word&0x80000000)|((254-((word>>>23)&255))<<23))>>>0;
function fragment({register=0,component=0,mask='w',modifier='',mode='branch',original=false,source='CONST',overwrite=false}={}){
 const lane='xyzw'[component],written=mask[0],limit=original?33:1,temp=original?48:0;
 const header=['FRAG','DCL OUT[0], COLOR',`DCL CONST[0..${limit}]`,`DCL TEMP[0..${original?50:3}]`,imm];
 const direct=`CONST[${register}].${lane.repeat(4)}`;
 const src=`${modifier}${source==='TEMP'?'TEMP[3].xxxx':source==='IMM'?'IMM[1].xxxx':direct}${modifier==='|'?'|':''}`;
 const before=original?['MOV TEMP[47].x, IMM[0].xxxx'] :
  source==='TEMP'?[`MOV TEMP[3].x, ${direct}`]:source==='IMM'?['IMM[1] FLT32 {2.0,0.0,0.0,0.0}']:[];
 const rcp=`RCP TEMP[${temp}].${mask}, ${src}`;
 const tail=mode==='winner'?[]:mode==='pow'?
  [`POW TEMP[${original?49:1}].x, ${original?'TEMP[47].xxxx':'IMM[0].xxxx'}, TEMP[${temp}].${written.repeat(4)}`,
   `MOV OUT[0], TEMP[${original?49:1}].xxxx`]:
  [`UIF TEMP[${temp}].${written.repeat(4)}`,'MOV OUT[0], IMM[0]','ELSE',
   `SIN TEMP[${original?50:2}].x, CONST[${original?33:1}].xxxx`,
   `MOV OUT[0], TEMP[${original?50:2}].xxxx`,'ENDIF'];
 return [...header,...before,rcp,...(overwrite?[`MOV TEMP[${temp}].${written}, CONST[1].xxxx`]:[]),
  ...tail,...(mode==='winner'?['MOV OUT[0], TEMP[0].xxxx']:[]),'END',''].join('\n');
}
export function cases(){
 const rows=[],add=(name,word,options={},accept=true)=>{
  const {register=0,component=0}=options;
  rows.push({name,vertexText:VERTEX,fragmentText:fragment(options),vertexComponents:[],
   fragmentComponents:[{register,component,word}],accept,expectedWord:accept&&options.mode!=='winner'?result(options.modifier==='|'?word&0x7fffffff:options.modifier==='-'?(word^0x80000000)>>>0:word):null,
   mode:options.mode??'branch',word});
 };
 for(const exponent of [1,2,3,126,127,128,129,252,253])for(const sign of [0,0x80000000])
  add(`edge-${exponent}-${sign?'-':'+'}`,((exponent<<23)|sign)>>>0);
 for(const [name,word] of [['zero',0],['negative-zero',0x80000000],['subnormal',1],
   ['largest-subnormal',0x007fffff],['fractional-mantissa',0x3fc00000],
   ['overflow-reciprocal',0x7f000000],['infinity',0x7f800000],['nan',0x7fc00000]])
  add('reject-'+name,word,{},false);
 for(const [name,component,mask,modifier,word] of [
  ['y-to-x',1,'x','',0x40000000],['z-to-y',2,'y','',0x3f000000],
  ['w-to-z',3,'z','',0x3f800000],['broadcast-yw',0,'yw','',0x40000000],
  ['negate',0,'w','-',0x40000000],['absolute-rejected',0,'w','|',0xc0000000]])
  add(name,word,{component,mask,modifier,mode:'pow'},modifier!=='|');
 add('ordinary-winner',0x40000000,{mask:'x',mode:'winner'});
 add('saved-temp-source-stays-opaque',0x40000000,{source:'TEMP'},false);
 add('immediate-source-stays-opaque',0x40000000,{source:'IMM'},false);
 add('overwritten-rcp-version',0x40000000,{overwrite:true},false);
 add('c580-pc34-35',0x40000000,{register:30,component:0,mask:'x',mode:'pow',original:true});
 for(const [name,kind] of [['92cb','92cb866a'],['c580','c5806d5f']]){
  const shader=fs.readdirSync('evidence/virgl-workload-inventory/captures/es2gears/shaders').find(x=>x.startsWith(kind)&&x.endsWith('.tgsi'));
  const vertexHash=name==='92cb'?'7bf4d0d0':'403b0529';
  const vertex=fs.readdirSync('evidence/virgl-workload-inventory/captures/es2gears/shaders').find(x=>x.startsWith(vertexHash)&&x.endsWith('.tgsi'));
  const root='evidence/virgl-workload-inventory/captures/es2gears/shaders/';
  rows.push({name:'full-original-'+name,vertexText:fs.readFileSync(root+vertex,'utf8'),fragmentText:fs.readFileSync(root+shader,'utf8'),
   vertexComponents:[],fragmentComponents:[{register:30,component:0,word:0x40000000}],accept:false,expectedWord:null,mode:'original',word:0x40000000});
 }
 return rows;
}
