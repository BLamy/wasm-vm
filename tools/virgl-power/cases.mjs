// Input declarations only. The independent Decimal reference owns predictions.
export {PARTNER_VERTEX,PARTNER_FRAGMENT} from '../virgl-signed-conversions/cases.mjs';
export {bits,float,imm,suffix} from '../virgl-exponent-logarithm/cases.mjs';
import {bits,imm,suffix} from '../virgl-exponent-logarithm/cases.mjs';
export const SEEDS=[0x243f6a88,0x85a308d3,0x13198a2e],OPS=['POW'];
export const CAPTURED_EXPONENTS=[1011862956,1042489344,1052171118,1053092943,1054168405,1055286886,1055439406,1074580685,1074673892,1075419546,1076258406,1077097267,1086906475,1117630464];
export function vectors(op='POW',seed=SEEDS[0]){
 const pairs=[[bits(.5),bits(2.2)],[0,bits(2)],[0x80000000,bits(.5)],[bits(1),bits(0)],[bits(1),bits(-0)],[bits(1),0x7f7fffff],[bits(1),0xff7fffff],
  [bits(2),bits(1)],[bits(2),bits(2)],[bits(4),bits(.5)],[bits(.25),bits(-.5)],[bits(.5),bits(-3)],[(127+120)<<23,bits(1)],[(127-120)<<23,bits(1)],
  [0x00800000,bits(.5)],[0x7f7fffff,bits(.5)],[bits(1)-1,bits(30)],[bits(1)+1,bits(-30)],[bits(2),bits(120)],[bits(.5),bits(120)],
  [bits(2),0x00800000],[0,0x00800000],[bits(.5),0x80800000],...CAPTURED_EXPONENTS.map(e=>[bits(.5),e]),...[-1,1].flatMap(n=>[[bits(.5)+n,bits(2.2)],[bits(2)+n,bits(.45)]])];
 let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 for(let i=0;i<8;i++)pairs.push([bits(.25+(next()%375001)/100000),bits((next()%600001)/10000-30)]);
 return pairs.map(([a,e],i)=>({name:i<pairs.length-8?'boundary-'+i:'random-'+seed+'-'+i,a:[a,bits(1),bits(2),bits(.75)],e:[e,bits(2),bits(.5),bits(-2)],b:[bits(1.5),bits(.5),bits(1),bits(2)],f:[bits(1),bits(3),bits(2),bits(.5)]}));
}
export const VARIANTS=['direct','alias','alias-exponent','join','saved','saved-exponent','killed-after','killed-exponent-after','bit-bounded',
 ...Array.from({length:15},(_,i)=>['xyzw-wzyx','wzyx-zxyw','xxxx-yyyy','zxyw-xyzw'].map(s=>'mask-'+(i+1)+'-'+s)).flat(),
 ...['xyzw-wzyx','wzyx-zxyw','xxxx-xxxx','zxyw-xyzw'].map(s=>'swizzle-'+s)];
export const maskOf=v=>v.startsWith('mask-')?Number(v.split('-')[1]):15;
export const swizzlesOf=v=>v==='alias'?['wzyx','zxyw']:v==='alias-exponent'?['zxyw','wzyx']:v.startsWith('swizzle-')?v.slice(8).split('-'):v.startsWith('mask-')?[v.split('-')[2]??'xyzw',v.split('-')[3]??'xyzw']:['xyzw','xyzw'];
export function selected(op,input,variant='direct',condition=0,modifier='',backend='owned'){
 const alternate=variant.startsWith('join')&&!condition,a=alternate?input.b:input.a,e=alternate?input.f:input.e,[sa,se]=swizzlesOf(variant);
 return Array.from({length:4},(_,lane)=>{const i=backend==='mesa'?[0,1,2,3].filter(n=>n<lane&&(maskOf(variant)&(1<<n))).length:0;let w=a['xyzw'.indexOf(sa[i])],x=e['xyzw'.indexOf(se[i])];
  if(variant==='bit-bounded'){w=((w&0x7fffff)|0x3f800000)>>>0;x=((x&0x7fffff)|0x3f800000)>>>0;}
  if(modifier==='neg-base'||modifier==='neg-both')w=(w^0x80000000)>>>0;if(modifier==='neg-exponent'||modifier==='neg-both')x=(x^0x80000000)>>>0;
  return maskOf(variant)&(1<<lane)?{op:'POW',word:w,exponentWord:x}:{exact:variant==='alias-exponent'?input.e[lane]:input.a[lane]};});
}
export function body(op,variant='direct',modifier=''){
 const ins=(dst,a,e)=>`${op} ${dst}, ${modifier==='neg-base'||modifier==='neg-both'?'-':''}${a}, ${modifier==='neg-exponent'||modifier==='neg-both'?'-':''}${e}`;
 const initial=['MOV TEMP[0], IMM[0]'];
 if(variant==='bit-bounded')return [...initial,'AND TEMP[3], CONST[0], IMM[4].xxxx','OR TEMP[3], TEMP[3], IMM[4].yyyy','AND TEMP[4], CONST[45], IMM[4].xxxx','OR TEMP[4], TEMP[4], IMM[4].yyyy',ins('TEMP[0]','TEMP[3]','TEMP[4]')];
 if(variant==='join-source')return [...initial,'UIF CONST[43].xxxx','MOV TEMP[3], IMM[0]','MOV TEMP[4], IMM[1]','ELSE','MOV TEMP[3], IMM[2]','MOV TEMP[4], IMM[3]','ENDIF',ins('TEMP[0]','TEMP[3]','TEMP[4]')];
 if(variant==='join')return [...initial,'UIF CONST[43].xxxx',ins('TEMP[0]','IMM[0]','IMM[1]'),'ELSE',ins('TEMP[0]','IMM[2]','IMM[3]'),'ENDIF'];
 if(variant.startsWith('saved')||variant.startsWith('killed'))return [...initial,'MOV TEMP[3], IMM[0]','MOV TEMP[4], IMM[1]',ins('TEMP[0]','TEMP[3]','TEMP[4]'),
  ...(variant.startsWith('killed')?[`UADD TEMP[${variant.includes('exponent')?4:3}], CONST[0], CONST[1]`]:[])];
 const [sa,se]=swizzlesOf(variant);
 if(variant==='alias-exponent')return ['MOV TEMP[0], IMM[1]',ins('TEMP[0].'+suffix(maskOf(variant)),'IMM[0].'+sa,'TEMP[0].'+se)];
 return [...initial,ins('TEMP[0].'+suffix(maskOf(variant)),(variant==='alias'?'TEMP[0]':'IMM[0]')+'.'+sa,'IMM[1].'+se)];
}
const bank=v=>v.startsWith('join')||v.startsWith('killed')||v==='bit-bounded';
const declarations=v=>[imm(0,v.a),imm(1,v.e),imm(2,v.b),imm(3,v.f),imm(4,[0x7fffff,0x3f800000,0,0])];
export function carrier(op,v,variant='direct',modifier=''){
 return ['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]','DCL TEMP[0..4]',...(bank(variant)?['DCL CONST[0..45]']:[]),...declarations(v),imm(5,[8388607,1056964608,23,0]),...body(op,variant,modifier),
 'AND TEMP[1], TEMP[0], IMM[5].xxxx','OR TEMP[1], TEMP[1], IMM[5].yyyy','USHR TEMP[2], TEMP[0], IMM[5].zzzz','OR TEMP[2], TEMP[2], IMM[5].yyyy','MOV OUT[0], IN[0]','MOV OUT[1], TEMP[1]','MOV OUT[2], TEMP[2]','END',''].join('\n');
}
export function bytesFragment(op,v,lane=0,variant='direct',modifier=''){
 return ['FRAG','DCL OUT[0], COLOR','DCL TEMP[0..4]',...(bank(variant)?['DCL CONST[0..45]']:[]),...declarations(v),imm(5,[0,8,16,24]),imm(6,[255,255,255,255]),...body(op,variant,modifier),
 `USHR TEMP[1], TEMP[0].${'xyzw'[lane].repeat(4)}, IMM[5]`,'AND TEMP[1], TEMP[1], IMM[6]','I2F TEMP[2], TEMP[1]','I2F TEMP[3], IMM[6]','DIV OUT[0], TEMP[2], TEMP[3]','END',''].join('\n');
}
export function getCases(){
 const cases=[],add=(name,stage,text,ok,primary=false)=>cases.push({name,stage,text,ok,primary});
 for(const seed of SEEDS)for(const v of vectors('POW',seed)){if(seed!==SEEDS[0]&&!v.name.startsWith('random-'))continue;
  for(const variant of ['direct','swizzle-xxxx-xxxx']){add(`POW-${v.name}-${variant}`,'vertex',carrier('POW',v,variant),true,true);for(let l=0;l<4;l++)add(`POW-${v.name}-${variant}-bytes-${l}`,'fragment',bytesFragment('POW',v,l,variant),true,true);}}
 const v=vectors()[0];for(const variant of VARIANTS){add('POW-'+variant,'vertex',carrier('POW',v,variant),true,true);if(variant!=='join')for(let l=0;l<4;l++)add(`POW-${variant}-bytes-${l}`,'fragment',bytesFragment('POW',v,l,variant),true,true);}
 const partial={...v,name:'partial-joined',a:Array(4).fill(bits(1)),b:Array(4).fill(bits(1.5)),e:Array(4).fill(bits(1)),f:Array(4).fill(bits(1.5))};add('POW-join-source','vertex',carrier('POW',partial,'join-source'),true,true);
 for(const modifier of ['neg-base','neg-exponent','neg-both']){const input={...v,a:v.a.map(w=>modifier==='neg-exponent'?w:(w^0x80000000)>>>0),e:v.e.map(w=>modifier==='neg-base'?w:(w^0x80000000)>>>0)};
  for(const variant of ['direct','alias','alias-exponent','mask-10-xyzw-wzyx'])add(`POW-${modifier}-${variant}`,'vertex',carrier('POW',input,variant,modifier),true,true);}
 const header=['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..4]','DCL CONST[0..45]',imm(0,Array(4).fill(bits(.5))),imm(1,Array(4).fill(bits(2)))];
 const program=lines=>[...header,...lines,'END',''].join('\n');
 for(let s=0;s<2;s++){
  for(const src of ['IN[0]','CONST[0]','TEMP[3]'])add(`POW-opaque-${s}-${src}`,'fragment',program(['ADD TEMP[3], IMM[0], IMM[1]',`POW TEMP[0], ${s===0?src:'IMM[0]'}, ${s===1?src:'IMM[1]'}`,'MOV OUT[0], IMM[0]']),false);
  add('POW-killed-'+s,'fragment',program(['MOV TEMP[0], IMM[0]','MOV TEMP[1], IMM[1]',`UADD TEMP[${s}], CONST[0], CONST[1]`,'POW OUT[0], TEMP[0], TEMP[1]']),false);
  add('POW-bad-join-'+s,'fragment',program(['UIF CONST[43].xxxx','MOV TEMP[3], IMM[0]','ELSE','MOV TEMP[3], IN[0]','ENDIF',`POW OUT[0], ${s===0?'TEMP[3]':'IMM[0]'}, ${s===1?'TEMP[3]':'IMM[1]'}`]),false);
  for(const w of [1,0x80000001,0x007fffff,0x7f800000,0xff800000,0x7fc00001])add(`POW-special-${s}-${w}`,'fragment',program([imm(2,Array(4).fill(w)),`POW OUT[0], ${s===0?'IMM[2]':'IMM[0]'}, ${s===1?'IMM[2]':'IMM[1]'}`]),false);
 }
 for(const [a,e,ok] of [[0,0,false],[0,0x80000000,false],[0,bits(-1),false],[0x80000000,bits(-1),false],[bits(-1),bits(2),false],[bits(-.5),bits(3),false],[bits(2),bits(120),true],[bits(2),bits(120)+1,false],[bits(.5),bits(120)+1,false],[bits(2)+1,bits(120),false],[0x00800000,bits(1),false],[0x7f7fffff,bits(1),false],[(127+120)<<23,bits(1),true],[bits(2),0x7f7fffff,false],[bits(2),bits(2**23),false],[bits(2),bits(2**29),false],[bits(2),bits(2**30),false],[bits(2),bits(2**-8),true],[((127+120)<<23)+1,bits(1),false]])
  add(`POW-envelope-${a}-${e}`,'fragment',program([imm(2,Array(4).fill(a)),imm(3,Array(4).fill(e)),'POW OUT[0], IMM[2], IMM[3]']),ok,ok);
 for(const [a,b,e,f,ok] of [[1,1.5,1,1.5,true],[0,.5,.5,.5,true],[0,.5,1,1,false],[.5,2,80,80,false],[.5,.75,2,3,true],[1,1.5,-2,2,true],[-0,0,1,1.5,true]])
  add(`POW-joined-${a}-${b}-${e}-${f}`,'fragment',program([imm(2,Array(4).fill(bits(a))),imm(3,Array(4).fill(bits(b))),imm(4,Array(4).fill(bits(e))),imm(5,Array(4).fill(bits(f))),'UIF CONST[43].xxxx','MOV TEMP[0], IMM[2]','MOV TEMP[1], IMM[4]','ELSE','MOV TEMP[0], IMM[3]','MOV TEMP[1], IMM[5]','ENDIF','POW OUT[0], TEMP[0], TEMP[1]']),ok,ok);
 add('POW-sources-x-only','fragment',program(['MOV TEMP[0].x, IMM[0]','MOV TEMP[1].y, IMM[1]','POW OUT[0].yw, TEMP[0].xzyw, TEMP[1].ywxz','MOV OUT[0].xz, IMM[0]']),true,true);
 add('POW-unused-specials','fragment',program([imm(2,[bits(.5),0x7fc00001,1,0xff800000]),imm(3,[bits(2),0xff800000,0x80000001,0x7f800000]),'POW OUT[0], IMM[2], IMM[3]']),true,true);
 for(const [a,e]of [[bits(1),bits(0)],[0,bits(2)],[bits(2),bits(2)]])add(`POW-no-result-F2I-${a}-${e}`,'fragment',program([imm(2,Array(4).fill(a)),imm(3,Array(4).fill(e)),'POW TEMP[0], IMM[2], IMM[3]','F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]']),false);
 for(const op of ['POW','SIN','EX2','LG2'])add('POW-no-result-domain-'+op,'fragment',program(['POW TEMP[0], IMM[0], IMM[1]',`${op} OUT[0], TEMP[0]${op==='POW'?', IMM[1]':''}`]),false);
 for(const bad of ['POW_PRECISE TEMP[0], IMM[0], IMM[1]','POW_SAT TEMP[0], IMM[0], IMM[1]','POW TEMP[0], |IMM[0]|, IMM[1]','POW TEMP[0], IMM[0], |IMM[1]|','POW TEMP[5], IMM[0], IMM[1]','POW TEMP[0], IMM[0]','POW TEMP[0], IMM[0], IMM[1], IMM[0]','POW TEMP[0], IMM[0].xy, IMM[1]','POW CONST[0], IMM[0], IMM[1]'])add('malformed-'+bad,'fragment',program([bad,'MOV OUT[0], IMM[0]']),false);
 add('POW-negative-modifier-base','fragment',program(['POW OUT[0], -IMM[0], IMM[1]']),false);
 return cases;
}
