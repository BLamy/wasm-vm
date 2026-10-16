// Independent literal-TGSI interpreter. It never reads compiler metadata or GLSL.
const require=(ok,message)=>{if(!ok)throw new Error(message);};
const buffer=new ArrayBuffer(4),view=new DataView(buffer);
export function bits(value){view.setFloat32(0,value,true);return view.getUint32(0,true);}
function number(word){view.setUint32(0,word,true);return view.getFloat32(0,true);}
const laneName='xyzw';
export function bank(vector){return vector.words.slice();}
export function interpret(text,inputs,words){
 const registers=new Map(),branches=[],loops=[],addresses=[],accesses=[];let address=null,currentLine=0;
 for(const[index,value]of Object.entries(inputs))registers.set('IN['+index+']',value.slice());
 for(let index=0;index<words.length/4;index++)registers.set('CONST['+index+']',words.slice(index*4,index*4+4));
 const operand=source=>{const indirect=/^CONST\[ADDR\[0\]\.x\](?:\.([xyzw]{1,4}))?$/.exec(source);if(indirect){require(Number.isInteger(address)&&address>=0&&address<46,'literal bounded initialized unsigned address');return{key:'CONST['+address+']',swizzle:indirect[1]??'xyzw',indirect:true};}const m=/^(IN|OUT|TEMP|CONST|IMM)\[(\d+)\](?:\.([xyzw]{1,4}))?$/.exec(source);require(m,'restricted literal operand '+source);return{key:m[1]+'['+Number(m[2])+']',swizzle:m[3]??'xyzw'};};
 const read=(source,lane)=>{const o=operand(source),component=laneName.indexOf(o.swizzle[o.swizzle.length===1?0:lane]),word=registers.get(o.key)?.[component];if(o.indirect)accesses.push({line:currentLine,index:address,component});require(Number.isInteger(word)&&word>=0&&word<=0xffffffff,'defined literal source '+source+'/'+lane);return word;};
 const instructions=[],stack=[],ends=new Map(),alternates=new Map(),loopFrames=[];
 for(const [lineNumber,original]of text.trim().split('\n').entries()){
  const line=original.trim().replace(/^\d+:\s*/,'');if(/^(VERT|FRAG|DCL)\b/.test(line))continue;
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
  const snapshot=[...mask].map(c=>{const lane=laneName.indexOf(c),values=operands.map(source=>read(source,lane));let value;
   if(opcode==='MOV')value=values[0];
   else if(opcode==='UCMP')value=values[0]!==0?values[1]:values[2];
   else if(opcode==='UADD')value=(values[0]+values[1])>>>0;
   else if(opcode==='SHL')value=(values[0]<<(values[1]&31))>>>0;
   else if(opcode==='OR')value=(values[0]|values[1])>>>0;
   else if(opcode==='USNE')value=values[0]!==values[1]?0xffffffff:0;
   else if(opcode==='ISGE')value=(values[0]|0)>=(values[1]|0)?0xffffffff:0;
   else if(opcode==='FSLT')value=number(values[0])<number(values[1])?0xffffffff:0;
   else if(opcode==='USHR')value=values[0]>>>(values[1]&31);
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
export function expectedPages(kernel,vector,fixture){const shader=fixture.shaders.find(s=>s.name===kernel.name),state=interpret(shader.text,{0:[bits(-1),bits(-1),0,bits(1)],1:[0x30400000,0x30400000,0,bits(1)],2:[0x3e800000,0x3f400000,0,0x3f800000],3:[...fixture.attributeWords,0,0x3f800000]},bank(vector));return{pages:kernel.pages.map(page=>[0,1,2,3].map(lane=>state.read(page.source,lane))),branches:state.branches,loops:state.loops,addresses:state.addresses,accesses:state.accesses};}
