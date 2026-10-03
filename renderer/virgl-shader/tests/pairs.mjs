// E6-T12e2: immutable captured text, derived interfaces, and independent pixels.
import { createVirglShaderBridge, LIMITS } from '../index.mjs';
import { ORIGINAL_INPUTS } from './components.mjs';
import { createProgram, bindSystemBlocks, texture2d, digest } from './browser.mjs';
export { digest };
export const require = (condition, message) => { if (!condition) throw new Error(message); };
export const equal = (a, b, label) => require(JSON.stringify(a) === JSON.stringify(b), `${label}: expected ${JSON.stringify(b)}, observed ${JSON.stringify(a)}`);
export const ok = (value, label) => { require(value?.ok === true, `${label}: ${JSON.stringify(value)}`); return value; };
export const FLAT_HASH = '67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa';
export const FLAT_KEY = 'generic-interpolation-v1:g0/15/flat';
export const SMOOTH_KEY = 'generic-interpolation-v1:g0/15/smooth';
export const POSITIONS = [-1,-1, 1,-1, -1,1];
export const COLORS = [0,0, 1,0, 0,1];
export const MIXED_VERTEX = `VERT
DCL IN[0]
DCL IN[1]
DCL IN[2]
DCL OUT[0], POSITION
DCL OUT[1], GENERIC[1]
DCL OUT[2], GENERIC[0]
MOV OUT[0], IN[0]
MOV OUT[1], IN[1]
MOV OUT[2], IN[2]
END
`;
export const MIXED_FRAGMENT = `FRAG
DCL IN[0], GENERIC[1], PERSPECTIVE
DCL IN[1], GENERIC[0], CONSTANT
DCL OUT[0], COLOR
IMM[0] FLT32 {0, 0, 0, 1}
MOV OUT[0].x, IN[1].xxxx
MOV OUT[0].y, IN[0].yyyy
MOV OUT[0].z, IMM[0].zzzz
MOV OUT[0].w, IMM[0].wwww
END
`;
// ES3.0.6 §2.17, Table2.12 (printed p92): the third submitted vertex of an
// independent triangle supplies flat outputs. §3.6.1 samples smooth values at
// pixel centers. https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf
// These literal bytes derive from barycentric coordinates (x+.5)/32,(y+.5)/32,
// independently of converter output, renderer metadata, or observed pixels.
const SAMPLES = [[4,4,36,36],[12,4,100,36],[20,4,163,36],[4,12,36,100],[12,12,100,100],[4,20,36,163],[8,8,68,68]];
export function pixelChecks(mode, order = [0,1,2]) {
  const last = order[2], flat = [[0,0,0,255],[255,0,0,255],[0,255,0,255]][last];
  const result = SAMPLES.map(([x,y,r,g]) => ({ pixel:[x,y], expected: mode === 'flat' ? flat : mode === 'mixed' ? [last === 2 ? 255 : 0,g,0,255] : [r,g,0,255] }));
  for (const pixel of [[28,28],[28,12],[12,28]]) result.push({ pixel, expected:[0,0,255,255] });
  return result;
}
export async function checkPixels(bytes, record, mode, order) {
  record.rgbaSha256 = await digest(bytes); record.checks = []; record.checkedPixels = 0;
  for (const {pixel,expected} of pixelChecks(mode, order)) {
    const offset = (pixel[1]*32+pixel[0])*4, observed = [...bytes.subarray(offset,offset+4)];
    record.checks.push({pixel,expected,observed});
    if (JSON.stringify(expected) !== JSON.stringify(observed)) record.failure = {pixel,expected,observed};
    equal(observed,expected,`${record.name} independent ${mode} pixel (${pixel})`); record.checkedPixels++;
  }
}
export function tile(bytes, name) {
  const canvas = document.createElement('canvas'); canvas.width=canvas.height=32;
  const flipped = new Uint8ClampedArray(bytes.length);
  for(let y=0;y<32;y++) flipped.set(bytes.subarray(y*128,(y+1)*128),(31-y)*128);
  canvas.getContext('2d').putImageData(new ImageData(flipped,32,32),0,0);
  const figure=document.createElement('figure'), img=document.createElement('img'), caption=document.createElement('figcaption');
  img.src=canvas.toDataURL(); img.alt=name; caption.textContent=name; figure.append(img,caption); document.querySelector('#draws').append(figure);
}
async function textFile(path, expectedSha, size) {
  const response=await fetch(`/${path}`); require(response.ok,`source ${path}`);
  const bytes=new Uint8Array(await response.arrayBuffer()), sha256=await digest(bytes);
  if(expectedSha) equal(sha256,expectedSha,'unchanged source SHA'); if(size!==undefined) equal(bytes.length,size,'unchanged source bytes');
  return {path,sha256,bytes:bytes.length,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
}
export async function loadPairSources() {
  return {
    vertex:await textFile('renderer/virgl-shader/tests/passthrough.vert.tgsi'),
    smooth:await textFile('renderer/virgl-shader/tests/linkage.frag.tgsi'),
    flat:await textFile(`evidence/virgl-corpus/captures/compositor/shaders/${FLAT_HASH}.tgsi`,FLAT_HASH,102),
  };
}
function project(items) {
  return items.filter(x=>x.semantic==='GENERIC').map(({semanticIndex,componentMask,interpolation})=>({semanticIndex,componentMask,interpolation})).sort((a,b)=>a.semanticIndex-b.semanticIndex);
}
function apiAttacks(bridge, sources, report) {
  const request={vertexText:sources.vertex.text,fragmentText:sources.flat.text};
  let getterCalls=0;
  const getter={fragmentText:request.fragmentText}; Object.defineProperty(getter,'vertexText',{get(){getterCalls++;return request.vertexText;},enumerable:true});
  const cases=[['null',null],['array',[]],['missing-vertex',{fragmentText:request.fragmentText}],['missing-fragment',{vertexText:request.vertexText}],
    ['inherited',Object.create(request)],['wrong-type',{...request,vertexText:42}],['accessor',getter],['symbol',{...request,[Symbol('key')]:0}],
    ['throwing-ownKeys',new Proxy(request,{ownKeys(){throw new Error('trusted request reflection fault');}})],
    ['throwing-descriptor',new Proxy(request,{getOwnPropertyDescriptor(){throw new Error('trusted request descriptor fault');}})],
    ['shader-key',{...request,key:{flatshade:true}}],['interface-key',{...request,interfaceKey:FLAT_KEY}],['compiler-key',{...request,fs_info:{}}],
    ['NUL',{...request,vertexText:request.vertexText+'\0'}],['non-ASCII',{...request,fragmentText:request.fragmentText+'é'}],
    ['vertex-too-long',{...request,vertexText:request.vertexText+'\n'.repeat(16385-request.vertexText.length)}],
    ['fragment-too-long',{...request,fragmentText:request.fragmentText+'\n'.repeat(16385-request.fragmentText.length)}],
    ['wrong-vertex-stage',{...request,vertexText:request.fragmentText}],['wrong-fragment-stage',{...request,fragmentText:request.vertexText}]];
  report.apiAttacks=[];
  const baseline=ok(bridge.translatePair(request),'API recovery anchor');
  for(const [name,input] of cases) {
    const result=bridge.translatePair(input); equal(result.ok,false,`${name} rejects`);
    require(typeof result.error?.code==='string'&&typeof result.error?.message==='string',`${name} structured error`);
    equal(Object.keys(result).sort(),['error','ok'],`${name} no partial stages`);
    report.apiAttacks.push({name,result}); equal(bridge.translatePair(request),baseline,`${name} recovery`);
  }
  equal(getterCalls,0,'pair record does not invoke accessors'); report.accessorCalls=getterCalls;
  const padded={vertexText:request.vertexText+'\n'.repeat(16384-request.vertexText.length),fragmentText:request.fragmentText+'\n'.repeat(16384-request.fragmentText.length)};
  equal(bridge.translatePair(padded),baseline,'both exact16384-byte inputs preserve result');
  report.maximumInputs={vertexBytes:padded.vertexText.length,fragmentBytes:padded.fragmentText.length,result:baseline};
}
async function allocationFailures(sources, baseline, report) {
  let module;
  const bridge=await createVirglShaderBridge({onRuntimeInitialized(){module=this;}});
  require(module&&['_malloc','_free','_bridge_translate_pair'].every(key=>typeof module[key]==='function'),'trusted module allocation controls');
  const original={malloc:module._malloc,free:module._free,compile:module._bridge_translate_pair};
  const live=new Set();let failAt=0,calls=[],frees=[],compilerCalls=0;
  module._malloc=(bytes)=>{const failed=failAt===calls.length+1,ptr=failed?0:original.malloc(bytes);calls.push({bytes,ptr,failed});if(ptr)live.add(ptr);return ptr;};
  module._free=(ptr)=>{frees.push(ptr);require(live.delete(ptr),'free owns a live pair input');return original.free(ptr);};
  // Observation only: the compiler itself is never sabotaged or substituted.
  module._bridge_translate_pair=(...args)=>{compilerCalls++;return original.compile(...args);};
  report.allocationFailures=[];
  try {
    const request={vertexText:sources.vertex.text,fragmentText:sources.flat.text};
    for(const allocation of [1,2]) {
      failAt=allocation;calls=[];frees=[];compilerCalls=0;
      const result=bridge.translatePair(request);
      equal(result,{ok:false,error:{code:'allocation-failed',message:'Wasm input allocation failed.'}},'structured allocation failure');
      equal(calls.length,allocation,'failure stops at selected input allocation');equal(calls[allocation-1].ptr,0,'selected allocation returns zero');
      equal(frees,allocation===1?[]:[calls[0].ptr],'second failure frees exactly the first input');equal(live.size,0,'failed pair owns no input');equal(compilerCalls,0,'allocation failure never enters compiler');
      const record={allocation,result,allocations:calls,frees,compilerCalls,liveInputs:live.size};report.allocationFailures.push(record);
      failAt=0;calls=[];frees=[];compilerCalls=0;
      const recovered=bridge.translatePair(request);equal(recovered,baseline,'same-instance allocation recovery');
      equal(calls.length,2,'recovery allocates both inputs');equal(frees,[calls[1].ptr,calls[0].ptr],'recovery frees both inputs in finally');equal(compilerCalls,1,'recovery invokes compiler once');equal(live.size,0,'recovery leaves no input');
      record.recovery={result:recovered,allocations:calls,frees,compilerCalls,liveInputs:live.size};
    }
  } finally {module._malloc=original.malloc;module._free=original.free;module._bridge_translate_pair=original.compile;}
}
async function directDraw(gl, pair, name, mode, order, report) {
  const record={name,mode,order,indices:order,width:32,height:32,interfaceKey:pair.interfaceKey,vertexGlslSha256:await digest(pair.vertex.glsl),fragmentGlslSha256:await digest(pair.fragment.glsl)};
  report.draws.push(record);
  const {program,logs}=createProgram(gl,pair.vertex,pair.fragment); record.programLogs=logs;
  const vao=gl.createVertexArray(),fb=gl.createFramebuffer(),buffers=[],texture=texture2d(gl,32,32,null);
  try {
    gl.bindVertexArray(vao);gl.useProgram(program);
    const inputs=[POSITIONS,COLORS,[0,0, .25,0, 1,0]];
    for(const a of pair.vertex.metadata.attributes) {
      const at=gl.getAttribLocation(program,a.name);if(at<0)continue;
      const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(inputs[a.index]),gl.STATIC_DRAW);
      gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,0,0);
    }
    record.uniformBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
    const indices=gl.createBuffer();buffers.push(indices);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(order),gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'pair draw framebuffer');
    gl.viewport(0,0,32,32);for(const cap of [gl.BLEND,gl.DITHER,gl.CULL_FACE,gl.DEPTH_TEST,gl.SCISSOR_TEST])gl.disable(cap);
    gl.colorMask(true,true,true,true);gl.clearColor(0,0,1,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawElements(gl.TRIANGLES,3,gl.UNSIGNED_SHORT,0);
    const bytes=new Uint8Array(4096);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,bytes);equal(gl.getError(),gl.NO_ERROR,'pair hardware draw');
    tile(bytes,name);await checkPixels(bytes,record,mode,order);
  } finally {gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);buffers.forEach(b=>gl.deleteBuffer(b));gl.deleteVertexArray(vao);gl.deleteFramebuffer(fb);gl.deleteTexture(texture);gl.deleteProgram(program);}
}
export async function runShaderPairs(gl, report) {
  const bridge=await createVirglShaderBridge(),sources=await loadPairSources();
  report.sources=sources;report.corpus=[];report.cases=[];report.draws=[];
  for(const input of ORIGINAL_INPUTS) {
    const source=await textFile(input.path,input.sha256,input.size),result=bridge.translate({stage:input.stage,text:source.text});
    if(input.sha256.startsWith('0ec6a7a8'))sources.missingVertex=source;
    if(input.sha256.startsWith('23b5f8a8'))sources.partialVertex=source;
    equal(result.ok,!source.text.includes('PRECISE'),`original ${input.sha256} outcome`);
    if(result.ok)equal(result.metadata.profile,'virgl-webgl2-straight-line-v5','v4 standalone profile');
    else equal(result.error.code,'unsupported-feature','PRECISE remains rejected');
    report.corpus.push({path:input.path,sha256:input.sha256,bytes:source.bytes,stage:input.stage,result,glslSha256:result.ok?await digest(result.glsl):null});
  }
  equal(report.corpus.filter(x=>x.result.ok).length,12,'12/19 unchanged originals');
  const fixture=await textFile('renderer/virgl-shader/tests/pair-cases.json');report.fixtureSha256=fixture.sha256;
  const cases=JSON.parse(fixture.text);require(Array.isArray(cases)&&cases.length>0&&cases.length<=512,'bounded pair fixture');
  const names=new Set();
  for(const test of cases) {
    require(!names.has(test.name),'unique pair case');names.add(test.name);
    const result=bridge.translatePair({vertexText:test.vertexText,fragmentText:test.fragmentText});equal(result.ok,test.ok,`${test.name} pair outcome`);
    if(test.ok) {
      require(test.expected,'positive literal expectations');equal(result.interfaceKey,test.expected.interfaceKey,`${test.name} literal interface`);
      equal(project(result.vertex.metadata.outputs),test.expected.vertexOutputs,`${test.name} vertex qualifiers`);
      equal(project(result.fragment.metadata.inputs),test.expected.fragmentInputs,`${test.name} fragment qualifiers`);
      for(const stage of ['vertex','fragment'])equal(result[stage].metadata.profile,'virgl-webgl2-straight-line-v5','v4 pair profile');
    } else equal(Object.keys(result).sort(),['error','ok'],'pair rejection no partial stages');
    report.cases.push({name:test.name,vertexSha256:await digest(test.vertexText),fragmentSha256:await digest(test.fragmentText),result});
  }
  const definitions=[{name:'smooth',vertexText:sources.vertex.text,fragmentText:sources.smooth.text},
    {name:'flat',vertexText:sources.vertex.text,fragmentText:sources.flat.text},
    {name:'mixed',vertexText:MIXED_VERTEX,fragmentText:MIXED_FRAGMENT},
    {name:'disjoint',vertexText:sources.vertex.text.replace('GENERIC[0]','GENERIC[3]'),fragmentText:sources.smooth.text.replace('GENERIC[0]','GENERIC[3]')}];
  const anchors=definitions.map(({name,...input})=>({name,...input,result:ok(bridge.translatePair(input),`${name} pair`)}));
  report.anchors=await Promise.all(anchors.map(async a=>({...a,vertexSha256:await digest(a.vertexText),fragmentSha256:await digest(a.fragmentText)})));
  equal(anchors[0].result.interfaceKey,SMOOTH_KEY,'smooth canonical key');equal(anchors[1].result.interfaceKey,FLAT_KEY,'flat canonical key');
  equal(anchors[2].result.interfaceKey,'generic-interpolation-v1:g0/15/flat;g1/15/smooth','mixed canonical key');
  report.recovery={rounds:2,conversions:0};
  for(let round=0;round<2;round++)for(let i=0;i<cases.length;i++) {
    const test=cases[i];equal(bridge.translatePair({vertexText:test.vertexText,fragmentText:test.fragmentText}),report.cases[i].result,'repeat pair result');
    for(const a of anchors){equal(bridge.translatePair({vertexText:a.vertexText,fragmentText:a.fragmentText}),a.result,'disjoint interface recovery');report.recovery.conversions++;}
  }
  apiAttacks(bridge,sources,report);
  await allocationFailures(sources,anchors[1].result,report);
  for(const [index,mode,order] of [[0,'smooth',[0,1,2]],[1,'flat',[0,1,2]],[0,'smooth',[0,1,2]],[1,'flat',[1,2,0]],[0,'smooth',[1,2,0]],[1,'flat',[0,1,2]],[2,'mixed',[0,1,2]],[2,'mixed',[1,2,0]]])
    await directDraw(gl,anchors[index].result,`pair ${mode} ${order}`,mode,order,report);
  report.status='passed';return {bridge,sources,anchors};
}
