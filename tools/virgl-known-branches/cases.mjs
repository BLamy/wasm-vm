// Complete source schedules. Truth predictions use integer UIF, not floats.
import {FLOW_CASES} from './flow-cases.mjs';
import {ORIGINAL_CASES} from './original-cases.mjs';
import {HELD_CASES} from './held-cases.mjs';
export const SEEDS=[0x243f6a88,0x85a308d3,0x13198a2e];
export const PARTNER_VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[0]\nEND\n';
export const HELD_VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL OUT[3], GENERIC[2]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[0]\nMOV OUT[2], IN[0]\nMOV OUT[3], IN[0]\nEND\n';
export const PARTNER_FRAGMENT='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {.25,.5,.75,1}\nMOV OUT[0], IMM[0]\nEND\n';
export const bits=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
export const imm=(i,w)=>`IMM[${i}] UINT32 {${w.join(',')}}`;
const color=[bits(.25),bits(.5),bits(.75),bits(1)];
export const header=(predicate=0,extra=[])=>['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..7]',...extra,imm(0,Array.isArray(predicate)?predicate:Array(4).fill(predicate)),imm(1,color),imm(2,[0,1,0x80000000,0x7fffffff])];
export const program=(body,predicate=0,extra=[])=>[...header(predicate,extra),...body,'END',''].join('\n');
export const selected=(condition,truth,live=['MOV OUT[0], IMM[1]'],dead=['SIN TEMP[1], IN[0]'])=>[`UIF ${condition}`,...(truth?live:dead),'ELSE',...(truth?dead:live),'ENDIF'];
export function physicalPlan(seed=SEEDS[0]){
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 const words=()=>Array.from({length:4},()=>bits((next()%8193-4096)/256));
 const controls=[{name:'zero',predicate:[0,1,0,1],source:'IMM[0].xxxx',truth:false},
  ...[0x80000000,1,0x7fc00001,0xff800000,0x80000001].map(p=>({name:'word-'+p,predicate:[p,p,p,p],source:'IMM[0].xxxx',truth:true})),
  {name:'swizzle-false',predicate:[1,0,1,1],source:'IMM[0].yyyy',truth:false},
  {name:'swizzle-true',predicate:[0,1,0,0],source:'IMM[0].yyyy',truth:true},
  {name:'masked-false',predicate:[1,0,1,1],prefix:['MOV TEMP[0].z, IMM[0].yyyy'],source:'TEMP[0].zzzz',truth:false},
  {name:'masked-true',predicate:[0,1,0,0],prefix:['MOV TEMP[0].z, IMM[0].yyyy'],source:'TEMP[0].zzzz',truth:true},
  {name:'partial-one',predicate:[0,0,0,0],prefix:['OR TEMP[0].x, IN[1].xxxx, IMM[2].yyyy'],source:'TEMP[0].xxxx',truth:true,dynamic:true},
  {name:'and-zero',predicate:[0,0,0,0],prefix:['AND TEMP[0].x, IN[1].xxxx, IMM[2].xxxx'],source:'TEMP[0].xxxx',truth:false,dynamic:true},
  {name:'nested-false',predicate:[0,0,0,0],source:'IMM[0].xxxx',truth:false,nested:true},
  {name:'nested-true',predicate:[1,1,1,1],source:'IMM[0].xxxx',truth:true,nested:true}];
 return controls.map(c=>({...c,seed,words:words(),integers:null})).map(c=>({...c,integers:c.words.map(w=>{const n=new Float32Array(new Uint32Array([w]).buffer)[0];return Math.trunc(n)>>>0;}),numeric:c.words.map(w=>bits(Math.trunc(new Float32Array(new Uint32Array([w]).buffer)[0])||0))}));
}
function physicalBody(row){
 const dead=row.nested?['UIF TEMP[7].xxxx','SIN TEMP[1], IN[0]','ELSE','POW TEMP[1], IN[0], IN[0]','ENDIF']:['SIN TEMP[1], IN[0]'];
 return[...(row.prefix??[]),...selected(row.source,row.truth,['MOV TEMP[1], IMM[1]'],dead)];
}
function physicalHeader(row,vertex){return[vertex?'VERT':'FRAG',...(vertex?['DCL IN[0]','DCL IN[1]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]','DCL OUT[3], GENERIC[2]']:['DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR',...(row.dynamic?['DCL IN[1], GENERIC[1], PERSPECTIVE']:[])]),'DCL TEMP[0..7]',imm(0,row.predicate),imm(1,row.words),imm(2,[0,1,0x80000000,0x7fffffff]),imm(3,[0x7fffff,0x3f000000,23,0]),imm(4,[0,8,16,24]),imm(5,[255,255,255,255])];}
export function carrier(row){return[...physicalHeader(row,true),...physicalBody(row),'AND TEMP[2], TEMP[1], IMM[3].xxxx','OR TEMP[2], TEMP[2], IMM[3].yyyy','USHR TEMP[3], TEMP[1], IMM[3].zzzz','OR TEMP[3], TEMP[3], IMM[3].yyyy','F2I TEMP[4], TEMP[1]','I2F TEMP[5], TEMP[4]','MOV OUT[0], IN[0]','MOV OUT[1], TEMP[2]','MOV OUT[2], TEMP[3]','MOV OUT[3], TEMP[5]','END',''].join('\n');}
export function bytesFragment(row,lane=0,converted=false){return[...physicalHeader(row,false),...physicalBody(row),'F2I TEMP[4], TEMP[1]',`USHR TEMP[2], TEMP[${converted?4:1}].${'xyzw'[lane].repeat(4)}, IMM[4]`,'AND TEMP[2], TEMP[2], IMM[5]','I2F TEMP[3], TEMP[2]','I2F TEMP[5], IMM[5]','DIV OUT[0], TEMP[3], TEMP[5]','END',''].join('\n');}
export const PHYSICAL_VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[0]\nMOV OUT[2], IN[0]\nEND\n';
export function specialPlan(){
 const rows=[
  {name:'dead/kill',text:program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['KILL','SIN TEMP[0], TEMP[7]'])),mode:'color'},
  {name:'dead/kill-if',text:program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['KILL_IF -|TEMP[7]|','SIN TEMP[0], TEMP[7]'])),mode:'color'},
  {name:'live/kill',text:program(['UIF IMM[2].yyyy','KILL','ELSE','SIN TEMP[1], IN[0]','ENDIF']),mode:'discard'},
  ...[0x80000000,0xffc00001,0xff800000].map(w=>({name:'kill-if/raw-'+w,text:program(selected('IMM[2].yyyy',true,['KILL_IF IMM[0]','MOV OUT[0], IMM[1]']),w),mode:w===0xff800000?'discard':'color'})),
  {name:'kill-if/dynamic-negative',text:program(selected('IMM[2].yyyy',true,['KILL_IF IN[0].xxxx','MOV OUT[0], IMM[1]'])),mode:'negative-x'},
  {name:'texture/dead',text:program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['TEX TEMP[0], TEMP[7], SAMP[0], 2D']),0,['DCL SAMP[0]','DCL SVIEW[0], 2D, FLOAT']),mode:'color'},
  {name:'texture/live',text:program(selected('IMM[0].xxxx',false,['TEX OUT[0], IN[0], SAMP[0], 2D']),0,['DCL SAMP[0]','DCL SVIEW[0], 2D, FLOAT']),mode:'color',sampler:true},
  ...[false,true].map(truth=>({name:'raster/'+truth,text:program(selected('IMM[0].xxxx',truth,['MOV OUT[0], CONST[0]']),+truth,['DCL CONST[0]']),mode:'color',bank:true})),
 ];
 return rows.map(c=>({...c,expectedColor:[64,128,191,255],clear:[23,47,71,95]}));
}
export const physicalLoops=()=>FLOW_CASES.filter(c=>c.ok);
export function getCases(){
 const cases=[],add=(name,text,ok,stage='fragment',properties={})=>cases.push({name,stage,text,ok,partner:stage==='vertex'?PARTNER_FRAGMENT:PARTNER_VERTEX,pairOk:ok,...properties});
 for(const predicate of[0,0x80000000,1,0x7fc00001,0xff800000,0x80000001])add('literal/'+predicate,program(selected('IMM[0].xxxx',predicate!==0),predicate),true);
 add('true/no-else',program(['UIF IMM[0].xxxx','MOV OUT[0], IMM[1]','ENDIF'],1),true);
 add('false/no-else',program(['MOV OUT[0], IMM[1]','UIF IMM[0].xxxx','SIN OUT[0], IN[0]','ENDIF']),true);
 for(const [name,body,truth]of[['mask-z-true',['MOV TEMP[0].z, IMM[2].yyyy'],true],['mask-z-false',['MOV TEMP[0].z, IMM[2].xxxx'],false]])add(name,program([...body,...selected('TEMP[0].zzzz',truth)]),true);
 for(const [name,body,truth]of[['partial-one',['OR TEMP[0].x, IN[0].xxxx, IMM[2].yyyy'],true],['and-zero',['AND TEMP[0].x, IN[0].xxxx, IMM[2].xxxx'],false],['not-known',['NOT TEMP[0].x, IMM[2].wwww'],true],['masked-unrelated',['MOV TEMP[0], IMM[0]','MOV TEMP[0].w, IN[0].xxxx'],false]])add(name,program([...body,...selected('TEMP[0].xxxx',truth)]),true);
 for(const truth of[false,true])add('swizzle/'+truth,program(selected('IMM[0].yyyy',truth),truth?[0,1,0,0]:[1,0,1,1]),true);
 for(const truth of[false,true])add('nested/'+truth,program(selected('IMM[0].xxxx',truth,['MOV OUT[0], IMM[1]'],['UIF TEMP[7].xxxx','SIN TEMP[1], IN[0]','ELSE','POW TEMP[1], IN[0], IN[0]','ENDIF']),+truth),true);
 const testTail=selected('TEMP[0].xxxx',true);
 add('unknown/input',program(selected('IN[0].xxxx',false)),false);
 add('unknown/const',program(selected('CONST[0].xxxx',false),0,['DCL CONST[0]']),false);
 add('unknown/overwrite',program(['MOV TEMP[0], IMM[2].yyyy','MOV TEMP[0].x, IN[0].xxxx',...testTail]),false);
 add('unknown/zero-bits-only',program(['AND TEMP[0].x, IN[0].xxxx, IMM[2].zzzz',...testTail]),false);
 add('missing/live-temp',program(['UIF IMM[2].yyyy','MOV OUT[0], TEMP[0]','ELSE','SIN TEMP[1], IN[0]','ENDIF']),false);
 add('missing/live-predicate',program(selected('TEMP[0].xxxx',true)),false);
 add('missing/live-output',program(['UIF IMM[0].xxxx','MOV OUT[0], IMM[1]','ENDIF']),false);
 add('missing/dead-write-not-published',program(['UIF IMM[0].xxxx','MOV TEMP[0], IMM[1]','ELSE','MOV TEMP[1], IMM[1]','ENDIF','MOV OUT[0], TEMP[0]']),false);
 for(const [name,a,b,ok]of[['same-one',1,1,true],['same-zero',0,0,true],['different-nonzero',1,2,true],['conflict',0,1,false]]){
  const truth=a!==0,lines=['UIF IN[0].xxxx',`MOV TEMP[0].x, IMM[${a===0?0:2}].${a===2?'zzzz':'yyyy'}`,'ELSE',`MOV TEMP[0].x, IMM[${b===0?0:2}].${b===2?'zzzz':'yyyy'}`,'ENDIF',...selected('TEMP[0].xxxx',truth)];
  if(name==='different-nonzero')lines[1]='OR TEMP[0].x, IN[0].xxxx, IMM[2].yyyy',lines[3]='OR TEMP[0].x, IN[0].yyyy, IMM[2].yyyy';
  add('join/'+name,program(lines),ok);
 }
 add('join/dynamic-other',program(['UIF IN[0].xxxx','MOV TEMP[0].x, IMM[2].yyyy','ELSE','MOV TEMP[0].x, IN[0].yyyy','ENDIF',...testTail]),false);
 add('join/missing-other',program(['UIF IN[0].xxxx','MOV TEMP[0].x, IMM[2].yyyy','ENDIF',...testTail]),false);
 add('dead/kill',program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['KILL','SIN TEMP[0], TEMP[7]'])),true);
 add('dead/kill-if',program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['KILL_IF -|TEMP[7]|','SIN TEMP[0], TEMP[7]'])),true);
 add('live/kill',program(['UIF IMM[2].yyyy','KILL','ELSE','SIN TEMP[1], IN[0]','ENDIF']),true);
 add('live/kill-if',program(['UIF IMM[2].yyyy','KILL_IF -IMM[1]','ELSE','SIN TEMP[1], IN[0]','ENDIF']),true);
 add('live/kill-if-zero-not-terminal',program(['UIF IMM[2].yyyy','KILL_IF IMM[0]','ELSE','SIN TEMP[1], IN[0]','ENDIF']),false);
 add('live/kill-if-nan-not-terminal',program(['UIF IMM[2].yyyy','KILL_IF IMM[0]','ELSE','SIN TEMP[1], IN[0]','ENDIF'],0xffc00001),false);
 add('discard/join-live',program(['UIF IN[0].xxxx','KILL','ELSE','MOV TEMP[0].x, IMM[2].yyyy','ENDIF',...testTail]),true);
 const bank=['DCL CONST[0..3]','DCL ADDR[0]'];
 add('indirect/dead-accounted',program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['MOV TEMP[0], CONST[ADDR[0].x]']),0,bank),true);
 add('indirect/dead-address-write',program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['UARL ADDR[0].x, TEMP[7].xxxx','MOV TEMP[0], CONST[ADDR[0].x]']),0,bank),true);
 add('indirect/live-missing-write',program(selected('IMM[2].yyyy',true,['MOV OUT[0], CONST[ADDR[0].x]']),0,bank),false);
 add('indirect/dead-write-not-live',program(['UIF IMM[0].xxxx','UARL ADDR[0].x, IMM[0].xxxx','ELSE','MOV TEMP[0], IMM[1]','ENDIF','MOV OUT[0], CONST[ADDR[0].x]'],0,bank),false);
 add('indirect/no-declared-bank',program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['MOV TEMP[0], CONST[ADDR[0].x]']),0,['DCL ADDR[0]']),false);
 add('indirect/undeclared-address',program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['MOV TEMP[0], CONST[ADDR[0].x]']),0,['DCL CONST[0]']),false);
 add('indirect/unused-address',program(selected('IMM[0].xxxx',false),0,bank),false);
 add('indirect/live-valid',program(['UARL ADDR[0].x, IMM[0].xxxx',...selected('IMM[0].xxxx',false,['MOV OUT[0], CONST[ADDR[0].x]'])],0,bank),true);
 for(const truth of[false,true])add('raster/'+truth,program(selected('IMM[0].xxxx',truth,['MOV OUT[0], CONST[0]']),+truth,['DCL CONST[0]']),true);
 add('precise/dead-and-live',program(selected('IMM[0].xxxx',false,['MOV_PRECISE OUT[0], IMM[1]'],['ADD_PRECISE TEMP[0], TEMP[7], TEMP[7]'])),true);
 add('texture/dead',program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['TEX TEMP[0], TEMP[7], SAMP[0], 2D']),0,['DCL SAMP[0]','DCL SVIEW[0], 2D, FLOAT']),true);
 add('known-arithmetic/composition',program(selected('IMM[0].xxxx',false,['ADD TEMP[0], IMM[1], IMM[1]','MUL TEMP[0], TEMP[0], IMM[1]','F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]'])),true);
 add('direct-bank-composition',program(selected('IMM[0].xxxx',false,['F2I TEMP[0], CONST[0]','I2F OUT[0], TEMP[0]']),0,['DCL CONST[0..45]']),true);
 let coordinate=program(selected('IMM[0].xxxx',false,['MOV OUT[0], IN[0]']));coordinate=coordinate.replace('FRAG\n','FRAG\nPROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\n').replace('DCL IN[0], GENERIC[0], PERSPECTIVE','DCL IN[0], POSITION, LINEAR');add('coordinates/composition',coordinate,true);
 for(const line of['SQRT TEMP[0], IN[0]','MOV TEMP[0], TEMP[8]','MOV TEMP[0], IMM[3]','MOV TEMP[0].q, IMM[1]','MOV TEMP[0], IN[0].qqqq','SIN TEMP[0]','POW TEMP[0], IN[0]','SIN TEMP[0], IN[0], IMM[1]','UIF -IMM[0]','AND TEMP[0], |IN[0]|, IMM[0]','UARL TEMP[0].x, IMM[0]','BRK','BGNLOOP :1','MOV TEMP[0], CONST[ADDR[0].y]'])add('bad-dead/'+line,program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],[line])),false);
 for(const line of['TEX TEMP[0], TEMP[7], SAMP[0], 3D','TEX TEMP[0], TEMP[7], SAMP[1], 2D','TEX TEMP[0], TEMP[7], SAMP[0].xxxx, 2D','MOV TEMP[0], CONST[46]','MOV TEMP[0], IN[8]','MOV TEMP[512], IMM[1]','MOV TEMP[0], TEMP[512]','SIN TEMP[0], |IN[0]|','KILL_IF |TEMP[7]','KILL_IF TEMP[7], IMM[1]'])add('bad-dead-operand/'+line,program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],[line]),0,['DCL SAMP[0]','DCL SVIEW[0], 2D, FLOAT']),false);
 add('declaration/temp-511',program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],['MOV TEMP[511], TEMP[511]']),0,['DCL TEMP[511]']),true);
 add('declaration/temp-512',program(selected('IMM[0].xxxx',false),0,['DCL TEMP[512]']),false);
 for(const width of[512,513]){const line='SIN TEMP[1], IN[0]';add('line-bytes/'+width,program(selected('IMM[0].xxxx',false,['MOV OUT[0], IMM[1]'],[line+' '.repeat(width-line.length)])),width===512);}
 for(const suffix of['MOV OUT[0], IMM[1]','BOGUS','ELSE','ENDIF','END','\u0000'])add('bad-tail/'+JSON.stringify(suffix),program(selected('IMM[0].xxxx',false))+suffix+'\n',false);
 add('label/valid',program(selected('IMM[0].xxxx',false)).replace('UIF IMM[0].xxxx','0: UIF IMM[0].xxxx :2').replace('SIN TEMP[1], IN[0]','1: SIN TEMP[1], IN[0]').replace('\nELSE\n','\n2: ELSE :4\n').replace('MOV OUT[0], IMM[1]','3: MOV OUT[0], IMM[1]').replace('\nENDIF\n','\n4: ENDIF\n').replace('\nEND\n','\n5: END\n'),true);
 const labelled=cases.at(-1).text;
 for(const [name,change]of[['wrong-label',t=>t.replace('0: UIF','1: UIF')],['wrong-target',t=>t.replace('xxxx :2','xxxx :3')],['over-target',t=>t.replace('xxxx :2','xxxx :768')],['dead-double-else',t=>t.replace('1: SIN TEMP[1], IN[0]','ELSE')]])add('label/'+name,change(labelled),false);
 for(const depth of[16,17])add('depth/'+depth,program([...Array(depth).fill('UIF IMM[0].xxxx'),'SIN TEMP[0], IN[0]',...Array(depth).fill('ENDIF'),'MOV OUT[0], IMM[1]']),depth===16);
 const core=program(selected('IMM[0].xxxx',false));for(const count of[768,769]){const body=['UIF IMM[0].xxxx',...Array(count-4).fill('MOV TEMP[0], TEMP[7]'),'ELSE','MOV OUT[0], IMM[1]','ENDIF'];add('instructions/'+count,program(body),count===768);}
 for(const bytes of[49152,49153])add('text-bytes/'+bytes,core+'\n'.repeat(bytes-core.length),bytes===49152);
 for(const seed of SEEDS)for(const row of physicalPlan(seed)){
  add('gpu/'+row.name+'/'+seed,carrier(row),true,'vertex');
  for(const converted of[false,true])add('gpu-bytes/'+row.name+'/'+seed+'/'+converted,bytesFragment(row,0,converted),true,'fragment',{partner:row.dynamic?PHYSICAL_VERTEX:PARTNER_VERTEX});
 }
 for(const row of specialPlan())if(!cases.some(c=>c.name===row.name))add(row.name,row.text,true);
 for(const c of ORIGINAL_CASES)cases.push(c);
 for(const c of HELD_CASES)add(c.name,c.text,c.ok,c.stage,{held:true,expectedProfile:c.expectedProfile,sourceFixture:c.sourceFixture,partner:c.stage==='fragment'?HELD_VERTEX:PARTNER_FRAGMENT});
 for(const c of FLOW_CASES)add(c.name,c.text,c.ok,c.stage);
 return cases;
}
