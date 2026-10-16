import {createVirglStandardDimensionalShadowTextureShaderBridge} from '../standard.mjs';
import {createProgram,digest} from './browser.mjs';
import {comparisonFixtures,inputBytes,expectedWords,textureInputs,maskValues,addValues} from '../../../tools/virgl-dimensional-shadow-shaders/fixtures.mjs';
const need=(value,message)=>{if(!value)throw Error(message);};
const same=(a,b,message)=>need(JSON.stringify(a)===JSON.stringify(b),message);
function encoded(bytes){let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);}
function captureGL(native,report){
 const handles=new WeakMap(),methods=new Map(),bodies=[];let next=1;
 const encode=value=>{
  if(ArrayBuffer.isView(value)||value instanceof ArrayBuffer){const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength),key='native-bytes-'+bodies.length;bodies.push({key,kind:'complete-native-call-bytes',bytes:bytes.slice()});return {key,type:value.constructor.name,byteLength:bytes.byteLength};}
  if(Array.isArray(value))return value.map(encode);
  if(value&&typeof value==='object'){if(!handles.has(value))handles.set(value,next++);return {handle:handles.get(value),type:value.constructor.name};}
  return value===undefined?{undefined:true}:value;
 };
 const gl=new Proxy(native,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;if(!methods.has(name))methods.set(name,(...args)=>{
  const event={id:report.events.length,method:name,args:args.map(encode)};report.events.push(event);
  try{const result=value.apply(target,args);event.result=encode(result);if(['readPixels','getBufferSubData'].includes(name))event.after=args.map(encode);return result;}catch(error){event.error=String(error);throw error;}
 });return methods.get(name);}});
 return {gl,bodies};
}
async function saveBodies(report,bodies){
 for(const body of bodies){const bytes=body.bytes,zipped=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());report.blobs.push({key:body.key,kind:body.kind,bytes:bytes.length,sha256:await digest(bytes),gzipSha256:await digest(zipped),gzipBase64:encoded(zipped)});}
}
async function complete(gl,frame,report){
 const writer=report.events.filter(e=>/^draw(?:Arrays|Elements)(?:Instanced)?$/.test(e.method)).at(-1);need(writer,'actual preceding native writer');
 const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);need(sync,'native completion object');const created=report.events.at(-1),start=performance.now();gl.flush();let status,waits=0;
 do{status=gl.clientWaitSync(sync,0,0);waits++;need(performance.now()-start<20000,'native fence deadline');if(status===gl.TIMEOUT_EXPIRED)await new Promise(resolve=>setTimeout(resolve,1));}while(status===gl.TIMEOUT_EXPIRED);
 need(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED,'native fence consumed');const consumed=report.events.at(-1);gl.deleteSync(sync);
 frame.gpuComplete={fenced:true,status,waits,writerEvent:writer.id,createdEvent:created.id,consumedEvent:consumed.id,handle:created.result.handle};
}
function upload(gl,target,bytes,buffers){
 const buffer=gl.createBuffer();need(buffer,'native buffer');buffers.push(buffer);gl.bindBuffer(target,buffer);gl.bufferData(target,bytes,gl.STATIC_DRAW);const copied=new Uint8Array(bytes.length);gl.getBufferSubData(target,0,copied);same([...copied],[...bytes],'whole original native buffer');return buffer;
}
function bindBlock(gl,program,buffers,frame){
 const index=gl.getUniformBlockIndex(program,'VirglBlock');need(index!==gl.INVALID_INDEX,'original VirglBlock');
 const size=gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_DATA_SIZE),member=gl.getUniformIndices(program,['winsys_adjust_y'])[0];
 const offset=gl.getActiveUniforms(program,[member],gl.UNIFORM_OFFSET)[0],type=gl.getActiveUniforms(program,[member],gl.UNIFORM_TYPE)[0];
 need(size===656&&offset===640&&type===gl.FLOAT,'unchanged original coordinate block');
 const bytes=new Uint8Array(656);new DataView(bytes.buffer).setFloat32(640,1,true);upload(gl,gl.UNIFORM_BUFFER,bytes,buffers);gl.uniformBlockBinding(program,index,0);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,buffers.at(-1));
 frame.block={index,size,offset,type};
 const point=gl.getUniformLocation(program,'wv_point_size');need(point!==null,'native point size');gl.uniform2f(point,1,0);
}
function controls(gl,program,pair,f,frame){
 const types={samplerCubeShadow:36293,sampler2DArrayShadow:36292,samplerCube:35680,sampler2DArray:36289,int:5124,vec4:35666};frame.uniforms=[];
 for(const [stage,body]of [['vertex',pair.vertex],['fragment',pair.fragment]])for(const record of [...body.metadata.samplers,...body.metadata.textureQueries,...body.metadata.shadowUniforms]){
  const location=gl.getUniformLocation(program,record.name),index=gl.getUniformIndices(program,[record.name])[0];
  if(location===null&&record.type.includes('sampler')&&f.opcode==='TXQ'&&f.mask==='w'){frame.uniforms.push({stage,...record,active:false,reason:'Original w-only query exports separately owned levels only.'});continue;}
  need(location!==null&&index!==gl.INVALID_INDEX,'active comparison uniform '+record.name);
  const type=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0],size=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0],initial=gl.getUniform(program,location);
  need(type===types[record.type]&&size===1,'literal native comparison type '+record.name);
  let value;
  if(record.type==='vec4'){same(Array.from(initial),[0,0,0,0],'initial comparison controls');value=record.semantic==='SHADOW_MASK'?maskValues:addValues;gl.uniform4fv(location,new Float32Array(value));same(Array.from(gl.getUniform(program,location)),value,'literal original comparison controls');}
  else{need(initial===0,'initial comparison/query unit');value=record.type==='int'?3-(f.baseLevel??0):8;gl.uniform1i(location,value);need(gl.getUniform(program,location)===value,'original comparison/query binding');}
  frame.uniforms.push({stage,...record,active:true,index,type,size,initial:record.type==='vec4'?Array.from(initial):initial,value});
 }
}
async function draw(gl, bridge, f, lookup, report, bodies, fault) {
  const request = {vertexText: f.vertexText, fragmentText: f.fragmentText, ...f.selectors};
  const pair = bridge.translatePairImages(request), row = lookup.get(JSON.stringify([f.vertexText, f.fragmentText, f.selectors]));
  need(pair.ok && row, 'actual original dimensional pair'); same(pair, row.result, 'native/Wasm/browser whole pair');
  const bytes = inputBytes(f), levels = textureInputs(f), built = createProgram(gl, pair.vertex, pair.fragment), program = built.program;
  const buffers = [], textures = [], vao = gl.createVertexArray(), fb = gl.createFramebuffer(); need(vao && fb, 'native dimension objects');
  const target = f.target === 'CUBE' ? gl.TEXTURE_CUBE_MAP : gl.TEXTURE_2D_ARRAY;
  const frame = {...f, width: bytes.width, height: bytes.height, nativeIndex: row.index, pair, logs: built.logs, firstEvent: report.events.length}; report.frames.push(frame);
  for (const [name, data] of Object.entries(bytes)) if (data instanceof Uint8Array) {
    const key = 'original-' + report.frames.length + '-' + name; bodies.push({key, kind: 'original-input', bytes: data.slice()}); (frame.originalInputs ??= {})[name] = key;
  }
  try {
    gl.useProgram(program); gl.bindVertexArray(vao); bindBlock(gl, program, buffers, frame); controls(gl, program, pair, f, frame);
    frame.attributes = [];
    for (const [index, data] of [[0, bytes.positions], [1, bytes.coordinates], [2, bytes.dx], [3, bytes.dy]]) {
      const location = gl.getAttribLocation(program, 'in_' + index); frame.attributes.push({index, location}); if (location < 0) continue;
      upload(gl, gl.ARRAY_BUFFER, data, buffers); gl.enableVertexAttribArray(location);
      if (f.selectors.unsignedMask & (1 << index)) gl.vertexAttribIPointer(location, 4, gl.UNSIGNED_INT, 0, 0);
      else gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0);
    }
    const texture = gl.createTexture(); need(texture, 'original dimensional texture'); textures.push(texture); gl.activeTexture(gl.TEXTURE0 + 8); gl.bindTexture(target, texture);
    const format = gl.DEPTH_COMPONENT32F;
    const external = gl.DEPTH_COMPONENT, scalar = gl.FLOAT;
    const Constructor = Float32Array;
    if (target === gl.TEXTURE_CUBE_MAP) gl.texStorage2D(target, 3, format, 4, 4); else gl.texStorage3D(target, 3, format, 4, 4, levels[0].layers);
    gl.texParameteri(target, gl.TEXTURE_BASE_LEVEL, f.baseLevel??0); gl.texParameteri(target, gl.TEXTURE_MAX_LEVEL, 2);
    const sampledBody=pair[f.stage],shadow=sampledBody.metadata.samplers.some(s=>s.type.includes('Shadow'));gl.texParameteri(target,gl.TEXTURE_COMPARE_MODE,shadow?gl.COMPARE_REF_TO_TEXTURE:gl.NONE);gl.texParameteri(target,gl.TEXTURE_COMPARE_FUNC,gl.LEQUAL);
    for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(target, name, value);
    frame.levels = [];
    for (const level of levels) {
      const key = 'original-' + report.frames.length + '-level' + level.level;
      bodies.push({key, kind: 'original-dimensional-texture', bytes: level.bytes.slice()});
      let actual = level.bytes;
      if (fault) {
        need(target === gl.TEXTURE_2D_ARRAY, 'physical layer sabotage target'); actual = level.bytes.slice();
        const plane = level.width * level.height * 4;
        actual.set(level.bytes.subarray((level.layers - 1) * plane), 0); actual.set(level.bytes.subarray(0, plane), (level.layers - 1) * plane);
        frame.corruption = {fault, swappedLayers: [0, level.layers - 1], originalBytesKey: key};
      }
      const uploads = [];
      if (target === gl.TEXTURE_CUBE_MAP) for (let face = 0; face < 6; face++) {
        const plane = level.width * level.height * 4, body = actual.slice(face * plane, (face + 1) * plane);
        gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, level.level, 0, 0, level.width, level.height, external, scalar, new Constructor(body.buffer)); uploads.push(report.events.at(-1).id);
      } else { gl.texSubImage3D(target, level.level, 0, 0, 0, level.width, level.height, level.layers, external, scalar, new Constructor(actual.buffer)); uploads.push(report.events.at(-1).id); }
      frame.levels.push({level: level.level, width: level.width, height: level.height, layers: level.layers, originalBytesKey: key, uploadEvents: uploads});
    }
    const output = gl.createTexture(); need(output, 'raw output texture'); textures.push(output); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, output); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, bytes.width, bytes.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0]); need(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, 'raw dimensional framebuffer');
    for (const cap of [gl.DITHER, gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST, gl.RASTERIZER_DISCARD]) gl.disable(cap);
    gl.viewport(0, 0, bytes.width, bytes.height); gl.colorMask(true, true, true, true); gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array([123, 123, 123, 123]));
    gl.drawArrays(f.biasProbe ? gl.TRIANGLES : gl.POINTS, 0, bytes.vertices); need(gl.getError() === gl.NO_ERROR, 'valid original dimensional writer');
    await complete(gl, frame, report);
    const pixels = new Uint32Array(bytes.width * bytes.height * 4); gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, bytes.width, bytes.height, gl.RGBA_INTEGER, gl.UNSIGNED_INT, pixels); need(gl.getError() === gl.NO_ERROR, 'whole raw dimensional output');
    const event = report.events.findLast(e => e.method === 'readPixels'); frame.output = {readEvent: event.id, bytesKey: event.after.at(-1).key};
    const expected = new Uint32Array(pixels.length), misses = [];
    for (let y = 0; y < bytes.height; y++) for (let x = 0; x < bytes.width; x++) {
      const words = expectedWords(f, x, y); expected.set(words, (y * bytes.width + x) * 4);
      for (let lane = 0; lane < 4; lane++) if (pixels[(y * bytes.width + x) * 4 + lane] !== words[lane] && misses.length < 24) misses.push({x, y, lane, expected: words[lane], actual: pixels[(y * bytes.width + x) * 4 + lane]});
    }
    const key = 'oracle-' + report.frames.length; bodies.push({key, kind: 'complete-independent-oracle', bytes: new Uint8Array(expected.buffer)});
    frame.audit = {held: misses.length === 0, checkedWords: pixels.length, expectedBytesKey: key, misses}; need(frame.audit.held, f.name + ' original mip/layer words ' + JSON.stringify(misses));
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null); gl.useProgram(null); gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, null); gl.bindBuffer(gl.UNIFORM_BUFFER, null); gl.bindBuffer(gl.ARRAY_BUFFER, null); gl.activeTexture(gl.TEXTURE0 + 8); gl.bindTexture(target, null); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
    for (const b of buffers) gl.deleteBuffer(b); for (const t of textures) gl.deleteTexture(t); gl.deleteFramebuffer(fb); gl.deleteVertexArray(vao); gl.deleteProgram(program);
    frame.cleaned = buffers.every(h => !gl.isBuffer(h)) && textures.every(h => !gl.isTexture(h)) && !gl.isFramebuffer(fb) && !gl.isVertexArray(vao) && !gl.isProgram(program); need(frame.cleaned, 'all dimensional native owners retired'); frame.lastEvent = report.events.length - 1;
  }
}
export async function runAcceptance(options){
 const report={schema:'original-dimensional-shadow-native-v1',status:'running',guestExecution:false,productionNegotiation:false,seed:options.seed,frames:[],events:[],blobs:[]};window.__dimensionalShadowReport=report;let bodies=[];
 try{
  const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;document.querySelector('#draws').append(canvas);const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});need(native instanceof WebGL2RenderingContext,'actual WebGL2');
  const capture=captureGL(native,report),gl=capture.gl;bodies=capture.bodies;const info=gl.getExtension('WEBGL_debug_renderer_info');report.gl={renderer:gl.getParameter(info.UNMASKED_RENDERER_WEBGL),version:gl.getParameter(gl.VERSION)};need(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/i.test(report.gl.renderer),'headed M4 Max Metal');
  const cases=(await(await fetch(options.matrixPath)).json()).cases,rows=(await(await fetch(options.nativePath)).text()).trim().split('\n').map(JSON.parse);need(cases.length===rows.length,'complete original compiler matrix');const lookup=new Map();
  for(const [i,c]of cases.entries())if(c.kind===45&&rows[i].result.ok)lookup.set(JSON.stringify([c.a,c.b,c.selectors]),{index:i,result:rows[i].result});
  const bridge=await createVirglStandardDimensionalShadowTextureShaderBridge();let fixtures=comparisonFixtures().map(f=>({...f,seed:options.seed})),schedule=options.seed>>>0;
  if(options.fault)fixtures=fixtures.filter(f=>f.stage==='vertex'&&f.target==='2D_ARRAY'&&f.opcode==='TEX'&&f.slot===7&&!f.explicit&&!f.label);
  else for(let i=fixtures.length-1;i>0;i--){schedule=(Math.imul(schedule,1664525)+1013904223)>>>0;const j=schedule%(i+1);[fixtures[i],fixtures[j]]=[fixtures[j],fixtures[i]];}
  need(fixtures.length>0,'nonempty native comparison matrix');
  for(const f of fixtures){if((schedule&3)===0)await new Promise(resolve=>setTimeout(resolve,1));schedule=(Math.imul(schedule,1664525)+1013904223)>>>0;await draw(gl,bridge,f,lookup,report,bodies,options.fault);}
  need(gl.getError()===gl.NO_ERROR,'zero final GL errors');report.status='passed';document.querySelector('#status').textContent=fixtures.length+' original comparison raw planes passed';
 }catch(error){report.status='failed';report.error=error.stack??String(error);document.querySelector('#status').textContent='Original comparison proof failed';}
 await saveBodies(report,bodies);return report;
}
