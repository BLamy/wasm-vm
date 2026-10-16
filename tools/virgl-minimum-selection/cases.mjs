// Source binary32 decoding/comparison; no IR ordering keys or emitted shader.
export const SEEDS=[0x51a83bd7,0xa724c139,0xe1698f03];
const view=new DataView(new ArrayBuffer(4));
export const float=w=>{view.setUint32(0,w,true);return view.getFloat32(0,true);};
export const bits=x=>{view.setFloat32(0,x,true);return view.getUint32(0,true);};
export const normalOrZero=w=>(w&0x7fffffff)===0||((w&0x7f800000)!==0&&(w&0x7f800000)!==0x7f800000);
export function evaluate(op,a,b){
 if(!['MIN','MIN_PRECISE'].includes(op))throw new Error('unknown minimum operation');
 return a.map((word,i)=>op==='MIN_PRECISE'?(float(word)<float(b[i])?word:b[i]):bits(Math.min(float(word),float(b[i]))));
}
export function vectors(op,seed=SEEDS[0]){
 let values=[0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,0x00800000,0x80800000,0x00800001,0x80800001,
  0x3effffff,0xbeffffff,0x3f000000,0xbf000000,0x3f7fffff,0xbf7fffff,0x3f800000,0xbf800000,0x3f800001,0xbf800001,
  0x3fc00000,0xbfc00000,0x4b000001,0xcb000001,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,
  0x7fc12345,0xffc54321,0x7f800001,0xff800001,0x7fffffff,0xffffffff];
 if(op==='MIN')values=values.filter(normalOrZero);
 const pairs=values.flatMap(a=>values.map(b=>[a,b])),result=[];
 while(pairs.length%4)pairs.push([0,0]);
 for(let i=0;i<pairs.length;i+=4)result.push({name:`edge-${op}-${i/4}`,a:pairs.slice(i,i+4).map(x=>x[0]),b:pairs.slice(i,i+4).map(x=>x[1])});
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;const w=state>>>0;
  return op==='MIN_PRECISE'?w:(((1+(w%254))*0x800000)+(w&0x7fffff)+(w&0x80000000))>>>0;};
 for(let i=0;i<8;i++)result.push({name:`random-${seed}-${i}`,a:Array.from({length:4},next),b:Array.from({length:4},next)});
 return result;
}
export function physicalVectors(op,seed=SEEDS[0]){return vectors(op,seed).filter((v,i)=>
 i<4||i%12===0||v.name.startsWith('random-')||v.a.some(w=>[0x7fc12345,0xff800001,0x00800000,0x80000000,0x3f800000].includes(w))&&i%4===0);}
const imm=(i,a)=>`IMM[${i}] UINT32 {${a.join(',')}}`;
export {PARTNER_VERTEX,PARTNER_FRAGMENT} from '../virgl-signed-conversions/cases.mjs';
export const VARIANTS=['direct','swizzled','masked','alias','join',...Array.from({length:15},(_,i)=>i+1).filter(m=>m!==5).map(m=>'mask-'+m)];
export const bankVariants=()=>VARIANTS;
export function selectedWords(op,vector,variant='direct',condition=0,modifier=''){
 let a=variant==='join'&&!condition?vector.b.slice():vector.a.slice(),b=variant==='join'&&!condition?vector.a.slice():vector.b.slice();
 if(variant==='swizzled'||variant==='alias'){a.reverse();b=[b[1],b[0],b[3],b[2]];}
 if(modifier.includes('a'))a=a.map(w=>(w^0x80000000)>>>0);
 if(modifier.includes('b'))b=b.map(w=>(w^0x80000000)>>>0);
 const output=evaluate(op,a,b);if(variant==='masked'||variant.startsWith('mask-')){const mask=variant==='masked'?5:Number(variant.slice(5));for(let i=0;i<4;i++)if(!(mask&(1<<i)))output[i]=vector.a[i];}return output;
}
function body(op,bank,variant,modifier='',inputSource=false){
 const a=inputSource?'IN[1]':bank?'CONST[0]':'IMM[0]',b=bank?'CONST[45]':'IMM[1]',sa=r=>modifier.includes('a')?'-'+r:r,sb=r=>modifier.includes('b')?'-'+r:r;
 if(variant==='masked'||variant.startsWith('mask-')){const mask=variant==='masked'?5:Number(variant.slice(5)),lanes=[...'xyzw'].filter((_,i)=>mask&(1<<i)).join('');return [`MOV TEMP[0], ${a}`,`${op} TEMP[0].${lanes}, ${sa(a)}, ${sb(b)}`];}
 if(variant==='alias')return [`MOV TEMP[0], ${a}`,`${op} TEMP[0], ${sa('TEMP[0].wzyx')}, ${sb(b+'.yxwz')}`];
 if(variant==='join')return ['UIF CONST[43].xxxx',`${op} TEMP[0], ${sa(a)}, ${sb(b)}`,'ELSE',`${op} TEMP[0], ${sa(b)}, ${sb(a)}`,'ENDIF'];
 return [`${op} TEMP[0], ${sa(a+(variant==='swizzled'?'.wzyx':''))}, ${sb(b+(variant==='swizzled'?'.yxwz':''))}`];
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
 const v={name:'representative',a:[0x3fc00000,0xbfc00000,0,0x80000000],b:[0x40000000,0xbf800000,0x80000000,0]};
 for(const op of ['MIN','MIN_PRECISE']){
  for(const seed of SEEDS)for(const x of vectors(op,seed))if(seed===SEEDS[0]||x.name.startsWith('random-'))add(`${op}-${x.name}`,'vertex',carrier(op,x),true,true);
  for(const variant of VARIANTS){add(`${op}-literal-${variant}`,'vertex',carrier(op,vectors(op)[0],variant),true,variant!=='join');add(`${op}-bank-${variant}`,'vertex',carrier(op,vectors(op)[0],variant,true),true,variant!=='join');}
  for(const x of physicalVectors(op).filter((_,i)=>i%12===0))for(let plane=0;plane<32;plane++)add(`${op}-${x.name}-plane-${plane}`,'fragment',bitplane(op,x,plane),true,true);
  add(op+'-physical-input-source','vertex',carrier(op,v,'direct',false,'',true),true,true);
  for(const modifier of ['a','b','ab']){add(op+'-negation-'+modifier,'vertex',carrier(op,v,'direct',false,modifier),true,true);add(op+'-bank-negation-'+modifier,'vertex',carrier(op,v,'direct',true,modifier),true,true);}
  const head=['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..2]','DCL CONST[0..45]',imm(0,v.a),imm(1,v.b),imm(2,[0,0,0,0])];
  const program=lines=>[...head,...lines,'END',''].join('\n');
  for(let mask=1;mask<16;mask++)for(const swizzle of ['xyzw','wzyx','xxxx','yxwz']){
   const lanes=[...'xyzw'].filter((_,i)=>mask&(1<<i)).join('');add(`${op}-mask-${lanes}-${swizzle}`,'fragment',program(['MOV TEMP[0], IMM[0]',`${op} TEMP[0].${lanes}, TEMP[0].${swizzle}, IMM[1].wzyx`,'MOV OUT[0], IMM[2]']),true,true);
  }
  for(const bad of [`${op}_SAT TEMP[0], IMM[0], IMM[1]`,`${op} TEMP[0]`,`${op} TEMP[0], IMM[0]`,`${op} TEMP[0], IMM[0], IMM[1], IMM[0]`,`${op} TEMP[0], CONST[46], IMM[0]`,`${op} CONST[0], IMM[0], IMM[1]`,`${op} TEMP[3], IMM[0], IMM[1]`,`${op} TEMP[0], IMM[0].xy, IMM[1]`,`${op} TEMP[0], |IMM[0]|, IMM[1]`,`${op.toLowerCase()} TEMP[0], IMM[0], IMM[1]`])add('malformed-'+bad,'fragment',program([bad,'MOV OUT[0], IMM[2]']),false);
  add(op+'-missing-lanes','fragment',program([`${op} TEMP[0].x, IMM[0], IMM[1]`,'MOV OUT[0], TEMP[0]']),false);
  add(op+'-killed-version','fragment',program(['MOV TEMP[0], IN[0]','UADD TEMP[0], CONST[0], CONST[1]',`${op} TEMP[1], TEMP[0], IMM[0]`,'MOV OUT[0], IMM[2]']),op==='MIN_PRECISE');
  add(op+'-saved-version','fragment',program(['MOV TEMP[0], IN[0]','MOV TEMP[1], TEMP[0]','UADD TEMP[0], CONST[0], CONST[1]',`${op} OUT[0], TEMP[1], IMM[0]`]),true,true);
  add(op+'-direct-numeric-output','fragment',program([`${op} OUT[0], IMM[0], IMM[1]`]),true,true);
  add(op+'-copied-bank-output','fragment',program([`${op} OUT[0], CONST[0], CONST[45]`]),true,true);
  add(op+'-float-locator-negation','fragment',program(['MOV TEMP[0], IN[0]',`${op} OUT[0], -TEMP[0], IMM[1]`]),true,true);
  for(const w of [1,0x80000001,0x7fffff,0x807fffff,0x7f800000,0xff800000,0x7fc12345,0xffffffff]){
   add(`${op}-private-word-${w}`,'vertex',carrier(op,{a:Array(4).fill(w),b:[0,0,0,0]}),op==='MIN_PRECISE',true);
   add(`${op}-unselected-unsafe-payload-${w}`,'fragment',program([imm(3,Array(4).fill(w)),`${op} OUT[0], IMM[2], IMM[3]`]),op==='MIN_PRECISE'&&float(0)<float(w));
  }
 }
 // Every old precision opcode coexists with a local minimum marker.
 add('adjacent-old-and-new-precision','vertex',carrier('MIN_PRECISE',v).replace('MOV OUT[0], IN[0]',
  'MIN TEMP[0], IMM[0], IMM[1]\nMIN_PRECISE TEMP[0], TEMP[0], IMM[0]\nMAX_PRECISE TEMP[0], TEMP[0], IMM[1]\nFSEQ_PRECISE TEMP[0], IMM[0], IMM[1]\nFSNE_PRECISE TEMP[0], IMM[0], IMM[1]\nMOV_PRECISE TEMP[0], IMM[0]\nMOV OUT[0], IN[0]'),true,true);
 return cases;
}
