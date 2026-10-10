// Original literal wire/uploads and GLES3 point squares. No renderer/compiler
// import and no observed pixel, generated ESSL or runtime summary as prediction.
import {literalState,fromHex,comparePixels} from './standard-draw-oracle.mjs';
const f=Math.fround;
export function pointModel(history,buffers,range){
 const s=literalState(history),contexts=new Map();
 for(const h of history){if(!contexts.has(h.ctx))contexts.set(h.ctx,{objects:new Map(),selected:0,raster:{bits:0,size:1},scissor:null});const c=contexts.get(h.ctx),raw=fromHex(h.hex),v=new DataView(raw.buffer);
  for(let at=0;at<raw.length;){const header=v.getUint32(at,true),op=header&255,kind=header>>>8&255,count=header>>>16,w=Array.from({length:count},(_,i)=>v.getUint32(at+4+4*i,true));
   if(op===1&&kind===2)c.objects.set(w[0],{bits:w[1],size:v.getFloat32(at+12,true)});
   if(op===2&&kind===2){c.selected=w[0];c.raster=w[0]===0?{bits:0,size:1}:c.objects.get(w[0]);}
   if(op===4)c.viewport=Array.from({length:6},(_,i)=>v.getFloat32(at+8+4*i,true));
   if(op===15&&count===3)c.scissor={minX:w[1]&65535,minY:w[1]>>>16,maxX:w[2]&65535,maxY:w[2]>>>16};
   if(op===8)c.restart={enabled:w[7]===1,value:w[8]};at+=4*(count+1);
  }
 }
 const c=contexts.get(history.at(-1).ctx),d=s.draw;s.raster=c.raster;s.viewport=c.viewport;s.scissor=c.scissor;s.winsysY=c.viewport[1]<0?-1:1;
 if(d.mode!==0)throw Error('original point mode required');
 const view=id=>{const raw=buffers.get(id);return new DataView(raw.buffer,raw.byteOffset,raw.byteLength);};
 s.ids=Array.from({length:d.count},(_,i)=>{if(!d.indexed)return d.start+i;const at=s.index.offset+i*s.index.size,v=view(s.index.id);return s.index.size===1?v.getUint8(at):s.index.size===2?v.getUint16(at,true):v.getUint32(at,true);});
 const marker=id=>c.restart.enabled&&id===c.restart.value,valid=s.ids.filter(id=>!marker(id));s.min=valid.length?Math.min(...valid):null;s.max=valid.length?Math.max(...valid):null;s.valid=valid.length;s.restarts=s.ids.length-valid.length;
 const sentinel=d.indexed?{1:255,2:65535,4:4294967295}[s.index.size]:null;s.normalize=s.ids.some(id=>marker(id)?id!==sentinel:id===sentinel);
 s.nativeSize=s.normalize?4:d.indexed?s.index.size:0;s.nativeOffset=s.normalize?0:d.indexed?s.index.offset:0;s.normalized=new Uint8Array(s.normalize?d.count*4:0);
 if(s.normalize){const v=new DataView(s.normalized.buffer);s.ids.forEach((id,i)=>v.setUint32(i*4,marker(id)?4294967295:id,true));}
 const vertex=s.shaders.get(0),fragment=s.shaders.get(1),psize=vertex.includes('PSIZE'),generic=fragment.includes('GENERIC[15]'),clipZ=f(Number(vertex.match(/IMM\[1\] FLT32 \{([^,]+)/)[1]));
 for(const line of ['DCL SV[0], INSTANCEID','DCL SV[1], VERTEXID','MAD OUT[0].x, IN[0].xxxx, IMM[0].xxxx, TEMP[0].xxxx',
  'SEQ TEMP[1].x, TEMP[1].xxxx, IN[0].zzzz','MUL OUT[0].w, TEMP[1].xxxx, IN[0].wwww'])if(!vertex.includes(line))throw Error('original point vertex identity drift');
 if(psize&&!vertex.includes('MOV OUT[31]'))throw Error('original point-size output missing');
 s.used=[0,...(psize?[1]:[]),...(generic?[15]:[])];
 s.fetches=s.used.map(i=>{const e=s.activeElements[i],b=s.buffers[e.buffer],offset=b.offset+e.sourceOffset,constant=b.stride===0,first=s.valid===0?null:constant||e.divisor?0:s.min,last=s.valid===0?null:constant?0:e.divisor?Math.floor((s.effective-1)/e.divisor):s.max,genericValues=[0,0,0,1],componentWords=[];
  if(constant)for(let lane=0;lane<e.format-27;lane++){genericValues[lane]=view(b.id).getFloat32(offset+lane*4,true);componentWords.push(view(b.id).getUint32(offset+lane*4,true));}
  return {attributeIndex:i,resourceId:b.id,stride:b.stride,offset,components:e.format-27,constant,divisor:e.divisor,nativeDivisor:constant?0:Math.min(e.divisor,65536),firstElement:first,lastElement:last,firstByte:first===null?null:offset+first*b.stride,requiredEnd:last===null?null:offset+last*b.stride+4*(e.format-27),...(constant?{genericValues,componentWords}:{})};});
 const input=(i,instance,id)=>{const e=s.activeElements[i],b=s.buffers[e.buffer],n=b.stride===0?0:e.divisor?Math.floor(instance/e.divisor):id,v=view(b.id),out=[0,0,0,1];for(let k=0;k<e.format-27;k++)out[k]=v.getFloat32(b.offset+e.sourceOffset+n*b.stride+4*k,true);return out;};
 s.pointUniform=[s.raster.size,Boolean(s.raster.bits&(1<<24))?1:0];
 const points=[];
 for(let instance=0;instance<s.effective;instance++)for(const id of valid){const a=input(0,instance,id),clipX=f(f(a[0]*s.imm[0])+f(f(instance*s.imm[1])+s.imm[2])),clipY=f(a[1]*s.winsysY),w=f((a[2]===id?1:0)*a[3]);
  const originalSize=s.pointUniform[1]?(psize?input(1,instance,id)[0]:1):s.raster.size,size=Math.min(range[1],Math.max(range[0],originalSize));
  if(!(size>0)||!Number.isFinite(size))throw Error('fixture outside defined native point domain');
  // GLES3 2.18 clips point centers only against the near/far planes. Its XY
  // square may cover the framebuffer even when the center lies beyond an edge.
  if(w!==1||Math.abs(clipZ)>w)continue;
  const color=generic?input(15,instance,id):[0,0,0,1];color[0]=(Math.imul(id,17)&255)/256;color[3]=f(color[3]+f(instance*.0625));
  points.push({instance,id,x:clipX*Math.abs(s.viewport[0])+s.viewport[3],y:clipY*Math.abs(s.viewport[1])+s.viewport[4],size,originalSize,color});
 }
 s.points=points;
 s.pixel=(x,y)=>{let rgba=[0,0,0,0];if((s.raster.bits&(1<<14))&&(!s.scissor||x<s.scissor.minX||y<s.scissor.minY||x>=s.scissor.maxX||y>=s.scissor.maxY))return [rgba];
  for(const p of points){const dx=x+.5-p.x,dy=y+.5-p.y;if(Math.abs(dx)>=p.size/2||Math.abs(dy)>=p.size/2)continue;
   const coord=[.5+dx/p.size,s.winsysY>0?.5-dy/p.size:.5+dy/p.size,0,1];let value;
   if(fragment.includes('MOV OUT[0], IN[31]'))value=p.color;
   else if(fragment.includes('MOV OUT[0].x, IN[31].xxxx'))value=[p.color[0],coord[1],coord[0],p.color[3]];
   else if(fragment.includes('.yxwz'))value=[coord[1],coord[0],1,0];
   else if(fragment.includes('.zwzw'))value=[0,1,0,1];
   else if(fragment.includes('MOV OUT[0].xy,'))value=[coord[1],coord[0],0,1];
   else value=coord;
   rgba=value.map(n=>Math.round(Math.max(0,Math.min(1,n))*255));
  }
  return [rgba];
 };
 return s;
}
export {comparePixels};
