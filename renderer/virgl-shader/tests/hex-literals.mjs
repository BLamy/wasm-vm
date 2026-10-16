import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,texture2d,bindSystemBlocks,digest} from './browser.mjs';
import {SEEDS,groups,carrier,bitplane,getCases,PARTNER_VERTEX,PARTNER_FRAGMENT} from '../../../tools/virgl-hex-literals/cases.mjs';
const require=(v,label)=>{if(!v)throw new Error(label);};
const equal=(a,b,label)=>require(JSON.stringify(a)===JSON.stringify(b),label);
const word=value=>new Uint32Array(new Float32Array([value]).buffer)[0],WIDTH=4;
function monitor(native,report){const live=new Map(),objects=[],ids=new WeakMap();let serial=0;
  const kinds={createShader:'Shader',createProgram:'Program',createBuffer:'Buffer',createTexture:'Texture',createFramebuffer:'Framebuffer',createVertexArray:'VertexArray',createTransformFeedback:'TransformFeedback'};
  const gl=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
    return(...args)=>{const result=value.apply(target,args);
      if(kinds[key]&&result){const id=kinds[key]+':'+(++serial);ids.set(result,id);live.set(id,kinds[key]);objects.push({id,kind:kinds[key],object:result});report.events.push({call:key,id});}
      if(/^delete/.test(key)&&args[0]){live.delete(ids.get(args[0]));report.events.push({call:key,id:ids.get(args[0])});}
      if(['compileShader','linkProgram'].includes(key))report.events.push({call:key,id:ids.get(args[0]),status:key==='compileShader'?target.getShaderParameter(args[0],target.COMPILE_STATUS):target.getProgramParameter(args[0],target.LINK_STATUS)});
      if(key==='shaderSource')report.events.push({call:key,id:ids.get(args[0]),source:args[1]});
      return result;
    };}});
  return{gl,finish(){equal(live.size,0,'all literal GL objects disposed');for(const entry of objects)equal(native['is'+entry.kind](entry.object),false,'physical deletion '+entry.id);report.objects={created:objects.length,live:live.size};}};
}
function positions(seed){let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  return Array.from({length:4},()=>[(next()%191-95)/128,(next()%191-95)/128,.125,1]);
}
// Two normal finite carriers expose all 32 literal bits without transporting a
// NaN or subnormal through a float vertex interface. This equation is independent
// of the emitted shader: low mantissa, then the remaining signed/exponent bits.
const carriers=words=>[...words.map(w=>((w&0x007fffff)|0x3f000000)>>>0),...words.map(w=>((w>>>23)|0x3f000000)>>>0)];
function faultPair(pair,kind){const result=JSON.parse(JSON.stringify(pair));if(!kind)return{result,mutation:null};
  const stage=kind==='fragment'?'fragment':'vertex',needle=kind==='fragment'?'(1u >> (0u & 31u))':'(1u & 8388607u)',replacement=kind==='fragment'?'(0u >> (0u & 31u))':'(2u & 8388607u)';
  const original=result[stage].glsl;require(original.includes(needle),'literal source fault must reach its target');result[stage].glsl=original.replace(needle,replacement);
  return{result,mutation:{kind,stage,needle,replacement,original,served:result[stage].glsl}};
}
async function vertexProbe(gl,bridge,group,values,report,fault){const text=carrier(group.words),pair=bridge.translatePair({vertexText:text,fragmentText:PARTNER_FRAGMENT});require(pair.ok,'canonical carrier pair');
  const changed=faultPair(pair,fault),built=createProgram(gl,changed.result.vertex,changed.result.fragment),program=built.program,buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();require(vao&&feedback&&output,'literal feedback objects');buffers.push(output);
  const record={name:group.name,words:group.words,text,textSha256:await digest(text),pair,mutation:changed.mutation,logs:built.logs,reflection:[],vectors:[]};report.vertices.push(record);
  try{const varyings=['gl_Position','vso_g0','vso_g1'];gl.transformFeedbackVaryings(program,varyings,gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);require(gl.getProgramParameter(program,gl.LINK_STATUS),'literal feedback link');
    for(let i=0;i<3;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.type,info.size],[varyings[i],gl.FLOAT_VEC4,1],'physical literal feedback reflection');record.reflection.push({name:info.name,type:info.type,size:info.size});}
    gl.useProgram(program);gl.bindVertexArray(vao);record.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);const at=gl.getAttribLocation(program,'in_0');require(at>=0,'physical position attribute');gl.disableVertexAttribArray(at);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,48,gl.DYNAMIC_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);gl.enable(gl.RASTERIZER_DISCARD);
    for(const position of values){gl.vertexAttrib4fv(at,new Float32Array(position));const attributes=[...gl.getVertexAttrib(at,gl.CURRENT_VERTEX_ATTRIB)].map(word);equal(attributes,position.map(word),'physical position words');
      const expectedWords=[...position.map(word),...carriers(group.words)],entry={position,attributeWords:attributes,expectedWords};record.vectors.push(entry);
      gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();const raw=new Uint8Array(48);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,raw);equal(gl.getError(),gl.NO_ERROR,'literal feedback GL errors');entry.bytes=[...raw];entry.sha256=await digest(raw);entry.observed=[...new Uint32Array(raw.buffer)];
      for(let lane=0;lane<12;lane++)if(entry.observed[lane]!==expectedWords[lane]){entry.failure={lane,expected:expectedWords[lane],actual:entry.observed[lane]};throw new Error('independent literal word mismatch '+group.name);}
      entry.reconstructed=group.words.map((_,lane)=>(((entry.observed[8+lane]&0x1ff)<<23)|(entry.observed[4+lane]&0x7fffff))>>>0);equal(entry.reconstructed,group.words,'all 32 physical literal bits');entry.checkedWords=12;
    }
  }finally{gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);for(const b of buffers)gl.deleteBuffer(b);gl.deleteProgram(program);}
}
async function fragmentProbe(gl,bridge,test,report,fault){const pair=bridge.translatePair({vertexText:PARTNER_VERTEX,fragmentText:test.text});require(pair.ok,'literal fragment pair');const changed=faultPair(pair,fault),built=createProgram(gl,changed.result.vertex,changed.result.fragment),program=built.program,buffers=[],textures=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer();require(vao&&fb,'literal fragment objects');
  const record={...test,textSha256:await digest(test.text),pair,mutation:changed.mutation,logs:built.logs,expectedBytes:test.expectedBytes,checkedPixels:0};report.fragments.push(record);
  try{gl.useProgram(program);gl.bindVertexArray(vao);record.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
    const mesh=gl.createBuffer();require(mesh,'literal mesh');buffers.push(mesh);gl.bindBuffer(gl.ARRAY_BUFFER,mesh);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]),gl.STATIC_DRAW);const at=gl.getAttribLocation(program,'in_0');require(at>=0,'literal position binding');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,4,gl.FLOAT,false,16,0);
    const target=texture2d(gl,WIDTH,WIDTH,null);textures.push(target);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'literal RGBA8 framebuffer');for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST])gl.disable(cap);gl.viewport(0,0,WIDTH,WIDTH);gl.colorMask(true,true,true,true);
    gl.clearColor(.1,.2,.3,.4);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);const raw=new Uint8Array(WIDTH*WIDTH*4);gl.readPixels(0,0,WIDTH,WIDTH,gl.RGBA,gl.UNSIGNED_BYTE,raw);equal(gl.getError(),gl.NO_ERROR,'literal physical pixel readback');record.rgbaBytes=[...raw];record.sha256=await digest(raw);
    for(let pixel=0;pixel<WIDTH*WIDTH;pixel++){const actual=[...raw.slice(pixel*4,pixel*4+4)];if(actual.some((v,lane)=>Math.abs(v-test.expectedBytes[lane])>(test.budget??0))){record.failure={pixel,expected:test.expectedBytes,actual};throw new Error('independent literal pixel mismatch '+test.name);}record.checkedPixels++;}
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);for(const t of textures)gl.deleteTexture(t);for(const b of buffers)gl.deleteBuffer(b);gl.deleteProgram(program);}
}
export async function runAcceptance({seed=SEEDS[0],fault=null}={}){const report={schema:'virgl-hex-literals-gpu-v1',status:'running',guestExecution:false,productionNegotiation:false,seed,fault,vertices:[],fragments:[],events:[]};window.__virglHexLiteralsReport=report;
  const canvas=document.querySelector('#gpu');canvas.width=canvas.height=WIDTH;const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(native instanceof WebGL2RenderingContext,'actual WebGL2');const debug=native.getExtension('WEBGL_debug_renderer_info');require(debug,'physical renderer identity');report.renderer={vendor:native.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:native.getParameter(debug.UNMASKED_RENDERER_WEBGL),version:native.getParameter(native.VERSION)};require(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer.renderer),'physical GPU');const watched=monitor(native,report),gl=watched.gl;
  try{const bridge=await createVirglShaderBridge();
    if(fault!=='fragment')for(const g of groups(seed))await vertexProbe(gl,bridge,g,positions(seed),report,fault==='vertex'&&g.name==='edge-0'?'vertex':null);
    for(const g of groups(seed,false).slice(0,10))for(let plane=0;plane<32;plane++)await fragmentProbe(gl,bridge,{name:g.name+'-plane-'+plane,words:g.words,plane,text:bitplane(g.words,plane),expectedBytes:g.words.map(w=>((w>>>plane)&1)*255)},report,fault==='fragment'&&g.name==='edge-0'&&plane===0?'fragment':null);
    for(const c of getCases().filter(c=>c.name.startsWith('legacy-'))){for(const [suffix,text] of [['hex-or-decimal',c.text],['uint32',c.equivalent]])await fragmentProbe(gl,bridge,{name:c.name+'-'+suffix,text,expectedBytes:[0,64,128,255],budget:1},report,null);}
    require(!fault,'literal source fault must fail its independent oracle');report.checkedWords=report.vertices.reduce((n,v)=>n+v.vectors.reduce((n,x)=>n+x.checkedWords,0),0);report.checkedPixels=report.fragments.reduce((n,f)=>n+f.checkedPixels,0);report.status='passed';document.querySelector('#status').textContent=`${report.checkedWords} exact carrier words · ${report.checkedPixels} pixels · all exponent classes · exceptional bits stay private`;document.querySelector('#renderer').textContent=report.renderer.renderer;
  }catch(error){report.status='failed';report.failure={message:error.message};throw error;}finally{watched.finish();equal(gl.getError(),gl.NO_ERROR,'final literal GL errors');}return report;
}
