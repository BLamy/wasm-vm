/** Native depth word packing and fixed-function stencil extraction. */
const VERTEX = "#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}";
const DEPTH = `#version 300 es
precision highp float;precision highp int;
uniform highp sampler2D sourceTexture;uniform ivec2 origin;uniform int sourceLevel;
out vec4 packedBytes;
void main(){uint word=floatBitsToUint(texelFetch(sourceTexture,origin+ivec2(gl_FragCoord.xy),sourceLevel).r);
packedBytes=vec4(float(word&255u),float((word>>8)&255u),float((word>>16)&255u),float(word>>24))/255.0;}`;
const STENCIL = "#version 300 es\nprecision highp float;uniform float bitValue;out vec4 packedBytes;void main(){packedBytes=vec4(bitValue/255.0,0.0,0.0,0.0);}";
const CAPS = ["BLEND", "DEPTH_TEST", "STENCIL_TEST", "SCISSOR_TEST", "CULL_FACE", "DITHER", "RASTERIZER_DISCARD", "SAMPLE_ALPHA_TO_COVERAGE", "SAMPLE_COVERAGE"];
const BLEND = ["BLEND_EQUATION_RGB", "BLEND_EQUATION_ALPHA", "BLEND_SRC_RGB", "BLEND_DST_RGB", "BLEND_SRC_ALPHA", "BLEND_DST_ALPHA"];
const STENCIL_STATE = ["STENCIL_FUNC", "STENCIL_REF", "STENCIL_VALUE_MASK", "STENCIL_WRITEMASK", "STENCIL_FAIL", "STENCIL_PASS_DEPTH_FAIL", "STENCIL_PASS_DEPTH_PASS"];

export function createFloatingDepthPacker(gl, check, require, vao, indexed) {
  const scratch = new Set();
  // WebGL's indexed extension deliberately exposes no enabled-state query.
  // Touch only output zero; isEnabled(BLEND) provides that output's state.
  const blendEnabled = enabled => indexed ? indexed[enabled ? "enableiOES" : "disableiOES"](gl.BLEND, 0) : gl[enabled ? "enable" : "disable"](gl.BLEND);
  const colorMask = values => indexed ? indexed.colorMaskiOES(0, ...values) : gl.colorMask(...values);
  const blendState = (equation, factors) => {
    if (indexed) { indexed.blendEquationSeparateiOES(0, ...equation); indexed.blendFuncSeparateiOES(0, ...factors); }
    else { gl.blendEquationSeparate(...equation); gl.blendFuncSeparate(...factors); }
  };
  let readFramebuffer = null, drawFramebuffer = null, depthProgram = null, stencilProgram = null, disposed = false;
  const ready = () => { require(!disposed, "backend-error", "Floating depth helper is disposed."); check(); };
  const framebuffers = () => {
    ready();
    if (readFramebuffer) return;
    let read = null, draw = null;
    try {
      read = gl.createFramebuffer(); draw = gl.createFramebuffer();
      require(read && draw, "backend-error", "Floating depth framebuffer allocation failed."); check();
      readFramebuffer = read; drawFramebuffer = draw;
    } catch (error) { if (read) gl.deleteFramebuffer(read); if (draw) gl.deleteFramebuffer(draw); throw error; }
  };
  const pipeline = stencil => {
    ready();
    if (stencil ? stencilProgram : depthProgram) return stencil ? stencilProgram : depthProgram;
    const shaders = []; let program = null;
    try {
      program = gl.createProgram(); require(program, "backend-error", "Floating depth program allocation failed.");
      for (const [type, text] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, stencil ? STENCIL : DEPTH]]) {
        const shader = gl.createShader(type); require(shader, "backend-error", "Floating depth shader allocation failed.");
        shaders.push(shader); gl.shaderSource(shader, text); gl.compileShader(shader);
        require(gl.getShaderParameter(shader, gl.COMPILE_STATUS), "backend-error", "Floating depth shader compilation failed."); gl.attachShader(program, shader);
      }
      gl.linkProgram(program); require(gl.getProgramParameter(program, gl.LINK_STATUS), "backend-error", "Floating depth program link failed.");
      const uniforms = Object.fromEntries((stencil ? ["bitValue"] : ["sourceTexture", "origin", "sourceLevel"]).map(name => [name, gl.getUniformLocation(program, name)]));
      require(Object.values(uniforms).every(value => value !== null), "backend-error", "Floating depth uniforms are unavailable."); check();
      const result = Object.freeze({ program, ...uniforms });
      if (stencil) stencilProgram = result; else depthProgram = result;
      return result;
    } catch (error) { if (program) gl.deleteProgram(program); throw error; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
  };
  const createScratch = (width, height, stencil, stencilInternal = gl.DEPTH32F_STENCIL8) => {
    ready(); require(Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0,
      "backend-error", "Invalid floating depth conversion dimensions.");
    require(!stencil || [gl.DEPTH32F_STENCIL8, gl.DEPTH24_STENCIL8].includes(stencilInternal),
      "backend-error", "Invalid native stencil copy format.");
    const active = gl.getParameter(gl.ACTIVE_TEXTURE); gl.activeTexture(gl.TEXTURE0);
    const binding = gl.getParameter(gl.TEXTURE_BINDING_2D), created = [];
    const texture = internal => {
      const object = gl.createTexture(); require(object, "backend-error", "Floating depth conversion allocation failed."); created.push(object);
      gl.bindTexture(gl.TEXTURE_2D, object); gl.texStorage2D(gl.TEXTURE_2D, 1, internal, width, height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); check(); return object;
    };
    try {
      const depthColor = texture(gl.RGBA8), stencilColor = stencil ? texture(gl.RGBA8) : null, depthCopy = stencil ? texture(stencilInternal) : null;
      const pair = Object.freeze({ width, height, depthColor, stencilColor, depthCopy }); scratch.add(pair); return pair;
    } catch (error) { for (const object of created) gl.deleteTexture(object); throw error; }
    finally { gl.bindTexture(gl.TEXTURE_2D, binding); gl.activeTexture(active); }
  };
  const releaseScratch = pair => {
    if (!scratch.delete(pair)) return;
    gl.deleteTexture(pair.depthColor); if (pair.stencilColor) gl.deleteTexture(pair.stencilColor); if (pair.depthCopy) gl.deleteTexture(pair.depthCopy);
  };
  const copyRegion = (source, destination, stencil, sourceLevel, destinationLevel, box) => {
    framebuffers();
    const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), previousDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), scissor = gl.isEnabled(gl.SCISSOR_TEST);
    const attachment = stencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer); gl.readBuffer(gl.NONE);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, attachment, gl.TEXTURE_2D, source, sourceLevel);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFramebuffer); gl.drawBuffers([gl.NONE]);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, attachment, gl.TEXTURE_2D, destination, destinationLevel);
      require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE,
        "backend-error", "Floating depth copy framebuffer is incomplete."); gl.disable(gl.SCISSOR_TEST);
      gl.blitFramebuffer(box.x, box.y, box.x + box.width, box.y + box.height, 0, 0, box.width, box.height,
        gl.DEPTH_BUFFER_BIT | (stencil ? gl.STENCIL_BUFFER_BIT : 0), gl.NEAREST); check();
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, attachment, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFramebuffer); gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, attachment, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw); gl[scissor ? "enable" : "disable"](gl.SCISSOR_TEST);
    }
  };
  const capture = () => ({
    program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
    viewport: gl.getParameter(gl.VIEWPORT), mask: gl.getParameter(gl.COLOR_WRITEMASK), active: gl.getParameter(gl.ACTIVE_TEXTURE),
    caps: CAPS.map(name => gl.isEnabled(gl[name])), blend: BLEND.map(name => gl.getParameter(gl[name])), depthMask: gl.getParameter(gl.DEPTH_WRITEMASK),
    stencil: [false, true].map(back => STENCIL_STATE.map(name => gl.getParameter(gl[back ? name.replace("STENCIL_", "STENCIL_BACK_") : name]))),
  });
  const restore = previous => {
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previous.draw); gl.bindVertexArray(previous.vao); gl.useProgram(previous.program); gl.viewport(...previous.viewport);
    colorMask(previous.mask); blendState(previous.blend.slice(0, 2), previous.blend.slice(2)); gl.depthMask(previous.depthMask);
    previous.stencil.forEach(([func, ref, valueMask, writeMask, fail, zfail, zpass], index) => {
      const face = index ? gl.BACK : gl.FRONT; gl.stencilFuncSeparate(face, func, ref, valueMask); gl.stencilMaskSeparate(face, writeMask); gl.stencilOpSeparate(face, fail, zfail, zpass);
    });
    CAPS.forEach((name, index) => name === "BLEND" ? blendEnabled(previous.caps[index]) : gl[previous.caps[index] ? "enable" : "disable"](gl[name]));
  };
  const pack = (pair, source, level, box) => {
    ready(); require(scratch.has(pair) && box.width === pair.width && box.height === pair.height, "backend-error", "Foreign floating depth conversion."); framebuffers();
    const p = pipeline(false), stencil = pair.stencilColor ? pipeline(true) : null, previous = capture();
    gl.activeTexture(gl.TEXTURE0); const binding = gl.getParameter(gl.TEXTURE_BINDING_2D), sampler = gl.getParameter(gl.SAMPLER_BINDING);
    const sampled = pair.depthCopy ?? source; gl.bindTexture(gl.TEXTURE_2D, sampled);
    const names = [gl.TEXTURE_BASE_LEVEL, gl.TEXTURE_MAX_LEVEL, gl.TEXTURE_COMPARE_MODE, gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER], values = names.map(name => gl.getTexParameter(gl.TEXTURE_2D, name));
    try {
      if (pair.depthCopy) copyRegion(source, pair.depthCopy, true, level, 0, box);
      gl.bindTexture(gl.TEXTURE_2D, sampled); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, pair.depthCopy ? 0 : level);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.bindSampler(0, null);
      gl.bindVertexArray(vao); gl.useProgram(p.program); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFramebuffer);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pair.depthColor, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      require(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Floating depth packing framebuffer is incomplete.");
      gl.viewport(0, 0, pair.width, pair.height); CAPS.forEach(name => name === "BLEND" ? blendEnabled(false) : gl.disable(gl[name])); colorMask([true, true, true, true]);
      gl.uniform1i(p.sourceTexture, 0); gl.uniform2i(p.origin, pair.depthCopy ? 0 : box.x, pair.depthCopy ? 0 : box.y); gl.uniform1i(p.sourceLevel, pair.depthCopy ? 0 : level); gl.drawArrays(gl.TRIANGLES, 0, 3); check();
      if (stencil) {
        // The depth sampling pass has ended before the same native depth/stencil
        // image is attached. This program has no texture sampler or feedback.
        gl.bindTexture(gl.TEXTURE_2D, null); gl.useProgram(stencil.program);
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pair.stencilColor, 0);
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, pair.depthCopy, 0);
        require(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Floating stencil packing framebuffer is incomplete.");
        gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 0])); gl.depthMask(false); gl.stencilMask(0); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        gl.enable(gl.STENCIL_TEST); blendEnabled(true); blendState([gl.FUNC_ADD, gl.FUNC_ADD], [gl.ONE, gl.ONE, gl.ONE, gl.ONE]);
        for (let bit = 0; bit < 8; bit++) { const mask = 1 << bit; gl.stencilFunc(gl.EQUAL, mask, mask); gl.uniform1f(stencil.bitValue, mask); gl.drawArrays(gl.TRIANGLES, 0, 3); }
        check();
      }
    } finally {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFramebuffer); gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);
      restore(previous); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sampled); names.forEach((name, index) => gl.texParameteri(gl.TEXTURE_2D, name, values[index]));
      gl.bindTexture(gl.TEXTURE_2D, binding); gl.bindSampler(0, sampler); gl.activeTexture(previous.active);
    }
  };
  const read = (pair, destination) => {
    ready(); require(scratch.has(pair), "backend-error", "Foreign floating depth readback."); framebuffers();
    const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), planeBytes = pair.width * pair.height * 4;
    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer); gl.readBuffer(gl.COLOR_ATTACHMENT0);
      for (const [index, texture] of [pair.depthColor, pair.stencilColor].entries()) if (texture) {
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        require(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, "backend-error", "Floating depth read framebuffer is incomplete.");
        gl.readPixels(0, 0, pair.width, pair.height, gl.RGBA, gl.UNSIGNED_BYTE, destination === null ? index * planeBytes : destination.subarray(index * planeBytes, (index + 1) * planeBytes)); check();
      }
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
    }
  };
  const dispose = () => {
    if (disposed) return;
    for (const pair of [...scratch]) releaseScratch(pair);
    for (const value of [depthProgram, stencilProgram]) if (value) { if (gl.getParameter(gl.CURRENT_PROGRAM) === value.program) gl.useProgram(null); gl.deleteProgram(value.program); }
    if (readFramebuffer) gl.deleteFramebuffer(readFramebuffer); if (drawFramebuffer) gl.deleteFramebuffer(drawFramebuffer); disposed = true;
  };
  return Object.freeze({ createScratch, releaseScratch, copyRegion, pack, read, dispose });
}
