// Independent literal packet and byte model. No runtime decoder/compiler import.
const fromHex = hex => Uint8Array.from(hex.match(/../g) ?? [], n => parseInt(n, 16));
export function literalState(history) {
  const contexts=new Map(); let s;
  const fresh=()=>({elements:new Map(),buffers:[],index:null,draws:[],shaders:new Map()});
  for (const record of history) {
    if(!contexts.has(record.ctx))contexts.set(record.ctx,fresh());
    s=contexts.get(record.ctx);
    const raw = fromHex(record.hex), v = new DataView(raw.buffer);
    for (let at = 0; at < raw.length;) {
      if (raw.length - at < 4) throw new Error('literal short header');
      const h = v.getUint32(at, true), op = h & 255, kind = h >>> 8 & 255, count = h >>> 16;
      if (count > (raw.length - at - 4) / 4) throw new Error('literal short payload');
      const w = Array.from({ length: count }, (_, n) => v.getUint32(at + 4 + 4 * n, true));
      if (op === 1 && kind === 5) s.elements.set(w[0], Array.from({length:(count-1)/4}, (_,n) => ({
        sourceOffset:w[1+4*n], divisor:w[2+4*n], buffer:w[3+4*n], format:w[4+4*n],
      })));
      if (op === 2 && kind === 5) s.selected = w[0];
      if (op === 6) s.buffers = Array.from({length:count/3}, (_,n) => ({stride:w[3*n],offset:w[3*n+1],id:w[3*n+2]}));
      if (op === 11) s.index = w.length === 1 ? null : {id:w[0],size:w[1],offset:w[2]};
      if (op === 1 && kind === 4) s.shaders.set(w[1], new TextDecoder().decode(raw.subarray(at+24,at+24+w[2]-1)));
      if (op === 8) s.draws.push({start:w[0],count:w[1],mode:w[2],indexed:w[3]===1,instances:w[4],minHint:w[9],maxHint:w[10]});
      at += (count+1)*4;
    }
  }
  if (!s.draws.length) throw new Error('literal model needs a draw');
  s.draw = s.draws.at(-1); s.effective = Math.max(1,s.draw.instances);
  s.activeElements = s.elements.get(s.selected);
  const imm = s.shaders.get(0)?.match(/IMM\[0\] FLT32 \{([^}]+)\}/);
  if (imm) s.imm = imm[1].split(',').map(n => Math.fround(Number(n)));
  return s;
}
export function drawModel(history, buffers, used = [0,1,15]) {
  const s = literalState(history), d = s.draw;
  const indices = d.indexed ? new DataView(buffers.get(s.index.id).buffer,
    buffers.get(s.index.id).byteOffset, buffers.get(s.index.id).byteLength) : null;
  s.ids = Array.from({length:d.count},(_,n) => {
    if (!indices) return d.start+n;
    const at = s.index.offset+n*s.index.size;
    return s.index.size===1 ? indices.getUint8(at) : s.index.size===2 ? indices.getUint16(at,true) : indices.getUint32(at,true);
  });
  s.min = Math.min(...s.ids); s.max = Math.max(...s.ids);
  s.fetches = used.map(index => {
    const e=s.activeElements[index], b=s.buffers[e.buffer], raw=buffers.get(b.id);
    const first=e.divisor ? 0 : s.min, last=e.divisor ? Math.floor((s.effective-1)/e.divisor) : s.max;
    return {attributeIndex:index,resourceId:b.id,divisor:e.divisor,firstElement:first,lastElement:last,
      stride:b.stride,offset:b.offset+e.sourceOffset,components:e.format-27,
      firstByte:b.offset+e.sourceOffset+first*b.stride,requiredEnd:b.offset+e.sourceOffset+last*b.stride+(e.format-27)*4,
      byteLength:raw.length};
  });
  s.color = (instance,id) => {
    const read = (index,lane) => {
      const e=s.activeElements[index], b=s.buffers[e.buffer], raw=buffers.get(b.id);
      const n=e.divisor ? Math.floor(instance/e.divisor) : id;
      return new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getFloat32(b.offset+e.sourceOffset+n*b.stride+lane*4,true);
    };
    return [read(1,0), (id&255)*s.imm[2], Math.fround(Math.fround((instance&7)*s.imm[3])+read(15,2)),read(15,3)]
      .map(n=>Math.round(Math.min(1,Math.max(0,n))*255));
  };
  s.pixel = (x,y,width,height) => {
    const clip=2*(x+.5)/width-1, instance=Math.floor((clip-s.imm[1])/s.imm[0]);
    if (instance<0 || instance>=s.effective) return [[0,0,0,0]];
    const local=(clip-s.imm[1]-instance*s.imm[0])/s.imm[0], diagonal=local+(y+.5)/height;
    const a=s.color(instance,s.ids[2]), b=s.color(instance,s.ids[d.mode===4?5:3]);
    return Math.abs(diagonal-1)<1e-6 ? [a,b] : [diagonal<1?a:b];
  };
  return s;
}
export function comparePixels(raw, model, width, height) {
  const misses=[]; let maxError=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const observed=[...raw.subarray((y*width+x)*4,(y*width+x+1)*4)], expected=model.pixel(x,y,width,height);
    const error=Math.min(...expected.map(color=>Math.max(...color.map((n,i)=>Math.abs(n-observed[i])))));
    maxError=Math.max(maxError,error);
    if(error>1 && misses.length<4)misses.push({x,y,expected,observed,error});
  }
  return {pixels:width*height,maxError,misses,held:misses.length===0};
}
export {fromHex};
