// Invert original wire and uploaded bytes; no runtime decoder or compiler.
import {literalState,fromHex} from '../virgl-command/standard-draw-oracle.mjs';
const f=Math.fround;
const cmp=(n,a,b)=>[false,a<b,a===b,a<=b,a>b,a!==b,a>=b,true][n];
const op=(n,s,r)=>[s,0,r,Math.min(255,s+1),Math.max(0,s-1),(s+1)&255,(s-1)&255,s^255][n];
const unpack=w=>({enabled:Boolean(w&1),func:w>>>1&7,fail:w>>>4&7,zpass:w>>>7&7,zfail:w>>>10&7,value:w>>>13&255,write:w>>>21&255});
export function model(history,buffers,{format,width,height,input,clearWords,present=[20,126].includes(format),prefixPasses=null}={}){
 const s=literalState(history),d=s.draw,ctx=history.at(-1).ctx,objects=new Map();
 s.front=unpack(0);s.back=unpack(0);s.refs=[0,0];s.raster=0;s.scissor=[0,0,0,0];s.depth={enabled:false,write:false,func:0};
 for(const row of history.filter(h=>h.ctx===ctx)){const raw=fromHex(row.hex),v=new DataView(raw.buffer);for(let at=0;at<raw.length;){const head=v.getUint32(at,true),kind=head>>>8&255,n=head>>>16,opcode=head&255,w=Array.from({length:n},(_,i)=>v.getUint32(at+4+i*4,true));
  if(opcode===1&&(kind===2||kind===3))objects.set(kind+':'+w[0],w);
  if(opcode===2&&kind===2)s.raster=objects.get('2:'+w[0])[1];
  if(opcode===2&&kind===3){const p=objects.get('3:'+w[0]);s.front=unpack(p[2]);s.back=unpack(p[3]);s.depth={enabled:Boolean(p[1]&1),write:Boolean(p[1]&2),func:p[1]>>>2&7};}
  if(opcode===13)s.refs=[w[0]&255,w[0]>>>8&255];
  if(opcode===15)s.scissor=[w[1]&65535,w[1]>>>16,w[2]&65535,w[2]>>>16];
  if(opcode===4){const fv=new DataView(raw.buffer);s.viewportFields=Array.from({length:6},(_,i)=>fv.getFloat32(at+8+i*4,true));const [sx,sy,,tx,ty]=s.viewportFields;s.viewport=[tx-sx,ty-Math.abs(sy),sx*2,Math.abs(sy)*2];}
  if(opcode===7&&w[0]&4)s.clearWords=w.slice(1,5);
  if(opcode===8)s.restart={enabled:Boolean(w[7]),value:w[8]};
  at+=4*(n+1);
 }}
 if(!s.clearWords)throw Error('original ordered color clear missing');if(clearWords&&JSON.stringify(clearWords)!==JSON.stringify(s.clearWords))throw Error('original color clear words drift');clearWords=s.clearWords;
 const v=id=>{const raw=buffers.get(id);return new DataView(raw.buffer,raw.byteOffset,raw.byteLength);};
 const index=d.indexed?v(s.index.id):null;
 s.ids=Array.from({length:d.count},(_,i)=>!index?d.start+i:s.index.size===1?index.getUint8(s.index.offset+i):s.index.size===2?index.getUint16(s.index.offset+2*i,true):index.getUint32(s.index.offset+4*i,true));
 const marker=id=>d.indexed&&s.restart.enabled&&id===s.restart.value;
 s.segments=[[]];for(const id of s.ids)marker(id)?s.segments.push([]):s.segments.at(-1).push(id);
 const primitives=ids=>d.mode===0?ids.map(id=>[id]):d.mode===1?Array.from({length:Math.floor(ids.length/2)},(_,i)=>ids.slice(i*2,i*2+2)):d.mode===2||d.mode===3?ids.slice(1).map((id,i)=>[ids[i],id]).concat(d.mode===2&&ids.length>=2?[[ids.at(-1),ids[0]]]:[]):d.mode===4?Array.from({length:Math.floor(ids.length/3)},(_,i)=>ids.slice(3*i,3*i+3)):d.mode===5?ids.slice(2).map((id,i)=>i%2?[ids[i+1],ids[i],id]:[ids[i],ids[i+1],id]):ids.slice(2).map((id,i)=>[ids[0],ids[i+1],id]);
 s.primitives=s.segments.flatMap(primitives);
 s.faces=s.front.enabled&&!s.back.enabled?[s.front,s.front]:[s.front,s.back];s.effectiveRefs=s.front.enabled&&!s.back.enabled?[s.refs[0],s.refs[0]]:s.refs;
 const common=s.effectiveRefs[0]===s.effectiveRefs[1]&&s.faces[0].value===s.faces[1].value&&s.faces[0].write===s.faces[1].write;
 s.lowering=present&&(s.front.enabled||s.back.enabled)&&!common?d.mode<=3||(s.raster>>>8&3)===2?'front':'triangles':null;
 s.nativeIds=s.lowering==='triangles'||[2,6].includes(d.mode)?s.primitives.flat():s.ids.map(id=>marker(id)?0xffffffff:id);
 const vertex=s.shaders.get(0),fragment=s.shaders.get(1);
 const expectedBody=['0: MOV OUT[0], IN[0]','1: ADD OUT[0].xy, IN[0], IN[1]','2: MOV OUT[0].z, IMM[0].zzzz','3: I2F TEMP[0].x, SV[1].xxxx','4: SEQ TEMP[0].x, TEMP[0].xxxx, IN[0].zzzz','5: MUL OUT[0].w, TEMP[0].xxxx, IN[0].wwww','6: UMUL TEMP[1].x, SV[1].xxxx, IMM[1].xxxx','7: AND TEMP[1].x, TEMP[1].xxxx, IMM[1].yyyy','8: U2F TEMP[1].x, TEMP[1].xxxx','9: MUL OUT[1].x, TEMP[1].xxxx, IMM[2].xxxx','10: I2F TEMP[0].y, SV[0].xxxx','11: MAD OUT[1].y, TEMP[0].yyyy, IMM[2].yyyy, IN[1].zzzz','12: MOV OUT[1].z, IN[2].zzzz','13: MOV OUT[1].w, IMM[0].wwww','14: END'];
 const instanceUsed=vertex.includes('10: I2F TEMP[0].y, SV[0].xxxx');
 if(!instanceUsed)expectedBody[10]='10: MOV TEMP[0].y, IMM[2].wwww';
 const lines=vertex.trim().split('\n');if(JSON.stringify(lines.slice(-15))!==JSON.stringify(expectedBody)||instanceUsed&&!vertex.includes('DCL SV[0], INSTANCEID')||!vertex.includes('DCL SV[1], VERTEXID')||!vertex.includes('IMM[1] UINT32 {17,255,0,0}')||!vertex.includes('IMM[2] FLT32 {0.00390625,0.0625,1,0}'))throw Error('original ordered vertex source drift');
 s.smooth=fragment.includes('DCL IN[0], GENERIC[0], PERSPECTIVE');if(fragment!==`FRAG\nDCL IN[0], GENERIC[0], ${s.smooth?'PERSPECTIVE':'CONSTANT'}\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n`)throw Error('original ordered fragment drift');
 const read=(attribute,instance,id)=>{const e=s.activeElements[attribute],b=s.buffers[e.buffer],n=b.stride===0?0:e.divisor?Math.floor(instance/e.divisor):id;const at=b.offset+e.sourceOffset+n*b.stride,raw=v(b.id);
  if([8,123,172,173].includes(e.format)){const word=raw.getUint32(at,true);return [0,1,2,3].map(lane=>{const bits=lane===3?2:10,mask=2**bits-1,u=word>>>(lane*10)&mask,signed=(u&(1<<(bits-1)))?u-2**bits:u;return f(e.format===8?u/mask:e.format===123?u:e.format===172?signed:Math.max(-1,signed/(2**(bits-1)-1)));});}
  if(![31,196,200].includes(e.format))throw Error('unrecognized original input format');
  return Array.from({length:4},(_,lane)=>raw.getFloat32(at+4*lane,true));};
 const position=(instance,id)=>{const a=read(0,instance,id),b=read(1,instance,id);if(a[2]!==id||a[3]!==1)throw Error('original physical vertex-ID tag drift');return [s.viewportFields[3]+f(a[0]+b[0])*s.viewportFields[0],s.viewportFields[4]+f(a[1]+b[1])*s.viewportFields[1]];};
 const color=(instance,id)=>[(Math.imul(id,17)&255)/256,f(f((instanceUsed?instance:0)/16)+read(1,instance,id)[2]),read(2,instance,id)[2],1];
 const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
 const bpp=format===126?8:4,so=format===126?4:0,incoming=f(f(s.imm[2]*s.viewportFields[2])+s.viewportFields[5]),iv=new DataView(input.buffer,input.byteOffset,input.byteLength),cv=new DataView(new Uint32Array(clearWords).buffer);
 const raster=[];let passes=0;
 for(let instance=0;instance<s.effective;instance++)for(const ids of s.primitives){const points=ids.map(id=>position(instance,id)),colors=ids.map(id=>color(instance,id)),area=points.length===3?cross(points[0],points[1],points[2]):null,front=points.length<3||area>0!==Boolean(s.raster>>>15&1);
  if(s.lowering==='triangles'){const pass=passes+(front?0:1);passes+=2;if(prefixPasses!==null&&pass>=prefixPasses)continue;}
  if(area===0||(s.raster>>>8&3)===2&&!front)continue;
  raster.push({ids,points,colors,area,side:front?0:1});
 }
 s.pixel=(x,y)=>{const i=y*width+x,z=format===20?(iv.getUint32(i*4,true)>>>8)/0xffffff:format===21?(iv.getUint32(i*4,true)&0xffffff)/0xffffff:iv.getFloat32(i*bpp,true),stencil=present?input[i*bpp+so]:0,clear=Array.from({length:4},(_,k)=>cv.getFloat32(k*4,true));let states=[{color:clear,stencil,depth:z}];
  if(x<s.viewport[0]||x>=s.viewport[0]+s.viewport[2]||y<s.viewport[1]||y>=s.viewport[1]+s.viewport[3]||(s.raster>>>14&1)&&!(s.scissor[0]<=x&&x<s.scissor[2]&&s.scissor[1]<=y&&y<s.scissor[3]))return states;
  const p=[x+.5,y+.5];
  for(const r of raster){let covered=false,optional=false,rgba=r.colors.at(-1);
   if(r.points.length===3){const sign=Math.sign(r.area),edges=[cross(r.points[0],r.points[1],p),cross(r.points[1],r.points[2],p),cross(r.points[2],r.points[0],p)].map(n=>n*sign);covered=edges.every(n=>n>0);optional=!covered&&edges.every(n=>n>=0);
    if(s.smooth){const weights=[cross(r.points[1],r.points[2],p)/r.area,cross(r.points[2],r.points[0],p)/r.area,cross(r.points[0],r.points[1],p)/r.area];rgba=r.colors[0].map((_,lane)=>f(weights.reduce((sum,w,j)=>sum+w*r.colors[j][lane],0)));}
   }else if(r.points.length===1)covered=Math.floor(r.points[0][0])===x&&Math.floor(r.points[0][1])===y;
   else {const [a,b]=r.points;if(a[0]===b[0]&&a[1]===b[1])continue;const along=a[1]===b[1]?0:a[0]===b[0]?1:null;if(along===null)throw Error('original line must be axis aligned');const across=1-along;covered=p[across]===a[across]&&p[along]>Math.min(a[along],b[along])&&p[along]<Math.max(a[along],b[along]);optional=p[across]===a[across]&&(p[along]===a[along]||p[along]===b[along]);if(s.smooth){const t=(p[along]-a[along])/(b[along]-a[along]);rgba=r.colors[0].map((n,lane)=>f((1-t)*n+t*r.colors[1][lane]));}}
   if(!covered&&!optional)continue;
   const next=states.map(prior=>{const selected=s.faces[r.side],reference=s.effectiveRefs[r.side],enabled=present&&(s.front.enabled||s.back.enabled),test=!enabled||cmp(selected.func,reference&selected.value,prior.stencil&selected.value),depth=!s.depth.enabled||cmp(s.depth.func,incoming,prior.depth),pass=test&&depth,n=op(!test?selected.fail:depth?selected.zpass:selected.zfail,prior.stencil,reference);
    return {color:pass?rgba:prior.color,stencil:enabled?(prior.stencil&(~selected.write&255))|(n&selected.write):prior.stencil,depth:pass&&s.depth.enabled&&s.depth.write?incoming:prior.depth};});
   const union=optional?states.concat(next):next;states=[...new Map(union.map(row=>[JSON.stringify(row),row])).values()];
  }return states;
 };
 return s;
}
export function compare(model,color,depth,width,height,format){const cv=new DataView(color.buffer,color.byteOffset,color.byteLength),dv=new DataView(depth.buffer,depth.byteOffset,depth.byteLength),miss=[];for(let i=0;i<width*height;i++){const observed={color:Array.from({length:4},(_,k)=>cv.getUint32(i*16+k*4,true)),stencil:[20,126].includes(format)?depth[width*height*16+i*4]:0,depth:dv.getUint32(i*16,true)},wanted=model.pixel(i%width,Math.floor(i/width)),word=n=>{const a=new DataView(new ArrayBuffer(4));a.setFloat32(0,n,true);return a.getUint32(0,true);};
 if(!wanted.some(row=>row.stencil===observed.stencil&&row.color.every((n,k)=>Math.abs(word(n)-observed.color[k])<=(model.smooth?2:0))&&Math.abs(word(row.depth)-observed.depth)<=([20,21].includes(format)?1:0))&&miss.length<8)miss.push({pixel:i,observed,wanted});
 if(dv.getUint32(i*16+4,true)!==0||dv.getUint32(i*16+8,true)!==0||dv.getUint32(i*16+12,true)!==1||[20,126].includes(format)&&(depth[width*height*16+i*4+1]!==0||depth[width*height*16+i*4+2]!==0||depth[width*height*16+i*4+3]!==0))throw Error('native diagnostic constant lanes drift');
 }return miss;}
