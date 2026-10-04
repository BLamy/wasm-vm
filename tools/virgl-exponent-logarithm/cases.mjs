// Inputs are declarations; reference.py predicts intervals independently.
export {PARTNER_VERTEX,PARTNER_FRAGMENT} from '../virgl-signed-conversions/cases.mjs';
export const SEEDS=[0x283b71c9,0x71ac40e3,0xd609827b];
export const OPS=['EX2','LG2'];
const view=new DataView(new ArrayBuffer(4));
export const bits=x=>{view.setFloat32(0,x,true);return view.getUint32(0,true);};
export const float=w=>{view.setUint32(0,w,true);return view.getFloat32(0,true);};
export const imm=(i,a)=>`IMM[${i}] UINT32 {${a.join(',')}}`;
export const suffix=mask=>[...'xyzw'].filter((_,i)=>mask&(1<<i)).join('');
export function vectors(op,seed=SEEDS[0]){
 const words=op==='EX2'?[bits(-125),bits(-125)-1,0x00800000,0x80800000,0x00800001,bits(-126)+1,bits(126),bits(126)-1,bits(125),bits(-10),bits(-1),bits(-.5),bits(-0),0,bits(.5),bits(1),bits(3),bits(10),bits(1)-1,bits(1)+1]:
 [0x00800000,0x00800001,0x7f7fffff,bits(.5)-1,bits(.5),bits(.5)+1,bits(1)-1,bits(1),bits(1)+1,bits(2)-1,bits(2),bits(2)+1,bits(.125),bits(3),bits(7)];
 // -126's successor still lies outside the declared interval; keep it for
 // rejection cases below rather than silently claiming it as admitted.
 if(op==='EX2')words.splice(5,1);
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 for(let i=0;i<8;i++)words.push(op==='EX2'?bits((next()%2490001)/10000-125):((next()%254+1)<<23|next()&0x7fffff)>>>0);
 return words.map((w,i)=>({name:i<words.length-8?'boundary-'+i:'random-'+seed+'-'+i,a:[w,op==='EX2'?bits(.75):bits(3),bits(2),bits(.5)],b:[op==='EX2'?bits(-2):bits(4),bits(.5),bits(1),bits(2)]}));
}
export const VARIANTS=['direct','alias','join','saved','killed-after','bit-bounded',...Array.from({length:15},(_,i)=>['xyzw','wzyx','xxxx','zxyw'].map(s=>'mask-'+(i+1)+'-'+s)).flat(),...['xyzw','wzyx','xxxx','zxyw'].map(s=>'swizzle-'+s)];
export const maskOf=v=>v.startsWith('mask-')?Number(v.split('-')[1]):15;
export const swizzleOf=v=>v==='alias'?'wzyx':v.startsWith('swizzle-')?v.slice(8):v.startsWith('mask-')?(v.split('-')[2]??'xyzw'):'xyzw';
export function selected(op,input,variant='direct',condition=0,modifier='',backend='owned'){
 const a=variant.startsWith('join')&&!condition?input.b:input.a,swizzle=swizzleOf(variant);
 return Array.from({length:4},(_,lane)=>{let w=a['xyzw'.indexOf(swizzle[backend==='mesa'?lane:0])];if(variant==='bit-bounded')w=((w&0x7fffff)|0x3f800000)>>>0;if(modifier==='neg')w=(w^0x80000000)>>>0;
  return maskOf(variant)&(1<<lane)?{op,word:w}:{exact:input.a[lane]};});
}
export function body(op,variant='direct',modifier='',source='IMM[0]'){
 const ins=(dst,src)=>`${op} ${dst}, ${modifier==='neg'?'-':''}${src}`;
 const initial=['MOV TEMP[0], IMM[0]'];
 if(variant==='bit-bounded')return [...initial,'AND TEMP[3], CONST[0], IMM[1].xxxx','OR TEMP[3], TEMP[3], IMM[1].yyyy',ins('TEMP[0]','TEMP[3]')];
 if(variant==='join-source')return [...initial,'UIF CONST[43].xxxx','MOV TEMP[3], IMM[0]','ELSE','MOV TEMP[3], IMM[1]','ENDIF',ins('TEMP[0]','TEMP[3]')];
 if(variant==='join')return [...initial,'UIF CONST[43].xxxx',ins('TEMP[0]',source),'ELSE',ins('TEMP[0]','IMM[1]'),'ENDIF'];
 if(variant==='saved'||variant==='killed-after')return [ins('TEMP[3]',source),'MOV TEMP[0], TEMP[3]',...(variant==='killed-after'?['UADD TEMP[3], CONST[0], CONST[1]']:[])];
 return [...initial,ins('TEMP[0].'+suffix(maskOf(variant)),(variant==='alias'?'TEMP[0]':source)+'.'+swizzleOf(variant))];
}
export function carrier(op,v,variant='direct',modifier=''){
 return ['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]','DCL TEMP[0..3]',...(variant.startsWith('join')||variant==='killed-after'||variant==='bit-bounded'?['DCL CONST[0..45]']:[]),
 imm(0,v.a),imm(1,variant==='bit-bounded'?[0x7fffff,0x3f800000,0,0]:v.b),imm(2,[8388607,1056964608,23,0]),...body(op,variant,modifier),
 'AND TEMP[1], TEMP[0], IMM[2].xxxx','OR TEMP[1], TEMP[1], IMM[2].yyyy','USHR TEMP[2], TEMP[0], IMM[2].zzzz','OR TEMP[2], TEMP[2], IMM[2].yyyy',
 'MOV OUT[0], IN[0]','MOV OUT[1], TEMP[1]','MOV OUT[2], TEMP[2]','END',''].join('\n');
}
// A single shader evaluation exposes the four bytes of one result word. This
// avoids assuming separately compiled bit planes use the same approximation.
export function bytesFragment(op,v,lane=0,variant='direct',modifier=''){
 return ['FRAG','DCL OUT[0], COLOR','DCL TEMP[0..3]',...(variant.startsWith('join')||variant==='killed-after'||variant==='bit-bounded'?['DCL CONST[0..45]']:[]),
 imm(0,v.a),imm(1,variant==='bit-bounded'?[0x7fffff,0x3f800000,0,0]:v.b),imm(2,[0,8,16,24]),imm(3,[255,255,255,255]),...body(op,variant,modifier),
 `USHR TEMP[1], TEMP[0].${'xyzw'[lane].repeat(4)}, IMM[2]`,'AND TEMP[1], TEMP[1], IMM[3]',
 'I2F TEMP[2], TEMP[1]','I2F TEMP[3], IMM[3]','DIV OUT[0], TEMP[2], TEMP[3]','END',''].join('\n');
}
export function getCases(){
 const cases=[],add=(name,stage,text,ok,primary=false)=>cases.push({name,stage,text,ok,primary});
 for(const op of OPS){
  for(const seed of SEEDS)for(const v of vectors(op,seed)){if(seed!==SEEDS[0]&&!v.name.startsWith('random-'))continue;
   add(`${op}-${v.name}`,'vertex',carrier(op,v),true,true);
   add(`${op}-${v.name}-broadcast`,'vertex',carrier(op,v,'swizzle-xxxx'),true,true);
   for(let lane=0;lane<4;lane++){add(`${op}-${v.name}-bytes-${lane}`,'fragment',bytesFragment(op,v,lane),true,true);add(`${op}-${v.name}-broadcast-bytes-${lane}`,'fragment',bytesFragment(op,v,lane,'swizzle-xxxx'),true,true);}}
  const v=vectors(op)[13];
  const partial={name:'partial-joined',a:Array(4).fill(bits(1)),b:Array(4).fill(bits(1.5))};add(op+'-join-source','vertex',carrier(op,partial,'join-source'),true,true);
  for(const variant of VARIANTS){add(`${op}-${variant}`,'vertex',carrier(op,v,variant),true,true);
   if(variant!=='join')for(let lane=0;lane<4;lane++)add(`${op}-${variant}-bytes-${lane}`,'fragment',bytesFragment(op,v,lane,variant),true,true);}
  const neg=op==='EX2'?vectors(op)[7]:{name:'negative-log-input',a:[bits(-3),bits(-.5),bits(-1),bits(-2)],b:[bits(-2),bits(-4),bits(-8),bits(-16)]};
  for(const variant of ['direct','alias','mask-10','join'])add(`${op}-neg-${variant}`,'vertex',carrier(op,neg,variant,'neg'),true,true);
 }
 const header=['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..4]','DCL CONST[0..45]',imm(0,[bits(1),bits(2),bits(.5),bits(4)]),imm(1,[bits(3),bits(4),bits(8),bits(16)])];
 const program=lines=>[...header,...lines,'END',''].join('\n');
 for(const op of OPS){
  for(const source of ['IN[0]','CONST[0]','TEMP[0]'])add(op+'-unknown-'+source,'fragment',program(['ADD TEMP[0], IMM[0], IMM[1]',`${op} TEMP[1], ${source}`,'MOV OUT[0], IMM[0]']),false);
  add(op+'-postmodifier-invalid','fragment',program([imm(2,Array(4).fill(bits(op==='EX2'?126:1))),`${op} OUT[0], -IMM[2]`]),false);
  add(op+'-signed-sign-domain','fragment',program(['SSG TEMP[0], IN[0]',`${op} OUT[0], TEMP[0]`]),op==='EX2',op==='EX2');
  const pair=op==='EX2'?[125,126]:[-1,1];add(op+'-partial-domain-overapproximation','fragment',program([imm(2,Array(4).fill(bits(pair[0]))),imm(3,Array(4).fill(bits(pair[1]))),'UIF CONST[43].xxxx','MOV TEMP[0], IMM[2]','ELSE','MOV TEMP[0], IMM[3]','ENDIF',`${op} OUT[0], TEMP[0]`]),false);
  add(op+'-killed-source','fragment',program(['MOV TEMP[0], IMM[0]','UADD TEMP[0], CONST[0], CONST[1]',`${op} TEMP[1], TEMP[0]`,'MOV OUT[0], IMM[0]']),false);
  add(op+'-bad-join','fragment',program(['UIF CONST[43].xxxx','MOV TEMP[0], IMM[0]','ELSE','MOV TEMP[0], IN[0]','ENDIF',`${op} TEMP[1], TEMP[0]`,'MOV OUT[0], IMM[0]']),false);
  add(op+'-partial-good','fragment',program([imm(2,[bits(1.5),bits(2.5),bits(.75),bits(6)]),'UIF CONST[43].xxxx','MOV TEMP[0], IMM[0]','ELSE','MOV TEMP[0], IMM[2]','ENDIF',`${op} OUT[0], TEMP[0]`]),true,true);
  add(op+'-partial-unsafe','fragment',program(['UIF CONST[43].xxxx','MOV TEMP[0], IMM[0]','ELSE','MOV TEMP[0], IMM[1]','ENDIF',`${op} OUT[0], TEMP[0]`]),false);
  add(op+'-source-x-only','fragment',program(['MOV TEMP[0].x, IMM[0].yyyy',`${op} OUT[0].yw, TEMP[0].xzyw`,'MOV OUT[0].xz, IMM[0]']),true,true);
  add(op+'-unused-special','fragment',program([imm(2,[bits(2),0x7fc00001,1,0xff800000]),`${op} OUT[0], IMM[2]`]),true,true);
  add(op+'-no-result-F2I-facts','fragment',program([`${op} TEMP[0], IMM[0]`,'F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]']),false);
  add(op+'-no-result-domain-facts','fragment',program([`${op} TEMP[0], IMM[0]`,`${op} OUT[0], TEMP[0]`]),false);
  for(const spelling of [op+'_SAT',op+'_PRECISE','SIN_PRECISE','POW'])add(op+'-unsupported-'+spelling,'fragment',program([`${spelling} TEMP[0], IMM[0]${spelling==='POW'?', IMM[1]':''}`,'MOV OUT[0], IMM[0]']),false);
  for(const bad of [`${op} TEMP[5], IMM[0]`,`${op} TEMP[0], CONST[46]`,`${op} TEMP[0], |IMM[0]|`,`${op} TEMP[0], IMM[0].xy`,`${op} CONST[0], IMM[0]`,`${op} TEMP[0], IMM[0], IMM[1]`])add('malformed-'+bad,'fragment',program([bad,'MOV OUT[0], IMM[0]']),false);
  const invalid=op==='EX2'?[bits(-125)+1,bits(126)+1,bits(-126),bits(127),bits(256)]:[0,bits(-0),bits(-1),bits(-.5),0x80800000];
  for(const w of [...invalid,1,0x80000001,0x007fffff,0x7f800000,0xff800000,0x7fc00001])add(op+'-out-of-domain-'+w,'fragment',program([imm(2,Array(4).fill(w)),`${op} TEMP[0], IMM[2]`,'MOV OUT[0], IMM[0]']),false);
 }
 add('adjacent-EX2-and-LG2','fragment',program(['EX2 TEMP[0], IMM[0]','LG2 TEMP[1], IMM[1]','MOV OUT[0], TEMP[0]']),true,true);
 return cases;
}
