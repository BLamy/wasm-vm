// Literal TGSI observation model. It never reads compiler IR, metadata or GLSL.
const require=(ok,message)=>{if(!ok)throw new Error(message);};
const buffer=new ArrayBuffer(4),view=new DataView(buffer),lanes='xyzw';
export function bits(value){view.setFloat32(0,value,true);return view.getUint32(0,true);}
function number(word){view.setUint32(0,word,true);return view.getFloat32(0,true);}
export function bank(vector){const words=Array(184).fill(0);words.splice(0,4,...vector.payload);words[4]=vector.width;words[168]=vector.nested?0x3f800000:0;words[172]=vector.outer?0x3f800000:0;words[180]=vector.selector?0x3f800000:0;return words;}
export function interpret(text,inputs,words){
 const registers=new Map(),branches=[],reads=[],deferred=[],demands=[],arithmetic=[];
 const cell=(word,version)=>({word,version});
 for(const[k,v]of Object.entries(inputs))registers.set('IN['+k+']',v.map(x=>cell(x,'input')));
 for(let i=0;i<words.length/4;i++)registers.set('CONST['+i+']',words.slice(i*4,i*4+4).map(x=>cell(x,'bank')));
 const parse=source=>{const m=/^(IN|OUT|TEMP|CONST|IMM)\[(\d+)\](?:\.([xyzw]{1,4}))?$/.exec(source);require(m,'literal operand '+source);return{key:m[1]+'['+Number(m[2])+']',swizzle:m[3]??'xyzw'};};
 const lookup=(source,lane,state=registers)=>{const o=parse(source),component=lanes.indexOf(o.swizzle[o.swizzle.length===1?0:lane]);return{key:o.key,component,cell:state.get(o.key)?.[component]};};
 const materialize=(value,pc,role)=>{
  require(value,'unwritten demanded value at '+pc+'/'+role);
  if(value.thunk){
   const t=value.thunk,a=number(materialize(t.a,pc,'LRP weight')),b=number(materialize(t.b,pc,'LRP selected payload')),c=number(materialize(t.c,pc,'LRP fallback'));
   // Fixtures use exact dyadic finite selected arithmetic. Discarded 0/0 is
   // classified independently and never granted a manufactured payload.
   const result=bits(Math.fround(Math.fround(c*Math.fround(1-a))+Math.fround(b*a)));
   if(!demands.some(x=>x.pc===t.pc&&x.lane===t.lane))demands.push({pc:t.pc,lane:t.lane,weightBits:materialize(t.a,pc,'LRP weight'),payloadVersion:t.b?.version??null,fallbackVersion:t.c?.version??null});
   return result;
  }
  require(Number.isInteger(value.word)&&value.word>=0&&value.word<=0xffffffff,'exact defined raw word');return value.word;
 };
 const read=(source,lane,pc,role,state=registers)=>{const o=lookup(source,lane,state);reads.push({pc,role,key:o.key,lane:o.component,version:o.cell?.version??null});return materialize(o.cell,pc,role);};
 const code=[],stack=[],ends=new Map(),alternates=new Map();
 for(const[line,original]of text.trim().split('\n').entries()){
  const t=original.trim().replace(/^\d+:\s*/,'');if(/^(VERT|FRAG|DCL)\b/.test(t))continue;
  if(t.startsWith('IMM')){const m=/^IMM\[(\d+)\] (UINT32|FLT32) \{([^}]+)\}$/.exec(t);require(m,'literal immediate');registers.set('IMM['+Number(m[1])+']',m[3].split(',').map(x=>cell(m[2]==='UINT32'?Number(x.trim()):bits(Number(x.trim())),'immediate')));continue;}
  const[opcode,...rest]=t.split(/\s+/);code.push({opcode,rest:rest.join(' '),line:line+1});
 }
 for(let pc=0;pc<code.length;pc++){const op=code[pc].opcode;if(op==='UIF')stack.push(pc);else if(op==='ELSE'){require(stack.length,'paired ELSE');alternates.set(stack.at(-1),pc);}else if(op==='ENDIF'){const at=stack.pop();require(at!==undefined,'paired ENDIF');ends.set(at,pc);if(alternates.has(at))ends.set(alternates.get(at),pc);}}
 require(stack.length===0,'closed literal control');
 for(let pc=0;pc<code.length;pc++){
  const{opcode,rest,line}=code[pc];
  if(opcode==='UIF'){const predicate=read(rest,0,pc,'UIF'),taken=predicate!==0;branches.push({pc,line,predicate,taken});if(!taken)pc=alternates.get(pc)??ends.get(pc);continue;}
  if(opcode==='ELSE'){pc=ends.get(pc);continue;}if(opcode==='ENDIF')continue;if(opcode==='END')break;
  const args=rest.split(/\s*,\s*/),destination=parse(args.shift()),snapshot=[];
  for(const component of destination.swizzle){const lane=lanes.indexOf(component);let word;
   if(opcode==='LRP'){
    const a=lookup(args[0],lane).cell,b=lookup(args[1],lane).cell,c=lookup(args[2],lane).cell;
    deferred.push({pc,line,lane,weightVersion:a?.version??null,payloadVersion:b?.version??null,fallbackVersion:c?.version??null,payloadDefined:!!b});
    snapshot.push([lane,{version:pc,thunk:{a,b,c,pc,lane}}]);continue;
   }
   const a=read(args[0],lane,pc,'source0');
   if(opcode==='MOV')word=a;
   else if(opcode==='UCMP')word=read(args[a!==0?1:2],lane,pc,a!==0?'selected true':'selected false');
   else{const b=read(args[1],lane,pc,'source1');
    if(opcode==='FSLT')word=number(a)<number(b)?0xffffffff:0;
    else if(opcode==='FSNE')word=number(a)!==number(b)?0xffffffff:0;
    else if(opcode==='FSEQ')word=number(a)===number(b)?0xffffffff:0;
    else if(opcode==='OR')word=(a|b)>>>0;
    else if(opcode==='AND')word=(a&b)>>>0;
    else if(opcode==='USHR')word=a>>>(b&31);
    else if(opcode==='UADD')word=(a+b)>>>0;
    else if(opcode==='MUL'||opcode==='ADD'||opcode==='DIV'){
     const value=Math.fround(opcode==='MUL'?number(a)*number(b):opcode==='ADD'?number(a)+number(b):number(a)/number(b));word=bits(value);arithmetic.push({pc,line,opcode,class:Number.isNaN(value)?'nan':!Number.isFinite(value)?'infinity':'finite'});
    }else throw new Error('unsupported literal opcode '+opcode);
   }
   snapshot.push([lane,cell(word,pc)]);
  }
  const value=registers.get(destination.key)?.slice()??Array(4);for(const[lane,v]of snapshot)value[lane]=v;registers.set(destination.key,value);
 }
 const result=[0,1,2,3].map(lane=>materialize(registers.get('TEMP[117]')?.[lane],code.length,'observed word'));
 return{words:result,branches,reads,deferred,demands,arithmetic,demanded:demands.length!==0};
}

export function expected(kernel,vector,fixture){
 const entry=fixture.cases.find(x=>x.name===kernel.case);require(entry,'literal authored kernel');
 const inputs={0:[0,0,0,0x3f800000],1:[0x30400000,0x30400000,0,0x3f800000],2:[0x3e800000,0x3f400000,0,0x3f800000]};
 return interpret(entry.text,inputs,bank(vector));
}
