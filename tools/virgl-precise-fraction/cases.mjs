// Independent rational TGSI equation; no word-helper algorithm supplies truth.
import {classify,roundRational} from '../virgl-precise-arithmetic/oracle.mjs';
export const SEEDS=[0x51a83bd7,0xa724c139,0xe1698f03];
const view=new DataView(new ArrayBuffer(4));
export const float=w=>{view.setUint32(0,w,true);return view.getFloat32(0,true);};
export const bits=x=>{view.setFloat32(0,x,true);return view.getUint32(0,true);};
export const normalOrZero=w=>(w&0x7fffffff)===0||((w&0x7f800000)!==0&&(w&0x7f800000)!==0x7f800000);
export const finite=w=>(w&0x7f800000)!==0x7f800000;
export function fractionWord(word){
  const value=classify(word);if(value.kind!=='finite')return 0x7fc00000;
  const floor=value.n>=0n?value.n/value.d:-((-value.n+value.d-1n)/value.d);
  return roundRational(value.n-floor*value.d,value.d);
}
export function evaluate(op,a){
  if(!['FRC','FRC_PRECISE'].includes(op))throw new Error('unknown fraction operation');
  return a.map(w=>{if(op==='FRC'&&!finite(w))throw new Error('ordinary finite fraction source');return fractionWord(w);});
}
export function vectors(op,seed=SEEDS[0]){
  const values=new Set([0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,0x00800000,0x80800000,
    0x33000000,0xb3000000,0xb3000001,0xb2ffffff,0xb3800000,0xb3c00000,0xb4200000,0xb4600000,
    0x3effffff,0xbeffffff,0x3f000000,0xbf000000,0x3f7fffff,0xbf7fffff,0x3f800000,0xbf800000,
    0x3f800001,0xbf800001,0x3fffffff,0xbfffffff,0x40000000,0xc0000000,0x40000001,0xc0000001,
    0x4affffff,0xcaffffff,0x4b000000,0xcb000000,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,
    0x7fc12345,0xff800001,0x7f800001,0xffc54321]);
  for(let e=0;e<256;e++)for(const m of [0,1,0x3fffff,0x400000,0x7fffff])for(const sign of [0,0x80000000])
    values.add((e*0x800000+m+sign)>>>0);
  for(let bit=0;bit<23;bit++)for(const sign of [0,0x80000000])values.add((2**bit+sign)>>>0);
  const list=[...values].filter(w=>op==='FRC_PRECISE'||normalOrZero(w)),result=[];while(list.length%4)list.push(0);
  for(let i=0;i<list.length;i+=4)result.push({name:`edge-${op}-${i/4}`,a:list.slice(i,i+4),b:list.slice(i,i+4).reverse()});
  let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;const word=state>>>0;
    return op==='FRC_PRECISE'?word:(((1+(word%254))*0x800000)+(word&0x7fffff)+(word&0x80000000))>>>0;};
  for(let i=0;i<12;i++)result.push({name:`random-${seed}-${i}`,a:Array.from({length:4},next),b:Array.from({length:4},next)});
  return result;
}
export function physicalVectors(op,seed=SEEDS[0]){return vectors(op,seed).filter((v,i)=>
  i<12||i%20===0||v.name.startsWith('random-')||v.a.some(w=>[102,125,126,127,148,149,150,255].includes((w>>>23)&255)));}
export function helperWords(){return SEEDS.flatMap(seed=>vectors('FRC_PRECISE',seed).flatMap(v=>v.a.map(word=>({word,expected:fractionWord(word)}))));}
const imm=(i,a)=>`IMM[${i}] UINT32 {${a.join(',')}}`;
export {PARTNER_VERTEX,PARTNER_FRAGMENT} from '../virgl-signed-conversions/cases.mjs';
export const VARIANTS=['direct','swizzled','masked','alias','join',...Array.from({length:15},(_,i)=>i+1).filter(m=>m!==5).map(m=>'mask-'+m)];
export const bankVariants=()=>VARIANTS;
export function selectedWords(op,vector,variant='direct',condition=0,modifier=''){
  const source=variant==='join'&&!condition?vector.b:vector.a;
  let input=variant==='swizzled'||variant==='alias'?source.slice().reverse():source.slice();
  if(modifier==='neg')input=input.map(w=>(w^0x80000000)>>>0);
  const output=evaluate(op,input);
  if(variant==='masked'||variant.startsWith('mask-')){const mask=variant==='masked'?5:Number(variant.slice(5));
    for(let lane=0;lane<4;lane++)if(!(mask&(1<<lane)))output[lane]=vector.a[lane];}
  return output;
}
function body(op,bank,variant,modifier='',inputSource=false){
  const a=inputSource?'IN[1]':bank?'CONST[0]':'IMM[0]',b=bank?'CONST[45]':'IMM[1]',source=r=>modifier==='neg'?'-'+r:r;
  if(variant==='masked'||variant.startsWith('mask-')){const mask=variant==='masked'?5:Number(variant.slice(5)),suffix='xyzw'.split('').filter((_,i)=>mask&(1<<i)).join('');
    return [`MOV TEMP[0], ${a}`,`${op} TEMP[0].${suffix}, ${source(a)}`];}
  if(variant==='alias')return [`MOV TEMP[0], ${a}`,`${op} TEMP[0], ${source('TEMP[0].wzyx')}`];
  if(variant==='join')return ['UIF CONST[43].xxxx',`${op} TEMP[0], ${source(a)}`,'ELSE',`${op} TEMP[0], ${source(b)}`,'ENDIF'];
  return [`${op} TEMP[0], ${source(a+(variant==='swizzled'?'.wzyx':''))}`];
}
export function carrier(op,v,variant='direct',bank=false,modifier='',inputSource=false){
  return ['VERT','DCL IN[0]',...(inputSource?['DCL IN[1]']:[]),'DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]',
    'DCL TEMP[0..2]',...(bank||variant==='join'?['DCL CONST[0..45]']:[]),imm(0,v.a),imm(1,v.b),imm(2,[8388607,1056964608,23,0]),
    ...body(op,bank,variant,modifier,inputSource),'AND TEMP[1], TEMP[0], IMM[2].xxxx','OR TEMP[1], TEMP[1], IMM[2].yyyy',
    'USHR TEMP[2], TEMP[0], IMM[2].zzzz','OR TEMP[2], TEMP[2], IMM[2].yyyy',
    'MOV OUT[0], IN[0]','MOV OUT[1], TEMP[1]','MOV OUT[2], TEMP[2]','END',''].join('\n');
}
export function bitplane(op,v,plane,bank=false){return ['FRAG','DCL OUT[0], COLOR','DCL TEMP[0]',
  ...(bank?['DCL CONST[0..45]']:[]),imm(0,v.a),imm(1,v.b),imm(2,[plane,1,1065353216,0]),...body(op,bank,'direct'),
  'USHR TEMP[0], TEMP[0], IMM[2].xxxx','AND TEMP[0], TEMP[0], IMM[2].yyyy','UCMP OUT[0], TEMP[0], IMM[2].zzzz, IMM[2].wwww','END',''].join('\n');}
export function getCases(){
  const cases=[],add=(name,stage,text,ok,primary=false,fraction=true)=>cases.push({name,stage,text,ok,primary,fraction});
  for(const op of ['FRC_PRECISE','FRC']){
    for(const seed of SEEDS)for(const v of vectors(op,seed))if(seed===SEEDS[0]||v.name.startsWith('random-'))
      add(`${op}-${v.name}`,'vertex',carrier(op,v),true,true,op==='FRC_PRECISE');
    for(const variant of VARIANTS){
      add(`${op}-literal-${variant}`,'vertex',carrier(op,vectors(op)[0],variant),true,variant!=='join',op==='FRC_PRECISE');
      add(`${op}-bank-${variant}`,'vertex',carrier(op,vectors(op)[0],variant,true),true,variant!=='join',op==='FRC_PRECISE');
    }
    for(const v of physicalVectors(op).filter((_,i)=>i%12===0))for(let plane=0;plane<32;plane++)
      add(`${op}-${v.name}-plane-${plane}`,'fragment',bitplane(op,v,plane),true,true,op==='FRC_PRECISE');
    const v={name:'physical-input',a:[0x3fc00000,0xbfc00000,0,0x80000000],b:[0,0,0,0]};
    add(op+'-physical-input-source','vertex',carrier(op,v,'direct',false,'',true),true,true,op==='FRC_PRECISE');
    add(op+'-negation','vertex',carrier(op,v,'direct',false,'neg'),true,true,op==='FRC_PRECISE');
    add(op+'-bank-negation','vertex',carrier(op,v,'direct',true,'neg'),true,true,op==='FRC_PRECISE');
  }
  const head=['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..2]','DCL CONST[0..45]',
    imm(0,[0x3f000000,0xbf000000,0,0x80000000]),imm(1,[1,1,1,1])],program=lines=>[...head,...lines,'END',''].join('\n');
  for(const bad of ['FRC_PRECISE_SAT TEMP[0], IMM[0]','FRC_PRECISE TEMP[0]','FRC_PRECISE TEMP[0], IMM[0], IMM[0]',
    'FRC_PRECISE TEMP[0], CONST[46]','FRC_PRECISE CONST[0], IMM[0]','FRC_PRECISE TEMP[3], IMM[0]',
    'FRC_PRECISE TEMP[0], IMM[0].xy','FRC_PRECISE TEMP[0], |IMM[0]|'])
    add('malformed-'+bad,'fragment',program([bad,'MOV OUT[0], IMM[0]']),false);
  add('fraction-missing-lanes','fragment',program(['FRC_PRECISE TEMP[0].x, IMM[0]','MOV OUT[0], TEMP[0]']),false);
  add('fraction-private-source-output','fragment',program(['UADD TEMP[0], CONST[0], CONST[1]','FRC_PRECISE OUT[0], TEMP[0]']),false);
  add('fraction-killed-version','fragment',program(['MOV TEMP[0], IN[0]','UADD TEMP[0], CONST[0], CONST[1]','FRC_PRECISE OUT[0], TEMP[0]']),false);
  add('fraction-unknown-private-read','fragment',program(['UADD TEMP[0], CONST[0], CONST[1]','FRC_PRECISE TEMP[0], TEMP[0]','ADD OUT[0], TEMP[0], IMM[0]']),false);
  add('fraction-bad-join','fragment',program(['UIF CONST[0].xxxx','FRC_PRECISE TEMP[0], IN[0]','ELSE','UADD TEMP[0], CONST[0], CONST[1]','ENDIF','ADD OUT[0], TEMP[0], IMM[0]']),false);
  add('fraction-source-before-write','fragment',program(['MOV TEMP[0], IN[0]','FRC_PRECISE TEMP[0], TEMP[0].wzyx','MOV OUT[0], TEMP[0]']),true,true);
  add('fraction-safe-overwrite','fragment',program(['UADD TEMP[0], CONST[0], CONST[1]','FRC_PRECISE TEMP[0], IMM[0]','MOV OUT[0], TEMP[0]']),true,true);
  add('fraction-saved-version','fragment',program(['FRC_PRECISE TEMP[0], IN[0]','MOV TEMP[1], TEMP[0]','UADD TEMP[0], CONST[0], CONST[1]','MOV OUT[0], TEMP[1]']),true,true);
  add('fraction-bank-output','fragment',program(['FRC_PRECISE OUT[0], CONST[0]']),true,true);
  add('fraction-copied-bank-output','fragment',program(['FRC_PRECISE OUT[0].x, CONST[0].xxxx','MOV OUT[0].yzw, CONST[45]']),true,true);
  add('fraction-numeric-chained','fragment',program(['FRC_PRECISE TEMP[0], IMM[0]','ADD OUT[0], TEMP[0], IMM[0]']),true,true);
  add('fraction-unknown-range-not-invented','fragment',program(['FRC_PRECISE TEMP[0], CONST[0]','F2I TEMP[0], TEMP[0]','I2F OUT[0], TEMP[0]']),false);
  for(const word of [1,0x80000001,0x7fffff,0x807fffff,0x7f800000,0xff800000,0x7fc12345,0xff800001]){
    const text=program([imm(2,Array(4).fill(word)),'FRC_PRECISE OUT[0], IMM[2]']);
    add('fraction-known-output-'+word,'fragment',text,normalOrZero(fractionWord(word)),true);
  }
  for(const mask of Array.from({length:15},(_,i)=>i+1))for(const swizzle of ['xyzw','wzyx','xxxx','zxyw'])
    add(`fraction-mask-${mask}-${swizzle}`,'fragment',program(['MOV TEMP[0], IMM[0]',
      `FRC_PRECISE TEMP[0].${'xyzw'.split('').filter((_,i)=>mask&(1<<i)).join('')}, IMM[0].${swizzle}`,'MOV OUT[0], TEMP[0]']),true,true);
  add('fraction-adjacent-local-precision','fragment',program(['FRC TEMP[0], IMM[0]','FRC_PRECISE TEMP[1], -TEMP[0]',
    'ADD_PRECISE TEMP[1], TEMP[1], IMM[0]','MUL_PRECISE TEMP[1], TEMP[1], IMM[0]','MAX_PRECISE TEMP[2], TEMP[1], IMM[0]',
    'MIN_PRECISE TEMP[2], TEMP[2], IMM[0]','MOV_PRECISE OUT[0], IMM[0]']),true,true);
  return cases;
}
