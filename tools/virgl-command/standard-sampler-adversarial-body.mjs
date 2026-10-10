// Fresh critic: two independently addressed stages across names, contexts and queued draws.
export async function runAcceptance({fault}={}) {
 const c=checks(),seed=__SEED__>>>0,report={schema:'d19-stage-split-seam-critic-v1',status:'running',guestExecution:false,productionNegotiation:false,predictions:c.rows,frames:[],runs:[],rejections:[],ownership:[],blobs:[],seed};window.__standardSamplerEvidence=report;
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu={renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),version:gl.getParameter(gl.VERSION)};c.same(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu.renderer),false,'physical stage-split seam GPU');
 const bridge=await createVirglStandardUniformShaderBridge(),s=specimen({stage:'both',textureWidth:[3,5,7][seed%3],textureHeight:[3,5][(seed>>>4)%2],scale:2,offset:[-.25-2*((seed>>>3)%3),.25+2*((seed>>>7)%3)],vsCoord:[-3.125-2*((seed>>>11)%2),4.125+2*((seed>>>15)%2)],swizzle:[2,1,0,3],vertexSwizzle:[0,4,5,3]});
 // Original upload bytes are seeded independently of any native read or runtime decoder.
 for(let stage=0;stage<2;stage++)for(let y=0;y<s.textureHeight;y++)for(let x=0;x<s.textureWidth;x++){
  const at=(y*s.textureWidth+x)*4,k=(seed+Math.imul(x+1,67)+Math.imul(y+1,149)+stage*211)>>>0;s.images[stage].set([16+((k>>>1)%14)*16,16+((k>>>5)%14)*16,16+((k>>>9)%14)*16,32+((k>>>13)%12)*16],at);
 }
 const field=(handle,options)=>samplerFields(packets(hex(sampler(handle,options)))[0].words),fa=field(8,{s:0,t:4,r:2,min:0,mip:2,mag:1,compareFunction:seed%8,border:[0x7fc01234,0xffffffff,0x80000000,0xdeadbeef]}),va=field(9,{s:4,t:0,r:4,min:1,mip:1,mag:0,minLod:1,maxLod:3}),fb=field(8,{s:4,t:2,r:0,min:1,mip:0,mag:0,minLod:-3,maxLod:-1}),vb=field(9,{s:2,t:4,r:4,min:0,mip:0,mag:1,minLod:-4,maxLod:-1}),fs=field(8,{s:2,t:0,r:4,min:1,mip:1,mag:0,minLod:.25,maxLod:2}),vs=field(9,{s:0,t:2,r:0,min:0,mip:2,mag:1,minLod:-.5,maxLod:-.25}),replacement=field(8,{s:4,t:0,r:0,min:1,mip:0,mag:0,minLod:-4,maxLod:-2});
 const r=rig(gl,bridge,c,s,{delay:({ordinal})=>1+((Math.imul(seed^ordinal,2654435761)>>>0)%7),step:1,fault});r.frames=report.frames;r.blobs=report.blobs;r.runIndex=0;report.runs.push({});
 const addressed=(index,size,mode)=>mode===2?Math.max(0,Math.min(size-1,index)):mode===0?((index%size)+size)%size:(()=>{const a=((index%(2*size))+2*size)%(2*size);return a<size?a:2*size-1-a;})();
 const lookup=(image,u,v,linear,p,swizzle)=>{
  const texel=(x,y,k)=>image[(addressed(y,s.textureHeight,p.t)*s.textureWidth+addressed(x,s.textureWidth,p.s))*4+k];let rgba;
  if(!linear)rgba=[0,1,2,3].map(k=>texel(Math.floor(u*s.textureWidth),Math.floor(v*s.textureHeight),k));else{
   const a=u*s.textureWidth-.5,b=v*s.textureHeight-.5,x=Math.floor(a),y=Math.floor(b),dx=a-x,dy=b-y;rgba=[0,1,2,3].map(k=>(1-dx)*(1-dy)*texel(x,y,k)+dx*(1-dy)*texel(x+1,y,k)+(1-dx)*dy*texel(x,y+1,k)+dx*dy*texel(x+1,y+1,k));
  }return swizzle.map(k=>k===4?0:k===5?255:rgba[k]);
 };
 const expected=(pair)=>{
  const clamp=(n,p)=>Math.min(p.maxLod,Math.max(p.minLod,n)),lambda=Math.log2(Math.max(2*s.scale*s.textureWidth/s.width,2*s.scale*s.textureHeight/s.height)),vp=pair[0],fp=pair[1],v=lookup(s.images[0],...s.vsCoord,clamp(0,vp)<=0?vp.mag:vp.min,vp,s.vertexSwizzle),pixels=new Uint8Array(s.width*s.height*4);
  for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){
   const coord=[Math.fround(Math.fround((2*(x+.5)/s.width-1)*s.scale)+s.offset[0]),Math.fround(Math.fround((2*(y+.5)/s.height-1)*s.scale)+s.offset[1])],f=lookup(s.images[1],...coord,clamp(lambda,fp)<=0?fp.mag:fp.min,fp,s.swizzle);pixels.set(v.map((n,k)=>Math.round((n+f[k])/2)),(y*s.width+x)*4);
  }return pixels;
 };
 const targetPixels=()=>{
  const previous=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),pack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),alignment=gl.getParameter(gl.PACK_ALIGNMENT),rowLength=gl.getParameter(gl.PACK_ROW_LENGTH),skipPixels=gl.getParameter(gl.PACK_SKIP_PIXELS),skipRows=gl.getParameter(gl.PACK_SKIP_ROWS),fb=gl.createFramebuffer(),raw=new Uint8Array(s.width*s.height*4);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.readPixels(0,0,s.width,s.height,gl.RGBA,gl.UNSIGNED_BYTE,raw);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previous);gl.deleteFramebuffer(fb);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);gl.pixelStorei(gl.PACK_ALIGNMENT,alignment);gl.pixelStorei(gl.PACK_ROW_LENGTH,rowLength);gl.pixelStorei(gl.PACK_SKIP_PIXELS,skipPixels);gl.pixelStorei(gl.PACK_SKIP_ROWS,skipRows);return raw;
 };
 const capture=async(record,pair)=>{
  c.ok(record.result,'original stage-split draw completion');c.same(record.result.gpuComplete,true,'stage-split actual final native fence');const predicted=expected(pair),raw=targetPixels(),native=[];
  for(const call of r.draws.filter(row=>row.label===record.label)){
   const samplers=[],attributes=[];for(const {raw,...info}of call.samplers)samplers.push({...info,texels:await blob(r,raw)});for(const {raw,...info}of call.attributes)attributes.push({...info,storage:await blob(r,raw)});native.push({...call,samplers,attributes});
  }
  const original={...s,positions:hex(s.positions),images:[]};for(const bytes of s.images)original.images.push(await blob(r,bytes));const audit=comparePixels(raw,{defined:true,pixels:predicted}),row={label:record.label,run:0,submission:r.history.length-1,width:s.width,height:s.height,original,parameters:pair,native,dump:record.dump,pixels:await blob(r,raw),expected:await blob(r,predicted),audit};report.frames.push(row);
  c.same(audit.held,true,'independent original stage-split seam pixels after completed fence');c.same(gl.getError(),gl.NO_ERROR,'stage-split no unexpected native error');return row;
 };
 const issue=async(ctx,bytes,label,pair,onYield)=>{r.currentLabel=label;return capture(await submit(r,ctx,bytes,label,onYield),pair);};
 const bothSetup=(fragment,vertex,create=true)=>join(setup(r,s,fragment,{create}),sampler(9,vertex),bind(0,5,9));
 try{
  const first=await issue(1,join(bothSetup(fa,va),draw()),'split-seam-A',[va,fa]);
  await issue(2,join(bothSetup(fb,vb,false),draw()),'split-seam-context-B',[vb,fb]);c.ok(r.renderer.resetCaches(),'reset both-stage sampler caches');
  const poison=gl.createSampler();gl.samplerParameteri(poison,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.samplerParameteri(poison,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.samplerParameteri(poison,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.samplerParameteri(poison,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.bindSampler(0,poison);gl.bindSampler(16,poison);
  const restored=await issue(1,draw(),'split-seam-A-restored',[va,fa]);gl.deleteSampler(poison);
  const ids=f=>Object.fromEntries(f.native.at(-1).samplers.map(n=>[n.name,n.nativeSampler]));c.same(ids(restored),ids(first),'both stages retain exact identities after context poison and cache reset');
  await issue(1,join(packet(29,0,[7]),bothSetup(fs,vs,false),draw()),'split-seam-subcontext',[vs,fs]);const old=await issue(1,join(packet(28,0,[0]),packet(30,0,[7]),draw()),'split-seam-old-subcontext',[va,fa]);c.same(ids(old),ids(first),'subcontext destruction restores original both-stage identities');
  let point=null;const queued=await issue(1,join(draw(),packet(3,7,[8]),sampler(8,replacement),bind(1,6,8),clear([0,0,0,0]),draw(),draw()),'split-seam-queued-replacement',[va,replacement],()=>{const jobs=r.renderer.inspect().jobs;if(jobs.status==='finishing'&&!point)point={renderer:r.renderer.inspect(),resources:r.store.inspect()};});
  c.same(Boolean(point),true,'stage-split replacement waits on actual delayed final fence');c.same(queued.native.length,3,'three actual original queued draws');const named=(call,name)=>call.samplers.find(row=>row.name===name).nativeSampler;c.same(named(queued.native[0],'fssamp0'),ids(first).fssamp0,'first queued FS draw uses original identity');c.same(named(queued.native[1],'fssamp0')!==ids(first).fssamp0,true,'explicit FS replacement has new native identity');c.same(named(queued.native[2],'fssamp0'),named(queued.native[1],'fssamp0'),'later queued FS draw retains replacement');c.same(queued.native.map(call=>named(call,'vssamp0')),[ids(first).vssamp0,ids(first).vssamp0,ids(first).vssamp0],'unmodified VS identity survives FS replacement');report.ownership.push({kind:'queued-stage-split-replacement',point,original:ids(first),replacement:ids(queued)});
  c.ok(r.renderer.resetCaches(),'reset replacement stage caches');gl.bindSampler(0,null);gl.bindSampler(16,null);await issue(2,draw(),'split-seam-context-B-again',[vb,fb]);const last=await issue(1,draw(),'split-seam-replacement-restored',[va,replacement]);c.same(ids(last),ids(queued),'both replacement stage identities restore after context switch');
  r.currentLabel='split-seam-delete';const rejected=await submit(r,1,join(packet(3,7,[8]),draw()),r.currentLabel);c.same(rejected.result.ok,false,'deleted original FS name rejects draw');c.same(r.draws.filter(row=>row.label===r.currentLabel).length,0,'deleted stage-split sampler never draws');report.rejections.push(rejected);
 }finally{finish(r,report);}
 report.status='passed';return report;
}
