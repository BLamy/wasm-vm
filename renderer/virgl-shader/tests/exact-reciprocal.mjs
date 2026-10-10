import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,texture2d,bindSystemBlocks,digest} from './browser.mjs';
import {parseConstantDomain,checkExactBank} from '../../virgl-command/constant-domain.mjs';

const require=(yes,message)=>{if(!yes)throw new Error(message);};
const same=(a,b,message)=>require(JSON.stringify(a)===JSON.stringify(b),`${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n';
function fragment(mode){
 return ['FRAG','DCL OUT[0], COLOR','DCL CONST[0]','DCL TEMP[0..4]',
  'IMM[0] FLT32 {0.25,0.0,0.0,1.0}',
  'IMM[1] UINT32 {0,8,16,24}',
  'IMM[2] UINT32 {255,255,255,255}',
  'IMM[3] FLT32 {255,255,255,255}',
  'RCP TEMP[0].x, CONST[0].xxxx',
  'POW TEMP[1].x, IMM[0].xxxx, TEMP[0].xxxx',
  ...(mode==='word'?['USHR TEMP[2], TEMP[0].xxxx, IMM[1]',
   'AND TEMP[2], TEMP[2], IMM[2]','I2F TEMP[3], TEMP[2]',
   'DIV OUT[0], TEMP[3], IMM[3]']:['MOV OUT[0], TEMP[1].xxxx']),
  'END',''].join('\n');
}
function expectedWord(input){
 const exponent=(input>>>23)&255;
 require(exponent>=1&&exponent<=253&&(input&0x7fffff)===0,'authored exact reciprocal input');
 return ((input&0x80000000)|((254-exponent)<<23))>>>0;
}
function number(word){const view=new DataView(new ArrayBuffer(4));view.setUint32(0,word,true);return view.getFloat32(0,true);}
function frame(gl,pair,word){
 const made=createProgram(gl,pair.vertex,pair.fragment),program=made.program;
 const buffers=[],textures=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer();
 require(vao&&fb,'physical draw objects');
 let uniform=null,reflection=null,blocks=null,rgba;
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);
  blocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
  const name='fsconst0[0]',index=gl.getUniformIndices(program,[name])[0];
  uniform=gl.getUniformLocation(program,name);
  // Literal specialization can erase the uniform from physical GLSL. The
  // paired compiler's exact-bank contract still requires the full DRAW bank.
  if(uniform===null||index===gl.INVALID_INDEX){
   same([uniform,index],[null,gl.INVALID_INDEX],'physically pruned exact constant');
   reflection={name,pruned:true};
  }else{
   const type=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0],size=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0];
   same([type,size],[gl.UNSIGNED_INT_VEC4,1],'actual u32 bank reflection');
   const uploaded=new Uint32Array([word,0,0,0]);gl.uniform4uiv(uniform,uploaded);
   same([...gl.getUniform(program,uniform)],[word,0,0,0],'physical exact uniform upload');
   reflection={name,index,type,size,uploaded:[...uploaded]};
  }
  const mesh=gl.createBuffer();require(mesh,'mesh buffer');buffers.push(mesh);gl.bindBuffer(gl.ARRAY_BUFFER,mesh);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]),gl.STATIC_DRAW);
  const at=gl.getAttribLocation(program,'in_0');require(at>=0,'position reflection');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,4,gl.FLOAT,false,16,0);
  const texture=texture2d(gl,4,4,null);textures.push(texture);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  same(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'physical RGBA8 framebuffer');
  for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST])gl.disable(cap);
  gl.viewport(0,0,4,4);gl.colorMask(true,true,true,true);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES,0,6);rgba=new Uint8Array(4*4*4);
  gl.readPixels(0,0,4,4,gl.RGBA,gl.UNSIGNED_BYTE,rgba);same(gl.getError(),gl.NO_ERROR,'physical GPU error');
  return {rgba:[...rgba],reflection,blocks,logs:made.logs};
 }finally{
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);
  gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);for(const t of textures)gl.deleteTexture(t);
  for(const b of buffers)gl.deleteBuffer(b);gl.deleteProgram(program);
  require(!gl.isFramebuffer(fb)&&!gl.isVertexArray(vao)&&!gl.isProgram(program),'physical objects disposed');
 }
}
export async function runAcceptance({fault=null,seed=1}={}){
 const canvas=document.getElementById('gpu'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
 require(gl instanceof WebGL2RenderingContext,'physical WebGL2 context');
 require(Number.isInteger(seed)&&seed>=1&&seed<=3,'bounded browser schedule');
 const faultBinary=fault?new Uint8Array(await(await fetch('/target/virgl-exact-reciprocal-fault/virgl-shader.wasm')).arrayBuffer()):null;
 const bridge=await createVirglShaderBridge(faultBinary?{wasmBinary:faultBinary}:{}),report={schema:1,status:'running',guestExecution:false,productionNegotiation:false,
  renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),fault,seed,frames:[]};
 if(faultBinary)report.faultWasm={bytes:faultBinary.length,sha256:await digest(faultBinary)};
 window.__virglExactReciprocalReport=report;
 document.getElementById('renderer').textContent=`${report.renderer} — ${report.version}`;
 const words=[0x40000000,0xc0000000,0x3f000000];
 const scheduled=[...words.slice(seed-1),...words.slice(0,seed-1)];
 for(const word of scheduled)for(const mode of ['word','power']){
  const text=fragment(mode),pair=bridge.translatePairExact({vertexText:vertex,fragmentText:text,
   vertexComponents:[],fragmentComponents:[{register:0,component:0,word}]});
  require(pair.ok,'actual exact paired compiler result');
  const checked=parseConstantDomain(pair.fragment.metadata,'fragment');require(checked.ok&&checked.exactDomain,'strict exact metadata');
  const bank=[word,0,0,0];require(checkExactBank(bank,checked.exactDomain,checked.exactBase).ok,'owned exact draw bank');
  require(!checkExactBank([word^1,0,0,0],checked.exactDomain,checked.exactBase).ok,'wrong bank rejected');
  require(!checkExactBank(bank.slice(0,3),checked.exactDomain,checked.exactBase).ok,'short bank rejected');
  require(pair.fragment.metadata.knownArithmeticContract.operations.includes('RCP'),'exact RCP contract');
  const literal=expectedWord(word),shadowLiteral=fault?(literal+0x00800000)>>>0:literal;
  require(pair.fragment.glsl.includes(`/* known:reciprocal */ uintBitsToFloat(${shadowLiteral}u)`),'source-bound literal shadow');
  require(pair.fragment.glsl.includes(`/* known:word */ raw_rhs.x = ${literal}u`),'literal matching word');
  const observed=frame(gl,pair,word),predicted=mode==='word'?
   [literal&255,(literal>>>8)&255,(literal>>>16)&255,(literal>>>24)&255]:
   Array(4).fill(Math.round(Math.min(1,Math.max(0,Math.pow(.25,number(literal))))*255));
  const entry={mode,inputWord:word,expectedWord:literal,predicted,checkedPixels:0,
   vertexSha256:await digest(vertex),fragmentSha256:await digest(text),glslSha256:await digest(pair.fragment.glsl),
   metadata:pair.fragment.metadata,observed};report.frames.push(entry);
  for(let pixel=0;pixel<16;pixel++)for(let lane=0;lane<4;lane++){
   const actual=observed.rgba[4*pixel+lane],wanted=predicted[lane];
   if(Math.abs(actual-wanted)>(mode==='word'?0:2)){
    entry.failure={pixel,lane,actual,wanted};throw new Error(`${mode}/${word.toString(16)}/pixel${pixel}/lane${lane}: ${actual} != ${wanted}`);
   }
   entry.checkedPixels++;
  }
  const figure=document.createElement('figure'),swatch=document.createElement('img'),caption=document.createElement('figcaption');
  const pic=document.createElement('canvas');pic.width=4;pic.height=4;const pctx=pic.getContext('2d');
  pctx.putImageData(new ImageData(new Uint8ClampedArray(observed.rgba),4,4),0,0);swatch.src=pic.toDataURL();
  caption.textContent=`${mode} · 0x${word.toString(16)} → 0x${literal.toString(16)} · ${entry.checkedPixels} channels`;
  figure.append(swatch,caption);document.getElementById('draws').append(figure);
 }
 same(gl.getError(),gl.NO_ERROR,'final GL error');report.status='passed';
 document.getElementById('status').textContent=`Passed ${report.frames.length} exact RCP frames / ${report.frames.reduce((n,x)=>n+x.checkedPixels,0)} channels.`;
 return report;
}
