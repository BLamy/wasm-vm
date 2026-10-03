// These explicit GLSL probes establish bounded WebGL2 API feasibility only.
// They are not translated guest shaders or an implementation of a VirGL renderer.
const require = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (actual, expected, label) => require(JSON.stringify(actual) === JSON.stringify(expected),
  `${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`);
const plain = (value) => ArrayBuffer.isView(value) ? [...value] : value;
const shaderSource = {
  vertex: `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`,
  sample: `#version 300 es
precision highp float;
uniform sampler2D source;
out vec4 color;
void main() { color = texelFetch(source, ivec2(0), 0); }`,
  bgra: `#version 300 es
precision highp float;
uniform sampler2D source;
out vec4 color;
void main() { color = texelFetch(source, ivec2(int(gl_FragCoord.x), 0), 0).bgra; }`,
  bgrx: `#version 300 es
precision highp float;
uniform sampler2D source;
out vec4 color;
void main() { color = vec4(texelFetch(source, ivec2(int(gl_FragCoord.x), 0), 0).bgr, 1.0); }`,
  rgbx: `#version 300 es
precision highp float;
uniform sampler2D source;
out vec4 color;
void main() { color = vec4(texelFetch(source, ivec2(int(gl_FragCoord.x), 0), 0).rgb, 1.0); }`,
  baseline: `#version 300 es
precision highp float;
out vec4 color;
void main() { float x = 0.5; color = vec4(x); }`,
  precise: `#version 300 es
precision highp float;
out vec4 color;
void main() { precise float x = 0.5; color = vec4(x); }`,
};

function compile(gl, stage, source) {
  const shader = gl.createShader(stage);
  require(shader, "allocate shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return { shader, source, compiled: gl.getShaderParameter(shader, gl.COMPILE_STATUS), log: gl.getShaderInfoLog(shader) };
}

function program(gl, fragment) {
  const vertex = compile(gl, gl.VERTEX_SHADER, shaderSource.vertex);
  const pixel = compile(gl, gl.FRAGMENT_SHADER, fragment);
  require(vertex.compiled && pixel.compiled, `probe shader compile: ${vertex.log} ${pixel.log}`);
  const handle = gl.createProgram();
  require(handle, "allocate program");
  gl.attachShader(handle, vertex.shader);
  gl.attachShader(handle, pixel.shader);
  gl.linkProgram(handle);
  require(gl.getProgramParameter(handle, gl.LINK_STATUS), `probe program link: ${gl.getProgramInfoLog(handle)}`);
  gl.deleteShader(vertex.shader);
  gl.deleteShader(pixel.shader);
  return handle;
}

function texture(gl, width, height, bytes = null) {
  const handle = gl.createTexture();
  require(handle, "allocate texture");
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    bytes === null ? null : new Uint8Array(bytes));
  return handle;
}

function target(gl, width, height) {
  const image = texture(gl, width, height);
  const framebuffer = gl.createFramebuffer();
  require(framebuffer, "allocate framebuffer");
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0);
  equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, "probe RGBA8 target");
  return { framebuffer, image, width, height };
}

function baseState(gl, destination, handle, vao) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
  gl.useProgram(handle);
  gl.bindVertexArray(vao);
  gl.viewport(0, 0, destination.width, destination.height);
  for (const capability of [gl.BLEND, gl.CULL_FACE, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.DITHER]) gl.disable(capability);
  gl.colorMask(true, true, true, true);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindSampler(0, null);
  gl.clearColor(0, 0, 0, 0);
}

function read(gl, destination) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
  const pixels = new Uint8Array(destination.width * destination.height * 4);
  gl.readPixels(0, 0, destination.width, destination.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  equal(gl.getError(), gl.NO_ERROR, "probe readback has no WebGL error");
  return [...pixels];
}

function destroyTarget(gl, destination) {
  gl.deleteFramebuffer(destination.framebuffer);
  gl.deleteTexture(destination.image);
}

function limits(gl) {
  const names = [
    "MAX_VERTEX_UNIFORM_BLOCKS", "MAX_FRAGMENT_UNIFORM_BLOCKS", "MAX_COMBINED_UNIFORM_BLOCKS",
    "MAX_UNIFORM_BUFFER_BINDINGS", "MAX_UNIFORM_BLOCK_SIZE", "UNIFORM_BUFFER_OFFSET_ALIGNMENT",
    "MAX_VERTEX_UNIFORM_COMPONENTS", "MAX_FRAGMENT_UNIFORM_COMPONENTS", "MAX_VERTEX_UNIFORM_VECTORS",
    "MAX_FRAGMENT_UNIFORM_VECTORS", "MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS", "MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS",
    "MAX_TEXTURE_SIZE", "MAX_3D_TEXTURE_SIZE", "MAX_ARRAY_TEXTURE_LAYERS", "MAX_CUBE_MAP_TEXTURE_SIZE",
    "MAX_RENDERBUFFER_SIZE", "MAX_DRAW_BUFFERS", "MAX_COLOR_ATTACHMENTS", "MAX_SAMPLES",
    "MAX_VERTEX_ATTRIBS", "MAX_VARYING_VECTORS", "MAX_VARYING_COMPONENTS", "MAX_VERTEX_OUTPUT_COMPONENTS",
    "MAX_FRAGMENT_INPUT_COMPONENTS", "MAX_VERTEX_TEXTURE_IMAGE_UNITS", "MAX_TEXTURE_IMAGE_UNITS",
    "MAX_COMBINED_TEXTURE_IMAGE_UNITS", "MAX_ELEMENT_INDEX", "MAX_ELEMENTS_INDICES", "MAX_ELEMENTS_VERTICES",
    "MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS", "MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS",
    "MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS", "MAX_SERVER_WAIT_TIMEOUT", "MAX_CLIENT_WAIT_TIMEOUT_WEBGL",
    "MAX_VIEWPORT_DIMS", "ALIASED_LINE_WIDTH_RANGE", "ALIASED_POINT_SIZE_RANGE",
  ];
  const result = {};
  for (const name of names) {
    require(typeof gl[name] === "number", `missing WebGL2 limit enum ${name}`);
    result[name] = plain(gl.getParameter(gl[name]));
  }
  result.precision = {};
  for (const stage of ["VERTEX_SHADER", "FRAGMENT_SHADER"]) {
    result.precision[stage] = {};
    for (const kind of ["LOW_FLOAT", "MEDIUM_FLOAT", "HIGH_FLOAT", "LOW_INT", "MEDIUM_INT", "HIGH_INT"]) {
      const precision = gl.getShaderPrecisionFormat(gl[stage], gl[kind]);
      result.precision[stage][kind] = { rangeMin: precision.rangeMin, rangeMax: precision.rangeMax, precision: precision.precision };
    }
  }
  equal(gl.getError(), gl.NO_ERROR, "all browser limit queries are valid");
  return result;
}

function formats(gl) {
  // Attachment completeness is a bounded storage/renderability observation, not
  // proof of filtering, blending, format reinterpretation or full format semantics.
  const floatExtension = Boolean(gl.getExtension("EXT_color_buffer_float"));
  const names = ["RGBA8", "SRGB8_ALPHA8", "R8", "RG8", "RGB565", "RGBA4", "RGB5_A1",
    "R8UI", "RGBA8UI", "R16F", "RG16F", "RGBA16F", "R32F", "RG32F", "RGBA32F", "R11F_G11F_B10F",
    "DEPTH_COMPONENT16", "DEPTH_COMPONENT24", "DEPTH_COMPONENT32F", "DEPTH24_STENCIL8", "DEPTH32F_STENCIL8"];
  const records = [];
  for (const name of names) {
    const image = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, image);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl[name], 4, 4);
    const allocationError = gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const depth = name.startsWith("DEPTH");
    const attachment = depth ? (name.includes("STENCIL") ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT) : gl.COLOR_ATTACHMENT0;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, image, 0);
    if (depth) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    const framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    const attachmentError = gl.getError();
    records.push({ name, internalFormat: gl[name], dimensions: [4, 4], allocationError, attachmentError,
      framebufferStatus, framebufferComplete: framebufferStatus === gl.FRAMEBUFFER_COMPLETE,
      renderbufferSamples: [...gl.getInternalformatParameter(gl.RENDERBUFFER, gl[name], gl.SAMPLES)] });
    equal(allocationError, gl.NO_ERROR, `${name} allocation`);
    equal(attachmentError, gl.NO_ERROR, `${name} attachment`);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(image);
  }
  equal(gl.getError(), gl.NO_ERROR, "format sample queries");
  return { colorBufferFloatEnabled: floatExtension, scope: "4x4 immutable storage plus FBO completeness and renderbuffer sample counts", records };
}

function precise(gl) {
  const baseline = compile(gl, gl.FRAGMENT_SHADER, shaderSource.baseline);
  const qualified = compile(gl, gl.FRAGMENT_SHADER, shaderSource.precise);
  require(baseline.compiled, `precise litmus baseline compile failed: ${baseline.log}`);
  equal(qualified.compiled, false, "GLSL ES300 precise qualifier must be rejected on tested backend");
  require(qualified.log.length > 0, "precise failure must include compiler diagnostic");
  gl.deleteShader(baseline.shader);
  gl.deleteShader(qualified.shader);
  equal(gl.getError(), gl.NO_ERROR, "expected shader rejection is not a GL API error");
  return { name: "precise-qualifier-litmus", kind: "negative-language-probe", status: "passed",
    baseline: { source: baseline.source, compiled: baseline.compiled, log: baseline.log },
    precise: { source: qualified.source, compiled: qualified.compiled, log: qualified.log },
    limitation: "Compiler rejection only. Does not prove numerical equivalence, precise semantics, or that removing the qualifier preserves TGSI PRECISE behavior." };
}

function views(gl) {
  const input = [11, 37, 83, 109, 163, 191, 223, 7];
  const cases = [
    { name: "bgra", virglFormat: { id: 1, name: "B8G8R8A8_UNORM" }, expected: [83, 37, 11, 109, 223, 191, 163, 7], expression: "sample.bgra" },
    { name: "bgrx", virglFormat: { id: 2, name: "B8G8R8X8_UNORM" }, expected: [83, 37, 11, 255, 223, 191, 163, 255], expression: "vec4(sample.bgr, 1.0)" },
    { name: "rgbx", virglFormat: { id: 134, name: "R8G8B8X8_UNORM" }, expected: [11, 37, 83, 255, 163, 191, 223, 255], expression: "vec4(sample.rgb, 1.0)" },
  ];
  const destination = target(gl, 2, 1);
  const source = texture(gl, 2, 1, input);
  const vao = gl.createVertexArray();
  const records = [];
  for (const scenario of cases) {
    const handle = program(gl, shaderSource[scenario.name]);
    baseState(gl, destination, handle, vao);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(gl.getUniformLocation(handle, "source"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const observed = read(gl, destination);
    equal(observed, scenario.expected, `${scenario.name} independent byte oracle`);
    records.push({ ...scenario, observed, checkedPixels: 2, fragmentSource: shaderSource[scenario.name] });
    gl.deleteProgram(handle);
  }
  gl.deleteTexture(source);
  gl.deleteVertexArray(vao);
  destroyTarget(gl, destination);
  return { name: "texture-view-swizzle", kind: "explicit-glsl-api-mapping", status: "passed", input,
    vertexSource: shaderSource.vertex, cases: records,
    limitation: "Shader-side sample patch on RGBA8 storage only; not hardware texture views, general format reinterpretation, or translated captured TGSI." };
}

function virtualContexts(gl) {
  const create = (name, rgba, scissor) => {
    const destination = target(gl, 8, 8);
    const state = { name, destination, source: texture(gl, 1, 1, rgba), program: program(gl, shaderSource.sample),
      vao: gl.createVertexArray(), scissor, rgba, viewport: [0, 0, 8, 8] };
    baseState(gl, destination, state.program, state.vao);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return state;
  };
  const a = create("A", [255, 0, 0, 255], [0, 0, 4, 8]);
  const b = create("B", [0, 0, 255, 255], [4, 0, 4, 8]);
  require(a.destination.framebuffer !== b.destination.framebuffer && a.program !== b.program && a.source !== b.source && a.vao !== b.vao,
    "virtual states use distinct actual GL objects");
  const order = [];
  for (const state of [a, b, a]) {
    baseState(gl, state.destination, state.program, state.vao);
    gl.bindTexture(gl.TEXTURE_2D, state.source);
    gl.uniform1i(gl.getUniformLocation(state.program, "source"), 0);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(...state.scissor);
    require(gl.getParameter(gl.CURRENT_PROGRAM) === state.program, "restored program identity");
    require(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) === state.destination.framebuffer, "restored FBO identity");
    require(gl.getParameter(gl.VERTEX_ARRAY_BINDING) === state.vao, "restored VAO identity");
    require(gl.getParameter(gl.TEXTURE_BINDING_2D) === state.source, "restored sampler source identity");
    equal([...gl.getParameter(gl.SCISSOR_BOX)], state.scissor, "restored scissor");
    equal([...gl.getParameter(gl.VIEWPORT)], state.viewport, "restored viewport");
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    order.push(state.name);
  }
  const checks = [];
  for (const state of [a, b]) {
    const pixels = read(gl, state.destination);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const inside = state.name === "A" ? x < 4 : x >= 4;
      equal(pixels.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4), inside ? state.rgba : [0, 0, 0, 0], `${state.name} isolated pixel ${x},${y}`);
    }
    checks.push({ name: state.name, viewport: state.viewport, scissor: state.scissor,
      insideExpected: state.rgba, outsideExpected: [0, 0, 0, 0], checkedPixels: 64, observed: pixels });
    gl.deleteTexture(state.source);
    gl.deleteProgram(state.program);
    gl.deleteVertexArray(state.vao);
    destroyTarget(gl, state.destination);
  }
  return { name: "virtual-context-state-replay", kind: "explicit-glsl-api-mapping", status: "passed", order,
    vertexSource: shaderSource.vertex, fragmentSource: shaderSource.sample,
    restoredState: ["program", "VAO", "draw/read framebuffer", "viewport", "texture unit 0", "sampler binding", "sampler uniform", "scissor", "blend/depth/stencil/cull/dither disable", "color mask"], checks,
    limitation: "Two manual state records in one WebGL context. Not guest handle validation, adversarial context security, shared-resource lifetime, or a complete VirGL state cache." };
}

async function fence(gl) {
  const destination = target(gl, 2, 2);
  const handle = program(gl, shaderSource.sample);
  const source = texture(gl, 1, 1, [0, 255, 0, 255]);
  const vao = gl.createVertexArray();
  baseState(gl, destination, handle, vao);
  gl.bindTexture(gl.TEXTURE_2D, source);
  gl.uniform1i(gl.getUniformLocation(handle, "source"), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  require(sync, "allocate fence");
  gl.flush();
  const statuses = [];
  const events = ["submitted-and-flushed"];
  let timerRan = false;
  const unrelatedEvent = new Promise((resolve) => setTimeout(() => {
    timerRan = true;
    events.push("unrelated-timer-ran");
    resolve();
  }, 0));
  const first = gl.clientWaitSync(sync, 0, 0);
  statuses.push(first);
  equal(first, gl.TIMEOUT_EXPIRED, "WebGL fence does not become signaled before yielding its creation task");
  events.push("nonblocking-poll-before-yield");
  let complete = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = gl.clientWaitSync(sync, 0, 0);
    statuses.push(status);
    require(status !== gl.WAIT_FAILED, "async fence wait failed");
    if (status === gl.CONDITION_SATISFIED || status === gl.ALREADY_SIGNALED) {
      complete = true;
      events.push("fence-signaled-after-yield");
      break;
    }
    equal(status, gl.TIMEOUT_EXPIRED, "bounded nonblocking fence status");
  }
  require(complete, "fence did not signal within 200 event-loop yields");
  await unrelatedEvent;
  require(timerRan && events.indexOf("unrelated-timer-ran") < events.indexOf("fence-signaled-after-yield"), "unrelated event must run before observed completion");
  const observed = read(gl, destination);
  const expected = [0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255];
  equal(observed, expected, "fence completion precedes expected green readback");
  equal(gl.getSyncParameter(sync, gl.SYNC_STATUS), gl.SIGNALED, "final sync state");
  gl.deleteSync(sync);
  gl.deleteProgram(handle);
  gl.deleteTexture(source);
  gl.deleteVertexArray(vao);
  destroyTarget(gl, destination);
  return { name: "asynchronous-fence-event-loop", kind: "explicit-glsl-api-mapping", status: "passed",
    vertexSource: shaderSource.vertex, fragmentSource: shaderSource.sample,
    events, statuses, timeoutNanoseconds: 0, waitFlags: 0, maxYields: 200, expected, observed, checkedPixels: 4,
    limitation: "WebGL fence scheduling only; no virtqueue completion, guest timeline, context-loss recovery, or performance budget claim." };
}

export async function runBackendProbes() {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, preserveDrawingBuffer: true,
    premultipliedAlpha: false, failIfMajorPerformanceCaveat: true });
  require(gl instanceof WebGL2RenderingContext, "hardware WebGL2 probe context required");
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  require(debug, "probe context hardware identity required");
  const renderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic|mock|fake|null/i.test(renderer), "probe context must use hardware rendering");
  const report = { status: "running", guestExecution: false, translatedGuestShaders: false, limits: limits(gl),
    renderer, extensions: gl.getSupportedExtensions().sort(), formats: formats(gl), probes: [] };
  window.__virglContractProbeReport = report;
  report.futureUboPrerequisite = { guestBlocksPerStage: 12, reservedBlocksPerStage: 1,
    minimumVertexBlocks: 13, minimumFragmentBlocks: 13, minimumCombinedBlocks: 26, minimumBindingPoints: 25,
    currentGuestAdvertisement: false };
  require(report.limits.MAX_VERTEX_UNIFORM_BLOCKS >= 13 && report.limits.MAX_FRAGMENT_UNIFORM_BLOCKS >= 13
    && report.limits.MAX_COMBINED_UNIFORM_BLOCKS >= 26 && report.limits.MAX_UNIFORM_BUFFER_BINDINGS >= 25,
  "browser must meet the bounded future UBO profile prerequisites; no guest UBO support is claimed");
  report.probes.push(precise(gl), views(gl), virtualContexts(gl));
  report.probes.push(await fence(gl));
  equal(gl.getError(), gl.NO_ERROR, "final backend probe error state");
  report.status = "passed";
  document.querySelector("#probes").textContent = report.probes.map((probe) => `${probe.name}: PASS\n  ${probe.limitation}`).join("\n\n");
  return report;
}
