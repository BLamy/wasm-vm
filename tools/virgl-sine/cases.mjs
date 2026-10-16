// Input declarations only. reference.py independently encloses each real SIN.
export {PARTNER_VERTEX,PARTNER_FRAGMENT} from '../virgl-signed-conversions/cases.mjs';
export {bits,float,imm,suffix,carrier,bytesFragment,VARIANTS,maskOf,swizzleOf} from '../virgl-exponent-logarithm/cases.mjs';
import {bits,imm,carrier,bytesFragment,VARIANTS,maskOf,swizzleOf} from '../virgl-exponent-logarithm/cases.mjs';
export const SEEDS=[0x173bc849,0x7f426a1d,0xca9e0873],OPS=['SIN'];
export function vectors(op='SIN',seed=SEEDS[0]){
 const words=[bits(.5),0,0x80000000,0x00800000,0x80800000,0x00800001,0x80800001,bits(8),bits(8)-1,bits(-8),bits(-8)-1,bits(1),bits(-1)];
 // Exact binary32 declarations nearest pi/2, pi, 3pi/2 and 2pi, plus neighbors.
 // The oracle evaluates these exact words; their labels supply no expected sine.
 for(const w of [0x3fc90fdb,0x40490fdb,0x4096cbe4,0x40c90fdb])for(const offset of [-1,0,1])for(const sign of [0,0x80000000])words.push(((w+offset)^sign)>>>0);
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 for(let i=0;i<8;i++)words.push(bits((next()%1600001)/100000-8));
 return words.map((w,i)=>({name:i<words.length-8?'boundary-'+i:'random-'+seed+'-'+i,a:[w,bits(1),bits(2),bits(.75)],b:[bits(-2),bits(.5),bits(1),bits(2)]}));
}
export function selected(op,input,variant='direct',condition=0,modifier='',backend='owned'){
 const a=variant.startsWith('join')&&!condition?input.b:input.a,swizzle=swizzleOf(variant);
 return Array.from({length:4},(_,lane)=>{let w=a['xyzw'.indexOf(swizzle[backend==='mesa'?lane:0])];if(variant==='bit-bounded')w=((w&0x7fffff)|0x3f800000)>>>0;if(modifier==='neg')w=(w^0x80000000)>>>0;
  return maskOf(variant)&(1<<lane)?{op:'SIN',word:w}:{exact:input.a[lane]};});
}
export function getCases(){
 const cases=[],add=(name,stage,text,ok,primary=false)=>cases.push({name,stage,text,ok,primary});
 for(const seed of SEEDS)for(const v of vectors('SIN',seed)){
  if(seed!==SEEDS[0]&&!v.name.startsWith('random-'))continue;
  add(`SIN-${v.name}`,'vertex',carrier('SIN',v),true,true);add(`SIN-${v.name}-broadcast`,'vertex',carrier('SIN',v,'swizzle-xxxx'),true,true);
  for(let lane=0;lane<4;lane++){add(`SIN-${v.name}-bytes-${lane}`,'fragment',bytesFragment('SIN',v,lane),true,true);add(`SIN-${v.name}-broadcast-bytes-${lane}`,'fragment',bytesFragment('SIN',v,lane,'swizzle-xxxx'),true,true);}
 }
 const partial={name:'partial-joined',a:Array(4).fill(bits(1)),b:Array(4).fill(bits(1.5))};add('SIN-join-source','vertex',carrier('SIN',partial,'join-source'),true,true);
 const v=vectors()[0];for(const variant of VARIANTS){add(`SIN-${variant}`,'vertex',carrier('SIN',v,variant),true,true);if(variant!=='join')for(let lane=0;lane<4;lane++)add(`SIN-${variant}-bytes-${lane}`,'fragment',bytesFragment('SIN',v,lane,variant),true,true);}
 for(const variant of ['direct','alias','mask-10','join'])add(`SIN-neg-${variant}`,'vertex',carrier('SIN',v,variant,'neg'),true,true);
 const header=['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..4]','DCL CONST[0..45]',imm(0,[bits(1),bits(2),bits(.5),bits(4)]),imm(1,[bits(3),bits(4),bits(8),bits(2)])];
 const program=lines=>[...header,...lines,'END',''].join('\n');
 for(const source of ['IN[0]','CONST[0]','TEMP[0]'])add('SIN-unknown-'+source,'fragment',program(['ADD TEMP[0], IMM[0], IMM[1]',`SIN TEMP[1], ${source}`,'MOV OUT[0], IMM[0]']),false);
 add('SIN-sign-facts','fragment',program(['SSG TEMP[0], IN[0]','SIN OUT[0], TEMP[0]']),true,true);
 for(const [name,pair,ok] of [['bounded',[1,1.5],true],['signs',[-1,1],true],['endpoints',[-8,8],true],['overapproximation',[7,8],false],['unsafe',[1,9],false]])
  add('SIN-join-'+name,'fragment',program([imm(2,Array(4).fill(bits(pair[0]))),imm(3,Array(4).fill(bits(pair[1]))),'UIF CONST[43].xxxx','MOV TEMP[0], IMM[2]','ELSE','MOV TEMP[0], IMM[3]','ENDIF','SIN OUT[0], TEMP[0]']),ok,ok);
 add('SIN-killed-source','fragment',program(['MOV TEMP[0], IMM[0]','UADD TEMP[0], CONST[0], CONST[1]','SIN TEMP[1], TEMP[0]','MOV OUT[0], IMM[0]']),false);
 add('SIN-bad-join','fragment',program(['UIF CONST[43].xxxx','MOV TEMP[0], IMM[0]','ELSE','MOV TEMP[0], IN[0]','ENDIF','SIN TEMP[1], TEMP[0]','MOV OUT[0], IMM[0]']),false);
 add('SIN-source-x-only','fragment',program(['MOV TEMP[0].x, IMM[0].yyyy','SIN OUT[0].yw, TEMP[0].xzyw','MOV OUT[0].xz, IMM[0]']),true,true);
 add('SIN-unused-special','fragment',program([imm(2,[bits(2),0x7fc00001,1,0xff800000]),'SIN OUT[0], IMM[2]']),true,true);
 add('SIN-no-result-F2I-facts','fragment',program(['SIN TEMP[0], IMM[0]','F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]']),false);
 for(const producer of ['SIN','EX2','LG2'])add('SIN-no-computed-facts-'+producer,'fragment',program([`${producer} TEMP[0], IMM[0]`,'SIN OUT[0], TEMP[0]']),false);
 for(const spelling of ['SIN_SAT','SIN_PRECISE','COS','POW_PRECISE'])add('SIN-unsupported-'+spelling,'fragment',program([`${spelling} TEMP[0], IMM[0]${spelling==='POW_PRECISE'?', IMM[1]':''}`,'MOV OUT[0], IMM[0]']),false);
 for(const bad of ['SIN TEMP[5], IMM[0]','SIN TEMP[0], CONST[46]','SIN TEMP[0], |IMM[0]|','SIN TEMP[0], IMM[0].xy','SIN CONST[0], IMM[0]','SIN TEMP[0], IMM[0], IMM[1]'])add('malformed-'+bad,'fragment',program([bad,'MOV OUT[0], IMM[0]']),false);
 for(const w of [bits(8)+1,bits(-8)+1,bits(9),bits(-9),1,0x80000001,0x007fffff,0x7f800000,0xff800000,0x7fc00001])add('SIN-out-of-domain-'+w,'fragment',program([imm(2,Array(4).fill(w)),'SIN TEMP[0], IMM[2]','MOV OUT[0], IMM[0]']),false);
 add('SIN-neg-out-of-domain','fragment',program([imm(2,Array(4).fill(bits(-9))),'SIN OUT[0], -IMM[2]']),false);
 add('adjacent-SIN-and-EX2-and-LG2','fragment',program(['SIN TEMP[0], IMM[0]','EX2 TEMP[1], IMM[1]','LG2 TEMP[2], IMM[1]','MOV OUT[0], TEMP[0]']),true,true);
 return cases;
}
