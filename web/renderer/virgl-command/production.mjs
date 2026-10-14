import {qualifyMultisampleStorage} from "./multisample.mjs";
/** Host qualification and the production Linux device. Guest bytes never select this profile. */
import {createVirglProductionBridge} from './control-bridge.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../virgl-shader/standard.mjs';
import {createProductionTransferBackend, createProductionResourceStore} from './resources.mjs';
import {vertexFormat} from './decoder.mjs';
import {byteColorFormat} from './color-images.mjs';
import {floatColorFormat} from './float-images.mjs';
import {packedFloatColorFormat} from './packed-float-images.mjs';
import {sharedExponentColorFormat} from './shared-exponent-images.mjs';
import {integerColorFormat} from './integer-images.mjs';
import {packedNormalizedColorFormat} from './packed-normalized-images.mjs';
import {packedUnsignedColorFormat} from './packed-unsigned-images.mjs';
import {floatingDepthFormat} from './floating-depth-images.mjs';
import {unormDepthFormat, packedDepthFormat} from './unorm-depth-images.mjs';

const unwrap = result => { if (!result?.ok) throw Error(result?.error?.message ?? 'GPU operation failed'); return result; };
const clean = value => JSON.parse(JSON.stringify(value, (_, v) => ArrayBuffer.isView(v) ? [...v] : typeof v === 'bigint' ? v.toString() : v));

export async function qualifyVirglHost(gl) {
  if (!gl || gl.isContextLost()) throw Error('Hardware WebGL2 is unavailable');
  if (!['createQuery','beginQuery','endQuery','getQueryParameter','deleteQuery'].every(name => typeof gl[name] === 'function')) throw Error('Native boolean queries are unavailable');
  if (!gl.getExtension('OES_texture_float_linear')) throw Error('Qualified Mesa requires native floating texture linear filtering');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const identity = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  if (/swiftshader|llvmpipe|softpipe|lavapipe|software rasterizer/i.test(identity)) throw Error('A hardware renderer is required');
  const names = ['MAX_TEXTURE_SIZE','MAX_3D_TEXTURE_SIZE','MAX_CUBE_MAP_TEXTURE_SIZE','MAX_ARRAY_TEXTURE_LAYERS',
    'MAX_VARYING_VECTORS','MAX_VERTEX_ATTRIBS','MAX_UNIFORM_BLOCK_SIZE','UNIFORM_BUFFER_OFFSET_ALIGNMENT',
    'MAX_VERTEX_TEXTURE_IMAGE_UNITS','MAX_TEXTURE_IMAGE_UNITS','MAX_VERTEX_UNIFORM_VECTORS',
    'MAX_FRAGMENT_UNIFORM_VECTORS','MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS','MAX_SAMPLES'];
  const multisample = qualifyMultisampleStorage(gl);
  const hostWords = Uint32Array.from(names.map(name => gl.getParameter(gl[name])));
  const floors = [2048,256,2048,256,16,16,16384,1,16,16,512,512,64,4];
  if (names.some((name, i) => !Number.isInteger(gl.getParameter(gl[name])) || hostWords[i] < floors[i]) ||
      gl.getParameter(gl.MAX_DRAW_BUFFERS) < 4 || gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) < 4 ||
      gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS) < 27 || gl.getParameter(gl.MAX_COMBINED_UNIFORM_BLOCKS) < 27 || gl.getParameter(gl.MAX_VERTEX_UNIFORM_BLOCKS) < 14 ||
      gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS) < 14) throw Error('WebGL2 limits do not meet the selected renderer floor');
  const {backend} = unwrap(createProductionTransferBackend(gl));
  const {store,bindings} = unwrap(createProductionResourceStore({backend}));
  const roles = [], probes = [];
  const programs=new Map(), native=[];
  const framebuffer=gl.createFramebuffer(), output=gl.createTexture(), vao=gl.createVertexArray(), buffer=gl.createBuffer();
  if(!framebuffer||!output||!vao||!buffer)throw Error('GPU qualification allocation failed');
  const destination=(texture,metadata,attachment)=>{
    if(metadata.target===2)gl.framebufferTexture2D(gl.FRAMEBUFFER,attachment,gl.TEXTURE_2D,texture,0);
    else if(metadata.target===4)gl.framebufferTexture2D(gl.FRAMEBUFFER,attachment,gl.TEXTURE_CUBE_MAP_POSITIVE_X,texture,0);
    else gl.framebufferTextureLayer(gl.FRAMEBUFFER,attachment,texture,0,0);
  };
  const samplerProgram=(target,integer,depthSample)=>{
    const key=target+':'+integer+':'+depthSample;if(programs.has(key))return programs.get(key);
    const suffix=({2:'2D',3:'3D',4:'Cube',7:'2DArray'})[target],type=(integer==='sint'?'i':integer==='uint'?'u':'')+'sampler'+suffix;
    const coordinate=target===2?'vec2(0.5)':target===4?'vec3(1,0,0)':target===3?'vec3(0.5)':'vec3(0.5,0.5,0)';
    const program=gl.createProgram(),shaders=[];
    if(!program)throw Error('GPU qualification program allocation failed');
    try {
      for(const [stage,text]of [[gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}'],
        [gl.FRAGMENT_SHADER,`#version 300 es\nprecision highp float;precision highp int;uniform highp ${type} source;out vec4 color;void main(){color=vec4(${depthSample?'float(texture(source,'+coordinate+').r)':"texture(source,"+coordinate+").r!="+(integer==='float'?'0.0':integer==='uint'?'0u':'0')+"?1.0:0.0"},0,0,1);}`]]) {
        const shader=gl.createShader(stage);if(!shader)throw Error('GPU qualification shader allocation failed');shaders.push(shader);gl.shaderSource(shader,text);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));gl.attachShader(program,shader);
      }
      gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      const source=gl.getUniformLocation(program,'source');if(source===null)throw Error('Missing qualification sampler');
      const result={program,source};programs.set(key,result);return result;
    }catch(error){gl.deleteProgram(program);throw error;}finally{for(const shader of shaders)gl.deleteShader(shader);}
  };
  let sync=null; const queryProbes=[];
  try {
    unwrap(store.createContext(1));
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,output);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,1,1);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.bufferData(gl.PIXEL_PACK_BUFFER,65536,gl.STREAM_READ);
    for(const name of ['BLEND','DEPTH_TEST','STENCIL_TEST','SCISSOR_TEST','CULL_FACE','DITHER','RASTERIZER_DISCARD'])gl.disable(gl[name]);
    gl.bindVertexArray(vao);gl.viewport(0,0,1,1);gl.colorMask(true,true,true,true);gl.bindSampler(0,null);
    for (let format = 0; format < 512; format++) {
      const color = byteColorFormat(format) || floatColorFormat(format) || packedFloatColorFormat(format) ||
        sharedExponentColorFormat(format) || integerColorFormat(format) || packedNormalizedColorFormat(format) || packedUnsignedColorFormat(format);
      const depth = floatingDepthFormat(format) || unormDepthFormat(format) || packedDepthFormat(format);
      let mask = vertexFormat(format) ? 8 : 0;
      const expected = depth ? 5 : color ? 1 | (color.render ? 2 : 0) : [2,67,233].includes(format) ? 3 : 0;
      for (const [role, bind] of [[1,8],[2,2],[4,1]]) if (expected & role) {
        let accepted=true;
        for(const target of depth?[2,4,7]:[2,3,4,7]) {
          const metadata={id:1,target,format,bind,width:1,height:1,depth:1,arraySize:target===4?6:1,lastLevel:0,nrSamples:0,flags:0};
          const result=store.createResource(metadata),probe={format,role,target,ok:result.ok,...(!result.ok?{error:result.error}:{})};
          probes.push(probe);if(!result.ok){accepted=false;continue;}
          let lease;
          try {
            unwrap(store.attachContext(1,1));
            lease=unwrap(store.retainStorage(1,1,role===4?'depth-surface':role===2?'surface':'view')).lease;
            const storage=unwrap(bindings.resolve(lease)).storage;
            gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,null,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,null,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.TEXTURE_2D,null,0);
            if(role!==1 || depth) {
              const attachment=depth?(depth.stencil?gl.DEPTH_STENCIL_ATTACHMENT:gl.DEPTH_ATTACHMENT):gl.COLOR_ATTACHMENT0;
              destination(storage.texture,metadata,attachment);gl.drawBuffers(depth?[gl.NONE]:[gl.COLOR_ATTACHMENT0]);gl.readBuffer(depth?gl.NONE:gl.COLOR_ATTACHMENT0);
              if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Qualified role has an incomplete framebuffer');
              if(depth){gl.depthMask(true);if(depth.stencil)gl.clearBufferfi(gl.DEPTH_STENCIL,0,0.25,0);else gl.clearBufferfv(gl.DEPTH,0,new Float32Array([0.25]));}
              else if(color?.integerBits||color?.packedUnsigned){const value=color.signed?new Int32Array([1,0,0,1]):new Uint32Array([1,0,0,1]);gl[color.signed?'clearBufferiv':'clearBufferuiv'](gl.COLOR,0,value);}
              else gl.clearBufferfv(gl.COLOR,0,new Float32Array([0.25,0.5,0.75,1]));
              probe.attachmentComplete=true;probe.cleared=true;
            }
            if(role===1 && !depth) {
              const nativeTarget=({2:gl.TEXTURE_2D,3:gl.TEXTURE_3D,4:gl.TEXTURE_CUBE_MAP,7:gl.TEXTURE_2D_ARRAY})[target];
              const upload=gl[color?.upload??(format===2?'RGB':'RGBA')],type=gl[color?.type??(format===233?'UNSIGNED_INT_2_10_10_10_REV':'UNSIGNED_BYTE')];
              const count=color?.nativePixelBytes??(format===2?3:4);
              let data;
              if(type===gl.FLOAT)data=new Float32Array(count/4).fill(1);
              else if(type===gl.HALF_FLOAT)data=new Uint16Array(count/2).fill(0x3c00);
              else if(type===gl.BYTE)data=new Int8Array(count).fill(127);
              else if(type===gl.SHORT)data=new Int16Array(count/2).fill(1);
              else if(type===gl.INT)data=new Int32Array(count/4).fill(1);
              else if(type===gl.UNSIGNED_BYTE)data=new Uint8Array(count).fill(255);
              else if(type===gl.UNSIGNED_SHORT)data=new Uint16Array(count/2).fill(1);
              else if(type===gl.UNSIGNED_INT)data=new Uint32Array(count/4).fill(1);
              else if(count===2)data=new Uint16Array([0xffff]);
              else data=new Uint32Array([format===125?0x84020100:format===124?0x781e03c0:0xffffffff]);
              gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);gl.bindTexture(nativeTarget,storage.texture);
              if(target===2||target===4)gl.texSubImage2D(target===4?gl.TEXTURE_CUBE_MAP_POSITIVE_X:nativeTarget,0,0,0,1,1,upload,type,data);
              else gl.texSubImage3D(nativeTarget,0,0,0,0,1,1,1,upload,type,data);
              probe.initialized=true;
            }
            gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,null,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.TEXTURE_2D,null,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);
            if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Qualification output framebuffer is incomplete');
            const integer=color?.integerBits||color?.packedUnsigned?color.signed?'sint':'uint':'float';
            const program=samplerProgram(target,integer,Boolean(depth)),nativeTarget=({2:gl.TEXTURE_2D,3:gl.TEXTURE_3D,4:gl.TEXTURE_CUBE_MAP,7:gl.TEXTURE_2D_ARRAY})[target];
            gl.useProgram(program.program);gl.uniform1i(program.source,0);gl.bindTexture(nativeTarget,storage.texture);gl.drawArrays(gl.TRIANGLES,0,3);
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,native.length*4);native.push({probe,expected:depth?64:255});
            probe.sampled=true;
            if(gl.getError()!==gl.NO_ERROR)throw Error('Physical qualification role failed');
          }catch(error){probe.ok=false;probe.error={message:String(error?.message??error)};accepted=false;}
          finally{if(lease)unwrap(store.releaseStorage(lease));unwrap(store.detachContext(1,1));unwrap(store.unref(1));}
        }
        if(accepted)mask|=role;
      }
      if (mask & 6) {
        const metadata={id:1,target:2,format,bind:mask & 4 ? 1 : 2,width:1,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:4,flags:0};
        const result=store.createResource(metadata),probe={format,role:16,target:2,samples:4,ok:result.ok};probes.push(probe);
        if(result.ok) {
          let lease;try {
            unwrap(store.attachContext(1,1));lease=unwrap(store.retainStorage(1,1,mask & 4 ? 'depth-surface':'surface')).lease;
            const storage=unwrap(bindings.resolve(lease)).storage,previous=gl.getParameter(gl.RENDERBUFFER_BINDING);
            gl.bindRenderbuffer(gl.RENDERBUFFER,storage.renderbuffer);probe.nativeSamples=gl.getRenderbufferParameter(gl.RENDERBUFFER,gl.RENDERBUFFER_SAMPLES);gl.bindRenderbuffer(gl.RENDERBUFFER,previous);
            if(probe.nativeSamples !== 4)throw Error('Native format samples disagree');mask|=16;
          }catch(error){probe.ok=false;probe.error={message:String(error.message)};}
          finally{if(lease)unwrap(store.releaseStorage(lease));unwrap(store.detachContext(1,1));unwrap(store.unref(1));}
        }
      }
      if (mask) roles.push(format, mask);
    }
    for (const target of [gl.ANY_SAMPLES_PASSED, gl.ANY_SAMPLES_PASSED_CONSERVATIVE]) {
      const native=gl.createQuery();if(!native)throw Error('Qualification query allocation failed');
      queryProbes.push({target,native});gl.beginQuery(target,native);gl.endQuery(target);
      if(gl.getError()!==gl.NO_ERROR)throw Error('Physical boolean query admission failed');
    }
    sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!sync)throw Error('Qualification fence allocation failed');gl.flush();
    const deadline=performance.now()+5000;
    for(;;){await new Promise(resolve=>setTimeout(resolve,0));const result=gl.clientWaitSync(sync,0,0);if(result===gl.ALREADY_SIGNALED||result===gl.CONDITION_SATISFIED)break;if(result===gl.WAIT_FAILED||performance.now()>deadline)throw Error('Qualification GPU fence failed');}
    const bytes=new Uint8Array(native.length*4);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,bytes);
    for(const [i,entry]of native.entries()){
      entry.probe.pixel=[...bytes.subarray(i*4,i*4+4)];
      if(entry.probe.pixel[0]!==entry.expected||entry.probe.pixel[1]!==0||entry.probe.pixel[2]!==0||entry.probe.pixel[3]!==255)throw Error('Qualification pixel oracle failed: '+JSON.stringify(entry.probe));
    }
    for(const probe of queryProbes) {
      probe.available=gl.getQueryParameter(probe.native,gl.QUERY_RESULT_AVAILABLE);
      if(probe.available!==true)throw Error('Qualification query did not become available');
      probe.result=gl.getQueryParameter(probe.native,gl.QUERY_RESULT);
      if(probe.result!==0)throw Error('Empty physical query did not return zero');
    }
  } finally {
    for(const probe of queryProbes) {gl.deleteQuery(probe.native);delete probe.native;}
    if(sync)gl.deleteSync(sync);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);
    for(const p of programs.values())gl.deleteProgram(p.program);gl.deleteBuffer(buffer);gl.deleteTexture(output);gl.deleteFramebuffer(framebuffer);gl.deleteVertexArray(vao);unwrap(store.dispose());
  }
  // Required formats are qualified physically, rather than inferred from extension strings.
  for (const [format, role] of [[67,3],[64,3],[65,3],[16,5],[18,5],[20,5],[21,5],[126,5],[94,1],[124,1],[125,1],[74,1]]) {
    const found = Array.from({length:roles.length / 2}, (_, i) => roles.slice(i * 2, i * 2 + 2)).find(p => p[0] === format);
    if (!found || (found[1] & role) !== role) throw Error(`Required GPU format ${format} is unavailable`);
  }
  if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) throw Error('GPU qualification failed');
  return Object.freeze({hostWords,formatRoles:Uint32Array.from(roles),identity,
    renderer: 'wasm-vm WebGL2 VirGL',probes,queryProbes,multisample,limits:Object.fromEntries(names.map((name, i) => [name,hostWords[i]]))});
}

/** Bounded retained presentation across the worker/page boundary. */
export function createWorkerScanoutPresenter(send) {
  let generation = '0000000000000000', sequence = 0, disposed = false;
  const frames = new Map(), counters = {queued:0,drawn:0,superseded:0,cancelled:0,failed:0};
  const settle = (entry, status, presentation) => {
    if (!frames.delete(entry.token.sequence)) return;
    counters[status]++; entry.onRetired({token:entry.token,status,...(presentation ? {presentation} : {})});
  };
  return Object.freeze({
    rebind(next) {
      if (disposed || !/^[0-9a-f]{16}$/.test(next) || next <= generation) return {ok:false,error:{code:'invalid-parameter',message:'Stale display binding'}};
      for (const entry of [...frames.values()]) settle(entry,'cancelled');
      generation = next; send({type:'clear'}); return {ok:true};
    },
    enqueueOwned(value,onRetired) {
      if (disposed || value.bindingGeneration !== generation || frames.size >= 2 || typeof onRetired !== 'function') return {ok:false,error:{code:'invalid-parameter',message:'Invalid retained display frame'}};
      const token = Object.freeze({sequence:++sequence,generation}), entry = {token,onRetired};
      frames.set(sequence,entry); counters.queued++;
      try { send({...value.frame,presentationToken:token}); }
      catch (error) { settle(entry,'failed'); return {ok:false,error:{code:'unspecified',message:String(error)}}; }
      return {ok:true,token};
    },
    acknowledge(token,status,presentation) {
      const entry = frames.get(token?.sequence);
      if (!entry || entry.token.generation !== token.generation || !['drawn','superseded','cancelled','failed'].includes(status)) return false;
      settle(entry,status,presentation); return true;
    },
    inspect() { return {disposed,generation,retainedFrames:frames.size,...counters}; },
    readPixels() { return {ok:false,error:{code:'unsupported-feature',message:'Visible pixels belong to the page'}}; },
    dispose() { if (disposed) return {ok:true}; disposed=true; for (const entry of [...frames.values()]) settle(entry,'cancelled'); return {ok:true}; },
  });
}

/** Install only before guest execution. Pumping happens after runChunk releases Machine's borrow. */
export async function attachProductionVirgl(machine, {presenter,onEvent = null,canvas = new OffscreenCanvas(1,1)} = {}) {
  const gl = canvas.getContext('webgl2',{antialias:false,alpha:true,depth:true,stencil:true,failIfMajorPerformanceCaveat:true});
  const qualification = await qualifyVirglHost(gl), shaderBridge = await createVirglStandardStreamOutputShaderBridge();
  const transport = Object.fromEntries(['gatherInput','scatterOutput','gatherLayeredInput','scatterLayeredOutput','complete'].map(name => [name,(...args) => machine[name](...args)]));
  const {bridge} = unwrap(createVirglProductionBridge({gl,shaderBridge,transport,presenter}));
  let lost = false, disposed = false, lastError = null, pendingLoss = false;
  const lose = () => { const extension=gl.getExtension("WEBGL_lose_context"); if(!extension)throw Error("Context loss injection unavailable");extension.loseContext(); };
  canvas.addEventListener('webglcontextlost',event => { event.preventDefault(); if (disposed) return; lost=true; machine.invalidateVirgl(); bridge.dispose(); onEvent?.({type:'context-lost'}); });
  try {
    machine.attachVirgl(qualification.hostWords,qualification.formatRoles,qualification.renderer,event => {
      const result = bridge.apply(event);
      if (onEvent) onEvent({type:'control',event:clean(event),result:clean(result)});
      return result;
    });
  } catch (error) { bridge.dispose(); throw error; }
  onEvent?.({type:'qualified',profile:clean(qualification)});
  return Object.freeze({qualification,
    pump() { if (!disposed && !lost) { const result=bridge.pump(); if (pendingLoss && result.status === "waiting-gpu") { pendingLoss=false; onEvent?.({type:"loss-injected",pending:clean(bridge.inspect().pending)}); lose(); } if (onEvent && result.status !== 'idle' && (result.ok || result.error?.message !== lastError)) onEvent({type:'pump',result:clean(result)}); lastError=result.ok?null:result.error?.message; return result; } return null; },
    loseContext(when="now") { if (!['now','pending'].includes(when) || lost || disposed) throw Error("Invalid context loss injection"); if (when === "pending") pendingLoss=true; else lose(); },
    acknowledge: (...args) => presenter.acknowledge(...args),
    inspect() { return {qualified:!lost && !disposed,lost,profile:clean(qualification),...bridge.inspect()}; },
    dispose() { if (disposed) return; disposed=true; bridge.dispose(); },
  });
}
