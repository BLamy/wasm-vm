// Independent original wire/bytes, primitive assembly and native vertex-ID model.
// No runtime decoder/compiler or observed pixels are expected input.
import {literalState,fromHex,comparePixels} from './standard-draw-oracle.mjs';
const f=Math.fround;
export function restartModel(history,buffers,used=[0,1,2]) {
 const s=literalState(history),d=s.draw;let flags;
 for(const h of history){const raw=fromHex(h.hex),v=new DataView(raw.buffer);for(let at=0;at<raw.length;){const header=v.getUint32(at,true),count=header>>>16;
  if((header&255)===8)flags={enabled:v.getUint32(at+32,true)===1,value:v.getUint32(at+36,true)};at+=4*(count+1);}}
 d.restart=flags;const view=id=>{const b=buffers.get(id);return new DataView(b.buffer,b.byteOffset,b.byteLength);};
 s.ids=Array.from({length:d.count},(_,i)=>{const at=s.index.offset+i*s.index.size,v=view(s.index.id);return s.index.size===1?v.getUint8(at):s.index.size===2?v.getUint16(at,true):v.getUint32(at,true);});
 const isRestart=id=>flags.enabled&&id===flags.value,valid=s.ids.filter(id=>!isRestart(id));
 s.min=valid.length?Math.min(...valid):null;s.max=valid.length?Math.max(...valid):null;s.valid=valid.length;s.restarts=s.ids.length-valid.length;
 const sentinel={1:255,2:65535,4:4294967295}[s.index.size];
 s.normalize=s.ids.some(id=>isRestart(id)?id!==sentinel:id===sentinel);
 s.nativeSize=s.normalize?4:s.index.size;s.nativeOffset=s.normalize?0:s.index.offset;
 s.normalized=new Uint8Array(s.normalize?d.count*4:0);if(s.normalize){const v=new DataView(s.normalized.buffer);s.ids.forEach((id,i)=>v.setUint32(4*i,isRestart(id)?4294967295:id,true));}
 s.segments=[[]];for(const id of s.ids){if(isRestart(id))s.segments.push([]);else s.segments.at(-1).push(id);}
 s.fetches=used.map(i=>{const e=s.activeElements[i],b=s.buffers[e.buffer],offset=b.offset+e.sourceOffset,constant=b.stride===0,
  first=s.valid===0?null:constant||e.divisor?0:s.min,last=s.valid===0?null:constant?0:e.divisor?Math.floor((s.effective-1)/e.divisor):s.max,generic=[0,0,0,1],words=[];
  if(constant)for(let k=0;k<e.format-27;k++){generic[k]=view(b.id).getFloat32(offset+k*4,true);words.push(view(b.id).getUint32(offset+k*4,true));}
  return {attributeIndex:i,resourceId:b.id,stride:b.stride,offset,components:e.format-27,constant,divisor:e.divisor,nativeDivisor:constant?0:Math.min(e.divisor,65536),
   firstElement:first,lastElement:last,firstByte:first===null?null:offset+first*b.stride,requiredEnd:last===null?null:offset+last*b.stride+4*(e.format-27),
   ...(constant?{genericValues:generic,componentWords:words}:{})};});
 const input=(attribute,instance,id)=>{const e=s.activeElements[attribute],b=s.buffers[e.buffer],n=b.stride===0?0:e.divisor?Math.floor(instance/e.divisor):id,v=view(b.id),out=[0,0,0,1];
  for(let k=0;k<e.format-27;k++)out[k]=v.getFloat32(b.offset+e.sourceOffset+n*b.stride+4*k,true);return out;};
 const vertex=s.shaders.get(0),fragment=s.shaders.get(1);
 for(const line of ['DCL SV[1], VERTEXID','I2F TEMP[2].x, SV[1].xxxx','SEQ TEMP[2].x, TEMP[2].xxxx, IN[0].zzzz',
  'MUL OUT[0].w, TEMP[2].xxxx, IN[0].wwww','ADD TEMP[1], IN[1], IN[2]'])if(!vertex.includes(line))throw Error('original restart vertex source drift');
 if(!fragment.includes('DCL IN[0], GENERIC[0], CONSTANT'))throw Error('original flat fragment drift');
 const color=(instance,id)=>{const a=input(1,instance,id),b=input(2,instance,id),c=a.map((n,k)=>f(f(n+b[k])*.5));return c.map(n=>Math.round(Math.min(1,Math.max(0,n))*255));};
 const point=(instance,id,width,height)=>{const a=input(0,instance,id);if(a[2]!==id||a[3]!==1)throw Error('original native vertex-ID guard fixture drift');const x=f(f(a[0]*s.imm[0])+f(f(instance*s.imm[0])+s.imm[1]));return [(x+1)*width/2,(a[1]+1)*height/2];};
 const primitives=ids=>{
  if(d.mode===1)return Array.from({length:Math.floor(ids.length/2)},(_,i)=>[ids[2*i],ids[2*i+1]]);
  if(d.mode===2||d.mode===3)return ids.slice(1).map((id,i)=>[ids[i],id]).concat(d.mode===2&&ids.length>1?[[ids.at(-1),ids[0]]]:[]);
  if(d.mode===4)return Array.from({length:Math.floor(ids.length/3)},(_,i)=>ids.slice(3*i,3*i+3));
  if(d.mode===5)return Array.from({length:Math.max(0,ids.length-2)},(_,i)=>ids.slice(i,i+3));
  if(d.mode===6)return Array.from({length:Math.max(0,ids.length-2)},(_,i)=>[ids[0],ids[i+1],ids[i+2]]);
  throw Error('original unsupported primitive');};
 const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
 s.pixel=(x,y,width,height)=>{const p=[x+.5,y+.5],boundaries=[];let sharedTriangles=0;
  for(let instance=0;instance<s.effective;instance++)for(const ids of s.segments)for(const primitive of primitives(ids)){
   const points=primitive.map(id=>point(instance,id,width,height)),rgba=color(instance,primitive.at(-1));
   if(points.length===3){const area=cross(points[0],points[1],points[2]);if(Math.abs(area)<1e-7)continue;const sign=Math.sign(area),edges=[cross(points[0],points[1],p),cross(points[1],points[2],p),cross(points[2],points[0],p)].map(n=>n*sign);
    if(edges.every(n=>n>1e-7))return [rgba];if(edges.every(n=>n>=-1e-7)){boundaries.push(rgba);sharedTriangles++;}}
   else{const [a,b]=points,dx=b[0]-a[0],dy=b[1]-a[1];if(Math.abs(dx)+Math.abs(dy)<1e-7)continue;
    if(Math.abs(dx)>1e-7&&Math.abs(dy)>1e-7)throw Error('independent line fixture must be axis aligned');
    const along=Math.abs(dy)<1e-7?0:1,across=1-along;
    if(Math.abs(p[across]-a[across])<1e-5&&p[along]>=Math.min(a[along],b[along])-1e-5&&p[along]<=Math.max(a[along],b[along])+1e-5){
     if(Math.abs(p[along]-a[along])>1e-5&&Math.abs(p[along]-b[along])>1e-5)return [rgba];boundaries.push(rgba);}
   }
  }
  // GLES3 bounded endpoint alternatives, declared before any comparison.
  // Shared triangle edges cannot turn into clear holes.
  return sharedTriangles>1?boundaries:[[0,0,0,0],...boundaries];
 };
 return s;
}
export {comparePixels};
