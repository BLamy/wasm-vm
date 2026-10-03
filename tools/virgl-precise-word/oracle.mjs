// Independent literal TGSI execution. Compiler IR/metadata/GLSL are never read.
// Finite comparison uses exact binary32 rational values, including subnormals.
// This is deliberately different from the compiler's integer sorting keys.
export function classify(word) {
 const exponent=(word>>>23)&255, fraction=word&0x7fffff, negative=word>>>31;
 if(exponent===255)return{kind:fraction?'nan':'infinity',negative};
 const significand=BigInt(exponent?fraction+0x800000:fraction), power=exponent?exponent-150:-149;
 const numerator=(negative?-1n:1n)*significand;
 return{kind:'finite',n:power>=0?numerator<<BigInt(power):numerator,d:power>=0?1n:1n<<BigInt(-power)};
}
export function compare(a,b) {
 const x=classify(a),y=classify(b);
 if(x.kind==='nan'||y.kind==='nan')return null;
 if(x.kind==='infinity')return y.kind==='infinity'?(x.negative===y.negative?0:x.negative?-1:1):x.negative?-1:1;
 if(y.kind==='infinity')return y.negative?1:-1;
 const difference=x.n*y.d-y.n*x.d;return difference<0n?-1:difference>0n?1:0;
}
export function operation(op,a,b) {
 const order=op==='MOV'?null:compare(a,b);
 if(op==='MOV')return a;
 if(op==='MAX')return order!==null&&order>0?a:b;
 if(op==='FSEQ')return order===0?0xffffffff:0;
 if(op==='FSNE')return order!==0?0xffffffff:0;
 throw new Error('outside exact word contract '+op);
}
const require=(ok,message)=>{if(!ok)throw new Error(message);};
// Independent literal-TGSI interpreter. It never reads compiler metadata or GLSL.
const interpreterBuffer=new ArrayBuffer(4),iview=new DataView(interpreterBuffer);
function bits(value){iview.setFloat32(0,value,true);return iview.getUint32(0,true);}
function number(word){iview.setUint32(0,word,true);return iview.getFloat32(0,true);}
const laneName='xyzw';
export function interpret(text,inputs,words){
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
  require(++steps<10000,'reference execution stays within proved finite domain');const{opcode:token,rest,line}=instructions[pc];currentLine=line;const marked=token.endsWith('_PRECISE'),opcode=marked?token.slice(0,-8):token;if(marked)require(['MOV','MAX','FSEQ','FSNE'].includes(opcode),'closed exact word modifier');
  if(opcode==='UIF'){const word=read(rest,0),taken=word!==0;branches.push({line,predicateWord:word,taken});if(!taken)pc=alternates.get(pc)??ends.get(pc);continue;}
  if(opcode==='ELSE'){pc=ends.get(pc);continue;}if(opcode==='ENDIF')continue;
  if(opcode==='BGNLOOP'){const trace={line,iterations:1,breakLine:null};loops.push(trace);loopFrames.push({begin:pc,end:ends.get(pc),trace});continue;}
  if(opcode==='ENDLOOP'){const frame=loopFrames.at(-1);require(frame&&frame.end===pc,'literal loop end');require(++frame.trace.iterations<=18,'literal signed count execution bound');pc=frame.begin;continue;}
  if(opcode==='BRK'){const frame=loopFrames.pop();require(frame,'literal BRK scope');frame.trace.breakLine=line;pc=frame.end;continue;}
  if(opcode==='END'){require(!loopFrames.length,'literal loop exited');break;}
  const operands=rest.split(/\s*,\s*/);if(opcode==='UARL'){require(operands[0]==='ADDR[0].x','literal scalar address destination');address=read(operands[1],0);require(address<46,'literal address within complete table');addresses.push({line:currentLine,index:address});continue;}const destination=operand(operands.shift()),mask=destination.swizzle;
  const snapshot=[...mask].map(c=>{const lane=laneName.indexOf(c),values=opcode==='UCMP'?[read(operands[0],lane)]:operands.map(source=>read(source,lane));let value;
   if(marked)value=operation(opcode,values[0],values[1]);
   else if(opcode==='MOV')value=values[0];
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

export function vectors(seed=0x741cc28d) {
 const v=(name,a,b)=>({name,a:a.map(x=>x>>>0),b:b.map(x=>x>>>0)});
 const list=[
  v('signed-zero-ties',[0,0x80000000,0,0x80000000],[0x80000000,0,0,0x80000000]),
  v('source0-unordered',[0x7fc01234,0x7f801234,0xffc05678,0xff801111],[0x3f800000,0xbf800000,0,0x80000000]),
  v('source1-unordered',[0x3f800000,0xbf800000,0,0x80000000],[0xffc05678,0xff801111,0x7fc01234,0x7f801234]),
  v('two-nans',[0x7fc01234,0xffc05678,0x7f800001,0xff800001],[0xffc05678,0x7fc01234,0xff800001,0x7f800001]),
  v('subnormal-signed',[1,0x80000001,0x007fffff,0x807fffff],[0,0x80000000,0x00800000,0x80800000]),
  v('infinity-order',[0x7f800000,0xff800000,0x7f800000,0xff800000],[0x7f7fffff,0xff7fffff,0x7f800000,0xff800000]),
  v('finite-equality',[0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff],[0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff]),
  v('opposite-sign',[0x3f800000,0xbf800000,0x00800000,0x80800000],[0xbf800000,0x3f800000,0x80800000,0x00800000]),
  v('adjacent-normal',[0x3f800001,0xbf800001,0x7f7ffffe,0xff7ffffe],[0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff]),
  v('computed-overflow',[0xfffffff0,0x7ffffff0,0x80000000,0xdeadbeef],[0x12345678,0xabcdef01,0,0xffffffff])];
 let state=seed>>>0;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 for(let i=0;i<8;i++)list.push(v('seed-'+i,Array.from({length:4},next),Array.from({length:4},next)));
 return list;
}
export function bank(kernel,vector) {
 const words=Array(kernel.count*4).fill(0);
 if(kernel.kind==='radial') {
  words[16]=vector.coefficient;words.splice(20,4,0x3e800000,0x3f000000,0x3e800000,0x3f800000);
  if(kernel.count>=10){words[36]=2;words[44]=0x3f800000;}
 }else{
  words.splice(0,4,...vector.a.map(w=>0x3f800000|(w>>>16)));
  words.splice(4,4,...vector.a.map(w=>0x3f800000|(w&65535)));
  words.splice(8,4,...vector.b.map(w=>0x3f800000|(w>>>16)));
  words.splice(12,4,...vector.b.map(w=>0x3f800000|(w&65535)));
 }
 return words;
}
export function kernelVectors(kernel,seed=0x741cc28d) {
 if(kernel.kind==='radial')return[0x3727c5ac,0x3727c5ad,0xb727c5ac,0xb727c5ad,0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff].map(coefficient=>({name:'coefficient-'+coefficient.toString(16),coefficient}));
 if(kernel.vectorSet==='finite')return vectors(seed).filter(v=>v.a.concat(v.b).every(w=>classify(w).kind==='finite'));
 return vectors(seed);
}
export function expected(kernel,vector,fixture) {
 const entry=fixture.cases.find(e=>e.name===kernel.case);require(entry,'literal kernel');
 const inputs={0:[0,0,0,0x3f800000],1:[0x30400000,0x30400000,0,0x3f800000],2:[0x3e800000,0x3f400000,0,0x3f800000],3:[0x3f000017,0x3e000000,0,0x3f800000]};
 if(kernel.stage==='fragment'){
  const varying=[inputs[1],inputs[2],inputs[3]];
  for(const match of entry.text.matchAll(/DCL IN\[(\d+)\], GENERIC\[(\d+)\]/g))inputs[Number(match[1])]=varying[Number(match[2])];
 }
 const state=interpret(entry.text,inputs,bank(kernel,vector)),words=state.registers.get('TEMP[117]');
 require(words?.length===4&&words.every(Number.isInteger),'defined complete observed word');
 return{words,branches:state.branches,loops:state.loops,addresses:state.addresses,accesses:state.accesses};
}
export function proof(seed=0x741cc28d) {
 const witnesses=[];
 for(const vector of vectors(seed))for(let lane=0;lane<4;lane++)for(const op of ['MOV','FSEQ','FSNE','MAX'])witnesses.push({vector:vector.name,lane,op,a:vector.a[lane],b:vector.b[lane],result:operation(op,vector.a[lane],vector.b[lane])});
 const tests=[['MAX',0,0x80000000,0x80000000],['MAX',0x80000000,0,0],['MAX',0x7fc01234,0x3f800000,0x3f800000],['MAX',0x3f800000,0xffc05678,0xffc05678],['FSEQ',0,0x80000000,0xffffffff],['FSNE',0x7fc01234,0x7fc01234,0xffffffff],['MOV',0x7f801234,0,0x7f801234],['MAX',1,0,1],['MAX',0x80000001,0,0]];
 for(const[op,a,b,result]of tests)require(operation(op,a,b)===result,'independent authored literal word witness');
 return{schema:'precise-independent-word-proof-v1',seed:seed>>>0,witnesses,literalChecks:tests.length};
}
if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href)process.stdout.write(JSON.stringify(proof())+'\n');
