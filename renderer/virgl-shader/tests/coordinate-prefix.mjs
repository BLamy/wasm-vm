import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,bindSystemBlocks,digest} from './browser.mjs';

const require=(value,message)=>{if(!value)throw new Error(message);};
const vertexText=['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1].xy, GENERIC[0]',
 'MOV OUT[0], IN[0]','MOV OUT[1].xy, IN[0].xyxx','END',''].join('\n');
const sourcePath='/evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi';
const bankPath='/target/evidence/virgl-coordinate-prefix/banks.bin';
const float=word=>new Float32Array(new Uint32Array([word]).buffer)[0];

function fragmentPrefix(source){
 const lines=source.split('\n').filter(line=>line!=='DCL ADDR[0]');
 const first=lines.findIndex(line=>/^\s*0:/.test(line));
 require(first>=0&&/^\s*27: MIN_PRECISE/.test(lines[first+27]),'literal original pc0..27');
 return [...lines.slice(0,first+28),'MOV OUT[0].x, TEMP[41].xxxx',
  'MOV OUT[0].y, TEMP[41].yyyy','MOV OUT[0].z, TEMP[43].xxxx',
  'MOV OUT[0].w, IMM[1].xxxx','END',''].join('\n');
}

function expected(words,x,y){
 const width=float(words[128]),height=float(words[129]),ox=float(words[124]),oy=float(words[125]);
 const px=Math.abs(x-ox-width/2)-width/2+1/width;
 const py=Math.abs(768-y-oy-height/2)-height/2+1/height;
 return [px,py,Math.min(px,py),1];
}

export async function runAcceptance({fault=null}={}){
 const report={schema:'virgl-c580-coordinate-prefix-gpu-v1',status:'running',guestExecution:false,
  productionNegotiation:false,fault,frames:[],renderer:null};
 window.__virglCoordinatePrefixReport=report;
 const canvas=document.querySelector('#gpu');canvas.width=canvas.height=4;
 const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 require(gl instanceof WebGL2RenderingContext,'physical WebGL2');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 require(debug,'physical renderer identity');
 report.renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
 require(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer),'hardware renderer');
 require(gl.getExtension('EXT_color_buffer_float'),'float color attachment');
 const [sourceResponse,bankResponse]=await Promise.all([fetch(sourcePath),fetch(bankPath)]);
 require(sourceResponse.ok&&bankResponse.ok,'served original source and authenticated banks');
 const original=await sourceResponse.text(),binary=new Uint8Array(await bankResponse.arrayBuffer());
 report.input={sourceSha256:await digest(original),bankSha256:await digest(binary)};
 require(report.input.sourceSha256==='c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f',
  'original fragment source SHA');
 const view=new DataView(binary.buffer,binary.byteOffset,binary.byteLength);
 require(view.getUint32(0,true)===0x50435231&&view.getUint32(4,true)===3&&binary.length===8+3*136*4,
  'three complete original banks');
 const fragmentText=fragmentPrefix(original),bridge=await createVirglShaderBridge();
 try{
  for(let bank=0;bank<3;bank++){
   const words=Array.from({length:136},(_,i)=>view.getUint32(8+bank*136*4+i*4,true));
   const components=words.map((word,i)=>({register:i>>2,component:i&3,word}));
   const pair=bridge.translatePairExact({vertexText,fragmentText,vertexComponents:[],fragmentComponents:components});
   require(pair.ok,'literal original prefix pair');
   require(pair.fragment.metadata.coordinateContract?.source==='gl_FragCoord','checked coordinate convention');
   let source=pair.fragment.glsl;
   if(fault==='coordinate'&&bank===0){
    require(source.includes('gl_FragCoord.x'),'fault source site');
    source=source.replaceAll('gl_FragCoord.x','(gl_FragCoord.x + 1.0)');
   }
   const built=createProgram(gl,pair.vertex,{...pair.fragment,glsl:source});
   const program=built.program,created=[];
   try{
    gl.useProgram(program);
    const blocks=[];report.frames.push({bank,sourceSha256:await digest(fragmentText),
      glslSha256:await digest(source),profile:pair.fragment.metadata.profile,
      logs:built.logs,pixels:[],systemBlocks:bindSystemBlocks(gl,program,pair.vertex.metadata,blocks)});
    created.push(...blocks);
    const location=gl.getUniformLocation(program,'fsconst0[0]');
    require(location!==null,'active original fragment constant array');
    gl.uniform4uiv(location,new Uint32Array(words));
    const vao=gl.createVertexArray(),buffer=gl.createBuffer(),texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
    require(vao&&buffer&&texture&&framebuffer,'physical draw objects');
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,3,-1,0,1,-1,3,0,1]),gl.STATIC_DRAW);
    const attribute=gl.getAttribLocation(program,'in_0');require(attribute>=0,'position attribute');
    gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,4,gl.FLOAT,false,16,0);
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,4,4,0,gl.RGBA,gl.FLOAT,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    require(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'float framebuffer');
    for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST])gl.disable(cap);
    gl.viewport(0,0,4,4);gl.drawArrays(gl.TRIANGLES,0,3);
    const values=new Float32Array(4*4*4);gl.readPixels(0,0,4,4,gl.RGBA,gl.FLOAT,values);
    require(gl.getError()===gl.NO_ERROR,'physical prefix draw');
    for(let y=0;y<4;y++)for(let x=0;x<4;x++){
     const actual=[...values.subarray((y*4+x)*4,(y*4+x+1)*4)];
     const prediction=expected(words,x+0.5,y+0.5);
     const error=actual.map((value,lane)=>Math.abs(value-prediction[lane]));
     report.frames.at(-1).pixels.push({x,y,actual,prediction,error});
     require(error.every(value=>Number.isFinite(value)&&value<=0.02),
      `independent original-prefix pixel bank${bank} (${x},${y}): ${JSON.stringify({actual,prediction,error})}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);
    gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);
   }finally{gl.useProgram(null);for(const block of created)gl.deleteBuffer(block);gl.deleteProgram(program);}
  }
  require(!fault,'injected source fault must contradict physical pixels');
  report.status='passed';document.querySelector('#status').textContent='48 float pixels checked on physical WebGL2';
  document.querySelector('#renderer').textContent=report.renderer;
 }catch(error){report.status='failed';report.failure={message:error.message};throw error;}
 return report;
}
