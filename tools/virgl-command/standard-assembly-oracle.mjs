// Independent original wire/bytes, primitive assembly and native vertex-ID model.
// No runtime decoder/compiler or observed pixels are expected input.
import {literalState,fromHex,comparePixels} from './standard-draw-oracle.mjs';
const f=Math.fround;
export function assemblyModel(history,buffers,used=[0,1,2]) {
 const s=literalState(history),d=s.draw;let flags;const rasterizers=new Map(),restartFlags=new Map();
 for(const h of history){const raw=fromHex(h.hex),v=new DataView(raw.buffer);for(let at=0;at<raw.length;){const header=v.getUint32(at,true),count=header>>>16;
  if((header&255)===8)restartFlags.set(h.ctx,{enabled:v.getUint32(at+32,true)===1,value:v.getUint32(at+36,true)}); if((header&255)===1&&(header>>>8&255)===2)rasterizers.set(h.ctx,v.getUint32(at+8,true));at+=4*(count+1);}}
 flags=restartFlags.get(history.at(-1).ctx);s.rasterizer=rasterizers.get(history.at(-1).ctx);d.restart=flags;const view=id=>{const b=buffers.get(id);return new DataView(b.buffer,b.byteOffset,b.byteLength);};
 s.ids=Array.from({length:d.count},(_,i)=>{if(!d.indexed)return d.start+i;const at=s.index.offset+i*s.index.size,v=view(s.index.id);return s.index.size===1?v.getUint8(at):s.index.size===2?v.getUint16(at,true):v.getUint32(at,true);});
 const isRestart=id=>flags.enabled&&id===flags.value,valid=s.ids.filter(id=>!isRestart(id));
 s.min=valid.length?Math.min(...valid):null;s.max=valid.length?Math.max(...valid):null;s.valid=valid.length;s.restarts=s.ids.length-valid.length;
 const sentinel=d.indexed?{1:255,2:65535,4:4294967295}[s.index.size]:null;
 s.normalize=s.ids.some(id=>isRestart(id)?id!==sentinel:id===sentinel);
 s.nativeSize=s.normalize?4:d.indexed?s.index.size:0;s.nativeOffset=s.normalize?0:d.indexed?s.index.offset:0;
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
  'MUL OUT[0].w, TEMP[2].xxxx, IN[0].wwww','ADD TEMP[1], IN[1], IN[2]'])if(!vertex.includes(line))throw Error('original assembly vertex source drift');
 s.smooth=fragment.includes('DCL IN[0], GENERIC[0], PERSPECTIVE'); if(!s.smooth&&!fragment.includes('DCL IN[0], GENERIC[0], CONSTANT'))throw Error('original assembly fragment drift');
 if(!vertex.includes('UMUL TEMP[2].x, SV[1].xxxx, IMM[4].xxxx')||!vertex.includes('IMM[4] UINT32 {17,17,17,17}')||!vertex.includes('AND TEMP[2].x, TEMP[2].xxxx, IMM[2].xxxx')||!vertex.includes('MUL OUT[1].x, TEMP[2].xxxx, IMM[3].xxxx'))throw Error('original per-vertex ID color drift');
 const color=(instance,id)=>{const a=input(1,instance,id),b=input(2,instance,id),c=a.map((n,k)=>f(f(n+b[k])*.5));c[0]=(Math.imul(id,17)&255)/256;return c.map(n=>Math.round(Math.min(1,Math.max(0,n))*255));};
 const point=(instance,id,width,height)=>{const a=input(0,instance,id);if(a[2]!==id||a[3]!==1)throw Error('original native vertex-ID guard fixture drift');const x=f(f(a[0]*s.imm[0])+f(f(instance*s.imm[0])+s.imm[1]));return [(x+1)*width/2,(a[1]+1)*height/2];};
 const primitives=ids=>{
  if(d.mode===1)return Array.from({length:Math.floor(ids.length/2)},(_,i)=>[ids[2*i],ids[2*i+1]]);
  if(d.mode===2||d.mode===3)return ids.slice(1).map((id,i)=>[ids[i],id]).concat(d.mode===2&&ids.length>1?[[ids.at(-1),ids[0]]]:[]);
  if(d.mode===4)return Array.from({length:Math.floor(ids.length/3)},(_,i)=>ids.slice(3*i,3*i+3));
  if(d.mode===5)return Array.from({length:Math.max(0,ids.length-2)},(_,i)=>i%2?[ids[i+1],ids[i],ids[i+2]]:ids.slice(i,i+3));
  if(d.mode===6)return Array.from({length:Math.max(0,ids.length-2)},(_,i)=>[ids[0],ids[i+1],ids[i+2]]);
  throw Error('original unsupported primitive');};
 s.assembled=[2,6].includes(d.mode);s.nativeMode=s.assembled?(d.mode===2?1:4):d.mode;s.nativeIndexed=d.indexed||s.assembled;
 if(s.assembled){const emitted=s.segments.flatMap(ids=>primitives(ids).flat());s.normalize=true;s.nativeSize=4;s.nativeOffset=0;s.normalized=new Uint8Array(emitted.length*4);const v=new DataView(s.normalized.buffer);emitted.forEach((id,i)=>v.setUint32(i*4,id,true));s.nativeIds=emitted;}
 s.nativeCount=s.assembled?s.normalized.length/4:d.count;
 const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
 let raster=null;
 s.pixel=(x,y,width,height)=>{const p=[x+.5,y+.5];let allowed=[[0,0,0,0]],shared=[];
  if(!raster){raster=[];for(let instance=0;instance<s.effective;instance++)for(const ids of s.segments)for(const primitive of primitives(ids)){
   const points=primitive.map(id=>point(instance,id,width,height)),colors=primitive.map(id=>color(instance,id));
   if(points.length===3&&Math.abs(cross(points[0],points[1],points[2]))<1e-7||points.length===2&&points[0][0]===points[1][0]&&points[0][1]===points[1][1])continue;
   raster.push({points,colors});}}
  for(const {points,colors} of raster){let rgba=colors.at(-1);
   if(points.length===3){const area=cross(points[0],points[1],points[2]);if(Math.abs(area)<1e-7)continue;
    if((s.rasterizer&0x300)===0x200&&(s.rasterizer&0x8000?area>0:area<0))continue;
    const sign=Math.sign(area),edges=[cross(points[0],points[1],p),cross(points[1],points[2],p),cross(points[2],points[0],p)].map(n=>n*sign);
    if(s.smooth){const weights=[cross(points[1],points[2],p)/area,cross(points[2],points[0],p)/area,cross(points[0],points[1],p)/area];rgba=colors[0].map((_,lane)=>Math.round(weights.reduce((sum,w,i)=>sum+w*colors[i][lane],0)));}
    if(edges.every(n=>n>1e-7)){allowed=[rgba];shared=[];}else if(edges.every(n=>n>=-1e-7)){shared.push(rgba);allowed.push(rgba);if(shared.length>1)allowed=shared;}
   }else{const [a,b]=points,dx=b[0]-a[0],dy=b[1]-a[1];if(Math.abs(dx)+Math.abs(dy)<1e-7)continue;
    if(Math.abs(dx)>1e-7&&Math.abs(dy)>1e-7)throw Error('independent line fixture must be axis aligned');
    const along=Math.abs(dy)<1e-7?0:1,across=1-along;
    if(Math.abs(p[across]-a[across])<1e-5&&p[along]>=Math.min(a[along],b[along])-1e-5&&p[along]<=Math.max(a[along],b[along])+1e-5){
     if(s.smooth){const t=(p[along]-a[along])/(b[along]-a[along]);rgba=colors[0].map((n,lane)=>Math.round((1-t)*n+t*colors[1][lane]));}
     if(Math.abs(p[along]-a[along])>1e-5&&Math.abs(p[along]-b[along])>1e-5)allowed=[rgba];else allowed.push(rgba);
    }
   }
  }
  // Compose original primitives in order. Only declared half-open endpoints
  // and outer triangle edges permit coverage alternatives; shared edges cannot
  // become clear holes. Every strict interior uses the actual original shader.
  return allowed;
 };
 return s;
}
export {comparePixels};
