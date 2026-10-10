import {createVirglStandardUniformShaderBridge} from '../standard.mjs';
import {normalizeStandardUniformShaderPair} from '../../virgl-command/constant-domain.mjs';
import {createProgram,digest} from './browser.mjs';
import {hardwareFixtures} from '../../../tools/virgl-standard-uniform/hardware-fixtures.mjs';
import {selectorKeys} from '../../../tools/virgl-standard-uniform/cases.mjs';
const need=(value,message)=>{if(!value)throw Error(message);};
const equal=(a,b,message)=>need(JSON.stringify(a)===JSON.stringify(b),message);
function encoded(bytes){let value='';for(let at=0;at<bytes.length;at+=32768)value+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(value);}
async function blob(report,bytes,kind) {
  const zipped=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const record={key:'blob-'+report.blobs.length,kind,bytes:bytes.length,sha256:await digest(bytes),gzipSha256:await digest(zipped),gzipBase64:encoded(zipped)};
  report.blobs.push(record);return record.key;
}
async function complete(gl,frame) {
  const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);need(fence,'actual GPU fence');gl.flush();const start=performance.now();let waits=0,status;
  do {status=gl.clientWaitSync(fence,0,0);++waits;if(status===gl.TIMEOUT_EXPIRED)await new Promise(resolve=>setTimeout(resolve,1));
    need(performance.now()-start<20000,'uniform GPU completion deadline');}while(status===gl.TIMEOUT_EXPIRED);
  need(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED,'actual uniform draw fence signaled');
  gl.deleteSync(fence);frame.gpuComplete={submitted:true,fenced:true,status,waits};
}
function systemBlock(gl,program,buffers) {
  const index=gl.getUniformBlockIndex(program,'VirglBlock');need(index!==gl.INVALID_INDEX,'native separate system block');
  const size=gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_DATA_SIZE);need(size===656,'native system size');
  let uniform=gl.getUniformIndices(program,['winsys_adjust_y'])[0];if(uniform===gl.INVALID_INDEX)uniform=gl.getUniformIndices(program,['VirglBlock.winsys_adjust_y'])[0];
  need(uniform!==gl.INVALID_INDEX&&gl.getActiveUniforms(program,[uniform],gl.UNIFORM_OFFSET)[0]===640&&
    gl.getActiveUniforms(program,[uniform],gl.UNIFORM_TYPE)[0]===gl.FLOAT,'native system coordinate member');
  const data=new Uint8Array(size);new DataView(data.buffer).setFloat32(640,1,true);const buffer=gl.createBuffer();need(buffer,'native system storage');buffers.push(buffer);
  gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferData(gl.UNIFORM_BUFFER,data,gl.STATIC_DRAW);gl.uniformBlockBinding(program,index,0);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,buffer);
  return [{name:'VirglBlock',index,size,binding:0,member:{name:'winsys_adjust_y',offset:640,type:gl.FLOAT,value:1}}];
}
async function draw(gl,bridge,fixture,native,cases,report,fault) {
  const selectors={...fixture.selectors};if(fault==='slot-zero-variant')selectors.bufferZeroMask=1;
  const pair=bridge.translatePairUniforms({vertexText:fixture.vertexText,fragmentText:fixture.fragmentText,...selectors});need(pair.ok,'actual uniform C pair '+fixture.name);
  need(normalizeStandardUniformShaderPair(pair,selectors).ok,'selected native uniform metadata');
  const nativeIndex=cases.findIndex(c=>c.kind===2&&c.a===fixture.vertexText&&c.b===fixture.fragmentText&&selectorKeys.every(key=>c.selectors[key]===selectors[key]));
  need(nativeIndex>=0,'native original pair identity');equal(pair,native[nativeIndex].result,'complete browser/C compiler response');
  const built=createProgram(gl,pair.vertex,pair.fragment),program=built.program,buffers=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer(),texture=gl.createTexture();
  need(vao&&fb&&texture,'physical uniform draw objects');
  const frame={name:fixture.name,kind:fixture.kind,width:fixture.width,height:fixture.height,mode:fixture.mode,vertices:fixture.vertices,
    stage:fixture.stage??null,slot:fixture.slot??null,shift:fixture.shift??null,count:fixture.count??null,seed:fixture.seed??null,base:fixture.base??null,offset:fixture.offset??null,
    expectedSelectors:fixture.selectors,actualSelectors:selectors,nativeIndex,vertexText:fixture.vertexText,fragmentText:fixture.fragmentText,
    pair,logs:built.logs,banks:[],attributes:[],calls:[],fault};report.frames.push(frame);
  try {
    gl.useProgram(program);frame.systemBlocks=systemBlock(gl,program,buffers);
    const system=new Uint8Array(656);gl.bindBuffer(gl.UNIFORM_BUFFER,buffers[0]);gl.getBufferSubData(gl.UNIFORM_BUFFER,0,system);
    frame.systemStorage=await blob(report,system,'system-block');
    const pointSize=gl.getUniformLocation(program,'wv_point_size');need(pointSize!==null,'native point-size selector');gl.uniform2f(pointSize,1,0);
    gl.bindVertexArray(vao);
    for(const input of fixture.attributes) {
      const buffer=gl.createBuffer();need(buffer,'original attribute allocation');buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,input.data,gl.STATIC_DRAW);const location=gl.getAttribLocation(program,'in_'+input.index);need(location>=0,'active original attribute');
      gl.enableVertexAttribArray(location);
      if(input.type==='signed'||input.type==='unsigned')gl.vertexAttribIPointer(location,4,input.type==='signed'?gl.INT:gl.UNSIGNED_INT,0,0);
      else gl.vertexAttribPointer(location,4,input.type==='packed'?gl.UNSIGNED_INT_2_10_10_10_REV:gl.FLOAT,false,input.type==='packed'?4:0,0);
      const original=new Uint8Array(input.data.buffer,input.data.byteOffset,input.data.byteLength),actual=new Uint8Array(original.length);gl.getBufferSubData(gl.ARRAY_BUFFER,0,actual);
      need(await digest(actual)===await digest(original),'original complete attribute bytes');
      frame.attributes.push({index:input.index,location,type:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_TYPE),
        integer:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_INTEGER),normalized:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
        stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),
        original:await blob(report,original,'original-attribute'),actual:await blob(report,actual,'gpu-attribute')});
    }
    let binding=1;
    for(const bank of fixture.banks) {
      const body=bank.stage==='vertex'?pair.vertex:pair.fragment,name=(bank.stage==='vertex'?'vs':'fs')+'const'+bank.slot;
      const source=new Uint8Array(bank.words.buffer,bank.words.byteOffset,bank.words.byteLength),original=await blob(report,source,'original-bank');
      const wantBlock=bank.slot>0||Boolean(fixture.selectors.bufferZeroMask&(bank.stage==='vertex'?1:2));
      if(!wantBlock) {
        const location=gl.getUniformLocation(program,name+'[0]');need(location!==null,'native inline slot zero');
        const uniform=gl.getUniformIndices(program,[name+'[0]'])[0];need(uniform!==gl.INVALID_INDEX,'native inline reflection');
        const size=gl.getActiveUniforms(program,[uniform],gl.UNIFORM_SIZE)[0],type=gl.getActiveUniforms(program,[uniform],gl.UNIFORM_TYPE)[0];
        need(size===bank.count&&type===gl.UNSIGNED_INT_VEC4,'raw inline extent');gl.uniform4uiv(location,bank.words);
        const actual=new Uint32Array(size*4);for(let i=0;i<size;++i)actual.set(gl.getUniform(program,gl.getUniformLocation(program,name+'['+i+']')),i*4);
        frame.banks.push({stage:bank.stage,slot:bank.slot,count:bank.count,original,inline:true,size,type,actual:await blob(report,new Uint8Array(actual.buffer),'native-inline-bank')});
        continue;
      }
      const blockName='Virgl'+(bank.stage==='vertex'?'VS':'FS')+'Const'+bank.slot,index=gl.getUniformBlockIndex(program,blockName),
        alignment=report.limits.alignment,expectedOffset=alignment*(1+(bank.slot%3)),actualOffset=expectedOffset+(fault==='range-offset'?alignment:0),
        backing=new Uint8Array(expectedOffset+source.length+alignment*2);
      for(let at=0;at<backing.length;++at)backing[at]=(at*37+bank.slot*19+23)&255;
      backing.set(source,expectedOffset);if(fault==='block-word')backing[expectedOffset]^=1;
      const buffer=gl.createBuffer();need(buffer,'original full uniform buffer');buffers.push(buffer);gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferData(gl.UNIFORM_BUFFER,backing,gl.STATIC_DRAW);
      const actual=new Uint8Array(backing.length);gl.getBufferSubData(gl.UNIFORM_BUFFER,0,actual);need(await digest(actual)===await digest(backing),'complete uploaded native uniform storage');
      const record={stage:bank.stage,slot:bank.slot,count:bank.count,original,inline:false,blockName,index,expectedOffset,actualOffset,
        nativeStorageBytes:actual.length,actualStorage:await blob(report,actual,'gpu-bank-backing'),binding:null};frame.banks.push(record);
      if(index===gl.INVALID_INDEX&&fixture.kind==='unused') {record.eliminatedDeclaration=true;continue;}
      if(index===gl.INVALID_INDEX) {need(fault==='slot-zero-variant'&&bank.stage==='fragment'&&bank.slot===0,'missing active native original block');
        record.variantMissingBlock=true;record.inlineDefault=[...gl.getUniform(program,gl.getUniformLocation(program,name+'[0]'))];continue;}
      const metadata=body.metadata.guestUniformBlocks.find(block=>block.slot===bank.slot);need(metadata,'declared original native block');
      const size=gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_DATA_SIZE),indices=[...gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES)];
      need(size===bank.count*16&&size===metadata.byteLength&&indices.length===1,'full native std140 block size');
      const uniform=indices[0],member=gl.getActiveUniform(program,uniform),offset=gl.getActiveUniforms(program,[uniform],gl.UNIFORM_OFFSET)[0],stride=gl.getActiveUniforms(program,[uniform],gl.UNIFORM_ARRAY_STRIDE)[0],
        blockIndex=gl.getActiveUniforms(program,[uniform],gl.UNIFORM_BLOCK_INDEX)[0];
      need(member.name===name+'[0]'&&member.size===bank.count&&member.type===gl.UNSIGNED_INT_VEC4&&offset===0&&stride===16&&blockIndex===index,'native raw uvec4 member reflection');
      const vertex=gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER),fragment=gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER);
      need(vertex===(bank.stage==='vertex')&&fragment===(bank.stage==='fragment')||fixture.kind==='unused'&&!vertex&&!fragment,'native original stage reference');
      gl.uniformBlockBinding(program,index,binding);gl.bindBufferRange(gl.UNIFORM_BUFFER,binding,buffer,actualOffset,size);
      Object.assign(record,{binding,size,member:{name:member.name,size:member.size,type:member.type,offset,stride,blockIndex},vertex,fragment,
        reflectedBinding:gl.getActiveUniformBlockParameter(program,index,gl.UNIFORM_BLOCK_BINDING),
        nativeStart:gl.getIndexedParameter(gl.UNIFORM_BUFFER_START,binding),nativeSize:gl.getIndexedParameter(gl.UNIFORM_BUFFER_SIZE,binding),
        nativeObjectMatches:gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING,binding)===buffer});
      need(record.reflectedBinding===binding&&record.nativeStart===actualOffset&&record.nativeSize===size&&record.nativeObjectMatches,'native original bound range');++binding;
    }
    frame.activeBlocks=gl.getProgramParameter(program,gl.ACTIVE_UNIFORM_BLOCKS);
    if(fixture.kind==='unused') {
      frame.unusedDeclarations=pair.vertex.metadata.guestUniformBlocks.map(block=>({name:block.name,index:gl.getUniformBlockIndex(program,block.name)}));
      need(frame.unusedDeclarations.length===2,'complete unused declarations survive compiler metadata');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,fixture.width,fixture.height,0,gl.RGBA,gl.FLOAT,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    need(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'native float output');
    for(const capability of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD])gl.disable(capability);
    gl.viewport(0,0,fixture.width,fixture.height);gl.clearColor(-9999,-9999,-9999,-9999);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl[fixture.mode],0,fixture.vertices);frame.calls.push({name:'drawArrays',mode:gl[fixture.mode],first:0,count:fixture.vertices});
    await complete(gl,frame);const pixels=new Float32Array(fixture.width*fixture.height*4);gl.readPixels(0,0,fixture.width,fixture.height,gl.RGBA,gl.FLOAT,pixels);
    need(gl.getError()===gl.NO_ERROR,'completed original GPU draw/read');frame.pixels=await blob(report,new Uint8Array(pixels.buffer),'complete-f32-pixels');
    const mismatches=[];let checked=0;for(let y=0;y<fixture.height;++y)for(let x=0;x<fixture.width;++x) {
      const expected=fixture.expected(x,y),at=(y*fixture.width+x)*4;for(let lane=0;lane<4;++lane) {
        ++checked;if(pixels[at+lane]!==expected[lane]&&mismatches.length<8)mismatches.push({x,y,lane,expected:expected[lane],actual:pixels[at+lane]});
      }
    }
    frame.audit={held:mismatches.length===0,checkedWords:checked,mismatches};need(!mismatches.length,'independent original uniform pixels after completed GPU fence: '+JSON.stringify(mismatches));
    if(fixture.kind==='all-banks'&&fixture.selectors.bufferZeroMask===3||fixture.kind==='formats'&&fixture.selectors.bufferZeroMask===3||
        fixture.kind==='atlas'&&fixture.slot===12&&fixture.shift===0&&fixture.width>1) {
      const preview=document.createElement('canvas');preview.width=fixture.width;preview.height=fixture.height;
      const context=preview.getContext('2d'),data=context.createImageData(fixture.width,fixture.height);
      for(let index=0;index<pixels.length;index+=4) {for(let lane=0;lane<3;++lane)data.data[index+lane]=Math.max(0,Math.min(255,pixels[index+lane]));data.data[index+3]=255;}
      context.putImageData(data,0,0);const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');
      image.src=preview.toDataURL('image/png');caption.textContent=fixture.name+' · actual GPU pixels';figure.append(image,caption);document.querySelector('#draws').append(figure);
    }
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);
    for(let binding=0;binding<report.limits.bindings;++binding)gl.bindBufferBase(gl.UNIFORM_BUFFER,binding,null);
    for(const buffer of buffers)gl.deleteBuffer(buffer);gl.deleteTexture(texture);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);gl.deleteProgram(program);
    frame.cleaned=buffers.every(buffer=>!gl.isBuffer(buffer))&&!gl.isTexture(texture)&&!gl.isFramebuffer(fb)&&!gl.isVertexArray(vao)&&!gl.isProgram(program);
    need(frame.cleaned,'complete native uniform cleanup');
  }
}
export async function runAcceptance({matrixPath,nativePath,fault=null}) {
  const report={status:'running',guestExecution:false,productionNegotiation:false,compiles:[],frames:[],blobs:[],fault};window.__standardUniformReport=report;
  const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
  need(gl instanceof WebGL2RenderingContext&&gl.getExtension('EXT_color_buffer_float'),'physical WebGL2 float readback');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');need(debug,'GPU identity');report.renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  need(!/swiftshader|llvmpipe|softpipe|lavapipe|software/i.test(report.renderer),'actual physical GPU');
  report.limits={vertexBlocks:gl.getParameter(gl.MAX_VERTEX_UNIFORM_BLOCKS),fragmentBlocks:gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS),
    combinedBlocks:gl.getParameter(gl.MAX_COMBINED_UNIFORM_BLOCKS),bindings:gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS),
    blockBytes:gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE),alignment:gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT)};
  need(report.limits.vertexBlocks>=14&&report.limits.fragmentBlocks>=13&&report.limits.combinedBlocks>=27&&report.limits.bindings>=27&&report.limits.blockBytes>=16384,'full simultaneous original bank hardware limits');
  const {cases}=await(await fetch(matrixPath)).json(),native=(await(await fetch(nativePath)).text()).trim().split('\n').map(JSON.parse),bridge=await createVirglStandardUniformShaderBridge();
  if(!fault)for(const [index,c]of cases.entries())if(c.okay&&c.kind<3) {
    const result=c.kind<2?bridge.translate({stage:c.kind?'fragment':'vertex',text:c.a}):bridge.translatePairUniforms({vertexText:c.a,fragmentText:c.b,...c.selectors});
    equal(result,native[index].result,'original native/browser matrix '+c.name);const bodies=c.kind<2?[[c.kind,result]]:[[0,result.vertex],[1,result.fragment]],records=[];
    for(const [stage,body]of bodies) {const shader=gl.createShader(stage?gl.FRAGMENT_SHADER:gl.VERTEX_SHADER);gl.shaderSource(shader,body.glsl);gl.compileShader(shader);
      const success=gl.getShaderParameter(shader,gl.COMPILE_STATUS),log=gl.getShaderInfoLog(shader);records.push({stage,success,log,glsl:body.glsl,metadata:body.metadata});gl.deleteShader(shader);need(success,'original uniform native compile '+c.name+': '+log);}
    let link=null;if(c.kind===2) {const built=createProgram(gl,result.vertex,result.fragment);link=built.logs;gl.deleteProgram(built.program);}
    report.compiles.push({name:c.name,index,records,link});need(gl.getError()===gl.NO_ERROR,'native matrix compilation errors');
  }
  let fixtures=hardwareFixtures();if(fault)fixtures=fixtures.filter(fixture=>fixture.name===(fault==='slot-zero-variant'?'all-active-banks-zero-3':'fragment-slot-1-full-shift-0'));
  for(const fixture of fixtures)await draw(gl,bridge,fixture,native,cases,report,fault);
  report.status='passed';document.querySelector('#status').textContent='Passed '+report.frames.length+' hardware uniform-bank frames';
  document.querySelector('#renderer').textContent=report.renderer;return report;
}
