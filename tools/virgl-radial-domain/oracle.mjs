// Independent literal coefficient/radial proof; no compiler IR, result or GLSL.
const assert = {equal(actual,expected) { if(actual !== expected) throw new Error(`literal proof: ${actual} !== ${expected}`); }};
export const thresholdWord = 0x3727c5ac;
const bytes = new ArrayBuffer(4), view = new DataView(bytes);
export function float(word) { view.setUint32(0, word, true); return view.getFloat32(0, true); }
export function word(value) { view.setFloat32(0, value, true); return view.getUint32(0, true); }
function rational(bits) {
  const sign = bits >>> 31 ? -1n : 1n, exp = (bits >>> 23) & 255, fraction = bits & 0x7fffff;
  if (exp === 255) return null;
  const integer = BigInt(exp ? fraction + 0x800000 : fraction), power = exp ? exp - 150 : -149;
  return power < 0 ? { n: sign * integer, d: 1n << BigInt(-power) } : { n: sign * (integer << BigInt(power)), d: 1n };
}
export function admitted(bits) {
  const value = rational(bits), threshold = rational(thresholdWord);
  return value !== null && (value.n < 0n ? -value.n : value.n) * threshold.d >= threshold.n * value.d;
}
export function predicate(bits) {
  const value = rational(bits), threshold = rational(thresholdWord);
  if (!value) return { finite: false, linear: null };
  const magnitude = value.n < 0n ? -value.n : value.n;
  return { finite: true, linear: magnitude * threshold.d < threshold.n * value.d };
}
export function counterexample(missingWord) {
  const coefficient = float(0x35800000), B = 4, C = 16;
  const primary = Math.fround(Math.fround(0.5 * C) / B);
  const alternate = Math.fround(Math.fround(B - float(missingWord)) / coefficient);
  const primaryOutside = primary > 1 || 0 >= primary;
  const root = primaryOutside ? alternate : primary;
  const transparent = root > 1 || 0 >= root;
  return { coefficientWord: 0x35800000, missingWord, B, C, primary, alternate, root, transparent };
}
export function proof() {
  const candidates = [0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,
    thresholdWord-1,thresholdWord,thresholdWord+1,
    (thresholdWord-1)|0x80000000,thresholdWord|0x80000000,(thresholdWord+1)|0x80000000,
    0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0x7fc01234,0xffc01234];
  const cases = candidates.map(value => { const bits=value>>>0, test=predicate(bits), accepts=admitted(bits);
    assert.equal(accepts,test.finite && !test.linear);
    return { word: bits, admitted: accepts, ...test };
  });
  const missingZero=counterexample(0), missingVisible=counterexample(0x407ffffe);
  assert.equal(missingZero.primary,2); assert.equal(missingVisible.primary,2);
  assert.equal(missingZero.transparent,true); assert.equal(missingVisible.root,0.5);
  assert.equal(missingVisible.transparent,false); assert.equal(admitted(0x35800000),false);
  return {schema:'radial-independent-domain-proof-v1',thresholdWord,cases,counterexample:[missingZero,missingVisible]};
}
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href)
  process.stdout.write(JSON.stringify(proof())+'\n');

const require=(ok,message)=>{if(!ok)throw new Error(message);};
// Independent literal-TGSI interpreter. It never reads compiler metadata or GLSL.
const interpreterBuffer=new ArrayBuffer(4),iview=new DataView(interpreterBuffer);
function bits(value){iview.setFloat32(0,value,true);return iview.getUint32(0,true);}
function number(word){iview.setUint32(0,word,true);return iview.getFloat32(0,true);}
const laneName='xyzw';
function interpret(text,inputs,words){
 const registers=new Map(),branches=[],loops=[],addresses=[],accesses=[];let address=null,currentLine=0;
 for(const[index,value]of Object.entries(inputs))registers.set('IN['+index+']',value.slice());
 for(let index=0;index<words.length/4;index++)registers.set('CONST['+index+']',words.slice(index*4,index*4+4));
 const operand=source=>{const indirect=/^CONST\[ADDR\[0\]\.x\](?:\.([xyzw]{1,4}))?$/.exec(source);if(indirect){require(Number.isInteger(address)&&address>=0&&address<46,'literal bounded initialized unsigned address');return{key:'CONST['+address+']',swizzle:indirect[1]??'xyzw',indirect:true};}const m=/^(IN|OUT|TEMP|CONST|IMM)\[(\d+)\](?:\.([xyzw]{1,4}))?$/.exec(source);require(m,'restricted literal operand '+source);return{key:m[1]+'['+Number(m[2])+']',swizzle:m[3]??'xyzw'};};
 const read=(source,lane)=>{const negative=source.startsWith('-');if(negative)source=source.slice(1);const o=operand(source),component=laneName.indexOf(o.swizzle[o.swizzle.length===1?0:lane]),word=registers.get(o.key)?.[component];if(o.indirect)accesses.push({line:currentLine,index:address,component});require(Number.isInteger(word)&&word>=0&&word<=0xffffffff,'defined literal source '+source+'/'+lane);return negative ? (word ^ 0x80000000) >>> 0 : word;};
 const instructions=[],stack=[],ends=new Map(),alternates=new Map(),loopFrames=[];
 for(const [lineNumber,original]of text.trim().split('\n').entries()){
  const line=original.trim().replace(/^\d+:\s*/,'');if(/^(VERT|FRAG|DCL|PROPERTY)\b/.test(line))continue;
  if(line.startsWith('IMM')){const m=/^IMM\[(\d+)\] (UINT32|FLT32) \{([^}]+)\}$/.exec(line);require(m,'literal immediate grammar');registers.set('IMM['+Number(m[1])+']',m[3].split(',').map(x=>m[2]==='UINT32'?Number(x.trim()):bits(Number(x.trim()))));continue;}
  const[opcode,...tail]=line.split(/\s+/),rest=tail.join(' ').replace(/\s*:\d+$/,'');instructions.push({opcode,rest,line:lineNumber+1});
 }
 for(let i=0;i<instructions.length;i++){const op=instructions[i].opcode;if(op==='UIF'||op==='BGNLOOP')stack.push({op,at:i});else if(op==='ELSE'){require(stack.at(-1)?.op==='UIF','literal ELSE pairing');alternates.set(stack.at(-1).at,i);}else if(op==='ENDIF'||op==='ENDLOOP'){const begin=stack.pop();require(begin&&begin.op===(op==='ENDIF'?'UIF':'BGNLOOP'),'literal block pairing');ends.set(begin.at,i);if(alternates.has(begin.at))ends.set(alternates.get(begin.at),i);}}
 require(stack.length===0,'literal closed control');let steps=0;
 for(let pc=0;pc<instructions.length;pc++){
  require(++steps<10000,'reference execution stays within proved finite domain');const{opcode,rest,line}=instructions[pc];currentLine=line;
  if(opcode==='UIF'){const word=read(rest,0),taken=word!==0;branches.push({line,predicateWord:word,taken});if(!taken)pc=alternates.get(pc)??ends.get(pc);continue;}
  if(opcode==='ELSE'){pc=ends.get(pc);continue;}if(opcode==='ENDIF')continue;
  if(opcode==='BGNLOOP'){const trace={line,iterations:1,breakLine:null};loops.push(trace);loopFrames.push({begin:pc,end:ends.get(pc),trace});continue;}
  if(opcode==='ENDLOOP'){const frame=loopFrames.at(-1);require(frame&&frame.end===pc,'literal loop end');require(++frame.trace.iterations<=18,'literal signed count execution bound');pc=frame.begin;continue;}
  if(opcode==='BRK'){const frame=loopFrames.pop();require(frame,'literal BRK scope');frame.trace.breakLine=line;pc=frame.end;continue;}
  if(opcode==='END'){require(!loopFrames.length,'literal loop exited');break;}
  const operands=rest.split(/\s*,\s*/);if(opcode==='UARL'){require(operands[0]==='ADDR[0].x','literal scalar address destination');address=read(operands[1],0);require(address<46,'literal address within complete table');addresses.push({line:currentLine,index:address});continue;}const destination=operand(operands.shift()),mask=destination.swizzle;
  const snapshot=[...mask].map(c=>{const lane=laneName.indexOf(c),values=opcode==='UCMP'?[read(operands[0],lane)]:operands.map(source=>read(source,lane));let value;
   if(opcode==='MOV')value=values[0];
   else if(opcode==='UCMP')value=read(operands[values[0]!==0?1:2],lane);
   else if(opcode==='UADD')value=(values[0]+values[1])>>>0;
   else if(opcode==='SHL')value=(values[0]<<(values[1]&31))>>>0;
   else if(opcode==='OR')value=(values[0]|values[1])>>>0;
   else if(opcode==='USNE')value=values[0]!==values[1]?0xffffffff:0;
   else if(opcode==='ISGE')value=(values[0]|0)>=(values[1]|0)?0xffffffff:0;
   else if(opcode==='FSLT')value=number(values[0])<number(values[1])?0xffffffff:0;
   else if(opcode==='USHR')value=values[0]>>>(values[1]&31);
   else if(opcode==='NOT')value=(~values[0])>>>0;
   else if(opcode==='FSGE')value=number(values[0])>=number(values[1])?0xffffffff:0;
   else if(opcode==='FSEQ')value=number(values[0])===number(values[1])?0xffffffff:0;
   else if(opcode==='FSNE')value=number(values[0])!==number(values[1])?0xffffffff:0;
   else if(opcode==='MAX')value=number(values[0])>number(values[1])?values[0]:values[1];
   else if(opcode==='DIV')value=bits(number(values[0])/number(values[1]));
   else if(opcode==='RCP')value=bits(1/number(values[0]));
   else if(opcode==='RSQ')value=bits(1/Math.sqrt(Math.abs(number(values[0]))));
   else if(opcode==='FRC')value=bits(number(values[0])-Math.floor(number(values[0])));
   else if(opcode==='LRP')value=bits(Math.fround(number(values[1])*number(values[0]))+Math.fround(number(values[2])*Math.fround(1-number(values[0]))));
   else if(opcode==='AND')value=(values[0]&values[1])>>>0;
   else if(opcode==='USEQ')value=values[0]===values[1]?0xffffffff:0;
   else if(opcode==='ADD')value=bits(number(values[0])+number(values[1]));
   else if(opcode==='MUL')value=bits(number(values[0])*number(values[1]));
   else throw new Error('unsupported literal opcode '+opcode);
   return[lane,value];});
  const value=registers.get(destination.key)?.slice()??Array(4);for(const[lane,word]of snapshot)value[lane]=word;registers.set(destination.key,value);
 }
 return{registers,branches,loops,addresses,accesses,read};
}

export function hardwareBank(kernel, coefficient, color=[0x3e800000,0x3f000000,0x3e800000,0x3f800000], count=2) {
 const values=Array(kernel.count*4).fill(0);values[16]=coefficient>>>0;
 if(kernel.kind==='mini')values.splice(20,4,...color);
 if(kernel.count>=10){values[36]=count>>>0;values[44]=0x3f800000;}
 if(kernel.kind==='structural-port'){
  values[10]=0x3f800000;values[24]=0x40000000;
  for(const index of kernel.count===26?[18,19,20,21,22,23,24,25]:[28,29,30])values.splice(index*4,4,...color);
 }
 return values;
}
export function interpretColor(entry, kernel, values) {
 require(admitted(values[16]),'independent oracle forbids unsafe radial GPU execution');
 const inputs={0:[0x30400000,0x30400000,0,0x3f800000],1:[0x30400000,0x30400000,0,0x3f800000],2:[0x3e800000,0x3f400000,0,0x3f800000],3:[0x3f000017,0x3e000000,0,0x3f800000]};
 const state=interpret(entry.text,inputs,values),key=kernel.stage==='vertex'?'OUT[1]':'OUT[0]',words=state.registers.get(key);
 require(words?.length===4&&words.every(Number.isInteger),'every observed literal output defined');
 const color=words.map(w=>Math.max(0,Math.min(255,Math.round(float(w)*255))));
 require(color.every(Number.isFinite),'finite independent hardware color');
 return {words,color,branches:state.branches,loops:state.loops,addresses:state.addresses,accesses:state.accesses};
}
