// Independent literal-TGSI interpreter. It never reads compiler metadata or GLSL.
const require=(ok,message)=>{if(!ok)throw new Error(message);};
const buffer=new ArrayBuffer(4),view=new DataView(buffer);
export function bits(value){view.setFloat32(0,value,true);return view.getUint32(0,true);}
function number(word){view.setUint32(0,word,true);return view.getFloat32(0,true);}
const laneName='xyzw';
export function bank(vector){return vector.words.slice();}
export function interpret(text,inputs,words){
 const registers=new Map(),branches=[],frames=[],addresses=[],accesses=[];let active=true,address=null,currentLine=0;
 for(const[index,value]of Object.entries(inputs))registers.set('IN['+index+']',value.slice());
 for(let index=0;index<words.length/4;index++)registers.set('CONST['+index+']',words.slice(index*4,index*4+4));
 const operand=source=>{const indirect=/^CONST\[ADDR\[0\]\.x\](?:\.([xyzw]{1,4}))?$/.exec(source);if(indirect){require(Number.isInteger(address)&&address>=0&&address<46,'literal bounded initialized unsigned address');return{key:'CONST['+address+']',swizzle:indirect[1]??'xyzw',indirect:true};}const m=/^(IN|OUT|TEMP|CONST|IMM)\[(\d+)\](?:\.([xyzw]{1,4}))?$/.exec(source);require(m,'restricted literal operand '+source);return{key:m[1]+'['+Number(m[2])+']',swizzle:m[3]??'xyzw'};};
 const read=(source,lane)=>{const o=operand(source),component=laneName.indexOf(o.swizzle[o.swizzle.length===1?0:lane]),word=registers.get(o.key)?.[component];if(o.indirect)accesses.push({line:currentLine,index:address,component});require(Number.isInteger(word)&&word>=0&&word<=0xffffffff,'defined literal source '+source+'/'+lane);return word;};
 const lines=text.trim().split('\n');
 for(let lineNumber=0;lineNumber<lines.length;lineNumber++){
  currentLine=lineNumber+1;const line=lines[lineNumber].trim().replace(/^\d+:\s*/,'');
  if(/^(VERT|FRAG|DCL)\b/.test(line))continue;
  if(line.startsWith('IMM')){const m=/^IMM\[(\d+)\] (UINT32|FLT32) \{([^}]+)\}$/.exec(line);require(m,'literal immediate grammar');const values=m[3].split(',').map(x=>m[2]==='UINT32'?Number(x.trim()):bits(Number(x.trim())));require(values.length===4,'four literal immediate lanes');registers.set('IMM['+Number(m[1])+']',values);continue;}
  const [opcode,...tail]=line.split(/\s+/),rest=tail.join(' ').replace(/\s*:\d+$/,'');
  if(opcode==='UIF'){const condition=active?read(rest,0)!==0:false;frames.push({parent:active,condition,otherwise:false});if(active)branches.push({line:lineNumber+1,predicateWord:read(rest,0),taken:condition});active=active&&condition;continue;}
  if(opcode==='ELSE'){const frame=frames.at(-1);require(frame&&!frame.otherwise,'matched unique ELSE');frame.otherwise=true;active=frame.parent&&!frame.condition;continue;}
  if(opcode==='ENDIF'){require(frames.length,'matched ENDIF');active=frames.pop().parent;continue;}
  if(opcode==='END'){require(frames.length===0,'closed literal control');break;}
  if(!active)continue;
  const operands=rest.split(/\s*,\s*/);if(opcode==='UARL'){require(operands[0]==='ADDR[0].x','literal scalar address destination');address=read(operands[1],0);require(address<46,'literal address within complete table');addresses.push({line:currentLine,index:address});continue;}const destination=operand(operands.shift()),mask=destination.swizzle;
  const snapshot=[...mask].map(c=>{const lane=laneName.indexOf(c),values=operands.map(source=>read(source,lane));let value;
   if(opcode==='MOV')value=values[0];
   else if(opcode==='UCMP')value=values[0]!==0?values[1]:values[2];
   else if(opcode==='UADD')value=(values[0]+values[1])>>>0;
   else if(opcode==='USHR')value=values[0]>>>(values[1]&31);
   else if(opcode==='AND')value=(values[0]&values[1])>>>0;
   else if(opcode==='USEQ')value=values[0]===values[1]?0xffffffff:0;
   else if(opcode==='ADD')value=bits(number(values[0])+number(values[1]));
   else if(opcode==='MUL')value=bits(number(values[0])*number(values[1]));
   else throw new Error('unsupported literal opcode '+opcode);
   return[lane,value];});
  const value=registers.get(destination.key)?.slice()??Array(4);for(const[lane,word]of snapshot)value[lane]=word;registers.set(destination.key,value);
 }
 return{registers,branches,addresses,accesses,read};
}
export function expectedPages(kernel,vector,fixture){const shader=fixture.shaders.find(s=>s.name===kernel.name),state=interpret(shader.text,{0:[bits(-1),bits(-1),0,bits(1)],1:[0x30400000,0x30400000,0,bits(1)],2:[0x3e800000,0x3f400000,0,0x3f800000],3:[...fixture.attributeWords,0,0x3f800000]},bank(vector));return{pages:kernel.pages.map(page=>[0,1,2,3].map(lane=>state.read(page.source,lane))),branches:state.branches,addresses:state.addresses,accesses:state.accesses};}
