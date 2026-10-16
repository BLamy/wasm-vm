// Source-only binary32 values and mathematical equations, independent of IR/GLSL.
export const SEEDS=[0x51a83bd7,0xa724c139,0xe1698f03];
const view=new DataView(new ArrayBuffer(4));
export const float=w=>{view.setUint32(0,w,true);return view.getFloat32(0,true);};
export const bits=x=>{view.setFloat32(0,x,true);return view.getUint32(0,true);};
export const normalOrZero=w=>(w&0x7fffffff)===0||((w&0x7f800000)!==0&&(w&0x7f800000)!==0x7f800000);
export const finite=w=>(w&0x7f800000)!==0x7f800000;
export function evaluate(op,a){return a.map(w=>{
  if(!finite(w))throw new Error('finite scalar source required');
  const value=float(w);
  if(op==='TRUNC')return bits(Math.trunc(value));
  if(op==='SSG')return bits(value>0?1:value<0?-1:0);
  throw new Error('unknown scalar operation');
});}
export function vectors(op,seed=SEEDS[0]){
  const values=new Set([0,0x80000000,0x00800000,0x80800000,0x3effffff,0xbeffffff,0x3f000000,0xbf000000,
    0x3f7fffff,0xbf7fffff,0x3f800000,0xbf800000,0x3f800001,0xbf800001,0x3fc00000,0xbfc00000,
    0x3fffffff,0xbfffffff,0x40000000,0xc0000000,0x40000001,0xc0000001,0x7f7fffff,0xff7fffff]);
  for(let e=1;e<255;e++)for(const m of [0,1,0x3fffff,0x7fffff])for(const sign of [0,0x80000000])
    values.add((e*0x800000+m+sign)>>>0);
  const list=[...values],result=[];while(list.length%4)list.push(0);
  for(let i=0;i<list.length;i+=4)result.push({name:`edge-${op}-${i/4}`,a:list.slice(i,i+4),b:list.slice(i,i+4).reverse()});
  let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;const w=state>>>0;
    return (((1+(w%254))*0x800000)+(w&0x7fffff)+(w&0x80000000))>>>0;};
  for(let i=0;i<8;i++)result.push({name:`random-${seed}-${i}`,a:Array.from({length:4},next),b:Array.from({length:4},next)});
  return result;
}
export function physicalVectors(op,seed=SEEDS[0]){return vectors(op,seed).filter((v,i)=>
  i<6||i%16===0||v.name.startsWith('random-')||v.a.some(w=>[127,149,150].includes((w>>>23)&255)));}
const imm=(i,a)=>`IMM[${i}] UINT32 {${a.join(',')}}`;
export {PARTNER_VERTEX,PARTNER_FRAGMENT} from '../virgl-signed-conversions/cases.mjs';
export const VARIANTS=['direct','swizzled','masked','alias','join'];
export const bankVariants=()=>VARIANTS;
export function selectedWords(op,vector,variant='direct',condition=0,modifier=''){
  const source=variant==='join'&&!condition?vector.b:vector.a;
  let input=variant==='swizzled'||variant==='alias'?source.slice().reverse():source.slice();
  if(modifier==='neg')input=input.map(w=>(w^0x80000000)>>>0);
  const output=evaluate(op,input);
  if(variant==='masked'){output[1]=vector.a[1];output[3]=vector.a[3];}return output;
}
function body(op,bank,variant,modifier='',inputSource=false){
  const a=inputSource?'IN[1]':bank?'CONST[0]':'IMM[0]',b=bank?'CONST[45]':'IMM[1]',source=r=>modifier==='neg'?'-'+r:r;
  if(variant==='masked')return [`MOV TEMP[0], ${a}`,`${op} TEMP[0].xz, ${source(a)}`];
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
  const cases=[],add=(name,stage,text,ok,primary=false)=>cases.push({name,stage,text,ok,primary});
  for(const op of ['TRUNC','SSG']){
    for(const seed of SEEDS)for(const v of vectors(op,seed))if(seed===SEEDS[0]||v.name.startsWith('random-'))
      add(`${op}-${v.name}`,'vertex',carrier(op,v),true,true);
    for(const variant of VARIANTS){
      add(`${op}-literal-${variant}`,'vertex',carrier(op,vectors(op)[0],variant),true,variant!=='join');
      add(`${op}-bank-${variant}`,'vertex',carrier(op,vectors(op)[0],variant,true),true,variant!=='join');
    }
    for(const v of physicalVectors(op).filter((_,i)=>i%8===0))for(let plane=0;plane<32;plane++)
      add(`${op}-${v.name}-plane-${plane}`,'fragment',bitplane(op,v,plane),true,true);
    const v={name:'physical-input',a:[0x3fc00000,0xbfc00000,0,0x80000000],b:[0,0,0,0]};
    add(op+'-physical-input-source','vertex',carrier(op,v,'direct',false,'',true),true,true);
    add(op+'-negation','vertex',carrier(op,v,'direct',false,'neg'),true,true);
    add(op+'-bank-negation','vertex',carrier(op,v,'direct',true,'neg'),true,true);
    const head=['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..1]','DCL CONST[0..1]',imm(0,[0x3f000000,0xbf000000,0,0x80000000]),imm(1,[1,1,1,1])];
    const program=lines=>[...head,...lines,'END',''].join('\n');
    for(const w of [1,0x80000001,0x7fffff,0x807fffff,0x7f800000,0xff800000,0x7fc12345,0xffffffff])
      add(`${op}-private-word-${w}`,'vertex',carrier(op,{a:Array(4).fill(w),b:Array(4).fill(w)}),false,true);
    for(const bad of [`${op}_SAT TEMP[0], IMM[0]`,`${op}_PRECISE TEMP[0], IMM[0]`,`${op} TEMP[0]`,`${op} TEMP[0], IMM[0], IMM[0]`,
      `${op} TEMP[0], CONST[2]`,`${op} CONST[0], IMM[0]`,`${op} TEMP[2], IMM[0]`,`${op} TEMP[0], IMM[0].xy`,`${op} TEMP[0], |IMM[0]|`])
      add('malformed-'+bad,'fragment',program([bad,'MOV OUT[0], IMM[0]']),false);
    add(op+'-missing-lanes','fragment',program([`${op} TEMP[0].x, IMM[0]`,'MOV OUT[0], TEMP[0]']),false);
    add(op+'-private-source','fragment',program(['UADD TEMP[0], CONST[0], CONST[1]',`${op} OUT[0], TEMP[0]`]),false);
    add(op+'-authorized-old-locator','fragment',program(['MOV TEMP[0], IN[0]',`${op} TEMP[0], TEMP[0].wzyx`,'MOV OUT[0], TEMP[0]']),true,true);
    add(op+'-killed-version','fragment',program(['MOV TEMP[0], IMM[0]','UADD TEMP[0], CONST[0], CONST[1]',`${op} OUT[0], TEMP[0]`]),false);
    add(op+'-new-version','fragment',program(['UADD TEMP[0], CONST[0], CONST[1]',`${op} TEMP[0], IMM[0]`,'MOV OUT[0], TEMP[0]']),true,true);
    add(op+'-bad-join','fragment',program(['UIF CONST[0].xxxx',`${op} TEMP[0], IMM[0]`,'ELSE','UADD TEMP[0], CONST[0], CONST[1]','ENDIF',`${op} OUT[0], TEMP[0]`]),false);
    add(op+'-private-result-use','fragment',program(['F2I TEMP[0], CONST[0]',`${op} OUT[0], TEMP[0]`]),false);
    add(op+'-numeric-output','fragment',program([`${op} OUT[0], IMM[0]`]),true,true);
    add(op+'-numeric-chained','fragment',program([`${op} TEMP[0], IMM[0]`,'ADD OUT[0], TEMP[0], IMM[0]']),true,true);
    add(op+'-scalar-conversion-chain','fragment',program([`${op} TEMP[0], IMM[0]`,'F2I TEMP[0], TEMP[0]','I2F OUT[0], TEMP[0]']),true,true);
  }
  return cases;
}
