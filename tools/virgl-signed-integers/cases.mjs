// Source-only signed32 oracle: no compiler output or IR is read here.
export const SEEDS=[0x51a83bd7,0xa724c139,0xe1698f03];
export const EDGES=[0x80000000,0x80000001,0xffffffff,0xfffffffe,0xffff0000,0xff800000,0xff800001,0xffc12345,
  0,1,2,0xffff,0x3f000000,0x7f7fffff,0x7f800001,0x7fffffff];
export const signed=w=>BigInt(w)>=0x80000000n?BigInt(w)-0x100000000n:BigInt(w);
export const evaluate=(op,a,b)=>a.map((w,i)=>op==='ISLT'?(signed(w)<signed(b[i])?0xffffffff:0):signed(w)>=signed(b[i])?w:b[i]);
export const normalOrZero=w=>(w&0x7fffffff)===0||((w&0x7f800000)!==0&&(w&0x7f800000)!==0x7f800000);
export function vectors(seed=SEEDS[0]) {
  const result=[];
  for(let a=0;a<EDGES.length;a++)for(let b=0;b<EDGES.length;b+=4)
    result.push({name:`edge-${a}-${b}`,a:Array(4).fill(EDGES[a]),b:EDGES.slice(b,b+4)});
  let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  for(let i=0;i<8;i++)result.push({name:`random-${seed}-${i}`,a:Array.from({length:4},next),b:Array.from({length:4},next)});
  return result;
}
const imm=(index,words)=>`IMM[${index}] UINT32 {${words.join(',')}}`;
export const PARTNER_VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n';
export const PARTNER_FRAGMENT='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL IN[1], GENERIC[1], PERSPECTIVE\nDCL OUT[0], COLOR\nMOV OUT[0], IN[0]\nEND\n';
export const VARIANTS=['direct','swizzled','masked','alias','join'];
export function selectedWords(op,vector,variant='direct',condition=0) {
  const reverse=words=>words.slice().reverse();
  if(variant==='join')return condition?evaluate(op,vector.a,vector.b):evaluate(op,vector.b,vector.a);
  const words=evaluate(op,variant==='swizzled'||variant==='alias'?reverse(vector.a):vector.a,
    variant==='swizzled'||variant==='alias'?reverse(vector.b):vector.b);
  if(variant==='masked'){words[1]=vector.a[1];words[3]=vector.a[3];}return words;
}
function body(op,bank,variant) {
  const a=bank?'CONST[0]':'IMM[0]',b=bank?'CONST[45]':'IMM[1]';
  if(variant==='masked')return [`MOV TEMP[0], ${a}`,`${op} TEMP[0].xz, ${a}, ${b}`];
  if(variant==='alias')return [`MOV TEMP[0], ${a}`,`MOV TEMP[1], ${b}`,`${op} TEMP[0], TEMP[0].wzyx, TEMP[1].wzyx`];
  if(variant==='join')return [`UIF CONST[43].xxxx`,`${op} TEMP[0], ${a}, ${b}`,'ELSE',`${op} TEMP[0], ${b}, ${a}`,'ENDIF'];
  return [`${op} TEMP[0], ${a}${variant==='swizzled'?'.wzyx':''}, ${b}${variant==='swizzled'?'.wzyx':''}`];
}
export function carrier(op,vector,variant='direct',bank=false,predicate=false) {
  return ['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]',
    'DCL TEMP[0..2]',...(bank||variant==='join'?['DCL CONST[0..45]']:[]),
    imm(0,vector.a),imm(1,vector.b),imm(2,[8388607,1056964608,23,0]),...(predicate?[imm(3,[1065353216,0,0,0])]:[]),...body(op,bank,variant),
    ...(predicate?['UCMP TEMP[0], TEMP[0], IMM[3].xxxx, IMM[3].yyyy']:[]),
    'AND TEMP[1], TEMP[0], IMM[2].xxxx','OR TEMP[1], TEMP[1], IMM[2].yyyy',
    'USHR TEMP[2], TEMP[0], IMM[2].zzzz','OR TEMP[2], TEMP[2], IMM[2].yyyy',
    'MOV OUT[0], IN[0]','MOV OUT[1], TEMP[1]','MOV OUT[2], TEMP[2]','END',''].join('\n');
}
export function bitplane(op,vector,plane,bank=false,predicate=false) {
  return ['FRAG','DCL OUT[0], COLOR','DCL TEMP[0]',...(bank?['DCL CONST[0..45]']:[]),
    imm(0,vector.a),imm(1,vector.b),imm(2,[plane,1,1065353216,0]),...body(op,bank,'direct'),
    ...(predicate?['UCMP TEMP[0], TEMP[0], IMM[2].zzzz, IMM[2].wwww']:[]),
    'USHR TEMP[0], TEMP[0], IMM[2].xxxx','AND TEMP[0], TEMP[0], IMM[2].yyyy',
    'UCMP OUT[0], TEMP[0], IMM[2].zzzz, IMM[2].wwww','END',''].join('\n');
}
export function getCases() {
  const cases=[],add=(name,stage,text,ok,primary=false)=>cases.push({name,stage,text,ok,primary});
  for(const op of ['ISLT','IMAX']) {
    for(const seed of SEEDS)for(const v of vectors(seed))if(seed===SEEDS[0]||v.name.startsWith('random-')){
      add(`${op}-${v.name}`,'vertex',carrier(op,v),true,true);
      if(op==='ISLT')add(`${op}-predicate-${v.name}`,'vertex',carrier(op,v,'direct',false,true),true,true);
    }
    for(const variant of VARIANTS){add(`${op}-bank-${variant}`,'vertex',carrier(op,vectors()[0],variant,true),true,variant!=='join');
      if(op==='ISLT'&&variant!=='join')add(`${op}-predicate-bank-${variant}`,'vertex',carrier(op,vectors()[0],variant,true,true),true,true);
    }
    for(const v of vectors().filter((_,i)=>i%8===0))for(const plane of [0,7,23,31]){
      add(`${op}-${v.name}-plane-${plane}`,'fragment',bitplane(op,v,plane),true,true);
      if(op==='ISLT')add(`${op}-predicate-${v.name}-plane-${plane}`,'fragment',bitplane(op,v,plane,false,true),true,true);
    }
    const head=['FRAG','DCL OUT[0], COLOR','DCL TEMP[0..1]','DCL CONST[0..1]',
      imm(0,[0,0,0,0]),imm(1,[0xffffffff,0x7f800001,1,0x80000001]),imm(2,[0x3f000000,0x3f000000,0x3f000000,0x3f000000])];
    const program=lines=>[...head,...lines,'END',''].join('\n');
    add(`${op}-private-bank-direct-raster`,'fragment',program([`${op} OUT[0], CONST[0], CONST[1]`]),false);
    add(`${op}-private-bank-numeric`,'fragment',program([`${op} TEMP[0], CONST[0], CONST[1]`,'MUL OUT[0], TEMP[0], IMM[2]']),false);
    add(`${op}-float-input-authority-not-inherited`,'fragment',program([`${op} TEMP[0], IN[0], IN[0]`,'MUL OUT[0], TEMP[0], IMM[2]']).replace('DCL OUT[0], COLOR','DCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR'),false);
    add(`${op}-dead-private-overwrite`,'fragment',program([`${op} TEMP[0], CONST[0], CONST[1]`,'MOV TEMP[0], IMM[2]','MOV OUT[0], TEMP[0]']),true);
    add(`${op}-private-old-version-live`,'fragment',program([`${op} TEMP[0], CONST[0], CONST[1]`,'MOV TEMP[1], TEMP[0]','MOV TEMP[0], IMM[2]','MOV OUT[0], TEMP[1]']),false);
    add(`${op}-missing-lanes`,'fragment',program([`${op} TEMP[0].x, CONST[0], CONST[1]`,'MOV OUT[0], TEMP[0]']),false);
    add(`${op}-bad-join-predecessor`,'fragment',program(['UIF CONST[0].xxxx',`${op} TEMP[0], CONST[0], CONST[1]`,'ELSE','MOV TEMP[0], IMM[2]','ENDIF','MOV OUT[0], TEMP[0]']),false);
    add(`${op}-one-uninitialized-predecessor`,'fragment',program(['UIF CONST[0].xxxx',`${op} TEMP[0], CONST[0], CONST[1]`,'ENDIF','MOV OUT[0], TEMP[0]']),false);
    for(const bad of [`${op}_SAT TEMP[0], IMM[0], IMM[0]`,`${op}_PRECISE TEMP[0], IMM[0], IMM[0]`,`${op} TEMP[0], -IMM[0], IMM[0]`,
      `${op} TEMP[0], |IMM[0]|, IMM[0]`,`${op} TEMP[0], IMM[0]`,`${op} TEMP[0], IMM[0], IMM[0], IMM[0]`,
      `${op} TEMP[0], CONST[2], IMM[0]`,`${op} CONST[0], IMM[0], IMM[0]`,`${op} TEMP[2], IMM[0], IMM[0]`,`${op} TEMP[0], IMM[0].xy, IMM[0]`])
      add('malformed-'+op+'-'+bad,'fragment',program([bad,'MOV OUT[0], IMM[2]']),false);
  }
  // Known selection must strip arbitrary raw manufacture, but retain bit facts
  // sufficient to recognize a zero/normal final encoding.
  for(const [a,b,ok] of [[0x80000001,0,true],[1,0,false],[0x7f800001,0,false],[0x80000000,0x80000000,true],
    [0x3f000000,0x3f800000,true],[0xffffffff,0xfffffffe,false]]) {
    const text=['FRAG','DCL OUT[0], COLOR',imm(0,Array(4).fill(a)),imm(1,Array(4).fill(b)),
      'IMAX OUT[0], IMM[0], IMM[1]','END',''].join('\n');add(`IMAX-direct-${a}-${b}`,'fragment',text,ok,true);
  }
  add('ISLT-known-false-safe-zero','fragment','FRAG\nDCL OUT[0], COLOR\nIMM[0] UINT32 {0,0,0,0}\nISLT OUT[0], IMM[0], IMM[0]\nEND\n',true,true);
  add('ISLT-known-true-private-mask','fragment','FRAG\nDCL OUT[0], COLOR\nIMM[0] UINT32 {0,1,0,1}\nISLT OUT[0], IMM[0].xxxx, IMM[0].yyyy\nEND\n',false,true);
  const bounded=['FRAG','DCL OUT[0], COLOR','DCL TEMP[0..1]','DCL CONST[0..1]',imm(0,[8388607,1056964608,0,0]),
    'AND TEMP[0], CONST[0], IMM[0].xxxx','OR TEMP[0], TEMP[0], IMM[0].yyyy',
    'AND TEMP[1], CONST[1], IMM[0].xxxx','OR TEMP[1], TEMP[1], IMM[0].yyyy','IMAX TEMP[0], TEMP[0], TEMP[1]'];
  add('IMAX-common-known-normal-bits','fragment',[...bounded,'MOV OUT[0], TEMP[0]','END',''].join('\n'),true);
  add('IMAX-common-known-normal-numeric-use','fragment',[...bounded,'MUL OUT[0], TEMP[0], IMM[0].yyyy','END',''].join('\n'),true);
  return cases;
}
