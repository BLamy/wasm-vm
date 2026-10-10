/** GPU canonical packing of actual RGB9_E5 colors, with owned reusable scratch. */
const VERTEX = '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}';
const FRAGMENT = `#version 300 es
precision highp float;precision highp int;
uniform highp sampler2D sourceTexture;uniform ivec2 origin;uniform int sourceLevel;uniform int reverseBytes;
layout(location=0) out highp vec4 packedBytes;
void main(){
 vec3 color=texelFetch(sourceTexture,origin+ivec2(gl_FragCoord.xy),sourceLevel).rgb;
 float maximum=max(max(color.r,color.g),color.b);
 int exponent=max(0,int((floatBitsToUint(maximum)>>23)&255u)-111);
 float quantum=uintBitsToFloat(uint(exponent+103)<<23);
 uvec3 mantissa=uvec3(floor(color/quantum+0.5));
 uint packedWord=mantissa.r | (mantissa.g<<9) | (mantissa.b<<18) | (uint(exponent)<<27);
 uvec4 bytes=uvec4(packedWord&255u,(packedWord>>8)&255u,(packedWord>>16)&255u,packedWord>>24);
 if(reverseBytes!=0)bytes=bytes.wzyx;
 packedBytes=(vec4(bytes)+0.25)/255.0;
}`;
// Only native RGB9_E5 values enter this kernel. They are finite, unsigned and
// exactly representable; the selected canonical quantum divides every component.
// The general float-to-RGB9E5 overflow/refinement case is unreachable here.
export function createSharedExponentPacker(gl, check, require, vao) {
 let program=null,framebuffer=null,disposed=false;const pairs=new Set(),reverseBytes=Number(new Uint8Array(new Uint32Array([0x01020304]).buffer)[0]!==4);
 const capabilities=['BLEND','DEPTH_TEST','STENCIL_TEST','SCISSOR_TEST','CULL_FACE','DITHER','RASTERIZER_DISCARD','SAMPLE_ALPHA_TO_COVERAGE','SAMPLE_COVERAGE'];
 const pixelNames=['PACK_ALIGNMENT','UNPACK_ALIGNMENT','PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS','UNPACK_ROW_LENGTH','UNPACK_IMAGE_HEIGHT','UNPACK_SKIP_PIXELS','UNPACK_SKIP_ROWS','UNPACK_SKIP_IMAGES','UNPACK_FLIP_Y_WEBGL','UNPACK_PREMULTIPLY_ALPHA_WEBGL','UNPACK_COLORSPACE_CONVERSION_WEBGL'];
 const ready=()=>{require(!disposed,'backend-error','Shared exponent packer is disposed.');check();};
 const pipeline=()=>{
  ready();if(program)return program;
  const shaders=[];let native=null,fb=null;
  try{
   native=gl.createProgram();fb=gl.createFramebuffer();require(native&&fb,'backend-error','Shared exponent helper allocation failed.');
   for(const [type,text]of [[gl.VERTEX_SHADER,VERTEX],[gl.FRAGMENT_SHADER,FRAGMENT]]){const shader=gl.createShader(type);require(shader,'backend-error','Shared exponent shader allocation failed.');shaders.push(shader);gl.shaderSource(shader,text);gl.compileShader(shader);require(gl.getShaderParameter(shader,gl.COMPILE_STATUS),'backend-error','Shared exponent shader compilation failed.');gl.attachShader(native,shader);}
   gl.linkProgram(native);require(gl.getProgramParameter(native,gl.LINK_STATUS),'backend-error','Shared exponent shader link failed.');
   const sourceTexture=gl.getUniformLocation(native,'sourceTexture'),origin=gl.getUniformLocation(native,'origin'),sourceLevel=gl.getUniformLocation(native,'sourceLevel'),byteOrder=gl.getUniformLocation(native,'reverseBytes');require(sourceTexture!==null&&origin!==null&&sourceLevel!==null&&byteOrder!==null,'backend-error','Shared exponent uniforms are unavailable.');check();
   program=Object.freeze({native,sourceTexture,origin,sourceLevel,byteOrder});framebuffer=fb;return program;
  }catch(error){if(native)gl.deleteProgram(native);if(fb)gl.deleteFramebuffer(fb);throw error;}
  finally{for(const shader of shaders)gl.deleteShader(shader);}
 };
 const createScratch=(width,height,buffered=false)=>{
  ready();require(Number.isSafeInteger(width)&&width>0&&Number.isSafeInteger(height)&&height>0,'backend-error','Invalid owned shared exponent dimensions.');
  const active=gl.getParameter(gl.ACTIVE_TEXTURE),pack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);gl.activeTexture(gl.TEXTURE0);const binding=gl.getParameter(gl.TEXTURE_BINDING_2D);let texture=null,buffer=null;
  try{texture=gl.createTexture();require(texture,'backend-error','Shared exponent conversion allocation failed.');gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,width,height);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   if(buffered){buffer=gl.createBuffer();require(buffer,'backend-error','Shared exponent copy buffer allocation failed.');gl.bindBuffer(gl.PIXEL_PACK_BUFFER,buffer);gl.bufferData(gl.PIXEL_PACK_BUFFER,width*height*4,gl.STREAM_COPY);}
   check();const pair=Object.freeze({texture,buffer,width,height});pairs.add(pair);return pair;
  }catch(error){if(texture)gl.deleteTexture(texture);if(buffer)gl.deleteBuffer(buffer);throw error;}
  finally{gl.bindTexture(gl.TEXTURE_2D,binding);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);gl.activeTexture(active);}
 };
 const releaseScratch=pair=>{if(!pairs.delete(pair))return;gl.deleteTexture(pair.texture);if(pair.buffer)gl.deleteBuffer(pair.buffer);};
 const pack=(pair,source,level,box)=>{
  ready();require(pairs.has(pair)&&box.width<=pair.width&&box.height<=pair.height,'backend-error','Foreign or undersized shared exponent conversion.');const p=pipeline();
  const previous={program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),viewport:gl.getParameter(gl.VIEWPORT),mask:gl.getParameter(gl.COLOR_WRITEMASK),active:gl.getParameter(gl.ACTIVE_TEXTURE),caps:capabilities.map(name=>gl.isEnabled(gl[name]))};
  gl.activeTexture(gl.TEXTURE0);const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),sampler=gl.getParameter(gl.SAMPLER_BINDING);gl.bindTexture(gl.TEXTURE_2D,source);const base=gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL),last=gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL);let attached=false;
  try{gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,0);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,level);gl.bindSampler(0,null);gl.bindVertexArray(vao);gl.useProgram(p.native);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,pair.texture,0);attached=true;gl.drawBuffers([gl.COLOR_ATTACHMENT0]);require(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'backend-error','Shared exponent conversion framebuffer incomplete.');gl.viewport(0,0,box.width,box.height);for(const name of capabilities)gl.disable(gl[name]);gl.colorMask(true,true,true,true);gl.uniform1i(p.sourceTexture,0);gl.uniform2i(p.origin,box.x,box.y);gl.uniform1i(p.sourceLevel,level);gl.uniform1i(p.byteOrder,reverseBytes);gl.drawArrays(gl.TRIANGLES,0,3);check();}
  finally{if(attached){gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,null,0);}gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,previous.draw);gl.bindVertexArray(previous.vao);gl.useProgram(previous.program);gl.viewport(...previous.viewport);gl.colorMask(...previous.mask);for(let i=0;i<capabilities.length;i++)gl[previous.caps[i]?'enable':'disable'](gl[capabilities[i]]);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL,base);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,last);gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindSampler(0,sampler);gl.activeTexture(previous.active);}
 };
 const copy=(pair,source,destination,firstLevel,levels)=>{
  ready();require(pairs.has(pair)&&pair.buffer,'backend-error','Native shared exponent copy needs owned scratch.');
  const read=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),packBuffer=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),unpackBuffer=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING),active=gl.getParameter(gl.ACTIVE_TEXTURE),pixels=pixelNames.map(name=>gl.getParameter(gl[name]));gl.activeTexture(gl.TEXTURE0);const binding=gl.getParameter(gl.TEXTURE_BINDING_2D);let attached=false;
  try{for(const name of pixelNames)gl.pixelStorei(gl[name],name.endsWith('ALIGNMENT')?1:name==='UNPACK_COLORSPACE_CONVERSION_WEBGL'?gl.NONE:0);
   for(const level of levels){pack(pair,source,firstLevel+level.level,{x:0,y:0,width:level.width,height:level.height});gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,pair.texture,0);attached=true;gl.readBuffer(gl.COLOR_ATTACHMENT0);require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'backend-error','Shared exponent copy framebuffer incomplete.');gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pair.buffer);gl.readPixels(0,0,level.width,level.height,gl.RGBA,gl.UNSIGNED_BYTE,0);check();gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,pair.buffer);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,destination);gl.texSubImage2D(gl.TEXTURE_2D,level.level,0,0,level.width,level.height,gl.RGB,gl.UNSIGNED_INT_5_9_9_9_REV,0);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);check();}
  }finally{if(attached){gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,null,0);}gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,packBuffer);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,unpackBuffer);for(let i=0;i<pixelNames.length;i++)gl.pixelStorei(gl[pixelNames[i]],pixels[i]);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,binding);gl.activeTexture(active);}
 };
 const dispose=()=>{if(disposed)return;for(const pair of [...pairs])releaseScratch(pair);if(program){if(gl.getParameter(gl.CURRENT_PROGRAM)===program.native)gl.useProgram(null);gl.deleteProgram(program.native);}if(framebuffer)gl.deleteFramebuffer(framebuffer);disposed=true;};
 return Object.freeze({createScratch,releaseScratch,pack,copy,dispose});
}
