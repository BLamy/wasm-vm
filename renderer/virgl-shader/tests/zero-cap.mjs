import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,bindSystemBlocks,digest} from './browser.mjs';

const require=(value,message)=>{if(!value)throw new Error(message);};
const vertexText=['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1].xy, GENERIC[0]',
 'MOV OUT[0], IN[0]','MOV OUT[1].xy, IN[0].xyxx','END',''].join('\n');
const sourcePath='/evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi';
const bankPath='/target/evidence/virgl-zero-cap/banks.bin';
const float=word=>new Float32Array(new Uint32Array([word]).buffer)[0];

function fragmentPrefix(source,{negativeCap=false}={}){
 const lines=source.split('\n').filter(line=>line!=='DCL ADDR[0]');
 const first=lines.findIndex(line=>/^\s*0:/.test(line));
 require(first>=0&&/^\s*27: MIN_PRECISE/.test(lines[first+27])&&
  /^\s*28: MIN/.test(lines[first+28])&&/^\s*29: FSLT/.test(lines[first+29]),
  'literal original pc0..29');
 const prefix=lines.slice(0,first+30);
 if(negativeCap)prefix[first+28]=prefix[first+28].replace('CONST[29].xxxx','-CONST[29].xxxx');
 return [...prefix,'MOV OUT[0].w, IMM[1].xxxx','UIF TEMP[45].xxxx',
  'POW TEMP[46].x, TEMP[41].xxxx, CONST[30].xxxx',
  'MOV OUT[0].w, IMM[0].wwww','ENDIF',
  'MOV OUT[0].x, TEMP[43].xxxx',
  'MOV OUT[0].y, TEMP[44].xxxx','MOV OUT[0].z, TEMP[45].xxxx',
  'END',''].join('\n');
}

function expected(words,x,y){
 const width=float(words[128]),height=float(words[129]),ox=float(words[124]),oy=float(words[125]);
 const px=Math.abs(x-ox-width/2)-width/2+1/width;
 const py=Math.abs(768-y-oy-height/2)-height/2+1/height;
 return [Math.min(px,py),Math.min(Math.min(px,py),0),0,1];
}

export async function runAcceptance({fault=null}={}){
 const report={schema:'virgl-c580-zero-cap-gpu-v1',status:'running',guestExecution:false,
  productionNegotiation:false,fault,frames:[],rejections:[],renderer:null};
 window.__virglZeroCapReport=report;
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
 const bridge=await createVirglShaderBridge();
 const reject=(name,fragmentText,fragmentComponents)=>{
  const result=bridge.translatePairExact({vertexText,fragmentText,vertexComponents:[],fragmentComponents});
  require(!result.ok,`${name} must not inherit the c580 branch proof`);
  report.rejections.push({name,code:result.error.code});
 };
 try{
  for(let bank=0;bank<3;bank++){
   const words=Array.from({length:136},(_,i)=>view.getUint32(8+bank*136*4+i*4,true));
   const components=words.map((word,i)=>({register:i>>2,component:i&3,word}));
   for(const negativeCap of [false,true]){
   const fragmentText=fragmentPrefix(original,{negativeCap});
   const pair=bridge.translatePairExact({vertexText,fragmentText,vertexComponents:[],fragmentComponents:components});
   require(pair.ok,`literal original zero-cap pair: ${JSON.stringify(pair)}`);
   require(pair.fragment.metadata.coordinateContract?.source==='gl_FragCoord','checked coordinate convention');
   require(pair.fragment.glsl.includes('/* proved raw UIF */ if (false)'),
    'ordered positive branch is statically dead');
   require(pair.fragment.glsl.includes('min(float_temp[43].x,')&&
    pair.fragment.glsl.includes('raw_rhs = floatBitsToUint(float_rhs);'),
    'ordinary MIN winner is still computed and materialized');
   if(bank===0&&!negativeCap){
    const changed=(index,word)=>components.map((entry,i)=>i===index?{...entry,word}:entry);
    reject('wrong complete bank',fragmentText,changed(7*4+3,words[7*4+3]^1));
    reject('short bank',fragmentText,components.slice(0,-1));
    reject('NaN bank cap',fragmentText,changed(29*4,0x7fc00000));
    reject('mutated prefix',fragmentText.replace('TEMP[9].xyxx','TEMP[9].xxxx'),components);
    reject('other cap register',fragmentText.replace('CONST[29].xxxx','CONST[28].xxxx'),components);
    reject('changed ordered source',fragmentText.replace('TEMP[44].xxxx','TEMP[44].yyyy'),components);
   }
   let source=pair.fragment.glsl;
   if(fault==='coordinate'&&bank===0){
    require(source.includes('gl_FragCoord.x'),'fault source site');
    source=source.replaceAll('gl_FragCoord.x','(gl_FragCoord.x + 1.0)');
   }
   if(fault==='branch'&&bank===0&&!negativeCap){
    require(source.includes('/* proved raw UIF */ if (false) {\n }'), 'fault branch site');
    source=source.replace('/* proved raw UIF */ if (false) {\n }',
     '/* proved raw UIF */ if (true) { float_out[0].w = 2.0; raw_out[0].w = 1073741824u; }');
   }
   const built=createProgram(gl,pair.vertex,{...pair.fragment,glsl:source});
   const program=built.program,created=[];
   try{
    gl.useProgram(program);
    const blocks=[];
    const systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,blocks);
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
    for(const viewport of [{x:0,y:0,width:4,height:4},{x:-1,y:-1,width:5,height:5}]){
     report.frames.push({bank,negativeCap,viewport,sourceSha256:await digest(fragmentText),
      glslSha256:await digest(source),profile:pair.fragment.metadata.profile,
      logs:built.logs,pixels:[],systemBlocks});
     gl.viewport(viewport.x,viewport.y,viewport.width,viewport.height);
     gl.drawArrays(gl.TRIANGLES,0,3);
     const values=new Float32Array(4*4*4);gl.readPixels(0,0,4,4,gl.RGBA,gl.FLOAT,values);
     require(gl.getError()===gl.NO_ERROR,'physical prefix draw');
     for(let y=0;y<4;y++)for(let x=0;x<4;x++){
      const actual=[...values.subarray((y*4+x)*4,(y*4+x+1)*4)];
      const prediction=expected(words,x+0.5,y+0.5);
      const error=actual.map((value,lane)=>Math.abs(value-prediction[lane]));
      report.frames.at(-1).pixels.push({x,y,actual,prediction,error});
      require(error.every(value=>Number.isFinite(value)&&value<=0.02),
       `independent zero-cap pixel bank${bank} cap${negativeCap?'-0':'+0'} viewport ${JSON.stringify(viewport)} (${x},${y}): ${JSON.stringify({actual,prediction,error})}`);
     }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);
    gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);
   }finally{gl.useProgram(null);for(const block of created)gl.deleteBuffer(block);gl.deleteProgram(program);}
   }
  }
  const inputValues=report.frames.flatMap(frame=>frame.pixels.map(pixel=>pixel.prediction[0]));
  require(inputValues.some(value=>value<0)&&inputValues.some(value=>value>0),
   'physical samples exercise both finite MIN winner signs');
  require(report.rejections.length===6,'six bound negatives exercised');
  require(!fault,'injected source fault must contradict physical pixels');
  report.status='passed';document.querySelector('#status').textContent='192 float pixels checked on physical WebGL2';
  document.querySelector('#renderer').textContent=report.renderer;
 }catch(error){report.status='failed';report.failure={message:error.message};throw error;}
 return report;
}
