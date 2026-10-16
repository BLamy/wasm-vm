import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,bindSystemBlocks,digest} from './browser.mjs';

const require=(condition,message)=>{if(!condition)throw new Error(message);};
const vertexHash='7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e';
const fragmentHash='92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba';
const root='/evidence/virgl-workload-inventory/captures/es2gears/shaders/';
const geometryPath='/target/evidence/virgl-92cb-raster/geometry.bin';
const rasterPath='/target/evidence/virgl-92cb-raster/raster.json';
const width=1024,height=768;
const float=word=>new Float32Array(new Uint32Array([word]).buffer)[0];

async function compressedReadback(bytes){
 const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
 const zipped=new Uint8Array(await new Response(stream).arrayBuffer());
 const chunks=[];
 for(let at=0;at<zipped.length;at+=32768)
  chunks.push(String.fromCharCode(...zipped.subarray(at,at+32768)));
 return {gzipBase64:btoa(chunks.join('')),gzipSha256:await digest(zipped)};
}

// This is a direct numeric probe, not a compiler translation of the original
// fragment program. The authenticated TGSI lines below define every expression
// in the probe; the full program remains rejected at pc221.
const probe=`#version 300 es
precision highp float;
precision highp int;
smooth in vec4 vso_g0;
uniform highp uvec4 fsconst0[7];
layout(location=0) out highp vec4 out_color;
void main() {
  highp vec2 temp34 = vec2(uintBitsToFloat(fsconst0[4].x) * vso_g0.x,
                           uintBitsToFloat(fsconst0[4].y) * vso_g0.y);
  highp vec2 temp169 = -vec2(uintBitsToFloat(fsconst0[0].x),
                              uintBitsToFloat(fsconst0[0].y));
  highp vec2 temp170 = temp34 + temp169;
  highp vec2 temp171 = max(temp170, -temp170);
  highp float exponent = uintBitsToFloat(fsconst0[6].x);
  if (temp34.x < uintBitsToFloat(fsconst0[0].x) &&
      temp34.y < uintBitsToFloat(fsconst0[0].y))
    out_color = vec4(temp170, pow(temp171.x, exponent), pow(temp171.y, exponent));
  else
    out_color = vec4(temp170, -10000.0, -10000.0);
}`;

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

function expectedAxis(vertex,fragment,axis,pixel){
 const scale=axis?384:512;
 const start=scale*(float(vertex[8+axis])+1);
 const end=scale*(float(vertex[axis?5:0])+float(vertex[8+axis])+1);
 const coordinate=float(fragment[16+axis])*(pixel+.5-start)/(end-start);
 return {delta:coordinate-float(fragment[axis]),start,end};
}

async function renderBank(gl,quad,bank,index,bridge,fault){
 for(const axis of [0,1]){
  const coefficient=float(bank.fragment[16+axis]),center=float(bank.fragment[axis]);
  require(Number.isFinite(coefficient)&&coefficient>0&&coefficient<=2048&&
   Number.isFinite(center),'finite positive original numeric coefficient and center');
 }
 const components=bank.vertex.map((word,i)=>({register:i>>2,component:i&3,word}));
 const vertex=bridge.translateExact({stage:'vertex',text:window.__original92cbVertex,components});
 require(vertex.ok&&vertex.metadata.outputs.some(out=>out.name==='vso_g0'&&out.interpolation==='smooth'),
  'authenticated original vertex translation and smooth varying');
 const built=createProgram(gl,vertex,{glsl:probe});
 const program=built.program,owned=[],vao=gl.createVertexArray(),buffer=gl.createBuffer();
 const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
 require(vao&&buffer&&texture&&framebuffer,'physical original draw objects');
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
  gl.uniform4uiv(vl,new Uint32Array(bank.vertex));
  gl.uniform4uiv(fl,new Uint32Array(bank.fragment.slice(0,28)));
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  const framebufferStatus=gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  require(framebufferStatus===gl.FRAMEBUFFER_COMPLETE,'physical float framebuffer');
  for(const capability of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST])gl.disable(capability);
  gl.viewport(0,0,fault==='viewport'&&index===0?width-1:width,height);
  const drawState={viewport:Array.from(gl.getParameter(gl.VIEWPORT)),
   samples:gl.getParameter(gl.SAMPLES),framebufferStatus,
   colorFormat:gl.RGBA32F,mode:gl.TRIANGLE_STRIP,count:4};
  gl.clearColor(-10000,-10000,-10000,-10000);gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  const pixels=new Float32Array(width*height*4);
  gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,pixels);
  require(gl.getError()===gl.NO_ERROR,'physical original-strip power probe');
  let covered=0,branches=0,minimum=Infinity,maximum=0,activeMinimum=Infinity,activeMaximum=0;
  let maxDeltaError=0,maxPowerRelativeError=0;
  const samples=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const at=(y*width+x)*4,actual=pixels.subarray(at,at+4);
   const ex=expectedAxis(bank.vertex,bank.fragment,0,x),ey=expectedAxis(bank.vertex,bank.fragment,1,y);
   const inside=ex.start<=x+.5&&x+.5<=ex.end&&ey.start<=y+.5&&y+.5<=ey.end;
   if(!inside){require(actual[0]===-10000,`uncovered pixel (${x},${y})`);continue;}
   require(actual[0]!==-10000,`missing original pixel (${x},${y})`);
   covered++;
   const deltas=[actual[0],actual[1]],predicted=[ex.delta,ey.delta];
   for(let axis=0;axis<2;axis++){
    const difference=Math.abs(deltas[axis]-predicted[axis]);
    require(Number.isFinite(difference)&&difference<.1,`interpolation/arithmetic gap bank${index} (${x},${y})`);
    maxDeltaError=Math.max(maxDeltaError,difference);
    const base=Math.abs(deltas[axis]);
    require(Number.isFinite(base)&&base>.25&&base<=2048,
     `positive-normal original power input bank${index} (${x},${y})`);
    minimum=Math.min(minimum,base);maximum=Math.max(maximum,base);
   }
   const active=actual[0]<0&&actual[1]<0;
   if(active){
    branches++;
    for(let axis=0;axis<2;axis++){
     const base=Math.abs(deltas[axis]),power=actual[axis+2],squared=base*base;
     require(Number.isFinite(power)&&power>=0,`finite active POW bank${index} (${x},${y})`);
     const relative=Math.abs(power-squared)/squared;
     require(relative<=1/16384,`physical POW contract bank${index} (${x},${y})`);
     activeMinimum=Math.min(activeMinimum,base);activeMaximum=Math.max(activeMaximum,base);
     maxPowerRelativeError=Math.max(maxPowerRelativeError,relative);
    }
   }else require(actual[2]===-10000&&actual[3]===-10000,
    `inactive first-power branch bank${index} (${x},${y})`);
   if((Math.abs(predicted[0])<6&&Math.abs(predicted[1])<6)||
      ((x===0||x===width-1||x===width>>1)&&(y===0||y===height-1||y===height>>1)))
    samples.push({x,y,actual:[...actual],ideal:predicted});
  }
  require(covered>0&&samples.length<200,'bounded adversarial physical sample inventory');
  const readback=await compressedReadback(new Uint8Array(pixels.buffer));
  return {bank:index,covered,branches,minimum,maximum,
   activeMinimum:branches?activeMinimum:null,activeMaximum:branches?activeMaximum:null,
   maxDeltaError,maxPowerRelativeError,
   samples,readbackSha256:await digest(new Uint8Array(pixels.buffer)),
   readbackGzipBase64:readback.gzipBase64,readbackGzipSha256:readback.gzipSha256,
   sourceSha256:await digest(probe),vertexGlslSha256:await digest(vertex.glsl),
   vertexGlsl:vertex.glsl,
   vertexMetadata:vertex.metadata,attributes,uniforms,blocks,drawState,logs:built.logs};
 }finally{
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);
  gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);
  for(const item of owned)gl.deleteBuffer(item);gl.deleteProgram(program);
 }
}

export async function runAcceptance({fault=null}={}){
 require([null,'source','bank','negative','nonfinite','geometry','viewport','zero-crossing'].includes(fault),
  'known original physical fault');
 const report={schema:'virgl-original-92cb-physical-power-domain-v1',status:'running',
  guestExecution:false,compilerAuthority:false,productionDrawAuthority:false,
  portableDomain:'not certified: this readback bounds one physical draw, not future renderers',
  observedDomain:'positive normal on this renderer and recorded draw only',
  maxAllowedDeltaError:0.1,fault,banks:[]};
 window.__virglOriginal92cbPowerDomainReport=report;
 const canvas=document.querySelector('#gpu');canvas.width=width;canvas.height=height;
 const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 require(gl instanceof WebGL2RenderingContext,'physical WebGL2 context');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 require(debug&&gl.getExtension('EXT_color_buffer_float'),'hardware identity and float attachments');
 report.renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
 require(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer),'hardware renderer');
 const precision=stage=>{
  const value=gl.getShaderPrecisionFormat(stage,gl.HIGH_FLOAT);
  require(value,'reported highp float precision');
  return {rangeMin:value.rangeMin,rangeMax:value.rangeMax,precision:value.precision};
 };
 report.precision={vertex:precision(gl.VERTEX_SHADER),fragment:precision(gl.FRAGMENT_SHADER)};
 const inputs=[root+vertexHash+'.tgsi',root+fragmentHash+'.tgsi',geometryPath,rasterPath];
 const responses=await Promise.all(inputs.map(path=>fetch(path)));
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
 if(fault==='bank')parsed.banks[0].fragment[24]=0x40400000;
 if(fault==='negative')parsed.banks[0].fragment[16]=0xbf800000;
 if(fault==='nonfinite')parsed.banks[0].fragment[16]=0x7fc00000;
 if(fault==='geometry')parsed.quad[6]=0x3f000000;
 if(fault==='zero-crossing')parsed.banks[0].vertex[8]=0xbe9b8000;
 window.__original92cbVertex=vertexText;
 const bridge=await createVirglShaderBridge();
 for(let index=0;index<3;index++){
  const bank=parsed.banks[index];
  require(bank.fragment[0]===0x40800000&&bank.fragment[1]===0x40800000&&
   bank.fragment[24]===0x40000000,'original center and square exponent');
  report.banks.push(await renderBank(gl,parsed.quad,bank,index,bridge,fault));
 }
 require(report.banks[0].branches===16&&report.banks[1].branches===0&&
  report.banks[2].branches===16,'original first-power branch center counts');
 report.status='passed';
 document.querySelector('#status').textContent='Physical original 92cb power input scan passed';
 document.querySelector('#renderer').textContent=report.renderer;
 return report;
}
