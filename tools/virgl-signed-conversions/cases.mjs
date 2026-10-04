// Independent integer/rational equations; no emitted source or IR is read.
export const SEEDS=[0x51a83bd7,0xa724c139,0xe1698f03];
export const signed=w=>BigInt(w)>=0x80000000n?BigInt(w)-0x100000000n:BigInt(w);
export const normalOrZero=w=>(w&0x7fffffff)===0||((w&0x7f800000)!==0&&(w&0x7f800000)!==0x7f800000);
export const defined=w=>(w&0x7fffffff)<0x4f000000||(w>=0x80000000&&(w&0x7fffffff)===0x4f000000);
export function i2f(w){
  const n=signed(w),negative=n<0n,absolute=negative?-n:n;if(!absolute)return 0;
  let exponent=absolute.toString(2).length-1;
  const unit=exponent>23?1n<<BigInt(exponent-23):1n;
  let rounded=absolute/unit,remaining=absolute%unit;
  if(remaining*2n>unit||(remaining*2n===unit&&(rounded%2n)!==0n))rounded++;
  if(exponent<=23)rounded<<=BigInt(23-exponent);
  if(rounded===0x1000000n){rounded/=2n;exponent++;}
  return Number((negative?0x80000000n:0n)|(BigInt(exponent+127)<<23n)|(rounded&0x7fffffn));
}
export function f2i(w){
  if(!defined(w))throw new Error('undefined signed conversion source');
  const exponent=(w>>>23)&255,mantissa=BigInt(w&0x7fffff)+(exponent?0x800000n:0n),power=(exponent||1)-150;
  const magnitude=power<0?mantissa/(1n<<BigInt(-power)):mantissa*(1n<<BigInt(power));
  return Number(BigInt.asUintN(32,w>=0x80000000?-magnitude:magnitude));
}
export const evaluate=(op,a)=>a.map(op==='I2F'?i2f:f2i);
const word=n=>Number(BigInt.asUintN(32,n));
export function vectors(op,seed=SEEDS[0]){
  const values=new Set(op==='I2F'?[0,1,0xffffffff,0x80000000,0x80000001,0x7fffffff,0x7ffffffe]:
    [0,0x80000000,1,0x80000001,0x7fffff,0x807fffff,0x800000,0x80800000,0x3f7fffff,0xbf7fffff,0x3f800000,0xbf800000,0x3fc00000,0xbfc00000,0x4effffff,0xceffffff,0xcf000000]);
  if(op==='I2F')for(let e=0;e<=30;e++)for(const offset of [-1n,0n,1n]){
    const n=(1n<<BigInt(e))+offset;values.add(word(n));values.add(word(-n));
    if(e>=24)for(const k of [0n,1n,2n,3n])for(const d of [-1n,0n,1n]){
      const tie=(1n<<BigInt(e))+k*(1n<<BigInt(e-23))+(1n<<BigInt(e-24))+d;
      if(tie<0x80000000n){values.add(word(tie));values.add(word(-tie));}
    }
  }
  else for(let e=127;e<=157;e++)for(const m of [0,1,0x3fffff,0x7fffff])for(const sign of [0,0x80000000])values.add(((e*0x800000+m)|sign)>>>0);
  const list=[...values],result=[];while(list.length%4)list.push(0);
  for(let i=0;i<list.length;i+=4)result.push({name:`edge-${op}-${i/4}`,a:list.slice(i,i+4),b:list.slice(i,i+4).reverse()});
  let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;const w=state>>>0;return op==='I2F'?w:((w%0x4f000000)|(w&0x80000000))>>>0;};
  for(let i=0;i<8;i++)result.push({name:`random-${seed}-${i}`,a:Array.from({length:4},next),b:Array.from({length:4},next)});
  return result;
}
const imm=(index,words)=>`IMM[${index}] UINT32 {${words.join(',')}}`;
export const PARTNER_VERTEX='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[0]\nMOV OUT[2], IN[0]\nEND\n';
export const PARTNER_FRAGMENT='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL IN[1], GENERIC[1], PERSPECTIVE\nDCL OUT[0], COLOR\nMOV OUT[0], IN[0]\nEND\n';
export const VARIANTS=['direct','swizzled','masked','alias','join'];
export const bankVariants=op=>op==='I2F'?VARIANTS:VARIANTS.filter(v=>v!=='alias');
export function selectedWords(op,vector,variant='direct',condition=0,modifier=''){
  const source=variant==='join'&&!condition?vector.b:vector.a;
  let inputs=variant==='swizzled'||variant==='alias'?source.slice().reverse():source;
  inputs=inputs.map(w=>modifier==='neg'?(w^0x80000000)>>>0:modifier==='abs'?(w&0x7fffffff):modifier==='negabs'?(w|0x80000000)>>>0:w);
  const words=evaluate(op,inputs);
  if(variant==='masked'){words[1]=vector.a[1];words[3]=vector.a[3];}return words;
}
function body(op,bank,variant,modifier=''){
  const a=bank?'CONST[0]':'IMM[0]',b=bank?'CONST[45]':'IMM[1]',source=r=>modifier==='abs'?`|${r}|`:modifier==='negabs'?`-|${r}|`:modifier==='neg'?`-${r}`:r;
  if(variant==='masked')return [`MOV TEMP[0], ${a}`,`${op} TEMP[0].xz, ${source(a)}`];
  if(variant==='alias')return [`MOV TEMP[0], ${a}`,`${op} TEMP[0], ${source('TEMP[0].wzyx')}`];
  if(variant==='join')return ['UIF CONST[43].xxxx',`${op} TEMP[0], ${source(a)}`,'ELSE',`${op} TEMP[0], ${source(b)}`,'ENDIF'];
  return [`${op} TEMP[0], ${source(a+(variant==='swizzled'?'.wzyx':''))}`];
}
export function carrier(op,vector,variant='direct',bank=false,modifier='',inputSource=false){
  return ['VERT',...(inputSource?['DCL IN[1]']:[]),'DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL OUT[2], GENERIC[1]',
    'DCL TEMP[0..2]',...(bank||variant==='join'?['DCL CONST[0..45]']:[]),imm(0,vector.a),imm(1,vector.b),imm(2,[8388607,1056964608,23,0]),...body(op,bank,variant,modifier).map(line=>inputSource?line.replace('I2F TEMP[0], IMM[0]','I2F TEMP[0], IN[1]'):line),
    'AND TEMP[1], TEMP[0], IMM[2].xxxx','OR TEMP[1], TEMP[1], IMM[2].yyyy','USHR TEMP[2], TEMP[0], IMM[2].zzzz','OR TEMP[2], TEMP[2], IMM[2].yyyy',
    'MOV OUT[0], IN[0]','MOV OUT[1], TEMP[1]','MOV OUT[2], TEMP[2]','END',''].join('\n');
}
export function bitplane(op,vector,plane,bank=false){
  return ['FRAG','DCL OUT[0], COLOR','DCL TEMP[0]',...(bank?['DCL CONST[0..45]']:[]),imm(0,vector.a),imm(1,vector.b),imm(2,[plane,1,1065353216,0]),...body(op,bank,'direct'),
    'USHR TEMP[0], TEMP[0], IMM[2].xxxx','AND TEMP[0], TEMP[0], IMM[2].yyyy','UCMP OUT[0], TEMP[0], IMM[2].zzzz, IMM[2].wwww','END',''].join('\n');
}
export function getCases(){
  const cases=[],add=(name,stage,text,ok,primary=false)=>cases.push({name,stage,text,ok,primary});
  for(const op of ['I2F','F2I']){
    for(const seed of SEEDS)for(const v of vectors(op,seed))if(seed===SEEDS[0]||v.name.startsWith('random-'))add(`${op}-${v.name}`,'vertex',carrier(op,v),true,true);
    for(const variant of VARIANTS)add(`${op}-literal-${variant}`,'vertex',carrier(op,vectors(op)[0],variant),true,variant!=='join');
    for(const variant of bankVariants(op))add(`${op}-bank-${variant}`,'vertex',carrier(op,vectors(op)[0],variant,true),true,variant!=='join');
    for(const v of vectors(op).filter((_,i)=>i%8===0))for(const plane of [0,7,23,31])add(`${op}-${v.name}-plane-${plane}`,'fragment',bitplane(op,v,plane),true,true);
    const head=['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..1]','DCL CONST[0..1]',imm(0,[0x3f000000,0x3f000000,0x3f000000,0x3f000000])];
    const program=lines=>[...head,...lines,'END',''].join('\n');
    add(`${op}-input-locator-range`,'fragment',program([`${op} TEMP[0], IN[0]`,'MOV OUT[0], TEMP[0]']),op==='I2F');
    add(`${op}-opaque-bank-temp`,'fragment',program(['MOV TEMP[0], CONST[0]',`${op} TEMP[0], TEMP[0]`,'AND TEMP[0], TEMP[0], IMM[0]','MOV OUT[0], IMM[0]']),op==='I2F');
    add(`${op}-missing-lanes`,'fragment',program([`${op} TEMP[0].x, IMM[0]`,'MOV OUT[0], TEMP[0]']),false);
    for(const bad of [`${op}_SAT TEMP[0], IMM[0]`,`${op}_PRECISE TEMP[0], IMM[0]`,`${op} TEMP[0]`,`${op} TEMP[0], IMM[0], IMM[0]`,`${op} TEMP[0], CONST[2]`,`${op} CONST[0], IMM[0]`,`${op} TEMP[2], IMM[0]`,`${op} TEMP[0], IMM[0].xy`])add('malformed-'+bad,'fragment',program([bad,'MOV OUT[0], IMM[0]']),false);
  }
  for(const word of [0x4f000000,0x4f000001,0xcf000001,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0x7f800001,0x7fc12345,0xffc12345]){
    const v={a:Array(4).fill(word),b:Array(4).fill(word)};add('F2I-undefined-'+word,'vertex',carrier('F2I',v),false,true);
  }
  for(const [modifier,values,ok] of [['neg',[0x3fc00000,0xbfc00000,0,0x80000000],true],['abs',[0x3fc00000,0xbfc00000,1,0x80000001],true],['negabs',[0xcf000000,0x4f000000,0x3fc00000,0],true],['abs',[0xcf000000,0,0,0],false],['neg',[0xcf000000,0,0,0],false]]){
    add('F2I-modifier-'+modifier+'-'+values[0],'vertex',carrier('F2I',{a:values,b:values},'direct',false,modifier),ok,true);
  }
  const input={a:[0x3f000000,0xbf000000,0,0x80000000],b:[0,0,0,0]};
  add('I2F-physical-input-source','vertex',carrier('I2F',input,'direct',false,'',true),true,true);
  const head=['FRAG','DCL OUT[0], COLOR','DCL TEMP[0..1]','DCL CONST[0..1]',imm(0,[0x3f000000,0x3f000000,0x3f000000,0x3f000000]),imm(1,[1,1,1,1])];
  const program=lines=>[...head,...lines,'END',''].join('\n');
  for(const line of ['I2F TEMP[0], -IMM[1]','I2F TEMP[0], |IMM[1]|','F2I TEMP[0], -CONST[0]','F2I TEMP[0], |CONST[0]|'])add('unsupported-modifier-'+line,'fragment',program([line,'MOV OUT[0], IMM[0]']),false);
  add('F2I-private-dynamic-output','fragment',program(['F2I OUT[0], CONST[0]']),false);
  add('F2I-private-dynamic-numeric','fragment',program(['F2I TEMP[0], CONST[0]','MUL OUT[0], TEMP[0], IMM[0]']),false);
  add('F2I-bounded-private-mask','fragment',program(['AND TEMP[0], CONST[0], IMM[1]','F2I TEMP[0], TEMP[0]','MOV OUT[0], TEMP[0]']),true);
  add('F2I-killed-old-private-version','fragment',program(['F2I TEMP[0], CONST[0]','MOV TEMP[1], TEMP[0]','MOV TEMP[0], IMM[0]','MOV OUT[0], TEMP[1]']),false);
  add('F2I-new-safe-version','fragment',program(['F2I TEMP[0], CONST[0]','MOV TEMP[1], TEMP[0]','MOV TEMP[0], IMM[0]','MOV OUT[0], TEMP[0]']),true);
  for(const word of [0,1,0xffffffff,0x80000000,0x7fffffff,0x01000001,0x01000003])add('I2F-F2I-roundtrip-'+word,'fragment',[
    ...head,imm(2,Array(4).fill(word)),'I2F TEMP[0], IMM[2]','F2I TEMP[0], TEMP[0]','I2F OUT[0], TEMP[0]','END',''].join('\n'),word!==0x7fffffff,true);
  return cases;
}
