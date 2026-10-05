// Literal source words and programs. Floating-point host comparison supplies
// primitive predictions independently of the compiler's integer classifier.
export const SEEDS = [0x9e3779b9, 0x243f6a88, 0x85a308d3];
export const CLEAR = [17, 34, 51, 68], WRITTEN = [64, 128, 191, 255];
export const VERTEX = 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n';
export const FRAGMENT = 'FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {.25,.5,.75,1}\nMOV OUT[0], IMM[0]\nEND\n';
export const WORDS = [
 ['positive-zero',0],['negative-zero',0x80000000],['positive-min-subnormal',1],['negative-min-subnormal',0x80000001],
 ['positive-max-subnormal',0x007fffff],['negative-max-subnormal',0x807fffff],['positive-min-normal',0x00800000],['negative-min-normal',0x80800000],
 ['positive-one',0x3f800000],['negative-one',0xbf800000],['positive-max-finite',0x7f7fffff],['negative-max-finite',0xff7fffff],
 ['positive-infinity',0x7f800000],['negative-infinity',0xff800000],['positive-quiet-nan',0x7fc12345],['negative-quiet-nan',0xffc12345],
 ['positive-signaling-nan',0x7f800001],['negative-signaling-nan',0xff800001]
];
export const MODIFIERS = ['plain', 'negative', 'absolute', 'negative-absolute'];
const source = (register, swizzle, modifier) => `${modifier.startsWith('negative')?'-':''}${modifier.includes('absolute')?'|':''}${register}.${swizzle}${modifier.includes('absolute')?'|':''}`;
export const decoded = word => new Float32Array(new Uint32Array([word]).buffer)[0];
export function sourceValues(words, swizzle, modifier) {
 return [...swizzle].map(lane => {let value=decoded(words['xyzw'.indexOf(lane)]);if(modifier.includes('absolute'))value=Math.abs(value);return modifier.startsWith('negative')?-value:value;});
}
export function primitive(words, swizzle='xyzw', modifier='plain', variant='immediate') {
 const declaration=variant==='uniform'?'DCL CONST[0]':`IMM[1] UINT32 {${words}}`;
 const before=variant==='copied'||variant==='alias'||variant==='saved'?['MOV TEMP[0], IMM[1]']:[];
 if(variant==='alias')before.push('MOV TEMP[0], TEMP[0].wzyx');
 if(variant==='saved')before.push('MOV TEMP[1], TEMP[0]','MOV TEMP[0], IMM[0]');
 const register=variant==='uniform'?'CONST[0]':variant==='saved'?'TEMP[1]':before.length?'TEMP[0]':'IMM[1]';
 return ['FRAG','DCL OUT[0], COLOR','DCL TEMP[0..3]',...(variant==='uniform'?[declaration]:[]),
  'IMM[0] FLT32 {.25,.5,.75,1}',...(variant==='uniform'?[]:[declaration]),...before,
  `KILL_IF ${source(register,swizzle,modifier)}`,'MOV OUT[0], IMM[0]','END',''].join('\n');
}
export function branch(kind) {
 const body={
  'killed-true':['UIF CONST[0].xxxx','KILL','ELSE','MOV OUT[0], IMM[0]','ENDIF'],
  'killed-false':['UIF CONST[0].xxxx','MOV OUT[0], IMM[0]','ELSE','KILL','ENDIF'],
  'both-killed':['UIF CONST[0].xxxx','KILL','ELSE','KILL','ENDIF'],
  'nested':['UIF CONST[0].xxxx','UIF CONST[0].yyyy','KILL','ELSE','MOV OUT[0], IMM[0]','ENDIF','ELSE','KILL','ENDIF'],
  'unconditional-fault':['MOV OUT[0], IMM[0]','UIF CONST[0].xxxx','KILL','ENDIF'],
  'raster-bank':['UIF CONST[1].xxxx','KILL','ELSE','MOV OUT[0], CONST[0]','ENDIF']
 }[kind];if(!body)throw new Error(kind);
 return ['FRAG','DCL OUT[0], COLOR',`DCL CONST[0${kind==='raster-bank'?'..1':''}]`,'IMM[0] FLT32 {.25,.5,.75,1}',...body,'END',''].join('\n');
}
export function spatial(kind='conditional', lane='x') {
 const tail=kind==='conditional'?['AND TEMP[0], TEMP[0], IMM[1]','KILL_IF -TEMP[0]','MOV OUT[0], IMM[0]']:
  kind==='true'?['UIF TEMP[0].xxxx','KILL','ELSE','MOV OUT[0], IMM[0]','ENDIF']:
  ['UIF TEMP[0].xxxx','MOV OUT[0], IMM[0]','ELSE','KILL','ENDIF'];
 return ['FRAG','PROPERTY FS_COORD_ORIGIN LOWER_LEFT','PROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER','DCL IN[0], POSITION, LINEAR','DCL OUT[0], COLOR','DCL TEMP[0]','DCL CONST[0]',
  'IMM[0] FLT32 {.25,.5,.75,1}','IMM[1] UINT32 {1065353216,1065353216,1065353216,1065353216}',`FSLT TEMP[0], IN[0].${lane.repeat(4)}, CONST[0].xxxx`,...tail,'END',''].join('\n');
}
export function geometry(seed) {
 const width=9+(seed%3)*2,height=7+((seed>>>5)%3)*2,x=1+(seed%2),y=1+((seed>>>9)%2);
 return {width,height,viewport:[x,y,width-x-1,height-y-1],vertices:[[-1,-1,0,1],[1,-1,0,1],[-1,1,0,1],[-1,1,0,1],[1,-1,0,1],[1,1,0,1]],indices:[0,1,2,3,4,5]};
}
export function physicalPlan(seed=SEEDS[0]) {
 const probes=[],g=geometry(seed),add=(name,text,words,fields={})=>{
  for(const backend of ['owned','mesa'])probes.push({name,text,words,geometry:g,backend,...fields});
 };
 for(const [name,word]of WORDS)for(let lane=0;lane<4;lane++)for(const modifier of ['plain','negative','absolute','negative-absolute']) {
  const words=Array(4).fill(0);words[lane]=word;
  add(`${name}-${lane}-${modifier}`,primitive(words,'xyzw',modifier,'uniform'),[...words,0,0,0,0],{variant:'uniform',modifier,lane,word,portablePrimary:!name.includes('subnormal')&&!name.includes('infinity')&&!name.includes('nan')});
 }
 for(const variant of ['copied','alias','saved'])for(const swizzle of ['xyzw','wzyx','xxxx','zzzz'])
  add(`${variant}-${swizzle}`,primitive([0xbf800000,0,0x3f800000,0],swizzle,'plain',variant),[],{variant,portablePrimary:true,always:sourceValues(variant==='alias'?[0,0x3f800000,0,0xbf800000]:[0xbf800000,0,0x3f800000,0],swizzle,'plain').some(value=>value<0)});
 for(const kind of ['killed-true','killed-false','both-killed','nested','unconditional-fault'])for(const selector of [0,0x3f800000])
  add(kind+'-'+selector,branch(kind),[selector,0,0,0,0,0,0,0],{variant:kind,portablePrimary:true});
 for(const kind of ['conditional','true','false'])for(const lane of ['x','y']) {
  const limit=g.viewport[lane==='x'?0:1]+2.5,word=new Uint32Array(new Float32Array([limit]).buffer)[0];
  add(`spatial-${kind}-${lane}`,spatial(kind,lane),[word,0,0,0,0,0,0,0],{variant:'spatial',kind,lane,portablePrimary:true});
 }
 add('kill-only','FRAG\nDCL OUT[0], COLOR\nKILL\nEND\n',[],{variant:'kill-only',portablePrimary:true});
 add('raster-bank-survivor',branch('raster-bank'),[0x3e800000,0x3f000000,0x3f400000,0x3f800000,0,0,0,0],{variant:'raster-bank',portablePrimary:true});
 return probes;
}
export function getCases() {
 const cases=[],seen=new Set(),add=(name,text,ok=true,fields={})=>{if(seen.has(text))return;seen.add(text);cases.push({name,stage:'fragment',text,ok,primary:ok,partner:VERTEX,pairOk:ok,...fields});};
 for(const [name,word]of WORDS)for(let lane=0;lane<4;lane++)for(const modifier of MODIFIERS)for(const swizzle of ['xyzw','wzyx','zxyw','xxxx','yyyy','zzzz','wwww']) {
  const words=Array(4).fill(0);words[lane]=word;
  add(`${name}-${lane}-${modifier}-${swizzle}`,primitive(words,swizzle,modifier),true,{always:sourceValues(words,swizzle,modifier).some(value=>value<0)});
 }
 for(const seed of SEEDS)for(const p of physicalPlan(seed))if(p.backend==='owned')add('physical-'+p.name,p.text,true,{always:p.always??['both-killed','kill-only'].includes(p.variant),physical:true});
 for(const position of ['before','after'])add('kill-'+position,position==='before'?'FRAG\nDCL OUT[0], COLOR\nKILL\nEND\n':FRAGMENT.replace('END','KILL\nEND'),true,{always:true});
 const base=['FRAG','DCL OUT[0], COLOR','DCL TEMP[0..3]','DCL CONST[0]','IMM[0] FLT32 {.25,.5,.75,1}'];
 const flow=body=>[...base,...body,'END',''].join('\n');
 add('mixed-terminal-operations',flow(['KILL_IF CONST[0]','KILL']),true,{always:true});
 add('partial-known-sign-is-not-terminal',flow(['IMM[1] UINT32 {2147483648,2147483648,2147483648,2147483648}','OR TEMP[0], CONST[0], IMM[1]','KILL_IF TEMP[0]','MOV OUT[0], IMM[0]']),true,{always:false});
 add('conditional-terminal-survivor',flow(['IMM[1] UINT32 {3212836864,0,0,0}','UIF CONST[0].xxxx','KILL_IF IMM[1]','ELSE','MOV OUT[0], IMM[0]','ENDIF']),true,{always:false});
 add('conditional-terminal-cannot-initialize',flow(['IMM[1] UINT32 {3212836864,0,0,0}','UIF CONST[0].xxxx','MOV TEMP[1], IMM[0]','KILL_IF IMM[1]','ENDIF','MOV OUT[0], TEMP[1]']),false,{primary:false});
 add('conditional-zero-survivor-not-initialized',flow(['IMM[1] UINT32 {2147483648,0,0,0}','UIF CONST[0].xxxx','KILL_IF IMM[1]','ELSE','MOV OUT[0], IMM[0]','ENDIF']),false,{primary:false});
 add('conditional-nan-survivor-not-initialized',flow(['IMM[1] UINT32 {4290847557,0,0,0}','UIF CONST[0].xxxx','KILL_IF IMM[1]','ELSE','MOV OUT[0], IMM[0]','ENDIF']),false,{primary:false});
 for(const [name,body,ok]of [
  ['survivor-temp',['UIF CONST[0].xxxx','KILL','ELSE','MOV TEMP[1], IMM[0]','ENDIF','MOV OUT[0], TEMP[1]'],true],
  ['killed-cannot-init',['UIF CONST[0].xxxx','MOV TEMP[1], IMM[0]','KILL','ENDIF','MOV OUT[0], TEMP[1]'],false],
  ['survivor-output-missing',['UIF CONST[0].xxxx','MOV OUT[0], IMM[0]','KILL','ELSE','MOV TEMP[1], IMM[0]','ENDIF'],false],
  ['conditional-cannot-init',['UIF CONST[0].xxxx','KILL_IF CONST[0]','ELSE','MOV OUT[0], IMM[0]','ENDIF'],false],
  ['survivor-raw-authority',['UIF CONST[0].xxxx','MOV TEMP[1], IMM[0]','KILL','ELSE','NOT TEMP[1], CONST[0]','ENDIF','ADD OUT[0], TEMP[1], IMM[0]'],false],
  ['dead-uninitialized-source',['KILL','MOV OUT[0], TEMP[1]'],false],
  ['all-dead-uninitialized-source',['UIF CONST[0].xxxx','KILL','ELSE','KILL','ENDIF','MOV OUT[0], TEMP[1]'],false],
  ['partial-source',['MOV TEMP[1].x, IMM[0]','KILL_IF TEMP[1]','MOV OUT[0], IMM[0]'],false],
  ['initialized-repeated-source',['MOV TEMP[1].x, IMM[0]','KILL_IF TEMP[1].xxxx','MOV OUT[0], IMM[0]'],true],
  ['dead-unknown-address',['DCL ADDR[0]','KILL','MOV OUT[0], CONST[ADDR[0].x]'],false]
 ])add(name,flow(body),ok,{primary:ok});
 const safe=primitive([0,0,0,0]);
 for(const token of ['KILL_PRECISE','KILL_IF_PRECISE','KILL_SAT','DEMOTE','KILL_IF TEMP[0], IMM[1]','KILL IMM[1]','KILL_IF OUT[0]','KILL_IF SAMP[0]','KILL_IF --IMM[1]','KILL_IF |IMM[1]','KILL_IF IMM[1].xy'])
  add('unsupported-'+token,safe.replace('KILL_IF IMM[1].xyzw',token),false,{primary:false});
 add('output-range',safe.replace('DCL OUT[0]','DCL OUT[0..1]'),false,{primary:false});
 for(const stageToken of ['KILL','KILL_IF IN[0]','KILL_IF -IN[0]'])add('vertex-'+stageToken,VERTEX.replace('END',stageToken+'\nEND'),false,{stage:'vertex',partner:FRAGMENT,primary:false});
 for(const depth of [1,16,17])add('depth-'+depth,flow([...Array(depth).fill('UIF CONST[0].xxxx'),'KILL',...Array(depth).fill('ENDIF'),'MOV OUT[0], IMM[0]']),depth<=16,{primary:depth<=16});
 for(const label of ['0: KILL_IF IMM[1].xyzw','1: KILL_IF IMM[1].xyzw','1000: KILL_IF IMM[1].xyzw'])
  add('label-'+label,safe.replace('KILL_IF IMM[1].xyzw',label),label.startsWith('0:'),{primary:label.startsWith('0:')});
 add('mismatched-target',flow(['UIF CONST[0].xxxx :4','KILL','ELSE :5','MOV OUT[0], IMM[0]','ENDIF']),false,{primary:false});
 for(const count of [768,769])add('instruction-bound-'+count,['FRAG','DCL OUT[0], COLOR',...Array(count).fill('KILL'),'END',''].join('\n'),count<=768,{primary:false,always:true});
 return cases;
}
