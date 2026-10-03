// Execute the two unmodified recorded TGSI bodies with the original workload's
// explicit bindings. This is not VirGL command replay or an emulator guest boot.
import { createVirglShaderBridge, LIMITS } from "../index.mjs";
import { createProgram, texture2d, bindSystemBlocks, bindConstants, digest } from "./browser.mjs";

export const CAPTURED_INPUTS = Object.freeze([
  { stage: "vertex", size: 256, sha256: "e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33",
    path: "evidence/virgl-corpus/captures/textured-scene/shaders/e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33.tgsi", event: 161, byteOffset: 4136 },
  { stage: "fragment", size: 261, sha256: "80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808",
    path: "evidence/virgl-corpus/captures/textured-scene/shaders/80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808.tgsi", event: 161, byteOffset: 4420 },
]);
const WIDTH = 32;
const HEIGHT = 32;
const require = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (actual, expected, label) => require(JSON.stringify(actual) === JSON.stringify(expected),
  `${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`);
// Literal values from tools/virgl-capture/workloads/textured-scene.c. Never
// generate expectations from shader output, a reference translator or readback.
const PHASES = [
  { name: "original-texture", tint: [1, 1, 1, 1], blend: false,
    expected: [[255,0,0,255], [0,255,0,255], [0,0,255,255], [255,255,0,255]] },
  { name: "same-program-tint-update", tint: [1, 0.5, 0, 1], blend: false,
    expected: [[255,0,0,255], [0,128,0,255], [0,0,0,255], [255,128,0,255]] },
  { name: "quarter-alpha-over-blue", tint: [1, 1, 1, 0.25], blend: true,
    expected: [[64,0,191,255], [0,64,191,255], [0,0,255,255], [64,64,191,255]] },
];
const TEXELS = [255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,0,255];
const VERTICES = [-1,-1,0,0, 1,-1,1,0, -1,1,0,1, 1,1,1,1];
const INDICES = [0,1,2, 2,1,3];

async function translations(bridge, report) {
  const result = {};
  for (const input of CAPTURED_INPUTS) {
    const response = await fetch(`/${input.path}`);
    require(response.ok, `cannot fetch exact captured body: ${input.path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    equal(bytes.length, input.size, `${input.stage} captured body byte length`);
    equal(await digest(bytes), input.sha256, `${input.stage} captured body SHA256`);
    require(bytes.every((byte) => [9, 10, 13].includes(byte) || byte >= 32 && byte <= 126), "captured TGSI must remain ASCII without NUL");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const translated = bridge.translate({ stage: input.stage, text });
    require(translated.ok === true, `${input.stage}: exact captured translation rejected: ${JSON.stringify(translated)}`);
    equal(translated.metadata.profile, "virgl-webgl2-straight-line-v5", "component-aware metadata profile");
    equal(translated.metadata.stage, input.stage, "captured metadata stage");
    require(translated.glsl.length > 0 && translated.glsl.length <= LIMITS.glslBytes, "captured GLSL output bound");
    result[input.stage] = { text, ...translated };
    report.translations.push({ ...input, sourceSha256: await digest(bytes), sourceText: text,
      glslSha256: await digest(translated.glsl), glsl: translated.glsl, metadata: translated.metadata });
  }
  const vertex = result.vertex.metadata;
  const fragment = result.fragment.metadata;
  equal(vertex.attributes.map((entry) => [entry.index, entry.type, entry.componentMask]), [[0,"vec4",15], [1,"vec4",15]], "captured attributes metadata");
  equal(vertex.outputs.map((entry) => [entry.index, entry.type, entry.componentMask, entry.writtenMask]),
    [[0,"vec4",15,15], [1,"vec4",3,3]], "POSITION and generic output component writes");
  equal(fragment.inputs.map((entry) => [entry.index, entry.type, entry.componentMask]), [[0,"vec4",3]], "fragment generic input components");
  equal(fragment.outputs.map((entry) => [entry.index, entry.type, entry.componentMask, entry.writtenMask]), [[0,"vec4",15,15]], "fragment full color output");
  return result;
}

async function rejectionRecovery(bridge, valid, report) {
  const response = await fetch(new URL("captured-invalid.json", import.meta.url));
  require(response.ok, "cannot fetch bounded new-grammar attack corpus");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const cases = JSON.parse(new TextDecoder().decode(bytes));
  require(Array.isArray(cases) && cases.length >= 20 && cases.length <= 256, "bounded nonempty new-grammar attack corpus");
  report.grammarAttacks = { sourceSha256: await digest(bytes), cases: [], recoveryRounds: 8 };
  for (const test of cases) {
    require(["vertex", "fragment"].includes(test.stage) && typeof test.text === "string", "invalid grammar-attack fixture schema");
    const output = bridge.translate({ stage: test.stage, text: test.text });
    require(output.ok === false && ["parse-error", "unsupported-feature"].includes(output.error?.code), `${test.name}: new-grammar attack accepted or misclassified: ${JSON.stringify(output)}`);
    require(!Object.hasOwn(output, "glsl") && output.error.message.length > 0 && output.error.message.length <= 512, `${test.name}: bounded rejection without fallback GLSL`);
    report.grammarAttacks.cases.push({ name: test.name, stage: test.stage, inputSha256: await digest(test.text), inputBytes: test.text.length, error: output.error });
  }
  for (let round = 0; round < report.grammarAttacks.recoveryRounds; round++) {
    for (const [index, test] of cases.entries()) {
      const failed = bridge.translate({ stage: test.stage, text: test.text });
      equal(failed.error?.code, report.grammarAttacks.cases[index].error.code, `recovery ${round}/${test.name} rejection code`);
      for (const stage of ["vertex", "fragment"]) {
        const { text, ...expected } = valid[stage];
        equal(bridge.translate({ stage, text }), expected, `recovery ${round}/${test.name}/${stage} unchanged output and metadata`);
      }
    }
  }
  report.grammarAttacks.rejections = cases.length * (report.grammarAttacks.recoveryRounds + 1);
  report.grammarAttacks.recoveries = cases.length * report.grammarAttacks.recoveryRounds * 2;
}

function screenshotTile(gl, canvas, framebuffer, name, checkedPixels) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.blitFramebuffer(0, 0, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  equal(gl.getError(), gl.NO_ERROR, "captured evidence canvas blit");
  const figure = document.createElement("figure");
  const picture = document.createElement("img");
  picture.src = canvas.toDataURL("image/png");
  picture.alt = name;
  const caption = document.createElement("figcaption");
  caption.textContent = `${name} · ${checkedPixels} exact pixels`;
  figure.append(picture, caption);
  document.querySelector("#draws").append(figure);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
}

async function renderPhases(gl, canvas, translated, report, sabotage) {
  const { program, logs } = createProgram(gl, translated.vertex, translated.fragment);
  const buffers = [];
  const textures = [];
  const vao = gl.createVertexArray();
  const framebuffer = gl.createFramebuffer();
  require(vao && framebuffer, "captured VAO/framebuffer allocation");
  try {
    // WebGL exposes interstage output type reflection through a transform-feedback
    // varying declaration. Relink before creating any locations; never begin TF.
    const generic = translated.vertex.metadata.outputs.find((output) => output.index === 1);
    gl.transformFeedbackVaryings(program, [generic.name], gl.SEPARATE_ATTRIBS);
    gl.linkProgram(program);
    require(gl.getProgramParameter(program, gl.LINK_STATUS), `captured IO reflection relink failed: ${gl.getProgramInfoLog(program)}`);
    const varying = gl.getTransformFeedbackVarying(program, 0);
    require(varying, "captured generic varying reflection");
    equal([varying.name, varying.type, varying.size], [generic.name, gl.FLOAT_VEC4, 1], "actual linked generic IO type");
    equal(gl.getFragDataLocation(program, translated.fragment.metadata.outputs[0].name), 0, "single fragment color output location");
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    const vertices = gl.createBuffer();
    const indices = gl.createBuffer();
    require(vertices && indices, "captured geometry buffer allocation");
    buffers.push(vertices, indices);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(VERTICES), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(INDICES), gl.STATIC_DRAW);
    const attributes = [];
    equal(gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES), 2, "both captured attributes are active");
    for (let index = 0; index < 2; index++) {
      const actual = gl.getActiveAttrib(program, index);
      const metadata = translated.vertex.metadata.attributes.find((entry) => entry.name === actual.name);
      require(metadata && [0, 1].includes(metadata.index), "captured active attribute must have metadata");
      equal([actual.type, actual.size], [gl.FLOAT_VEC4, 1], `${actual.name} actual shader input type`);
      const location = gl.getAttribLocation(program, actual.name);
      const offset = metadata.index * 8;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset);
      equal(gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_SIZE), 2, "original two-component attribute binding");
      equal(gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_STRIDE), 16, "original interleaved stride");
      equal(gl.getVertexAttribOffset(location, gl.VERTEX_ATTRIB_ARRAY_POINTER), offset, "original attribute offset");
      attributes.push({ ...metadata, location, reflectedType: actual.type, reflectedSize: actual.size, boundComponents: 2, strideBytes: 16, offsetBytes: offset });
    }
    const uniformBlocks = bindSystemBlocks(gl, program, translated.vertex.metadata, buffers);
    equal(translated.fragment.metadata.samplers.map((entry) => [entry.index, entry.type]), [[0,"sampler2D"]], "captured sampler metadata");
    const target = texture2d(gl, WIDTH, HEIGHT, null);
    textures.push(target);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, "captured RGBA8 target completeness");
    gl.activeTexture(gl.TEXTURE0);
    const texels = [...TEXELS];
    if (sabotage === "texture-texel") texels[0] = 0;
    textures.push(texture2d(gl, 2, 2, new Uint8Array(texels)));
    const samplerName = translated.fragment.metadata.samplers[0].name;
    const samplerLocation = gl.getUniformLocation(program, samplerName);
    require(samplerLocation !== null, "captured sampler is active");
    const samplerIndex = gl.getUniformIndices(program, [samplerName])[0];
    equal(gl.getActiveUniforms(program, [samplerIndex], gl.UNIFORM_TYPE)[0], gl.SAMPLER_2D, "actual captured sampler type");
    gl.uniform1i(samplerLocation, 0);
    gl.viewport(0, 0, WIDTH, HEIGHT);
    for (const capability of [gl.DITHER, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST]) gl.disable(capability);
    gl.colorMask(true, true, true, true);
    gl.blendEquation(gl.FUNC_ADD);
    report.bindings = { programCount: 1, sameProgramAcrossPhases: true, vertices: VERTICES, indices: INDICES,
      vertexBytesSha256: await digest(new Float32Array(VERTICES)), indexBytesSha256: await digest(new Uint16Array(INDICES)),
      attributes, uniformBlocks, generic: { name: varying.name, type: varying.type, size: varying.size, reflection: "transform-feedback varying; no TF execution" },
      fragmentOutput: { name: translated.fragment.metadata.outputs[0].name, location: 0 },
      sampler: { name: samplerName, type: gl.SAMPLER_2D, unit: 0, texels, originalTexels: TEXELS, width: 2, height: 2, filter: "NEAREST", wrap: "CLAMP_TO_EDGE" },
      logs: { ...logs, reflectionLink: gl.getProgramInfoLog(program) } };
    for (const [phase, scenario] of PHASES.entries()) {
      require(gl.getParameter(gl.CURRENT_PROGRAM) === program, "same linked program must remain active across tint updates");
      gl.clearColor(0, 0, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const uniforms = [];
      bindConstants(gl, program, translated.fragment.metadata, [scenario.tint], uniforms);
      if (scenario.blend) {
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      } else gl.disable(gl.BLEND);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      gl.finish();
      const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
      gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      equal(gl.getError(), gl.NO_ERROR, `${scenario.name} draw/readback WebGL error`);
      const draw = { phase, name: scenario.name, uniforms, blend: scenario.blend, clear: [0,0,1,1],
        drawCall: { mode: "TRIANGLES", count: 6, indexType: "UNSIGNED_SHORT", offsetBytes: 0 },
        expectedQuadrants: scenario.expected, checkedPixels: 0, checks: [], rgbaSha256: await digest(pixels), glError: gl.NO_ERROR };
      report.draws.push(draw);
      for (const [quadrant, expected] of scenario.expected.entries()) {
        const x0 = 4 + 16 * (quadrant % 2);
        const y0 = 4 + 16 * Math.floor(quadrant / 2);
        for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) {
          const actual = [...pixels.subarray((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)];
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            draw.failure = { x, y, expected, observed: actual };
            document.querySelector("#status").textContent = `FAILED: phase ${phase}, pixel(${x},${y}), expected ${expected}, observed ${actual}`;
            screenshotTile(gl, canvas, framebuffer, `${scenario.name} FAILED`, draw.checkedPixels);
          }
          equal(actual, expected, `${scenario.name} phase=${phase} pixel(${x},${y})`);
          draw.checkedPixels++;
        }
        draw.checks.push({ rect: [x0, y0, 8, 8], expected, observed: [...pixels.subarray((y0 * WIDTH + x0) * 4, (y0 * WIDTH + x0) * 4 + 4)], pixels: 64 });
      }
      equal(draw.checkedPixels, 256, "original scene phase pixel count");
      screenshotTile(gl, canvas, framebuffer, scenario.name, draw.checkedPixels);
    }
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.deleteFramebuffer(framebuffer);
    for (const image of textures) gl.deleteTexture(image);
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
  }
}

export async function runAcceptance({ sabotage = null } = {}) {
  require(sabotage === null || sabotage === "texture-texel", "unknown trusted harness sabotage");
  const report = { kind: "captured-textured-scene-shaders", guestExecution: false, commandStreamReplay: false,
    status: "running", sabotage, translations: [], draws: [], limits: LIMITS };
  window.__virglCapturedShaderReport = report;
  const canvas = document.querySelector("#gpu");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: false,
    preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
  require(gl instanceof WebGL2RenderingContext, "captured shader proof requires WebGL2");
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  require(debug, "unmasked hardware identity required");
  report.renderer = { vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
    version: gl.getParameter(gl.VERSION), shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION), contextAttributes: gl.getContextAttributes(), extensions: gl.getSupportedExtensions() };
  require(typeof report.renderer.renderer === "string" && report.renderer.renderer.length > 3
    && !/swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic|mock|fake|null/i.test(report.renderer.renderer), "captured shader proof requires actual hardware renderer");
  const bridge = await createVirglShaderBridge();
  const translated = await translations(bridge, report);
  await rejectionRecovery(bridge, translated, report);
  await renderPhases(gl, canvas, translated, report, sabotage);
  report.checkedPixels = report.draws.reduce((sum, draw) => sum + draw.checkedPixels, 0);
  equal(report.checkedPixels, 768, "original captured workload total pixels");
  report.status = "passed";
  document.querySelector("#status").textContent = `2 exact captured TGSI bodies · 3 indexed draws · 768 exact interior pixels · ${report.grammarAttacks.cases.length} grammar attacks`;
  document.querySelector("#renderer").textContent = report.renderer.renderer;
  return report;
}
