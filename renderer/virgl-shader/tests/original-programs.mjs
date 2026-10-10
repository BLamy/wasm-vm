import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,bindSystemBlocks,digest} from './browser.mjs';
import {originalOracle,powerPrediction,POWER_SITES} from '../../../tools/virgl-original-programs/oracle.mjs';
import {GUARD_CASES} from '../../../tools/virgl-original-programs/guard-cases.mjs';

const require=(condition,message)=>{if(!condition)throw new Error(message);};
const vertexHash='7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e';
const fragmentHash='92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba';
const root='/evidence/virgl-workload-inventory/captures/es2gears/shaders/';
const geometryPath='/target/evidence/virgl-92cb-raster/geometry.bin';
const rasterPath='/target/evidence/virgl-92cb-raster/raster.json';
const width=1024,height=768;
const certifiedRenderer='ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)';
const certifiedPrecision={rangeMin:127,rangeMax:127,precision:23};
const float=word=>new Float32Array(new Uint32Array([word]).buffer)[0];

async function compressedReadback(bytes){
 const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
 const zipped=new Uint8Array(await new Response(stream).arrayBuffer());
 const chunks=[];
 for(let at=0;at<zipped.length;at+=32768)
  chunks.push(String.fromCharCode(...zipped.subarray(at,at+32768)));
 return {gzipBase64:btoa(chunks.join('')),gzipSha256:await digest(zipped)};
}

function originalExpressions(text){
 const expected=[
  /^\s*2: MUL TEMP\[34\]\.xy, CONST\[4\]\.xyyy, IN\[0\]\.xyyy$/m,
  /^208: FSLT TEMP\[166\]\.xy, TEMP\[34\]\.xyyx, CONST\[0\]\.xyyy$/m,
  /^215: MOV TEMP\[168\]\.x, TEMP\[166\]\.yxxx$/m,
  /^218:\s+MUL TEMP\[169\]\.xy, CONST\[0\]\.xyxx, IMM\[0\]\.xxxx$/m,
  /^219:\s+ADD TEMP\[170\]\.xy, TEMP\[34\]\.xyxx, TEMP\[169\]\.xyxx$/m,
  /^220:\s+MAX TEMP\[171\]\.xy, TEMP\[170\]\.xyxx, -TEMP\[170\]\.xyxx$/m,
  /^221:\s+POW TEMP\[172\]\.x, TEMP\[171\]\.xxxx, CONST\[6\]\.xxxx$/m,
  /^222:\s+POW TEMP\[172\]\.y, TEMP\[171\]\.yyyy, CONST\[6\]\.xxxx$/m];
 require(expected.every(pattern=>pattern.test(text)),'unchanged original first-power TGSI expressions');
 require(/^IMM\[0\] UINT32 \{3212836864, 0, 2, 1065353216\}$/m.test(text),
  'original negative-one immediate and branch literal');
}

function geometry(binary){
 const view=new DataView(binary.buffer,binary.byteOffset,binary.byteLength);
 require(binary.length===72+3*656&&view.getUint32(0,true)===0x31323947&&view.getUint32(4,true)===3,
  'complete predecessor geometry binary');
 const word=at=>view.getUint32(at,true);
 const quad=Array.from({length:16},(_,i)=>word(8+i*4));
 require(JSON.stringify(quad)===JSON.stringify([
  0,0,0,0,0,0x3f800000,0,0x3f800000,
  0x3f800000,0,0x3f800000,0,
  0x3f800000,0x3f800000,0x3f800000,0x3f800000]),
  'exact original four-vertex position/UV strip');
 const banks=Array.from({length:3},(_,bank)=>({
  vertex:Array.from({length:16},(_,i)=>word(72+bank*656+i*4)),
  fragment:Array.from({length:148},(_,i)=>word(136+bank*656+i*4))}));
 return {quad,banks};
}

function boundWords(gl,program,name,expected){
 const observed=[];
 for(let register=0;register<expected.length/4;register++){
  const location=gl.getUniformLocation(program,`${name}[${register}]`);
  require(location!==null,`active physical ${name}[${register}] uniform`);
  const value=gl.getUniform(program,location);
  require(value instanceof Uint32Array&&value.length===4,
   `physical ${name}[${register}] raw uvec4 reflection`);
  observed.push(...value);
 }
 require(observed.length===expected.length&&observed.every((word,i)=>word===expected[i]),
  `bound physical ${name} words still equal the certified bank`);
 return observed;
}

function expectedAxis(vertex,fragment,axis,pixel){
 const scale=axis?384:512;
 const start=scale*(float(vertex[8+axis])+1);
 const end=scale*(float(vertex[axis?5:0])+float(vertex[8+axis])+1);
 const coordinate=float(fragment[16+axis])*(pixel+.5-start)/(end-start);
 return {delta:coordinate-float(fragment[axis]),start,end};
}

async function renderBank(gl,quad,bank,index,bridge,inputs,fault){
 for(const axis of [0,1]){
  const coefficient=float(bank.fragment[16+axis]),center=float(bank.fragment[axis]);
  require(Number.isFinite(coefficient)&&coefficient>0&&coefficient<=2048&&
   Number.isFinite(center),'finite positive original numeric coefficient and center');
 }
 const drawState={viewportX:0,viewportY:0,viewportWidth:width,viewportHeight:height,
  samples:0,colorFormat:gl.RGBA32F,mode:gl.TRIANGLE_STRIP,first:0,count:4};
 const request=()=>({vertexText:inputs.vertexText,fragmentText:inputs.fragmentText,
  geometry:inputs.binary,bank:index,drawState});
 const translated=bridge.translateOriginal92cbComplete(request());
 require(translated.ok&&translated.private92cbComplete?.drawTimeRecheckRequired&&
  translated.private92cbComplete?.bank===index&&
  translated.private92cbComplete?.productionDrawAuthority===false,
  `authenticated private complete original bank${index}: ${JSON.stringify(translated.error)}`);
 const {vertex,fragment}=translated;
 require(vertex.metadata.outputs.some(out=>out.name==='vso_g0'&&out.interpolation==='smooth')&&
  fragment.glsl.includes('pow(')&&fragment.glsl.includes('fsout_c0'),
  'generated complete original shader and smooth varying');
 let fullGlsl=fragment.glsl;
 if(index===0&&fault==='output')fullGlsl=fullGlsl.replace(/ fsout_c0.x = [^;]+;/,' fsout_c0.x = 0.0;');
 if(index===0&&fault==='discard')fullGlsl=fullGlsl.replace(' discard;',' ; /* sabotaged discard */');
 if(index===0&&fault==='power-value')fullGlsl=fullGlsl.replace('pow(power_base, power_exponent)','(2.0 * pow(power_base, power_exponent))');
 const invocationFaults={
  'power-negative':'power_base = -1.0;',
  'power-subnormal':'power_base = uintBitsToFloat(1u);',
  'power-nan':'power_exponent = uintBitsToFloat(2143289344u);',
  'power-zero':'power_base = 0.0; power_exponent = 0.0;',
  'power-envelope':'power_exponent = 128.0;',
 };
 if(index===0&&Object.hasOwn(invocationFaults,fault))
  fullGlsl=fullGlsl.replace(' if (!power_masked) {',` ${invocationFaults[fault]} if (!power_masked) {`);
 const built=createProgram(gl,vertex,{...fragment,glsl:fullGlsl});
 const program=built.program,owned=[],vao=gl.createVertexArray(),buffer=gl.createBuffer();
 const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
 const probeTexture=gl.createTexture();
 require(vao&&buffer&&texture&&probeTexture&&framebuffer,'physical original draw objects');
 try{
  gl.useProgram(program);
  const blocks=bindSystemBlocks(gl,program,vertex.metadata,owned);
  gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  const quadFloats=new Float32Array(new Uint32Array(quad).buffer);
  gl.bufferData(gl.ARRAY_BUFFER,quadFloats,gl.STATIC_DRAW);
  const attributes=[];
  for(const [name,offset] of [['in_0',0],['in_1',8]]){
   const location=gl.getAttribLocation(program,name);require(location>=0,`active original ${name}`);
   gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,16,offset);
   attributes.push({name,location,offset,type:gl.getActiveAttrib(program,attributes.length)?.type});
  }
  const vl=gl.getUniformLocation(program,'vsconst0[0]');
  const fl=gl.getUniformLocation(program,'fsconst0[0]');
  require(vl!==null&&fl!==null,'active original raw constant arrays');
  const uniforms=Array.from({length:gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS)},
   (_,i)=>{const item=gl.getActiveUniform(program,i);return {name:item.name,size:item.size,type:item.type};});
  require(fragment.metadata.uniforms.length===1&&
   fragment.metadata.uniforms[0].name==='fsconst0'&&
   fragment.metadata.uniforms[0].count===37&&
   uniforms.some(item=>item.name==='fsconst0[0]'&&item.size===37&&item.type===gl.UNSIGNED_INT_VEC4)&&
   uniforms.some(item=>item.name==='vsconst0[0]'&&item.size===4&&item.type===gl.UNSIGNED_INT_VEC4)&&
   attributes.every(item=>item.type===gl.FLOAT_VEC4)&&fragment.metadata.samplers.length===0,
   'generated complete program reflection matches complete original constant banks');
  gl.uniform4uiv(vl,new Uint32Array(bank.vertex));
  gl.uniform4uiv(fl,new Uint32Array(bank.fragment));
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  gl.bindTexture(gl.TEXTURE_2D,probeTexture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,null);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT1,gl.TEXTURE_2D,probeTexture,0);
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);
  const probePc=gl.getUniformLocation(program,'private_probe_pc');
  const probeMode=gl.getUniformLocation(program,'private_probe_mode');
  require(probePc!==null&&probeMode!==null,'active private diagnostic uniforms');
  gl.uniform1i(probePc,-1);gl.uniform1i(probeMode,0);
  const framebufferStatus=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  require(framebufferStatus===gl.FRAMEBUFFER_COMPLETE,'physical float framebuffer');
  for(const capability of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST])gl.disable(capability);
  gl.viewport(0,0,fault==='viewport'&&index===0?width-1:width,height);
  const observedDraw={viewport:Array.from(gl.getParameter(gl.VIEWPORT)),
   samples:gl.getParameter(gl.SAMPLES),framebufferStatus,
   colorFormat:gl.RGBA32F,mode:gl.TRIANGLE_STRIP,count:4};
  if(fault==='post-bank'&&index===0)inputs.binary[72+64+24*4]^=1;
  if(fault==='post-geometry'&&index===0)inputs.binary[8]^=1;
  if(fault==='post-source'&&index===0)inputs.vertexText+='\n';
  if(fault==='post-parsed-bank'&&index===0)bank.fragment[24]^=1;
  if(fault==='post-parsed-quad'&&index===0)quad[0]^=1;
  if(fault==='post-sample'&&index===0)drawState.samples=1;
  if(fault==='post-bound-exponent'&&index===1){
   const words=new Uint32Array(bank.fragment.slice(24,28));words[0]=0x40400000;
   gl.uniform4uiv(gl.getUniformLocation(program,'fsconst0[6]'),words);
  }
  if(fault==='post-bound-vertex'&&index===1){
   const words=new Uint32Array(bank.vertex.slice(8,12));words[0]^=1;
   gl.uniform4uiv(gl.getUniformLocation(program,'vsconst0[2]'),words);
  }
  if(fault==='post-bound-attribute'&&index===1)
   gl.vertexAttribPointer(attributes[1].location,2,gl.FLOAT,false,8,0);
  if(fault==='post-bound-color'&&index===1)
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  // Recheck the complete source/bank/quad snapshot after program setup. From
  // this point through drawArrays there is no await or callback into the page.
  const atDraw=bridge.translateOriginal92cbComplete(request());
  require(atDraw.ok&&atDraw.vertex.glsl===vertex.glsl&&
   atDraw.fragment.glsl===fragment.glsl&&
   JSON.stringify(atDraw.private92cbComplete)===JSON.stringify(translated.private92cbComplete),
   'draw-time compiler certificate and immutable generated shader');
  const liveGeometry=geometry(inputs.binary);
  require(quad.every((word,i)=>word===liveGeometry.quad[i])&&
   bank.vertex.every((word,i)=>word===liveGeometry.banks[index].vertex[i])&&
   bank.fragment.every((word,i)=>word===liveGeometry.banks[index].fragment[i]),
   'owned quad and both bound stage banks still equal the certified geometry');
  const rendererInfo=gl.getExtension('WEBGL_debug_renderer_info');
  const precisionAtDraw={};
  for(const [stageName,shaderType] of [['vertex',gl.VERTEX_SHADER],['fragment',gl.FRAGMENT_SHADER]]){
   const value=gl.getShaderPrecisionFormat(shaderType,gl.HIGH_FLOAT);
   precisionAtDraw[stageName]={rangeMin:value?.rangeMin,rangeMax:value?.rangeMax,
    precision:value?.precision};
  }
  const rendererAtDraw=rendererInfo&&gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL);
  require(rendererAtDraw===certifiedRenderer&&
   Object.values(precisionAtDraw).every(value=>
    JSON.stringify(value)===JSON.stringify(certifiedPrecision)),
   'recorded M4 Max renderer and highp precision still satisfy private certificate');
  const observedQuad=new Float32Array(16);
  gl.getBufferSubData(gl.ARRAY_BUFFER,0,observedQuad);
  require(new Uint32Array(observedQuad.buffer).every((word,i)=>word===quad[i]),
   'bound quad bytes still equal the pinned original geometry');
  if(fault==='post-buffer-exponent'&&index===1){
   const words=new Uint32Array(bank.fragment.slice(24,28));words[0]=0x40400000;
   gl.uniform4uiv(gl.getUniformLocation(program,'fsconst0[6]'),words);
  }
  gl.clearColor(-10000,-10000,-10000,-10000);gl.clear(gl.COLOR_BUFFER_BIT);
  if(fault==='post-clear-exponent'&&index===1){
   const words=new Uint32Array(bank.fragment.slice(24,28));words[0]=0x40400000;
   gl.uniform4uiv(gl.getUniformLocation(program,'fsconst0[6]'),words);
  }
  const boundAttributes=attributes.map(({location,offset})=>({
   location,offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),
   enabled:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_ENABLED),
   size:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_SIZE),
   type:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_TYPE),
   normalized:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
   stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),
   divisor:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_DIVISOR),
   bufferMatches:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING)===buffer,
   expectedOffset:offset}));
  require(boundAttributes.every(item=>item.enabled&&item.size===2&&
   item.type===gl.FLOAT&&!item.normalized&&item.stride===16&&
   item.offset===item.expectedOffset&&item.divisor===0&&item.bufferMatches),
   'physical VAO input bindings still equal the certified original quad');
  const attachment={
   objectType:gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,
    gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE),
   textureMatches:gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,
    gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME)===texture,
   componentType:gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,
    gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE),
   channelBits:[gl.FRAMEBUFFER_ATTACHMENT_RED_SIZE,gl.FRAMEBUFFER_ATTACHMENT_GREEN_SIZE,
    gl.FRAMEBUFFER_ATTACHMENT_BLUE_SIZE,gl.FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE]
    .map(parameter=>gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,parameter))};
  require(attachment.objectType===gl.TEXTURE&&attachment.textureMatches&&
   attachment.componentType===gl.FLOAT&&attachment.channelBits.every(bits=>bits===32)&&
   gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE&&
   Array.from(gl.getParameter(gl.COLOR_WRITEMASK)).every(enabled=>enabled)&&
   !gl.isEnabled(gl.RASTERIZER_DISCARD),
   'physical float framebuffer attachment still satisfies private certificate');
  require(observedDraw.viewport.join(',')==='0,0,1024,768'&&
   observedDraw.samples===0&&observedDraw.framebufferStatus===gl.FRAMEBUFFER_COMPLETE&&
   gl.getParameter(gl.FRAMEBUFFER_BINDING)===framebuffer&&
   gl.getParameter(gl.CURRENT_PROGRAM)===program&&
   gl.getParameter(gl.VERTEX_ARRAY_BINDING)===vao&&
   gl.getParameter(gl.ARRAY_BUFFER_BINDING)===buffer&&
   gl.getParameter(gl.VIEWPORT).join(',')==='0,0,1024,768'&&
   gl.getParameter(gl.SAMPLES)===0&&
   [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST]
   .every(capability=>!gl.isEnabled(capability)),
   'physical WebGL2 draw state still satisfies private certificate');
  // Every preparatory WebGL call is complete. Reflect all constants last,
  // then issue the draw with no intervening WebGL operation or callback.
  const boundVertexWords=boundWords(gl,program,'vsconst0',bank.vertex);
  const boundFragmentWords=boundWords(gl,program,'fsconst0',bank.fragment);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  const pixels=new Float32Array(width*height*4);
  gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,pixels);
  require(gl.getError()===gl.NO_ERROR,'physical original-strip power probe');
  const xs=Array.from({length:width},(_,x)=>expectedAxis(bank.vertex,bank.fragment,0,x));
  const ys=Array.from({length:height},(_,y)=>expectedAxis(bank.vertex,bank.fragment,1,y));
  const centerX=float(bank.fragment[0]),centerY=float(bank.fragment[1]);
  if(index===0&&Object.hasOwn(invocationFaults,fault)){
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const ex=xs[x],ey=ys[y];
    if(ex.start>x+.5||ex.end<x+.5||ey.start>y+.5||ey.end<y+.5)continue;
    if(originalOracle(bank.fragment,ex.delta+centerX,ey.delta+centerY).discard)continue;
    require(pixels.subarray((y*width+x)*4,(y*width+x)*4+4).every(value=>value===-30000),
     'missing checked power fault sentinel');
    throw new Error(`checked invocation domain rejected ${fault}`);
   }
   throw new Error('missing visible power fault exercise');
  }
  let covered=0,survived=0,discarded=0,maxOutputError=0;
  const samples=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const at=(y*width+x)*4,actual=pixels.subarray(at,at+4);
   const ex=xs[x],ey=ys[y];
   const inside=ex.start<=x+.5&&x+.5<=ex.end&&ey.start<=y+.5&&y+.5<=ey.end;
   if(!inside){require(actual.every(value=>value===-10000),`uncovered pixel (${x},${y})`);continue;}
   covered++;
   const oracle=originalOracle(bank.fragment,ex.delta+centerX,ey.delta+centerY);
   if(oracle.discard){
    discarded++;require(actual.every(value=>value===-10000),`original discard bank${index} (${x},${y})`);
   }else{
    survived++;
    const errors=[...actual].map((value,lane)=>Math.abs(value-oracle.color[lane]));
    require(errors.every(error=>Number.isFinite(error)&&error<=0.0001),
     `full original output bank${index} (${x},${y}): ${[...actual]} expected ${oracle.color}`);
    maxOutputError=Math.max(maxOutputError,...errors);
   }
   if((Math.abs(ex.delta)<6&&Math.abs(ey.delta)<6)||
      (x%257===0&&y%193===0))samples.push({x,y,actual:[...actual],expected:oracle.color,discard:oracle.discard});
  }
  const primarySha=await digest(new Uint8Array(pixels.buffer));
  const primary=await compressedReadback(new Uint8Array(pixels.buffer));
  const probes=[];
  require(JSON.stringify(translated.private92cbComplete.powerSites)===JSON.stringify(POWER_SITES),
   'full-source checked power site inventory');
  // The same complete linked body runs for each diagnostic. Mode 1 preserves
  // the already-computed operands at original KILL rather than losing the probe.
  gl.uniform1i(probeMode,1);
  for(const pc of POWER_SITES){
   gl.uniform1i(probePc,pc);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
   boundWords(gl,program,'vsconst0',bank.vertex);boundWords(gl,program,'fsconst0',bank.fragment);
   gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
   gl.readBuffer(gl.COLOR_ATTACHMENT1);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,pixels);
   require(gl.getError()===gl.NO_ERROR,`complete original diagnostic pc${pc}`);
   let hits=0,masked=0,zeros=0,minBase=Infinity,maxBase=-Infinity,maxRelative=0,maxInputError=0;
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4,base=pixels[at],exponent=pixels[at+1],result=pixels[at+2],tag=pixels[at+3];
    const ex=xs[x],ey=ys[y];
    const inside=ex.start<=x+.5&&x+.5<=ex.end&&ey.start<=y+.5&&y+.5<=ey.end;
    const prediction=inside?powerPrediction(bank.fragment,ex.delta+centerX,ey.delta+centerY,pc):null;
    if(!prediction){require(tag===0,`unexecuted power pc${pc} bank${index} (${x},${y})`);continue;}
    hits++;require(tag===(prediction.masked?2:1),`power control pc${pc} bank${index} (${x},${y})`);
    require(Number.isFinite(base)&&Number.isFinite(exponent)&&exponent===prediction.exponent,
     `power operands pc${pc} bank${index} (${x},${y})`);
    const inputError=Math.abs(base-prediction.base);
    const inputBudget=(pc<=107||pc>=535)?0.000001:0.001;
    require(inputError<=inputBudget,`independent power input pc${pc} bank${index} (${x},${y}): ${base} / ${prediction.base}`);
    maxInputError=Math.max(maxInputError,inputError);
    minBase=Math.min(minBase,base);maxBase=Math.max(maxBase,base);
    if(prediction.masked){masked++;require(base<0&&result===0,'selected-away negative fade');continue;}
    require(base>=0&&Number.isFinite(result)&&result>=0,'defined nonnegative power invocation');
    if(base===0){zeros++;require(result===0,'owned exact power zero');}
    else{
     const ideal=Math.pow(base,exponent),relative=Math.abs(result-ideal)/ideal;
     require(Number.isFinite(relative)&&relative<=1/16384,
      `physical power budget pc${pc} bank${index} (${x},${y}) ${relative}`);
     maxRelative=Math.max(maxRelative,relative);
    }
   }
   const probe=await compressedReadback(new Uint8Array(pixels.buffer));
   probes.push({pc,hits,masked,zeros,minBase:hits?minBase:null,maxBase:hits?maxBase:null,
    maxInputError,maxRelative,readbackSha256:await digest(new Uint8Array(pixels.buffer)),
    readbackGzipBase64:probe.gzipBase64,readbackGzipSha256:probe.gzipSha256});
  }
  return {bank:index,covered,survived,discarded,maxOutputError,samples,probes,
   readbackSha256:primarySha,
   readbackGzipBase64:primary.gzipBase64,readbackGzipSha256:primary.gzipSha256,
   vertexGlslSha256:await digest(vertex.glsl),fragmentGlslSha256:await digest(fragment.glsl),
   vertexGlsl:vertex.glsl,fragmentGlsl:fragment.glsl,
   vertexMetadata:vertex.metadata,fragmentMetadata:fragment.metadata,
   certificate:translated.private92cbComplete,attributes,uniforms,blocks,
   drawState:observedDraw,boundVertexWords,boundFragmentWords,boundAttributes,
   attachment,rendererAtDraw,precisionAtDraw,logs:built.logs};
 }finally{
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);
  gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteTexture(probeTexture);gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);
  for(const item of owned)gl.deleteBuffer(item);gl.deleteProgram(program);
  require(!gl.isProgram(program)&&!gl.isTexture(texture)&&!gl.isTexture(probeTexture)&&
   !gl.isFramebuffer(framebuffer)&&!gl.isBuffer(buffer)&&!gl.isVertexArray(vao)&&
   owned.every(item=>!gl.isBuffer(item))&&gl.getError()===gl.NO_ERROR,
   'complete full-source object disposal');
 }
}

async function checkGuard(gl,fullSource){
 const start=fullSource.indexOf('bool private_power_domain(');
 const end=fullSource.indexOf('\n}\n',start)+3;
 require(start>=0&&end>start,'actual emitted numerical guard');
 const helper=fullSource.slice(start,end);
 const snapshotStart=fullSource.indexOf(' { highp float power_base = ');
 const snapshotEnd=fullSource.indexOf('}\n',snapshotStart)+2;
 require(snapshotStart>=0&&snapshotEnd>snapshotStart,'actual emitted power snapshot');
 const snapshot=fullSource.slice(snapshotStart,snapshotEnd)
  .replace(/power_base = [^;]+;/,'power_base = uintBitsToFloat(words.x);')
  .replace(/power_exponent = [^;]+;/,'power_exponent = uintBitsToFloat(words.y);');
 const vertex={glsl:'#version 300 es\nprecision highp float;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}'};
 const fragment={glsl:`#version 300 es
precision highp float;
precision highp int;
uniform highp uvec2 test_words[${GUARD_CASES.length}];
layout(location=0) out vec4 score;
${helper}
void main(){int at=int(gl_FragCoord.x);uvec2 words=test_words[at];
 vec4 float_rhs;bool private_power_fault=false;vec4 private_probe=vec4(0);int private_probe_pc=105;
 ${snapshot}
 score=vec4(private_power_fault?-1.0:1.0,float_rhs.x,floatBitsToUint(float_rhs.x)==0u?1.0:0.0,1.0);}`};
 const {program,logs}=createProgram(gl,vertex,fragment);
 const texture=gl.createTexture(),framebuffer=gl.createFramebuffer(),vao=gl.createVertexArray();
 require(texture&&framebuffer&&vao,'guard physical objects');
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,GUARD_CASES.length,1,0,gl.RGBA,gl.FLOAT,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);
  require(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'guard float framebuffer');
  gl.viewport(0,0,GUARD_CASES.length,1);
  gl.uniform2uiv(gl.getUniformLocation(program,'test_words[0]'),
   new Uint32Array(GUARD_CASES.flatMap(([,base,exponent])=>[base,exponent])));
  gl.drawArrays(gl.TRIANGLES,0,3);
  const pixels=new Float32Array(GUARD_CASES.length*4);
  gl.readPixels(0,0,GUARD_CASES.length,1,gl.RGBA,gl.FLOAT,pixels);
  require(gl.getError()===gl.NO_ERROR,'physical numerical guard');
  const cases=GUARD_CASES.map(([name,base,exponent,expected],i)=>{
   const actual=[...pixels.subarray(i*4,i*4+4)];
   const ideal=expected?(float(base)===0?0:Math.pow(float(base),float(exponent))):0;
   const relative=ideal===0?0:Math.abs(actual[1]-ideal)/ideal;
   require(actual[0]===(expected?1:-1)&&Number.isFinite(actual[1])&&
    (ideal===0?actual[1]===0:relative<=1/16384)&&actual[2]===(ideal===0?1:0)&&actual[3]===1,
    `literal numerical guard and emitted power ${name}`);
   return {name,base,exponent,expected,actual,ideal,relative};
  });
  return {cases,helper,helperSha256:await digest(helper),snapshot,snapshotSha256:await digest(snapshot),logs};
 }finally{
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);
  gl.deleteProgram(program);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteVertexArray(vao);
  require(!gl.isProgram(program)&&!gl.isFramebuffer(framebuffer)&&!gl.isTexture(texture)&&
   !gl.isVertexArray(vao)&&gl.getError()===gl.NO_ERROR,'guard object disposal');
 }
}

export async function runPhysicalAcceptance({fault=null}={}){
 require([null,'source','bank','negative','nonfinite','geometry','viewport','zero-crossing',
  'post-source','post-bank','post-geometry','post-parsed-bank','post-parsed-quad','post-sample',
  'post-bound-exponent','post-bound-vertex','post-bound-attribute','post-bound-color',
  'post-buffer-exponent','post-clear-exponent','output','discard','power-value',
  'power-negative','power-subnormal','power-nan','power-zero','power-envelope'].includes(fault),
  'known original physical fault');
 require(typeof document==='undefined'&&typeof OffscreenCanvas==='function',
  'isolated physical WebGL worker');
 const report={schema:'virgl-original-programs-compiler-v1',status:'running',
  guestExecution:false,compilerAuthority:'complete original with invocation guards',productionDrawAuthority:false,
  executionRealm:'dedicated-offscreen-worker',
  portableDomain:'not certified: private certificate applies only to the authenticated draw',
  observedDomain:'positive normal on this renderer and certified draw only',
  maxAllowedDeltaError:0.1,fault,banks:[]};
 const canvas=new OffscreenCanvas(width,height);
 const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 require(gl instanceof WebGL2RenderingContext,'physical WebGL2 context');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 require(debug&&gl.getExtension('EXT_color_buffer_float'),'hardware identity and float attachments');
 report.renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
 require(report.renderer===certifiedRenderer,'recorded M4 Max physical renderer');
 const precision=stage=>{
  const value=gl.getShaderPrecisionFormat(stage,gl.HIGH_FLOAT);
  require(value,'reported highp float precision');
  return {rangeMin:value.rangeMin,rangeMax:value.rangeMax,precision:value.precision};
 };
 report.precision={vertex:precision(gl.VERTEX_SHADER),fragment:precision(gl.FRAGMENT_SHADER)};
 require(Object.values(report.precision).every(value=>
  JSON.stringify(value)===JSON.stringify(certifiedPrecision)),
  'recorded vertex/fragment highp precision');
 const paths=[root+vertexHash+'.tgsi',root+fragmentHash+'.tgsi',geometryPath,rasterPath];
 const responses=await Promise.all(paths.map(path=>fetch(path)));
 require(responses.every(response=>response.ok),'served original sources and predecessor evidence');
 let vertexText=await responses[0].text();
 const fragmentText=await responses[1].text();
 if(fault==='source')vertexText+='\n';
 const binary=new Uint8Array(await responses[2].arrayBuffer()),raster=await responses[3].json();
 require(await digest(vertexText)===vertexHash&&await digest(fragmentText)===fragmentHash,
  'complete original vertex/fragment source SHA');
 originalExpressions(fragmentText);
 require(raster.draws===1957&&raster.numericCompilerAuthority===false&&
  raster.productionDrawAuthority===false&&await digest(binary)===raster.geometryBinarySha256,
  'verified predecessor raster and bank identity');
 const parsed=geometry(binary);
 const bytes=new DataView(binary.buffer,binary.byteOffset,binary.byteLength);
 if(fault==='bank')bytes.setUint32(72+64+24*4,0x40400000,true);
 if(fault==='negative')bytes.setUint32(72+64+16*4,0xbf800000,true);
 if(fault==='nonfinite')bytes.setUint32(72+64+16*4,0x7fc00000,true);
 if(fault==='geometry')bytes.setUint32(8+6*4,0x3f000000,true);
 if(fault==='zero-crossing')bytes.setUint32(72+8*4,0xbe9b8000,true);
 if(fault&&['bank','negative','nonfinite','geometry','zero-crossing'].includes(fault))
  Object.assign(parsed,geometry(binary));
 const inputs={vertexText,fragmentText,binary};
 const bridge=await createVirglShaderBridge();
 for(let index=0;index<3;index++){
  const bank=parsed.banks[index];
  require(bank.fragment[0]===0x40800000&&bank.fragment[1]===0x40800000&&
   bank.fragment[24]===0x40000000,'original center and square exponent');
  report.banks.push(await renderBank(gl,parsed.quad,bank,index,bridge,inputs,fault));
 }
 require(report.banks.reduce((n,bank)=>n+bank.covered,0)===1612644&&
  report.banks[0].survived>0&&report.banks[2].survived>0,'complete original pixel coverage');
 report.guard=await checkGuard(gl,report.banks[0].fragmentGlsl);
 report.status='passed';
 return report;
}

export async function runAcceptance({fault=null}={}){
 const worker=new Worker(new URL('./original-programs-worker.mjs',import.meta.url),
  {type:'module',name:'original-programs'});
 try{
  const report=await new Promise((resolve,reject)=>{
   worker.addEventListener('message',({data})=>{
    if(data.error)reject(new Error(data.error));
    else resolve(JSON.parse(data.report));
   },{once:true});
   worker.addEventListener('error',event=>reject(new Error(event.message)),{once:true});
   worker.postMessage({fault});
  });
  window.__virglOriginalProgramsReport=report;
  const preview=report.banks[0];
  const zipped=Uint8Array.from(atob(preview.readbackGzipBase64),c=>c.charCodeAt(0));
  const raw=await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const source=new Float32Array(raw),rgba=new Uint8ClampedArray(width*height*4);
  for(let at=0;at<rgba.length;at+=4){
   if(source[at]<0){rgba[at]=rgba[at+1]=rgba[at+2]=24;rgba[at+3]=255;}
   else{for(let lane=0;lane<3;lane++)rgba[at+lane]=255*source[at+lane];rgba[at+3]=255;}
  }
  const canvas=document.querySelector('#gpu');canvas.width=width;canvas.height=height;
  canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);
  document.querySelector('#status').textContent='Complete original compositor shader passed';
  document.querySelector('#renderer').textContent=report.renderer;
  return report;
 }finally{
  worker.terminate();
 }
}
