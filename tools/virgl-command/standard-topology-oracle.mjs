// Independent literal Gallium wire, original input bytes and raster geometry.
// No renderer, decoder or compiler import. GLES3 section3.5 specifies half-open
// diamond-exit lines and bounded alternate algorithms. These fixtures use
// axis-aligned fragment-center endpoints: interiors are strict, endpoint pixels
// admit native half-open orientation differences. Missing loop interiors cannot
// hide behind endpoint alternatives.
import { literalState, comparePixels } from './standard-draw-oracle.mjs';
const f=Math.fround;
export function topologyModel(history, buffers, used=[0,1,2]) {
  const s=literalState(history),d=s.draw;
  const view=id=>{const b=buffers.get(id);return new DataView(b.buffer,b.byteOffset,b.byteLength);};
  s.ids=Array.from({length:d.count},(_,i)=>{
    if(!d.indexed)return d.start+i;
    const v=view(s.index.id),at=s.index.offset+i*s.index.size;
    return s.index.size===1?v.getUint8(at):s.index.size===2?v.getUint16(at,true):v.getUint32(at,true);
  });
  s.min=Math.min(...s.ids);s.max=Math.max(...s.ids);
  s.fetches=used.map(i=>{
    const e=s.activeElements[i],b=s.buffers[e.buffer],offset=b.offset+e.sourceOffset,constant=b.stride===0;
    const first=constant||e.divisor?0:s.min,last=constant?0:e.divisor?Math.floor((s.effective-1)/e.divisor):s.max;
    const generic=[0,0,0,1],words=[];
    if(constant)for(let k=0;k<e.format-27;k++){generic[k]=view(b.id).getFloat32(offset+k*4,true);words.push(view(b.id).getUint32(offset+k*4,true));}
    return {attributeIndex:i,resourceId:b.id,stride:b.stride,offset,components:e.format-27,constant,
      divisor:e.divisor,nativeDivisor:constant?0:Math.min(e.divisor,65536),firstElement:first,lastElement:last,
      firstByte:offset+first*b.stride,requiredEnd:offset+last*b.stride+(e.format-27)*4,
      ...(constant?{genericValues:generic,componentWords:words}:{})};
  });
  const input=(attribute,instance,id)=>{
    const e=s.activeElements[attribute],b=s.buffers[e.buffer],n=b.stride===0?0:e.divisor?Math.floor(instance/e.divisor):id,v=view(b.id),out=[0,0,0,1];
    for(let k=0;k<e.format-27;k++)out[k]=v.getFloat32(b.offset+e.sourceOffset+n*b.stride+k*4,true);
    return out;
  };
  const vertex=s.shaders.get(0),fragment=s.shaders.get(1);
  for(const line of ['DCL SV[0], INSTANCEID','MAD TEMP[0].x, TEMP[0].xxxx, IMM[0].xxxx, IMM[0].yyyy',
    'MOV OUT[0], IN[0]','MAD OUT[0].x, IN[0].xxxx, IMM[0].xxxx, TEMP[0].xxxx',
    'ADD TEMP[1], IN[1], IN[2]','MUL OUT[1], TEMP[1], IMM[1].xxxx'])if(!vertex.includes(line))throw Error('original topology shader shape drift');
  if(!fragment.includes('DCL IN[0], GENERIC[0], CONSTANT')||!fragment.includes('0: MOV OUT[0], IN[0]'))throw Error('original flat fragment drift');
  const coeff=vertex.match(/IMM\[1\] FLT32 \{([^}]+)\}/)[1].split(',').map(n=>f(Number(n)));
  const rgba=instance=>{
    const a=input(1,instance,s.ids[0]),b=input(2,instance,s.ids[0]);
    return a.map((n,k)=>Math.round(Math.min(1,Math.max(0,f(f(n+b[k])*coeff[0])))*255));
  };
  const geometry=(instance,width,height)=>s.ids.map(id=>{
    const a=input(0,instance,id),x=f(f(a[0]*s.imm[0])+f(f(instance*s.imm[0])+s.imm[1]));
    return [(x+1)*width/2,(a[1]+1)*height/2];
  });
  const triangles=points=>{
    if(d.mode!==6)throw Error('triangle oracle only claims original fan');
    return Array.from({length:Math.max(0,points.length-2)},(_,i)=>[points[0],points[i+1],points[i+2]]);
  };
  const segments=points=>{
    if(d.mode===1)return Array.from({length:Math.floor(points.length/2)},(_,i)=>[points[2*i],points[2*i+1]]);
    if(d.mode===2||d.mode===3)return points.slice(1).map((p,i)=>[points[i],p]).concat(d.mode===2&&points.length>1?[[points.at(-1),points[0]]]:[]);
    throw Error('line oracle mode');
  };
  const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  s.pixel=(x,y,width,height)=>{
    const p=[x+.5,y+.5];let boundaryColors=[];
    for(let instance=0;instance<s.effective;instance++){
      const points=geometry(instance,width,height),color=rgba(instance);
      if(d.mode===6){
        let edges=0;
        for(const t of triangles(points)){
          const area=cross(t[0],t[1],t[2]);if(Math.abs(area)<1e-7)continue;
          const sign=Math.sign(area),c=[cross(t[0],t[1],p),cross(t[1],t[2],p),cross(t[2],t[0],p)].map(n=>n*sign);
          if(c.every(n=>n>1e-7))return [color];
          if(c.every(n=>n>=-1e-7))edges++;
        }
        if(edges>1)return [color];if(edges===1)boundaryColors.push(color);
      }else for(const [a,b]of segments(points)){
        const dx=b[0]-a[0],dy=b[1]-a[1];if(Math.abs(dx)+Math.abs(dy)<1e-7)continue;
        if(Math.abs(dy)<1e-7){
          if(Math.abs(p[1]-a[1])<1e-5&&p[0]>=Math.min(a[0],b[0])-1e-5&&p[0]<=Math.max(a[0],b[0])+1e-5){
            if(Math.abs(p[0]-a[0])>1e-5&&Math.abs(p[0]-b[0])>1e-5)return [color];boundaryColors.push(color);}
        }else if(Math.abs(dx)<1e-7){
          if(Math.abs(p[0]-a[0])<1e-5&&p[1]>=Math.min(a[1],b[1])-1e-5&&p[1]<=Math.max(a[1],b[1])+1e-5){
            if(Math.abs(p[1]-a[1])>1e-5&&Math.abs(p[1]-b[1])>1e-5)return [color];boundaryColors.push(color);}
        }else throw Error('line fixture must remain axis aligned');
      }
    }
    return [[0,0,0,0],...boundaryColors];
  };
  return s;
}
export {comparePixels};
