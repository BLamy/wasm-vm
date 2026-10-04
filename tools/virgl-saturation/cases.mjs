// Independent rational equations and numerical enclosures, never emitted GLSL.
import {classify,roundRational} from '../virgl-precise-arithmetic/oracle.mjs';
export {PARTNER_VERTEX,PARTNER_FRAGMENT} from '../virgl-signed-conversions/cases.mjs';
export const SEEDS=[0x61c92ad7,0xb734e129,0xe2689f03];
export const OPS=['MOV','MOV_SAT','DIV','DIV_SAT'];
const view=new DataView(new ArrayBuffer(4));
export const bits=x=>{view.setFloat32(0,x,true);return view.getUint32(0,true);};
export const float=w=>{view.setUint32(0,w,true);return view.getFloat32(0,true);};
export const normalOrZero=w=>(w&0x7fffffff)===0||((w&0x7f800000)!==0&&(w&0x7f800000)!==0x7f800000);
const power=e=>e>=0?[1n<<BigInt(e),1n]:[1n,1n<<BigInt(-e)];
const bitLength=n=>n.toString(2).length;
export function laneOracle(op,source,divisor){
 const a=classify(source);if(a.kind!=='finite'||!normalOrZero(source))throw Error('normal-or-zero numerical source');
 let n=a.n,d=a.d;
 if(op.startsWith('DIV')){const b=classify(divisor);if(b.kind!=='finite'||b.n===0n||!normalOrZero(divisor))throw Error('defined normal denominator');
  n*=b.d;d*=b.n;if(d<0n){n=-n;d=-d;}}
 const saturation=op.endsWith('_SAT');
 let center=roundRational(n,d);if(n===0n)center=((source^(op.startsWith('DIV')?divisor:0))&0x80000000)>>>0;
 if(saturation&&n<0n)center=0;else if(saturation&&n>d)center=0x3f800000;
 if(!op.startsWith('DIV'))return{center,allowed:saturation&&(center&0x7fffffff)===0?[0,0x80000000]:[center],kind:'exact-move',n:n.toString(),d:d.toString()};
 if(n===0n)return{center,allowed:[0,0x80000000],kind:'zero-division',n:'0',d:d.toString()};
 const magnitude=n<0n?-n:n;let e=bitLength(magnitude)-bitLength(d);
 if(e>=0?magnitude<(d<<BigInt(e)):(magnitude<<BigInt(-e))<d)e--;
 const [un,ud]=power(e-23),radiusN=5n*un,radiusD=2n*ud;
 const lowN=n*radiusD-radiusN*d,highN=n*radiusD+radiusN*d,endpointD=d*radiusD;
 // Search neighboring binary32 encodings around the independently rounded
 // center of the quotient; exact plateau bounds are then applied numerically.
 const q=roundRational(n,d),allowed=new Set();
 for(let delta=-8;delta<=8;delta++){
  const w=(q+delta)>>>0,v=classify(w);if(v.kind!=='finite')continue;
  if(v.n*endpointD<lowN*v.d||v.n*endpointD>highN*v.d)continue;
  const final=saturation&&v.n<0n?0:saturation&&v.n>v.d?0x3f800000:w;allowed.add(final);
 }
 if(saturation&&(allowed.has(0)||allowed.has(0x80000000))){allowed.add(0);allowed.add(0x80000000);}
 if(!allowed.size)throw Error('empty independent division enclosure');
 return{center,allowed:[...allowed].sort((a,b)=>a-b),kind:'highp-division-2.5-ulp',n:n.toString(),d:d.toString(),
  lower:{n:lowN.toString(),d:endpointD.toString()},upper:{n:highN.toString(),d:endpointD.toString()},exponent:e};
}
export const VARIANTS=['direct','swizzled','masked','alias','join',...Array.from({length:15},(_,i)=>i+1).filter(m=>m!==5).map(m=>'mask-'+m)];
export const maskOf=variant=>variant==='masked'?5:variant.startsWith('mask-')?Number(variant.slice(5)):15;
export function vectors(op,seed=SEEDS[0]){
 const list=[],add=(name,a,d=[1,1,1,1])=>list.push({name,a:a.map(bits),b:a.slice().reverse().map(bits),d:d.map(bits)});
 add('clamp-plateaus',[-2,0,.25,2]);add('signed-zero',[-0,0,1,-1]);
 add('near-one',[float(0x3f7fffff),1,float(0x3f800001),float(0xbf800001)]);
 add('near-zero',[float(0x00800000),-float(0x00800000),float(0x7f7fffff),-float(0x7f7fffff)]);
 if(op.startsWith('DIV')){
  add('post-order',[1.5,.75,-.75,-1.5],[2,.5,2,-2]);
  add('rounding',[1,2,3,7],[3,7,11,13]);add('denominator-sign',[.75,-.75,1.5,-1.5],[-1,-1,-2,-2]);
  add('divisor-neighbors',[.25,.5,1,1.5],[float(0x3f7fffff),float(0x3f800001),float(0x3fffffff),float(0x40000001)]);
  add('quotient-near-one',[float(0x3f7fffff),1,float(0x3f800001),float(0x40000001)],[1,1,1,2]);
 }
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 for(let i=0;i<8;i++){const a=Array.from({length:4},()=>((next()%131071)-65535)/16384);
  add('random-'+seed+'-'+i,a,op.startsWith('DIV')&&i%2?Array.from({length:4},()=>[.5,2,3,-2][next()%4]):[1,1,1,1]);}
 return list;
}
export function selectedOracles(op,v,variant='direct',condition=0,modifier=''){
 let a=(variant==='join'&&!condition?v.b:v.a).slice();if(['alias','swizzled'].includes(variant))a.reverse();
 if(modifier==='neg')a=a.map(w=>(w^0x80000000)>>>0);
 return a.map((w,i)=>maskOf(variant)&(1<<i)?laneOracle(op,w,v.d[i]):{center:v.a[i],allowed:[v.a[i]],kind:'unchanged-lane'});
}
export const selectedWords=(...args)=>selectedOracles(...args).map(v=>v.center);
const imm=(i,a)=>`IMM[${i}] UINT32 {${a.join(',')}}`;
function body(op,bank,variant,modifier='',inputSource=false){
 const a=inputSource?'IN[1]':bank?'CONST[0]':'IMM[0]',b=bank?'CONST[45]':'IMM[1]',mod=r=>modifier==='neg'?'-'+r:r;
 const instruction=(dst,source)=>`${op} ${dst}, ${mod(source)}${op.startsWith('DIV')?', IMM[3]':''}`;
 if(maskOf(variant)!==15)return[`MOV TEMP[0], ${a}`,instruction('TEMP[0].'+[...'xyzw'].filter((_,i)=>maskOf(variant)&(1<<i)).join(''),a)];
 if(variant==='alias')return[`MOV TEMP[0], ${a}`,instruction('TEMP[0]','TEMP[0].wzyx')];
 if(variant==='join')return['UIF CONST[43].xxxx',instruction('TEMP[0]',a),'ELSE',instruction('TEMP[0]',b),'ENDIF'];
 return[instruction('TEMP[0]',a+(variant==='swizzled'?'.wzyx':''))];
}
export function carrier(op,v,variant='direct',bank=false,modifier='',inputSource=false){
 return['VERT','DCL IN[0]',...(inputSource?['DCL IN[1]']:[]),'DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]','DCL TEMP[0..2]',
 ...(bank||variant==='join'?['DCL CONST[0..45]']:[]),imm(0,v.a),imm(1,v.b),imm(2,[8388607,1056964608,23,0]),imm(3,v.d),
 ...body(op,bank,variant,modifier,inputSource),'AND TEMP[1], TEMP[0], IMM[2].xxxx','OR TEMP[1], TEMP[1], IMM[2].yyyy','USHR TEMP[2], TEMP[0], IMM[2].zzzz','OR TEMP[2], TEMP[2], IMM[2].yyyy','MOV OUT[0], IN[0]','MOV OUT[1], TEMP[1]','MOV OUT[2], TEMP[2]','END',''].join('\n');
}
export function bitplane(op,v,plane,bank=false){return['FRAG','DCL OUT[0], COLOR','DCL TEMP[0]',...(bank?['DCL CONST[0..45]']:[]),imm(0,v.a),imm(1,v.b),imm(2,[plane,1,1065353216,0]),imm(3,v.d),
 ...body(op,bank,'direct'),'USHR TEMP[0], TEMP[0], IMM[2].xxxx','AND TEMP[0], TEMP[0], IMM[2].yyyy','UCMP OUT[0], TEMP[0], IMM[2].zzzz, IMM[2].wwww','END',''].join('\n');}
export function getCases(){
 const cases=[],add=(name,stage,text,ok,primary=false,saturation=true)=>cases.push({name,stage,text,ok,primary,saturation});
 for(const op of OPS){const saturated=op.endsWith('_SAT'),all=SEEDS.flatMap(seed=>vectors(op,seed).filter(v=>seed===SEEDS[0]||v.name.startsWith('random-')));
  for(const v of all){add(op+'-'+v.name,'vertex',carrier(op,v),true,true,saturated);
   if(v.name.startsWith('random-'))continue;for(let plane=0;plane<32;plane++)add(op+'-'+v.name+'-plane-'+plane,'fragment',bitplane(op,v,plane),true,true,saturated);}
  for(const variant of VARIANTS){const v=vectors(op)[0];add(op+'-literal-'+variant,'vertex',carrier(op,v,variant),true,variant!=='join',saturated);
   add(op+'-bank-'+variant,'vertex',carrier(op,v,variant,true),true,variant!=='join',saturated);}
  for(const modifier of ['', 'neg']){const v=vectors(op)[0];add(op+'-input-'+modifier,'vertex',carrier(op,v,'direct',false,modifier,true),op!=='MOV'||!modifier,op!=='MOV'||!modifier,saturated);
   add(op+'-bank-modifier-'+modifier,'vertex',carrier(op,v,'direct',true,modifier),op!=='MOV'||!modifier,op!=='MOV'||!modifier,saturated);}
 }
 const header=['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..3]','DCL CONST[0..45]',imm(0,[0x3f000000,0xbf000000,0,0x80000000]),imm(1,Array(4).fill(0x3f800000))];
 const program=lines=>[...header,...lines,'END',''].join('\n');
 for(const op of ['MOV_SAT','DIV_SAT']){
  const tail=op==='DIV_SAT'?', IMM[1]':'';
  add(op+'-raw-manufacture','fragment',program(['UADD TEMP[0], CONST[0], CONST[1]',`${op} TEMP[0], TEMP[0]${tail}`,'MOV OUT[0], IMM[0]']),false);
  add(op+'-killed-source','fragment',program(['MOV TEMP[0], IN[0]','UADD TEMP[0], CONST[0], CONST[1]',`${op} OUT[0], TEMP[0]${tail}`]),false);
  add(op+'-saved-source','fragment',program([`${op} TEMP[0], IN[0]${tail}`,'MOV TEMP[1], TEMP[0]','UADD TEMP[0], CONST[0], CONST[1]','MOV OUT[0], TEMP[1]']),true,true);
  add(op+'-bad-join','fragment',program(['UIF CONST[0].xxxx','MOV TEMP[0], IN[0]','ELSE','UADD TEMP[0], CONST[0], CONST[1]','ENDIF',`${op} OUT[0], TEMP[0]${tail}`]),false);
  add(op+'-copied-bank-output','fragment',program([`${op} OUT[0].x, CONST[0].xxxx${tail}`,'MOV OUT[0].yzw, CONST[45]']),true,true);
  for(const bad of [`${op}_PRECISE TEMP[0], IMM[0]${tail}`,`${op} TEMP[0], |IMM[0]|${tail}`,`${op} TEMP[4], IMM[0]${tail}`,`${op} TEMP[0], CONST[46]${tail}`,`${op} TEMP[0], IMM[0].xy${tail}`,`${op} CONST[0], IMM[0]${tail}`])add('malformed-'+bad,'fragment',program([bad,'MOV OUT[0], IMM[0]']),false);
  for(const w of [1,0x80000001,0x007fffff,0x807fffff,0x7f800000,0xff800000,0x7fc12345])add(op+'-unproved-word-'+w,'fragment',program([imm(2,Array(4).fill(w)),`${op} TEMP[0], IMM[2]${tail}`,'MOV OUT[0], IMM[0]']),false);
 }
 for(const w of [0,0x80000000,1,0x80000001,0x7f800000,0xff800000,0x7fc12345,0x7e800001,0x7f7fffff])add('division-denominator-'+w,'fragment',program([imm(2,Array(4).fill(w)),'DIV_SAT TEMP[0], IMM[0], IMM[2]','MOV OUT[0], IMM[0]']),false);
 for(const src of ['IN[0]','CONST[0]','TEMP[0]'])add('division-unknown-denominator-'+src,'fragment',program(['MOV TEMP[0], IN[0]',`DIV_SAT TEMP[1], IMM[0], ${src}`,'MOV OUT[0], IMM[0]']),false);
 for(const w of [0x3f000000,0x40000000,0xbf000000,0xc0000000])add('division-unknown-nonunit-numerator-'+w,'fragment',program([imm(2,Array(4).fill(w)),'DIV_SAT TEMP[0], IN[0], IMM[2]','MOV OUT[0], IMM[0]']),false);
 for(const [a,b,ok] of [[0x00800000,0x40000000,false],[0x00800000,0x3f000000,false],[0x7f7fffff,0x3f000000,false],[0x7f7fffff,0x40000000,false],[0x00800000,0x00800000,true],[0x7e800000,0x7e800000,true],[0,0x7e800000,true],[0x80000000,0xfe800000,true]])add(`division-quotient-margin-${a}-${b}`,'fragment',program([imm(2,Array(4).fill(a)),imm(3,Array(4).fill(b)),'DIV_SAT TEMP[0], IMM[2], IMM[3]','MOV OUT[0], IMM[0]']),ok,ok);
 for(const mask of Array.from({length:15},(_,i)=>i+1))for(const swizzle of ['xyzw','wzyx','xxxx','zxyw'])for(const op of ['MOV_SAT','DIV_SAT'])add(`saturation-${op}-mask-${mask}-${swizzle}`,'fragment',program(['MOV TEMP[0], IMM[0]',`${op} TEMP[0].${[...'xyzw'].filter((_,i)=>mask&(1<<i)).join('')}, -IMM[0].${swizzle}${op==='DIV_SAT'?', -IMM[1]':''}`,'MOV OUT[0], TEMP[0]']),true,true);
 add('saturation-local-adjacency','fragment',program(['MOV TEMP[0], IMM[0]','MOV_SAT TEMP[1], TEMP[0]','DIV TEMP[2], TEMP[0], IMM[1]','DIV_SAT TEMP[2].xz, -TEMP[2], -IMM[1]','MOV OUT[0], TEMP[1]']),true,true);
 add('saturation-no-range-facts','fragment',program(['MOV_SAT TEMP[0], IN[0]','F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]']),false);
 add('unsupported-ADD-SAT','fragment',program(['ADD_SAT TEMP[0], IMM[0], IMM[0]','MOV OUT[0], IMM[0]']),false);
 return cases;
}
