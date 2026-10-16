// Original literal bytes and TGSI operations; no runtime descriptor, compiler ESSL or scalar converter imports.
// Packet/TGSI interpretation carries the previously verified independent interpreter.
const f32 = Math.fround;
const scratch = new DataView(new ArrayBuffer(4));
const word = n => { scratch.setFloat32(0, n, true); return scratch.getUint32(0, true); };
const number = w => { scratch.setUint32(0, w, true); return scratch.getFloat32(0, true); };
const require = (held, why) => { if (!held) throw Error('critic: ' + why); };
const hex = text => Uint8Array.from(text.match(/../g) ?? [], a => Number.parseInt(a, 16));

// Literal pinned ABI; scaled integers are never normalized. Native arithmetic
// remains numerical authority; exact integer/generic words have rational proof.
export function integerFormat(enumValue) {
  const rows=[[28,4,5126,false,false],[177,1,5121,false,true],[181,1,5120,true,true],
    [185,2,5123,false,true],[189,2,5122,true,true],[193,4,5125,false,true],[197,4,5124,true,true]];
  const row=rows.find(([base])=>enumValue>=base&&enumValue<base+4);
  require(row,'literal integer format '+enumValue);
  const [base,bytes,type,signed,integer]=row;
  return {components:enumValue-base+1,bytes,type,signed,integer,normalized:false,
    shaderType:integer?signed?35669:36296:35666};
}
export function integerScalar(raw,offset,format) {
  const spec=integerFormat(format),v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  require(offset>=0&&offset+spec.bytes*spec.components<=raw.length,'literal original integer end');
  const words=[0,0,0,spec.integer?1:0x3f800000],values=[0,0,0,1],nan=[false,false,false,false];
  for(let lane=0;lane<spec.components;lane++){
    const at=offset+lane*spec.bytes;
    if(!spec.integer){words[lane]=v.getUint32(at,true);values[lane]=number(words[lane]);nan[lane]=Number.isNaN(values[lane]);}
    else {let magnitude=0;for(let j=0;j<spec.bytes;j++)magnitude+=raw[at+j]*2**(8*j);
      const integer=spec.signed&&magnitude>=2**(8*spec.bytes-1)?magnitude-2**(8*spec.bytes):magnitude;
      words[lane]=integer>>>0;values[lane]=integer;}
  }
  return {words,values,nan,suppliedWords:words.slice(0,spec.components)};
}

export function integerPackets(history) {
  const contexts = new Map();
  for (const record of history) {
    let s = contexts.get(record.ctx);
    if (!s) contexts.set(record.ctx, s = { objects: new Map(), buffers: [], shaders: new Map(), raster: { size:1,bits:0 }, uploads: [] });
    const bytes = hex(record.hex), v = new DataView(bytes.buffer);
    for (let at = 0; at < bytes.length;) {
      require(at + 4 <= bytes.length, 'original packet header');
      const h = v.getUint32(at,true), op = h & 255, kind = h >>> 8 & 255, n = h >>> 16;
      require(at + (n+1)*4 <= bytes.length, 'original packet extent');
      const w = Array.from({length:n},(_,i)=>v.getUint32(at+4+i*4,true));
      if (op === 1 && kind === 5) {
        require((n-1)%4===0,'original element width');
        s.objects.set(w[0], Array.from({length:(n-1)/4},(_,i)=>({sourceOffset:w[1+i*4],divisor:w[2+i*4],slot:w[3+i*4],format:w[4+i*4]})));
      } else if (op === 2 && kind === 5) s.elements = s.objects.get(w[0]);
      else if (op === 6) s.buffers = Array.from({length:n/3},(_,i)=>({stride:w[3*i],offset:w[3*i+1],id:w[3*i+2]}));
      else if (op === 11) s.index = n===1 ? null : {id:w[0],bytes:w[1],offset:w[2]};
      else if (op === 8) s.draw = {start:w[0],count:w[1],mode:w[2],indexed:w[3]===1,instances:Math.max(1,w[4]),restart:w[7]===1,marker:w[8]};
      else if (op === 1 && kind === 4) {
        const text = new TextDecoder().decode(bytes.subarray(at+24,at+24+w[2]-1));
        s.objects.set(w[0], {stage:w[1],text});
      } else if (op === 31) s.shaders.set(w[1], s.objects.get(w[0]).text);
      else if (op === 1 && kind === 2) s.objects.set(w[0], {bits:w[1],size:number(w[2])});
      else if (op === 2 && kind === 2) s.raster = s.objects.get(w[0]);
      else if (op === 4) s.viewport = w.slice(1).map(number);
      else if (op === 43) s.uploads.push({id:w[0],offset:w[5],width:w[8],height:w[9],depth:w[10],direction:w[12]});
      at += (n+1)*4;
    }
  }
  const selected = contexts.get(history.at(-1).ctx);
  require(selected?.draw && selected.elements && selected.shaders.size===2, 'original active draw/shader state');
  return selected;
}

function tgsi(text, inputs, systems) {
  const registers = new Map(), categories = new Map(), ids = new Map();
  const assign = (key, words, nan=words.map(()=>false)) => { registers.set(key,words); categories.set(key,nan); };
  inputs.forEach((input,i)=>assign('IN['+i+']',input.words.slice(),input.nan.slice()));
  for (const line of text.split('\n')) {
    let match = line.match(/^IMM\[(\d+)\] (FLT32|UINT32) \{([^}]+)\}$/);
    if (match) assign('IMM['+match[1]+']',match[3].split(',').map(x=>match[2]==='FLT32'?word(Number(x)):Number(x)>>>0));
    match = line.match(/^DCL SV\[(\d+)\], (INSTANCEID|VERTEXID)$/);
    if (match) ids.set(match[1],match[2]);
  }
  for (const [index,kind] of ids) assign('SV['+index+']',Array(4).fill(systems[kind]>>>0));
  const operand = value => {
    const m = value.match(/^(IN|OUT|TEMP|IMM|SV)\[(\d+)\](?:\.([xyzw]+))?$/);
    require(m,'original TGSI register '+value);
    const key=m[1]+'['+m[2]+']', lanes=m[3]??'xyzw';
    if (!registers.has(key)) assign(key,[0,0,0,0]);
    return {key, lanes:[...lanes].map(x=>'xyzw'.indexOf(x)),words:registers.get(key),nan:categories.get(key)};
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^\d+: (\w+)(?: (.*))?$/); if(!m)continue;
    const op=m[1];if(op==='END')break;
    const args=m[2].split(',').map(s=>s.trim()),dest=operand(args.shift()),src=args.map(operand);
    const output=dest.words.slice(),outNan=dest.nan.slice();
    for (const lane of dest.lanes) {
      const read = i => src[i].words[src[i].lanes.length===1?src[i].lanes[0]:src[i].lanes[lane]], n=i=>number(read(i));
      let w;
      if(op==='MOV')w=read(0);
      else if(op==='I2F')w=word(read(0)|0);
      else if(op==='U2F')w=word(read(0));
      else if(op==='MAD')w=word(f32(n(0)*n(1))+n(2));
      else if(op==='MUL')w=word(n(0)*n(1));
      else if(op==='SEQ')w=word(n(0)===n(1)?1:0);
      else if(op==='USHR')w=read(0) >>> (read(1)&31);
      else if(op==='AND')w=(read(0)&read(1))>>>0;
      else if(op==='UADD'||op==='IADD')w=(read(0)+read(1))>>>0;
      else if(op==='XOR')w=(read(0)^read(1))>>>0;
      else throw Error('critic: unsupported original opcode '+op);
      output[lane]=w;outNan[lane]=src.some(s=>s.nan[s.lanes.length===1?s.lanes[0]:s.lanes[lane]]);
    }
    assign(dest.key,output,outNan);
  }
  return {registers,categories};
}

export function integerModel(history, buffers, range) {
  const s=integerPackets(history),d=s.draw;require(d.mode===0,'bounded critic point domain');
  const idBytes=d.indexed?buffers.get(s.index.id):null,indices=idBytes?new DataView(idBytes.buffer,idBytes.byteOffset,idBytes.byteLength):null;
  const ids=Array.from({length:d.count},(_,i)=>!indices?d.start+i: s.index.bytes===1?indices.getUint8(s.index.offset+i):s.index.bytes===2?indices.getUint16(s.index.offset+i*2,true):indices.getUint32(s.index.offset+i*4,true));
  const valid=ids.filter(id=>!d.restart||id!==d.marker),min=valid.length?Math.min(...valid):null,max=valid.length?Math.max(...valid):null;
  const sentinel=d.indexed?2**(8*s.index.bytes)-1:null;
  const normalize=d.indexed&&ids.some(id=>d.restart&&id===d.marker?id!==sentinel:id===sentinel);
  const nativeSize=normalize?4:d.indexed?s.index.bytes:0,nativeOffset=normalize?0:d.indexed?s.index.offset:0;
  const normalized=new Uint8Array(normalize?d.count*4:0);if(normalize){const v=new DataView(normalized.buffer);ids.forEach((id,i)=>v.setUint32(i*4,d.restart&&id===d.marker?0xffffffff:id,true));}
  const declared=new Set([...s.shaders.get(0).matchAll(/^DCL IN\[(\d+)\]$/gm)].map(row=>Number(row[1])));
  const fetches=s.elements.map((e,attributeIndex)=>{if(!declared.has(attributeIndex))return null;
    const b=s.buffers[e.slot],spec=integerFormat(e.format),constant=b.stride===0,offset=b.offset+e.sourceOffset;
    const first=valid.length===0?null:constant||e.divisor?0:min,last=valid.length===0?null:constant?0:e.divisor?Math.floor((d.instances-1)/e.divisor):max;
    require(offset%spec.bytes===0&&b.stride%spec.bytes===0&&b.stride<=255,'literal effective alignment');
    const requiredEnd=last===null?null:offset+last*b.stride+spec.bytes*spec.components;
    require(requiredEnd===null||requiredEnd<=buffers.get(b.id).length,'literal actual fetch bounds');
    const generic=constant?integerScalar(buffers.get(b.id),offset,e.format):null;
    return {attributeIndex,resourceId:b.id,stride:b.stride,offset,components:spec.components,sourceFormat:e.format,elementBytes:spec.bytes*spec.components,
      nativeType:spec.type,normalized:spec.normalized,constant,...(spec.integer?{integer:true,signed:spec.signed,shaderType:spec.shaderType}:{}),divisor:e.divisor,nativeDivisor:constant?0:Math.min(e.divisor,65536),
      firstElement:first,lastElement:last,firstByte:first===null?null:offset+first*b.stride,requiredEnd,
      ...(generic?{genericValues:generic.values,componentWords:generic.suppliedWords,
        ...(spec.integer?{genericWords:generic.words}:{}),nan:generic.nan}:{})};
  }).filter(Boolean);
  const vertices=[],size=Math.min(range[1],Math.max(range[0],s.raster.size));
  for(let instance=0;instance<d.instances;instance++)for(const id of valid){
    const inputs=s.elements.map(e=>{const b=s.buffers[e.slot],element=b.stride===0?0:e.divisor?Math.floor(instance/e.divisor):id;return integerScalar(buffers.get(b.id),b.offset+e.sourceOffset+element*b.stride,e.format);});
    const output=tgsi(s.shaders.get(0),inputs,{INSTANCEID:instance,VERTEXID:id}),position=output.registers.get('OUT[0]').map(number),varying=output.registers.get('OUT[1]');
    if(position[3]===0)continue;
    const fragment=tgsi(s.shaders.get(1),[{words:varying,nan:output.categories.get('OUT[1]')}],{}),color=fragment.registers.get('OUT[0]').map(number);
    vertices.push({id,instance,x:position[0]/position[3]*Math.abs(s.viewport[0])+s.viewport[3],
      y:position[1]/position[3]*s.viewport[1]+s.viewport[4],size,color:color.map(v=>Math.round(Math.min(1,Math.max(0,v))*255)),
      nan:fragment.categories.get('OUT[0]').some(Boolean)});
  }
  const wordMode=/^\d+: USHR /m.test(s.shaders.get(0));
  return {state:s,draw:d,ids,min,max,valid:valid.length,restarts:ids.length-valid.length,normalize,nativeSize,nativeOffset,normalized,fetches,vertices,points:vertices,effective:d.instances,index:s.index?{id:s.index.id,size:s.index.bytes,offset:s.index.offset}:null,wordMode,
    pointUniform:[s.raster.size,0],pixel(x,y){let p={color:[0,0,0,0],nan:false};for(const v of vertices)if(x+.5>v.x-v.size/2&&x+.5<v.x+v.size/2&&y+.5>v.y-v.size/2&&y+.5<v.y+v.size/2)p=v;return p;}};
}

export function compareIntegerPixels(raw,model,width,height) {
  const misses=[];let nanPixels=0,maxError=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const expected=model.pixel(x,y),observed=Array.from(raw.subarray((y*width+x)*4,(y*width+x+1)*4));let error;
    if(expected.nan){require(model.wordMode,'undefined arithmetic NaN cannot receive a pixel certificate');const w=(observed[0]|observed[1]<<8|observed[2]<<16|observed[3]<<24)>>>0;error=(w&0x7f800000)===0x7f800000&&(w&0x7fffff)!==0?0:255;nanPixels++;}
    else error=Math.max(...observed.map((n,i)=>Math.abs(n-expected.color[i])));
    maxError=Math.max(maxError,error);if(error>(model.wordMode?0:1)&&misses.length<8)misses.push({x,y,expected:expected.color,observed,error});
  }
  return {held:misses.length===0,pixels:width*height,nanPixels,maxError,misses,portableNaNPayload:false};
}
