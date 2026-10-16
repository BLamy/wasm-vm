/** Independent GLES3.0 sections3.8.10/11 and literal Gallium enum oracle. */
export function packets(hex){
 const raw=Uint8Array.from(hex.match(/../g)??[],x=>parseInt(x,16)),view=new DataView(raw.buffer),out=[];
 for(let at=0;at<raw.length;){const header=view.getUint32(at,true),length=header>>>16,end=at+4*(length+1);if(end>raw.length)throw Error('original packet truncation');out.push({op:header&255,kind:header>>>8&255,words:Array.from({length},(_,i)=>view.getUint32(at+4*(i+1),true))});at=end;}
 return out;
}
export const float=n=>{const v=new DataView(new ArrayBuffer(4));v.setUint32(0,n,true);return v.getFloat32(0,true);};
export function samplerFields(w){
 const b=w[1];return{handle:w[0],s:b&7,t:b>>>3&7,r:b>>>6&7,min:b>>>9&1,mip:b>>>11&3,mag:b>>>13&1,compare:b>>>15&1,compareFunction:b>>>16&7,seamless:Boolean(b&1<<19),anisotropy:b>>>20&31,bias:float(w[2]),minLod:float(w[3]),maxLod:float(w[4]),border:w.slice(5)};
}
export function nativeParameters(p){
 const address={0:10497,2:33071,4:33648},minimum=[[9984,9986,9728],[9985,9987,9729]];
 return{wrapS:address[p.s],wrapT:address[p.t],wrapR:address[p.r],minFilter:minimum[p.min][p.mip],magFilter:9728+p.mag,compareMode:0,compareFunction:512+p.compareFunction,minLod:p.minLod,maxLod:p.maxLod};
}
// GL_NEVER is 0x0200=512. No product tables are used here.
export function wrap(index,size,mode){
 if(mode===2)return Math.min(size-1,Math.max(0,index));
 if(mode===0)return index-size*Math.floor(index/size);
 if(mode===4){const n=index-2*size*Math.floor(index/(2*size));return n<size?n:2*size-1-n;}
 throw Error('unqualified original address enum');
}
export function sample(bytes,width,height,u,v,linear,p,swizzle){
 const texel=(x,y)=>Array.from(bytes.slice((wrap(y,height,p.t)*width+wrap(x,width,p.s))*4,(wrap(y,height,p.t)*width+wrap(x,width,p.s))*4+4));
 let color;if(!linear)color=texel(Math.floor(u*width),Math.floor(v*height));else{
  const x=u*width-.5,y=v*height-.5,i=Math.floor(x),j=Math.floor(y),a=x-i,b=y-j,neighbors=[texel(i,j),texel(i+1,j),texel(i,j+1),texel(i+1,j+1)];
  color=[0,1,2,3].map(k=>(1-a)*(1-b)*neighbors[0][k]+a*(1-b)*neighbors[1][k]+(1-a)*b*neighbors[2][k]+a*b*neighbors[3][k]);
 }
 return swizzle.map(lane=>lane===4?0:lane===5?255:color[lane]);
}
export function samplingModel(s,p,images=s.images){
 if(p.minLod>p.maxLod)return{defined:false,reason:'GLES3.0 equation3.18 leaves reversed bounds undefined'};
 const lambda=Math.log2(Math.max(2*s.scale*s.textureWidth/s.width,2*s.scale*s.textureHeight/s.height)),clamp=n=>Math.min(p.maxLod,Math.max(p.minLod,n)),fragmentFilter=clamp(lambda)<=0?p.mag:p.min;
 // Non-fragment implicit lookup uses base LOD zero before sampler clamps.
 const vertexFilter=clamp(0)<=0?p.mag:p.min,vertex=s.stage==='fragment'?null:sample(images[0],s.textureWidth,s.textureHeight,...s.vsCoord,vertexFilter,p,s.vertexSwizzle),pixels=new Uint8Array(s.width*s.height*4);
 for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
  const coord=[Math.fround(Math.fround((2*(x+.5)/s.width-1)*s.scale)+s.offset[0]),Math.fround(Math.fround((2*(y+.5)/s.height-1)*s.scale)+s.offset[1])],fragment=s.stage==='vertex'?null:sample(images[1],s.textureWidth,s.textureHeight,...coord,fragmentFilter,p,s.swizzle);
  const color=s.stage==='fragment'?fragment:s.stage==='vertex'?vertex:vertex.map((n,k)=>(n+fragment[k])/2);
  pixels.set(color.map(n=>Math.max(0,Math.min(255,Math.round(n)))),(y*s.width+x)*4);
 }
 return{defined:true,lambda,clampedLambda:clamp(lambda),fragmentFilter,vertexFilter,pixels};
}
export function comparePixels(observed,model){
 const misses=[];if(!model.defined)return{held:null,misses,defined:false};
 for(let i=0;i<observed.length;i++)if(Math.abs(observed[i]-model.pixels[i])>1){misses.push({at:i,observed:observed[i],predicted:model.pixels[i]});if(misses.length>=16)break;}
 return{defined:true,held:misses.length===0,misses};
}
export function configuration(vertex,fragment){
 const immediate=index=>{
  const match=vertex.match(new RegExp('IMM\\['+index+'\\] FLT32 \\{([^}]+)\\}'));if(!match)throw Error('missing original coordinate immediate');return match[1].split(',').map(n=>Math.fround(Number(n.trim())));
 },vs=vertex.includes('TEX OUT[2]'),fs=fragment.includes('TEX '),a=immediate(0),b=immediate(1),d=immediate(2);
 if(a[0]!==a[1]||!a.slice(2).every(n=>n===0)||!b.slice(2).every(n=>n===0)||!d.slice(2).every(n=>n===0))throw Error('original coordinate shape outside oracle');
 return{stage:vs?fs?'both':'vertex':'fragment',scale:a[0],offset:b.slice(0,2),vsCoord:d.slice(0,2)};
}
export function originalDraws(run,through){
 const contexts=new Map(),draws=[];
 const sub=()=>({objects:new Map(),shaders:[null,null],views:[[],[]],samplers:[[],[]]});
 function state(id){if(!contexts.has(id))contexts.set(id,{current:0,subs:new Map([[0,sub()]])});return contexts.get(id);}
 for(let i=0;i<=through;i++){
  const record=run.history[i],ctx=state(record.ctx);
  for(const p of packets(record.hex)){
   const w=p.words,s=ctx.subs.get(ctx.current);
   if(p.op===1){
    const object={kind:p.kind,handle:w[0]};
    if(p.kind===7)object.fields=samplerFields(w);
    if(p.kind===6)object.fields={resource:w[1],format:w[2]&0xffffff,target:w[2]>>>24,swizzle:Array.from({length:4},(_,lane)=>w[5]>>>(3*lane)&7)};
    if(p.kind===4){const raw=new Uint8Array((w.length-5)*4),v=new DataView(raw.buffer);w.slice(5).forEach((n,k)=>v.setUint32(k*4,n,true));object.text=new TextDecoder().decode(raw.subarray(0,w[2]-1));object.stage=w[1];}
    s.objects.set(w[0],object);
   }else if(p.op===3){const object=s.objects.get(w[0]);if(object?.kind===7)for(const slots of s.samplers)for(let k=0;k<slots.length;k++)if(slots[k]===object)slots[k]=null;s.objects.delete(w[0]);}
   else if(p.op===10||p.op===18){const slots=p.op===10?s.views:s.samplers;w.slice(2).forEach((h,k)=>slots[w[0]][w[1]+k]=h?s.objects.get(h):null);}
   else if(p.op===31)s.shaders[w[1]]=s.objects.get(w[0]);
   else if(p.op===29){ctx.subs.set(w[0],sub());ctx.current=w[0];}
   else if(p.op===28)ctx.current=w[0];
   else if(p.op===30){ctx.subs.delete(w[0]);if(ctx.current===w[0])ctx.current=0;}
   else if(p.op===8){
    const vertex=s.shaders[0].text,fragment=s.shaders[1].text,config=configuration(vertex,fragment),sampling=[];
    for(const stage of [0,1])if(stage===0?config.stage!=='fragment':config.stage!=='vertex')sampling.push({stage,unit:stage?0:16,name:stage?'fssamp0':'vssamp0',view:s.views[stage][0]?.fields,sampler:s.samplers[stage][0]?.fields});
    draws.push({record:i,words:w,vertex,fragment,config,sampling});
   }
  }
 }
 return draws;
}
