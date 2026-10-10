import {createVirglStandardShaderBridge} from '../standard.mjs';
import {createProgram,bindSystemBlocks,digest} from './browser.mjs';
import {originalOracle} from '../../../tools/virgl-original-programs/oracle.mjs';
const require=(v,m)=>{if(!v)throw new Error(m);};
const word=f=>new Uint32Array(new Float32Array([f]).buffer)[0];
const float=w=>new Float32Array(new Uint32Array([w]).buffer)[0];
const words=values=>values.map(word);
const text=(stage,decl,body)=>(stage==='vertex'?'VERT':'FRAG')+'\n'+decl+'\n'+body.concat('END').map((line,i)=>`${i}: ${line}\n`).join('');
const VS=text('vertex','DCL IN[0]\nDCL OUT[0], POSITION',['MOV OUT[0], IN[0]']);
const quad=[-1,-1,0,1,3,-1,0,1,-1,3,0,1];
function encoded(bytes){let result='';for(let at=0;at<bytes.length;at+=32768)result+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(result);}
async function pixels(bytes){const zipped=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());return{bytes:bytes.length,sha256:await digest(bytes),gzipSha256:await digest(zipped),gzipBase64:encoded(zipped)};}
export async function draw(gl,pair,spec,report,fault){
 const actual={vertex:pair.vertex,fragment:pair.fragment};
 if(fault==='sine'&&spec.name==='dynamic-fragment-SIN-0'){
  require(actual.fragment.glsl.includes('sin('),'real native sine mutation site');
  actual.fragment={...pair.fragment,glsl:pair.fragment.glsl.replace('sin(','cos(')};
 }
 const built=createProgram(gl,actual.vertex,actual.fragment),program=built.program;
 const buffers=[],textures=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer();
 require(vao&&fb,'physical standard draw objects');
 const frame={name:spec.name,width:spec.width??16,height:spec.height??16,mode:spec.mode??gl.TRIANGLES,count:spec.count??3,instances:spec.instances??null,clear:spec.clear??[-10000,-10000,-10000,-10000],budget:spec.budget??0.00005,vertexText:spec.vertexText??VS,fragmentText:spec.fragmentText,interfaceKey:pair.interfaceKey,vertex:actual.vertex,fragment:actual.fragment,logs:built.logs,banks:[],attributes:[],textures:[],outputs:[],fixture:spec.fixture??null};
 report.frames.push(frame);
 try{
  gl.useProgram(program);frame.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
  gl.bindVertexArray(vao);
  for(const [index,input] of (spec.attributes??[{name:'in_0',components:4,values:quad}]).entries()){
   const buffer=gl.createBuffer();require(buffer,'physical vertex buffer');buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
   const data=new Float32Array(input.values);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
   const location=gl.getAttribLocation(program,input.name);require(location>=0,'active '+input.name);
   gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,input.components,gl.FLOAT,false,0,0);
   const read=new Uint8Array(data.byteLength);gl.getBufferSubData(gl.ARRAY_BUFFER,0,read);
   require(await digest(read)===await digest(new Uint8Array(data.buffer)),'actual GPU attribute bytes');
   frame.attributes.push({name:input.name,location,components:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_SIZE),type:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_TYPE),stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),bufferWords:[...new Uint32Array(read.buffer)]});
  }
  for(const [name,input] of [['vsconst0',spec.vertexWords],['fsconst0',spec.fragmentWords]])if(input){
   const location=gl.getUniformLocation(program,name+'[0]');require(location!==null,'active bank '+name);
   const uniform=gl.getUniformIndices(program,[name+'[0]'])[0];require(uniform!==gl.INVALID_INDEX,'bank reflection '+name);
   const count=gl.getActiveUniforms(program,[uniform],gl.UNIFORM_SIZE)[0],type=gl.getActiveUniforms(program,[uniform],gl.UNIFORM_TYPE)[0];
   require(type===gl.UNSIGNED_INT_VEC4&&count*4<=input.length,'raw standard bank type/prefix');gl.uniform4uiv(location,new Uint32Array(input.slice(0,count*4)));
   const observed=[];for(let i=0;i<count;++i)observed.push(...gl.getUniform(program,gl.getUniformLocation(program,`${name}[${i}]`)));
   require(observed.every((n,i)=>n===input[i]),'bound standard raw bank bytes');frame.banks.push({name,count,type,inputWords:input.slice(),actualWords:observed});
  }
  for(const sample of spec.samplers??[]){
   const texture=gl.createTexture();textures.push(texture);gl.activeTexture(gl.TEXTURE0+sample.unit);gl.bindTexture(gl.TEXTURE_2D,texture);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,2,2,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(sample.rgba));
   const location=gl.getUniformLocation(program,sample.name);require(location!==null,'active sampler '+sample.name);gl.uniform1i(location,sample.unit);
   frame.textures.push({...sample,actualUnit:gl.getUniform(program,location)});
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,fb);const attachments=spec.outputs??1;
  for(let i=0;i<attachments;++i){const t=gl.createTexture();textures.push(t);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,frame.width,frame.height,0,gl.RGBA,gl.FLOAT,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0);}
  gl.drawBuffers(Array.from({length:attachments},(_,i)=>gl.COLOR_ATTACHMENT0+i));require(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'standard float framebuffer');
  for(const capability of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD])gl.disable(capability);
  gl.colorMask(true,true,true,true);gl.viewport(0,0,frame.width,frame.height);gl.clearColor(...frame.clear);gl.clear(gl.COLOR_BUFFER_BIT);
  if(frame.instances===null)gl.drawArrays(frame.mode,0,frame.count);else gl.drawArraysInstanced(frame.mode,0,frame.count,frame.instances);
  let mismatches=[];
  for(let output=0;output<attachments;++output){gl.readBuffer(gl.COLOR_ATTACHMENT0+output);const raw=new Float32Array(frame.width*frame.height*4);gl.readPixels(0,0,frame.width,frame.height,gl.RGBA,gl.FLOAT,raw);
   require(gl.getError()===gl.NO_ERROR,'standard actual GPU draw/read has no GL error');let maxError=0;const samples=[];
   for(let y=0;y<frame.height;++y)for(let x=0;x<frame.width;++x){const expected=spec.expected(x,y,output),actual=[...raw.slice((y*frame.width+x)*4,(y*frame.width+x+1)*4)];
    const errors=actual.map((n,i)=>Math.abs(n-expected[i]));maxError=Math.max(maxError,...errors);
    if(errors.some(n=>!Number.isFinite(n)||n>frame.budget)&&mismatches.length<4)mismatches.push({output,x,y,expected,actual,errors});
    if((x===0&&y===0)||(x===8&&y===8)||(x===frame.width-1&&y===frame.height-1))samples.push({x,y,expected,actual});}
   frame.outputs.push({output,maxError,samples,pixels:await pixels(new Uint8Array(raw.buffer))});
   if(output===0&&spec.name.startsWith('full-original-')){
    const preview=document.createElement('canvas');preview.width=frame.width;preview.height=frame.height;const context=preview.getContext('2d'),data=context.createImageData(frame.width,frame.height);
    for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++)for(let lane=0;lane<4;lane++)data.data[((frame.height-1-y)*frame.width+x)*4+lane]=Math.round(Math.max(0,Math.min(1,raw[(y*frame.width+x)*4+lane]))*255);
    context.putImageData(data,0,0);const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=preview.toDataURL('image/png');caption.textContent=spec.name+' · actual GPU readback';figure.append(img,caption);document.querySelector('#draws').append(figure);
   }
  }
  frame.mismatches=mismatches;require(!mismatches.length,spec.name+' independent standard pixels: '+JSON.stringify(mismatches));
 }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);for(const b of buffers)gl.deleteBuffer(b);for(const t of textures)gl.deleteTexture(t);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);gl.deleteProgram(program);require(buffers.every(b=>!gl.isBuffer(b))&&textures.every(t=>!gl.isTexture(t))&&!gl.isFramebuffer(fb)&&!gl.isVertexArray(vao)&&!gl.isProgram(program),'standard physical object cleanup');}
}
export async function runAcceptance({matrixPath,nativePath,geometryPath,banksPath,fault=null}){
 const report={schema:'virgl-standard-shader-hardware-v1',status:'running',guestExecution:false,productionNegotiation:false,fault,compiles:[],frames:[]};window.__standardShaderReport=report;
 const canvas=document.querySelector('#gpu'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(gl instanceof WebGL2RenderingContext,'hardware WebGL2 context');require(gl.getExtension('EXT_color_buffer_float'),'actual physical float readback');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');require(debug,'physical GPU identity');report.renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);require(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer),'physical GPU required');
 report.limits={vertexUniformComponents:gl.getParameter(gl.MAX_VERTEX_UNIFORM_COMPONENTS),fragmentUniformComponents:gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_COMPONENTS),varyingVectors:gl.getParameter(gl.MAX_VARYING_VECTORS),vertexAttributes:gl.getParameter(gl.MAX_VERTEX_ATTRIBS),combinedSamplers:gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)};
 const matrix=await(await fetch(matrixPath)).json(),native=(await(await fetch(nativePath)).text()).trim().split('\n').map(JSON.parse),bridge=await createVirglStandardShaderBridge();
 for(const [i,c]of matrix.cases.entries())if(c.okay&&c.kind<3){
  const translated=c.kind===2?bridge.translatePair({vertexText:c.a,fragmentText:c.b}):bridge.translate({stage:c.kind===0?'vertex':'fragment',text:c.a});
  require(JSON.stringify(translated)===JSON.stringify(native[i].result),c.name+' browser/native exact compiler response');
  const records=[];
  for(const [stage,result]of(c.kind===2?[[0,translated.vertex],[1,translated.fragment]]:[[c.kind,translated]])){
   const shader=gl.createShader(stage===0?gl.VERTEX_SHADER:gl.FRAGMENT_SHADER);gl.shaderSource(shader,result.glsl);gl.compileShader(shader);
   const success=gl.getShaderParameter(shader,gl.COMPILE_STATUS),log=gl.getShaderInfoLog(shader);records.push({stage,success,log,glsl:result.glsl,metadata:result.metadata});gl.deleteShader(shader);require(success,c.name+' physical compile: '+log);}
  let link=null;if(c.kind===2){const p=createProgram(gl,translated.vertex,translated.fragment);link=p.logs;gl.deleteProgram(p.program);}
  report.compiles.push({name:c.name,records,link});require(gl.getError()===gl.NO_ERROR,'physical compile/link GL error');
 }
 async function run(spec){const vertexText=spec.vertexText??VS;const pair=bridge.translatePair({vertexText,fragmentText:spec.fragmentText});require(pair.ok,spec.name+' standard pair: '+JSON.stringify(pair.error));await draw(gl,pair,spec,report,fault);}
 const math={SIN:Math.sin,EX2:x=>2**x,LG2:Math.log2,POW:(x,y)=>x**y};
 for(const stage of ['fragment','vertex'])for(const op of ['SIN','EX2','LG2','POW'])for(let bank=0;bank<3;bank++){
  const x={SIN:[.5,.75,1],EX2:[-.5,0,.5],LG2:[1.25,1.5,1.75],POW:[.5,.75,1.25]}[op][bank],y=1.5,base=[.125,.375,.625,.75];
  const decl='DCL CONST[0..1]\nDCL TEMP[0]',body=['MOV TEMP[0], CONST[1]',`${op} TEMP[0].yz, CONST[0].xxxx`+(op==='POW'?', CONST[0].yyyy':''),'MOV OUT['+(stage==='vertex'?'1':'0')+'], TEMP[0]'];
  const fragmentText=stage==='fragment'?text(stage,decl+'\nDCL OUT[0], COLOR',body):text('fragment','DCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR',['MOV OUT[0], IN[0]']);
  const vertexText=stage==='vertex'?text(stage,'DCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n'+decl,['MOV OUT[0], IN[0]',...body]):VS;
  const expected=[base[0],math[op](x,y),math[op](x,y),base[3]],data=words([x,y,0,0,...base]);
  await run({name:`dynamic-${stage}-${op}-${bank}`,vertexText,fragmentText,[stage==='vertex'?'vertexWords':'fragmentWords']:data,fixture:{kind:'math',op,x,y,base},expected:()=>expected});
 }
 // Scalar TGSI instructions replicate the first SWIZZLED lane. Distinct
 // remaining lanes and yz-only destinations expose componentwise lowering.
 for(const [op,fn]of Object.entries({RCP:x=>1/x,RSQ:x=>1/Math.sqrt(x),SQRT:Math.sqrt,SIN:Math.sin,COS:Math.cos,EX2:x=>2**x,LG2:Math.log2,POW:(x,y)=>x**y}))for(const swizzle of ['xyzw','yxwz']){
  const a=[1.25,.5,2.5,.75],b=[1.5,2,.5,.25],base=[.125,.375,.625,.75],at=swizzle==='xyzw'?0:1;
  const value=fn(a[at],b[at]),expected=[base[0],value,value,base[3]];
  await run({name:`scalar-replicate-${op}-${swizzle}`,fragmentText:text('fragment','DCL CONST[0..2]\nDCL TEMP[0]\nDCL OUT[0], COLOR',['MOV TEMP[0], CONST[2]',`${op} TEMP[0].yz, CONST[0].${swizzle}`+(op==='POW'?`, CONST[1].${swizzle}`:''),'MOV OUT[0], TEMP[0]']),fragmentWords:words([...a,...b,...base]),fixture:{kind:'scalar',op,swizzle,a,b,base},expected:()=>expected});
 }
 const fa=[1.25,2.5,-1.75,.25],fb=[.5,-.25,2,.75],fc=[.25,.5,.75,1];
 const roundEven=x=>{const n=Math.floor(x),r=x-n;return r===.5?n+(n%2!==0?1:0):Math.round(x);};
 const floats={MUL:(a,b)=>a*b,ADD:(a,b)=>a+b,SUB:(a,b)=>a-b,DIV:(a,b)=>a/b,MAD:(a,b,c)=>a*b+c,LRP:(a,b,c)=>a*b+(1-a)*c,MIN:(a,b)=>Math.min(a,b),MAX:(a,b)=>Math.max(a,b),ABS:Math.abs,FRC:x=>x-Math.floor(x),FLR:Math.floor,ROUND:roundEven,TRUNC:Math.trunc,CEIL:Math.ceil,SSG:Math.sign,SEQ:(a,b)=>+(a===b),SNE:(a,b)=>+(a!==b),SLT:(a,b)=>+(a<b),SGE:(a,b)=>+(a>=b)};
 for(const [op,fn]of Object.entries(floats)){
  const unary=['ABS','FRC','FLR','ROUND','TRUNC','CEIL','SSG'].includes(op),ternary=['MAD','LRP'].includes(op),ns=unary?1:ternary?3:2;
  await run({name:'float-vector-'+op,fragmentText:text('fragment','DCL CONST[0..2]\nDCL OUT[0], COLOR',[`${op} OUT[0], `+Array.from({length:ns},(_,i)=>`CONST[${i}]`).join(', ')]),fragmentWords:words([...fa,...fb,...fc]),fixture:{kind:'float-vector',op,a:fa,b:fb,c:fc},expected:()=>fa.map((a,i)=>fn(a,fb[i],fc[i]))});
 }
 for(const n of [2,3,4]){
  const value=fa.slice(0,n).reduce((sum,x,i)=>sum+x*fb[i],0);
  await run({name:'float-dot-'+n,fragmentText:text('fragment','DCL CONST[0..1]\nDCL OUT[0], COLOR',[`DP${n} OUT[0], CONST[0], CONST[1]`]),fragmentWords:words([...fa,...fb]),fixture:{kind:'dot',n,a:fa,b:fb},expected:()=>Array(4).fill(value)});
 }
 const ua=[0xffffffff,0x80000000,0x3f800000,0x87654321],ub=[33,0xffffffff,4,0x8000001f],mask=b=>b?0xffffffff:0;
 const integer={UADD:(a,b)=>(a+b)>>>0,UMUL:Math.imul,INEG:a=>(-a)>>>0,IMIN:(a,b)=>Math.min(a|0,b|0)>>>0,IMAX:(a,b)=>Math.max(a|0,b|0)>>>0,UMIN:(a,b)=>Math.min(a,b),UMAX:(a,b)=>Math.max(a,b),AND:(a,b)=>(a&b)>>>0,OR:(a,b)=>(a|b)>>>0,XOR:(a,b)=>(a^b)>>>0,NOT:a=>(~a)>>>0,SHL:(a,b)=>(a<<(b&31))>>>0,ISHR:(a,b)=>(a>>(b&31))>>>0,USHR:(a,b)=>a>>>(b&31),USEQ:(a,b)=>mask(a===b),USNE:(a,b)=>mask(a!==b),USLT:(a,b)=>mask(a<b),USGE:(a,b)=>mask(a>=b),ISLT:(a,b)=>mask((a|0)<(b|0)),ISGE:(a,b)=>mask((a|0)>=(b|0)),I2F:a=>word(a|0),U2F:a=>word(a),MOV:a=>a,UCMP:(a,b,c)=>a?b:c};
 for(const [op,fn]of Object.entries(integer)){
  const unary=['INEG','NOT','I2F','U2F','MOV'].includes(op),ternary=op==='UCMP',a=ternary?[0,1,0xffffffff,0x80000000]:ua,b=ub,c=[word(.25),word(.5),word(.75),word(1)];
  const expectedWords=a.map((x,i)=>fn(x,b[i],c[i])>>>0),data=[...a,...b,...expectedWords,...c],sources=['CONST[0]'].concat(unary?[]:['CONST[1]']).concat(ternary?['CONST[3]']:[]);
  await run({name:'integer-word-'+op,fragmentText:text('fragment','DCL CONST[0..3]\nDCL TEMP[0..1]\nDCL OUT[0], COLOR\nIMM[0] UINT32 {1,1,1,1}',[`${op} TEMP[0], ${sources.join(', ')}`,'USEQ TEMP[1], TEMP[0], CONST[2]','AND TEMP[1], TEMP[1], IMM[0]','U2F OUT[0], TEMP[1]']),fragmentWords:data,fixture:{kind:'integer-word',op,a,b,c,expectedWords},expected:()=>[1,1,1,1]});
 }
 for(const [op,fn]of Object.entries({FSEQ:(a,b)=>mask(a===b),FSNE:(a,b)=>mask(a!==b),FSLT:(a,b)=>mask(a<b),FSGE:(a,b)=>mask(a>=b),F2I:a=>Math.trunc(a)>>>0,F2U:a=>Math.trunc(a)>>>0})){
  const a=op==='F2U'?fa.map(Math.abs):fa,b=fb,ns=op.startsWith('F2')?1:2,expectedWords=a.map((x,i)=>fn(x,b[i]));
  await run({name:'typed-word-'+op,fragmentText:text('fragment','DCL CONST[0..2]\nDCL TEMP[0..1]\nDCL OUT[0], COLOR\nIMM[0] UINT32 {1,1,1,1}',[`${op} TEMP[0], CONST[0]`+(ns===2?', CONST[1]':''),'USEQ TEMP[1], TEMP[0], CONST[2]','AND TEMP[1], TEMP[1], IMM[0]','U2F OUT[0], TEMP[1]']),fragmentWords:words([...a,...b]).concat(expectedWords),fixture:{kind:'typed-word',op,a,b,expectedWords},expected:()=>[1,1,1,1]});
 }
 await run({name:'literal-nan-mask-custody',fragmentText:text('fragment','DCL CONST[0..1]\nDCL TEMP[0..1]\nDCL OUT[0], COLOR\nIMM[0] UINT32 {4294967295,4294967295,4294967295,4294967295}',['MOV TEMP[0], IMM[0]','NOT TEMP[1], TEMP[0]','UCMP OUT[0], TEMP[1], CONST[0], CONST[1]']),fragmentWords:words([.125,.125,.125,.125,.875,.875,.875,.875]),fixture:{kind:'constant',value:[.875,.875,.875,.875]},expected:()=>[.875,.875,.875,.875]});
 await run({name:'flat-raw-word-custody',vertexText:text('vertex','DCL IN[0]\nDCL CONST[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]',['MOV OUT[0], IN[0]','MOV OUT[1], CONST[0]']),fragmentText:text('fragment','DCL IN[0], GENERIC[0], CONSTANT\nDCL CONST[0]\nDCL TEMP[0]\nDCL OUT[0], COLOR\nIMM[0] UINT32 {1,1,1,1}',['USEQ TEMP[0], IN[0], CONST[0]','AND TEMP[0], TEMP[0], IMM[0]','U2F OUT[0], TEMP[0]']),vertexWords:ua,fragmentWords:ua,fixture:{kind:'flat-words',words:ua},expected:()=>[1,1,1,1]});
 for(const semantic of ['VERTEXID','INSTANCEID']){
  const value=semantic==='VERTEXID'?2:1;
  await run({name:'system-physical-'+semantic,instances:semantic==='INSTANCEID'?2:null,vertexText:text('vertex','DCL IN[0]\nDCL SV[0], '+semantic+'\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]',['MOV OUT[0], IN[0]','I2F OUT[1], SV[0]']),fragmentText:text('fragment','DCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR',['MOV OUT[0], IN[0]']),fixture:{kind:'system',semantic,value},expected:()=>Array(4).fill(value)});
 }
 for(const op of ['DDX','DDY']){
  const value=op==='DDX'?[1,0,0,0]:[0,1,0,0];
  await run({name:'native-derivative-'+op,fragmentText:text('fragment','PROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[0], POSITION, LINEAR\nDCL OUT[0], COLOR',[`${op} OUT[0], IN[0]`]),fixture:{kind:'derivative',op},expected:()=>value});
 }
 for(const [op,condition]of[['IF',0],['IF',1],['UIF',0],['UIF',1]]){
  const a=[.125,.375,.625,.75],b=[.875,.625,.375,.25],data=words([0,0,0,0,...a,...b]);data[0]=op==='UIF'?condition:word(condition);
  await run({name:`branch-${op}-${condition}`,fragmentText:text('fragment','DCL CONST[0..2]\nDCL OUT[0], COLOR',[`${op} CONST[0].xxxx :2`,'MOV OUT[0], CONST[1]','ELSE :4','MOV OUT[0], CONST[2]','ENDIF']),fragmentWords:data,fixture:{kind:'branch',op,condition,a,b},expected:()=>condition?a:b});
 }
 for(const op of ['UARL','ARL']){
  const color=[.25,.5,.75,1],data=words([0,0,0,0,...color]);data[0]=op==='UARL'?1:word(1.75);
  await run({name:'indirect-'+op,fragmentText:text('fragment','DCL CONST[0..1]\nDCL ADDR[0]\nDCL OUT[0], COLOR',[`${op} ADDR[0].x, CONST[0].xxxx`,'MOV OUT[0], CONST[ADDR[0].x]']),fragmentWords:data,fixture:{kind:'constant',value:color},expected:()=>color});
 }
 const base=[.125,.25,.375,.5],step=[.03125,.0625,.125,.015625],loopWords=words([0,0,0,0,...base,...step]);loopWords.splice(0,4,3,3,3,3);
 await run({name:'dynamic-integer-loop',fragmentText:text('fragment','DCL CONST[0..2]\nDCL TEMP[0..2]\nDCL OUT[0], COLOR\nIMM[0] UINT32 {0,0,0,0}\nIMM[1] UINT32 {1,1,1,1}',['MOV TEMP[0], IMM[0]','MOV TEMP[1], CONST[1]','BGNLOOP :9','ADD TEMP[1], TEMP[1], CONST[2]','UADD TEMP[0], TEMP[0], IMM[1]','USGE TEMP[2], TEMP[0], CONST[0]','UIF TEMP[2].xxxx :8','BRK','ENDIF','ENDLOOP :2','MOV OUT[0], TEMP[1]']),fragmentWords:loopWords,fixture:{kind:'loop',base,step,count:3},expected:()=>base.map((n,i)=>n+3*step[i])});
 const swapped=[.25,-.5,.75,-1.25];await run({name:'absolute-negation-saturation-precise',fragmentText:text('fragment','DCL CONST[0]\nDCL OUT[0], COLOR',['MOV_SAT_PRECISE OUT[0], -|CONST[0].wzyx|']),fragmentWords:words(swapped),fixture:{kind:'constant',value:[0,0,0,0]},expected:()=>[0,0,0,0]});
 for(const flat of [false,true]){
  const colors=[[.125,.25,.375,.5],[.625,.75,.875,1],[.25,.625,.5,.75]];
  await run({name:'partial-'+(flat?'flat':'smooth'),vertexText:text('vertex','DCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[31].xy, GENERIC[15]',['MOV OUT[0], IN[0]','MOV OUT[31].xy, IN[1].xyyy']),fragmentText:text('fragment','DCL IN[31].xy, GENERIC[15], '+(flat?'CONSTANT':'PERSPECTIVE')+'\nDCL CONST[0]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[0]','MOV OUT[0].xy, IN[31].xyyy']),fragmentWords:words([0,0,.5,1]),attributes:[{name:'in_0',components:4,values:quad},{name:'in_1',components:4,values:colors.flat()}],fixture:{kind:'varying',flat,colors},expected:(x,y)=>{const l=[1-(x+y+1)/32,(x+.5)/32,(y+.5)/32];return [0,1].map(i=>flat?colors[2][i]:l.reduce((v,w,j)=>v+w*colors[j][i],0)).concat(.5,1);}});
 }
 const high=Array(512*4).fill(0),value=[.25,.5,.75,.875];high.splice(511*4,4,...words(value));await run({name:'constant511',fragmentText:text('fragment','DCL CONST[0..511]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[511]']),fragmentWords:high,fixture:{kind:'constant',value},expected:()=>value});
 const mrt=[[.125,.25,.375,.5],[.75,.875,1,.625],[.25,.125,.5,.875],[.625,.375,.875,.25]];
 await run({name:'four-color-outputs',outputs:4,fragmentText:text('fragment','DCL CONST[0..3]\n'+mrt.map((_,i)=>`DCL OUT[${i}], COLOR[${i}]`).join('\n'),mrt.map((_,i)=>`MOV OUT[${i}], CONST[${i}]`)),fragmentWords:words(mrt.flat()),fixture:{kind:'mrt',values:mrt},expected:(x,y,i)=>mrt[i]});
 await run({name:'broadcast-four-color-outputs',outputs:4,fragmentText:text('fragment','PROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1\nDCL CONST[0]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[0]']),fragmentWords:words(value),fixture:{kind:'constant',value},expected:()=>value});
 await run({name:'native-fragment-position',fragmentText:text('fragment','PROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[0], POSITION, LINEAR\nDCL OUT[0], COLOR',['MOV OUT[0], IN[0]']),fixture:{kind:'position'},expected:(x,y)=>[x+.5,y+.5,.5,1]});
 for(const negative of [false,true]){
  const v=[negative?-.25:.25,.5,.75,1];await run({name:'native-discard-'+negative,fragmentText:text('fragment','DCL CONST[0]\nDCL OUT[0], COLOR',['MOV OUT[0], CONST[0]','KILL_IF CONST[0]']),fragmentWords:words(v),fixture:{kind:'discard',negative,value:v},expected:()=>negative?[-10000,-10000,-10000,-10000]:v});
 }
 for(const stage of ['vertex','fragment']){
  const decl='DCL SAMP[15]\nDCL SVIEW[15], 2D, FLOAT';const color=[32/255,96/255,160/255,224/255],rgba=[32,96,160,224,64,128,192,255,128,64,32,255,200,180,160,140];
  const vt=stage==='vertex'?text('vertex','DCL IN[0]\nDCL CONST[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n'+decl,['MOV OUT[0], IN[0]','TEX OUT[1], CONST[0], SAMP[15], 2D']):VS;
  const ft=stage==='fragment'?text('fragment','DCL CONST[0]\nDCL OUT[0], COLOR\n'+decl,['TEX OUT[0], CONST[0], SAMP[15], 2D']):text('fragment','DCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR',['MOV OUT[0], IN[0]']);
  await run({name:'native-'+stage+'-sampler15',vertexText:vt,fragmentText:ft,[stage==='vertex'?'vertexWords':'fragmentWords']:words([.25,.25,0,1]),samplers:[{name:(stage==='vertex'?'vs':'fs')+'samp15',unit:15,rgba}],fixture:{kind:'constant',value:color},expected:()=>color});
 }
 const unused='DCL SAMP[15]\nDCL SVIEW[15], 2D, FLOAT';
 await run({name:'unused-sampler-both-stages',width:4,height:4,
  vertexText:text('vertex','DCL IN[0]\nDCL OUT[0], POSITION\n'+unused,['MOV OUT[0], IN[0]']),
  fragmentText:text('fragment','DCL CONST[0]\nDCL OUT[0], COLOR\n'+unused,['MOV OUT[0], CONST[0]']),
  fragmentWords:words([.25,.5,.75,.875]),fixture:{kind:'constant',value:[.25,.5,.75,.875]},expected:()=>[.25,.5,.75,.875]});
 const originals=new Map(matrix.originals.map(o=>[o.sha256,o.text]));
 const geometry=new DataView(await(await fetch(geometryPath)).arrayBuffer());require(geometry.byteLength===2040&&geometry.getUint32(4,true)===3,'authenticated full original geometry extent');
 const rw=(offset,count)=>Array.from({length:count},(_,i)=>geometry.getUint32(offset+i*4,true));
 const v92='7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e',f92='92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba';
 for(let bank=0;bank<3;bank++){
  const vertex=rw(72+bank*656,16),fragment=rw(136+bank*656,148),data=rw(8,16).map(float);
  const ax=(axis,pixel)=>{const scale=axis?384:512,start=scale*(float(vertex[8+axis])+1),end=scale*(float(vertex[axis?5:0])+float(vertex[8+axis])+1);return{start,end,value:float(fragment[16+axis])*(pixel+.5-start)/(end-start)};};
  await run({name:'full-original-92cb-'+bank,width:1024,height:768,mode:gl.TRIANGLE_STRIP,count:4,budget:.0001,vertexText:originals.get(v92),fragmentText:originals.get(f92),vertexWords:vertex,fragmentWords:fragment,attributes:[{name:'in_0',components:2,values:[data[0],data[1],data[4],data[5],data[8],data[9],data[12],data[13]]},{name:'in_1',components:2,values:[data[2],data[3],data[6],data[7],data[10],data[11],data[14],data[15]]}],fixture:{kind:'original92',bank,vertex,fragment},expected:(x,y)=>{const a=ax(0,x),b=ax(1,y);if(x+.5<a.start||x+.5>a.end||y+.5<b.start||y+.5>b.end)return[-10000,-10000,-10000,-10000];const o=originalOracle(fragment,a.value,b.value);return o.discard?[-10000,-10000,-10000,-10000]:o.color;}});
 }
 const c580=new DataView(await(await fetch(banksPath)).arrayBuffer());require(c580.byteLength===1784&&c580.getUint32(4,true)===3,'original c580 paired bank extent');
 const cf=(b,offset,count)=>Array.from({length:count},(_,i)=>c580.getUint32(8+b*592+(offset+i)*4,true));
 for(let bank=0;bank<3;bank++)for(const edge of ['near','far']){
  const vertex=cf(bank,0,12),fragment=cf(bank,12,136),w=float(fragment[0]),h=float(fragment[1]),sx=float(vertex[0]),sy=float(vertex[5]),ox=float(vertex[8]),oy=float(vertex[9]);
  const positions=[],uv=[];for(const[x,y]of[[-1,-1],[3,-1],[-1,3]]){positions.push((x-ox)/sx,(y-oy)/sy,0,1);uv.push(((edge==='near'?0:w-4)+(x+1)*2)/w,((edge==='near'?0:h-4)+(y+1)*2)/h,0,0);}
  const color=c580Color(fragment);await run({name:`full-original-c580-${bank}-${edge}`,width:4,height:4,budget:.02,clear:[0,0,1,1],vertexText:originals.get('403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c'),fragmentText:originals.get('c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f'),vertexWords:vertex,fragmentWords:fragment,attributes:[{name:'in_0',components:4,values:positions},{name:'in_1',components:4,values:uv}],fixture:{kind:'originalC580',bank,edge,vertex,fragment},expected:(x,y)=>{const px=(edge==='near'?0:w-4)+x+.5,py=(edge==='near'?0:h-4)+y+.5;return Math.min(px,w-px,py,h-py)<=1?color:[0,0,1,1];}});
 }
 // Both stages place the isolated zero declaration after CONST511. Real
 // reflection and all 512 uploaded vectors must retain the independent max.
 const order=matrix.cases.find(c=>c.name==='constant-order-both-stages');require(order,'recorded declaration-order pair');
 for(let bank=0;bank<3;bank++){
  const vertex=Array(2048).fill(0),fragment=Array(2048).fill(0);
  const v0=[(bank+1)/32,1/16,1/8,3/16],v511=[1/8,1/8,1/4,1/4],f0=[1/16,1/8,3/16,1/4],f511=[1/8,1/16,1/32,1/8];
  for(const [input,at,values]of[[vertex,0,v0],[vertex,2044,v511],[fragment,0,f0],[fragment,2044,f511]])input.splice(at,4,...words(values));
  await run({name:'constant-order-physical-'+bank,width:4,height:4,vertexText:order.a,fragmentText:order.b,vertexWords:vertex,fragmentWords:fragment,fixture:{kind:'constant-order',bank},expected:()=>v0.map((n,i)=>n+v511[i]+f511[i]+f0[i])});
 }
 report.status='passed';document.querySelector('#status').textContent=`${report.compiles.length} full shader/program compiles, ${report.frames.length} physical draws with independent pixels`;document.querySelector('#renderer').textContent=report.renderer;return report;
}
function c580Color(words){
 const a=[1053486281,1046281129,1082291371,1055439406].map(float),b=[1037578380,1031980538,1035420539,1067798374].map(float),d=[1079226764,1051640170,1060377406].map(float),e=[1047298914,1076299332,1071289118].map(float),k=[1067605037,998866771].map(float),c=words.slice(12,16).map(float);
 const s=c[0]+c[1]*a[0]+c[2]*a[1],u=c[0]-c[1]*(b[0]+b[2])-c[2]*(b[1]+b[3]),s3=s*s*s,u3=u*u*u;
 const linear=[s3*a[2]-u3*d[0]+u3*e[0],-s3*k[0]+u3*e[1]-u3*d[1],-s3*k[1]-u3*d[2]+u3*e[2]],opacity=c[3]*float(words[28*4]);return linear.map(n=>Math.max(n,0)**a[3]*opacity).concat(opacity);
}
