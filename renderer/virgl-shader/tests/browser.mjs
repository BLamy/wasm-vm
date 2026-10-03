import { createVirglShaderBridge, LIMITS } from "../index.mjs";
import { shaders, draws, invalidCases } from "./corpus.mjs";

const WIDTH = 32;
const HEIGHT = 32;
const require = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (a, b, message) => require(JSON.stringify(a) === JSON.stringify(b),
  `${message}: expected ${JSON.stringify(b)}, observed ${JSON.stringify(a)}`);
const digest = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256",
  typeof value === "string" ? new TextEncoder().encode(value) : value))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");

// Reuse binding/reflection mechanics while keeping literal/captured oracles separate.
export { createProgram, texture2d, bindSystemBlocks, bindConstants, digest };

function shader(gl, kind, source, label) {
  require(/^#version 300 es\b/m.test(source), `${label}: GLSL ES300 required`);
  const handle = gl.createShader(kind);
  require(handle, `${label}: createShader failed`);
  gl.shaderSource(handle, source);
  gl.compileShader(handle);
  const log = gl.getShaderInfoLog(handle);
  if (!gl.getShaderParameter(handle, gl.COMPILE_STATUS)) {
    gl.deleteShader(handle);
    throw new Error(`${label}: actual WebGL shader compile failed: ${log}`);
  }
  return { handle, log };
}

function createProgram(gl, vertex, fragment) {
  const vs = shader(gl, gl.VERTEX_SHADER, vertex.glsl, "vertex");
  const fs = shader(gl, gl.FRAGMENT_SHADER, fragment.glsl, "fragment");
  const program = gl.createProgram();
  require(program, "createProgram failed");
  gl.attachShader(program, vs.handle);
  gl.attachShader(program, fs.handle);
  gl.linkProgram(program);
  const log = gl.getProgramInfoLog(program);
  gl.deleteShader(vs.handle);
  gl.deleteShader(fs.handle);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new Error(`actual WebGL program link failed: ${log}`);
  }
  return { program, logs: { vertex: vs.log, fragment: fs.log, link: log } };
}

function texture2d(gl, width, height, pixels) {
  const texture = gl.createTexture();
  require(texture, "createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return texture;
}

function bindSystemBlocks(gl, program, metadata, buffers) {
  const blocks = metadata.uniformBlocks ?? [];
  const result = [];
  for (const block of blocks) {
    const index = gl.getUniformBlockIndex(program, block.name);
    require(index !== gl.INVALID_INDEX, `missing declared uniform block ${block.name}`);
    const byteLength = gl.getActiveUniformBlockParameter(program, index, gl.UNIFORM_BLOCK_DATA_SIZE);
    equal(byteLength, block.byteLength, `${block.name} reflected byte length`);
    const data = new ArrayBuffer(byteLength);
    const view = new DataView(data);
    const members = [];
    for (const member of block.members) {
      const names = [member.name, `${block.name}.${member.name}`];
      let uniformIndex = gl.INVALID_INDEX;
      let reflectedName;
      for (const name of names) {
        const candidate = gl.getUniformIndices(program, [name])?.[0];
        if (candidate !== undefined && candidate !== gl.INVALID_INDEX) {
          uniformIndex = candidate;
          reflectedName = name;
          break;
        }
      }
      require(uniformIndex !== gl.INVALID_INDEX, `missing ${block.name}.${member.name}`);
      const offset = gl.getActiveUniforms(program, [uniformIndex], gl.UNIFORM_OFFSET)[0];
      const type = gl.getActiveUniforms(program, [uniformIndex], gl.UNIFORM_TYPE)[0];
      equal(offset, member.offset, `${member.name} reflected offset`);
      equal(type, gl.FLOAT, `${member.name} reflected type`);
      require(member.name === "winsys_adjust_y" && member.type === "float" && member.default === 1,
        `unproven system uniform ${member.name}`);
      require(offset + 4 <= byteLength, "system uniform offset exceeds block");
      view.setFloat32(offset, 1, true);
      members.push({ name: member.name, reflectedName, offset, type, value: 1 });
    }
    const buffer = gl.createBuffer();
    require(buffer, "uniform buffer allocation failed");
    buffers.push(buffer);
    gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, new Uint8Array(data), gl.STATIC_DRAW);
    gl.uniformBlockBinding(program, index, result.length);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, result.length, buffer);
    result.push({ name: block.name, index, byteLength, members });
  }
  require(result.some((block) => block.members.some((member) => member.name === "winsys_adjust_y")),
    "vertex coordinate-system binding must be represented in metadata");
  equal(gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS), result.length,
    "every active uniform block has metadata");
  return result;
}

function bindConstants(gl, program, metadata, values, bindings) {
  for (const uniform of metadata.uniforms) {
    require(uniform.type === "uvec4[]", `unsupported constant metadata type ${uniform.type}`);
    require(Number.isInteger(uniform.count) && uniform.count > 0 && uniform.count <= 8,
      "constant array must stay inside profile");
    equal(values?.length, uniform.count, `${metadata.stage} constant count`);
    const name = `${uniform.name}[0]`;
    require(/^(?:vs|fs)const0$/.test(uniform.name) && uniform.encoding === "float32-bits", "constant binding must expose array/bit encoding");
    const location = gl.getUniformLocation(program, name);
    require(location !== null, `constant ${name} is not active`);
    const index = gl.getUniformIndices(program, [name])[0];
    equal(gl.getActiveUniforms(program, [index], gl.UNIFORM_TYPE)[0], gl.UNSIGNED_INT_VEC4,
      `${name} actual uniform type`);
    equal(gl.getActiveUniforms(program, [index], gl.UNIFORM_SIZE)[0], uniform.count,
      `${name} actual uniform array count`);
    const floats = new Float32Array(values.flat());
    require(floats.length === uniform.count * 4, "expected four components per constant");
    const bits = new Uint32Array(floats.buffer);
    gl.uniform4uiv(location, bits);
    bindings.push({ name, stage: metadata.stage, type: uniform.type, values, bits: [...bits] });
  }
}

async function renderDraw(gl, canvas, scenario, translations) {
  const vertex = translations[scenario.vertex];
  const fragment = translations[scenario.fragment];
  const { program, logs } = createProgram(gl, vertex, fragment);
  const buffers = [];
  const textures = [];
  const framebuffers = [];
  const vao = gl.createVertexArray();
  require(vao, "createVertexArray failed");
  try {
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    const positions = [-1,-1,0,1, 1,-1,0,1, -1,1,0,1, -1,1,0,1, 1,-1,0,1, 1,1,0,1];
    const uv = [0,0,0,1, 1,0,0,1, 0,1,0,1, 0,1,0,1, 1,0,0,1, 1,1,0,1];
    const varying = scenario.texture ? uv : Array.from({ length: 6 },
      () => scenario.varying ?? [0, 0, 0, 1]).flat();
    const activeAttributes = [];
    const attributes = vertex.metadata.attributes;
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES); i++) {
      const actual = gl.getActiveAttrib(program, i);
      const declared = attributes.find((attribute) => attribute.name === actual.name);
      require(declared && [0, 1].includes(declared.index), `active attribute lacks metadata: ${actual.name}`);
      equal(actual.type, gl.FLOAT_VEC4, `${actual.name} attribute type`);
      equal(actual.size, 1, `${actual.name} attribute size`);
      const location = gl.getAttribLocation(program, actual.name);
      const buffer = gl.createBuffer();
      require(buffer, "vertex buffer allocation failed");
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(declared.index === 0 ? positions : varying), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0);
      activeAttributes.push({ ...declared, location, type: actual.type });
    }
    require(activeAttributes.some((attribute) => attribute.index === 0), "position input must be active");
    if (scenario.varying || scenario.texture) {
      require(activeAttributes.some((attribute) => attribute.index === 1), "generic varying must be active");
    }
    const uniformBlocks = bindSystemBlocks(gl, program, vertex.metadata, buffers);
    const uniforms = [];
    bindConstants(gl, program, vertex.metadata, scenario.uniforms?.vertex, uniforms);
    bindConstants(gl, program, fragment.metadata, scenario.uniforms?.fragment, uniforms);

    const target = texture2d(gl, WIDTH, HEIGHT, null);
    textures.push(target);
    const framebuffer = gl.createFramebuffer();
    require(framebuffer, "createFramebuffer failed");
    framebuffers.push(framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, "RGBA8 framebuffer complete");
    const samplers = [];
    for (const sampler of fragment.metadata.samplers) {
      require(scenario.texture && sampler.index === 0 && sampler.type === "sampler2D",
        "only the explicitly tested 2D sampler is supported");
      gl.activeTexture(gl.TEXTURE0);
      textures.push(texture2d(gl, 2, 2, new Uint8Array(scenario.texture)));
      const location = gl.getUniformLocation(program, sampler.name);
      require(location !== null, `sampler ${sampler.name} must be active`);
      gl.uniform1i(location, 0);
      samplers.push({ ...sampler, texture: scenario.texture });
    }
    equal(samplers.length, scenario.texture ? 1 : 0, "sampler metadata matches workload");
    gl.viewport(0, 0, WIDTH, HEIGHT);
    gl.disable(gl.DITHER);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(...(scenario.clear ?? [0, 0, 0, 0]));
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (scenario.blend) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    equal(gl.getError(), gl.NO_ERROR, `${scenario.name} WebGL error`);
    let checkedPixels = 0;
    const checks = scenario.expected.map(({ rect, rgba }) => {
      const [x0, y0, width, height] = rect;
      for (let y = y0; y < y0 + height; y++) {
        for (let x = x0; x < x0 + width; x++) {
          const offset = (y * WIDTH + x) * 4;
          equal([...pixels.subarray(offset, offset + 4)], rgba, `${scenario.name} pixel(${x},${y})`);
          checkedPixels++;
        }
      }
      return { rect, expected: rgba, observed: [...pixels.subarray((y0 * WIDTH + x0) * 4,
        (y0 * WIDTH + x0) * 4 + 4)], pixels: width * height };
    });
    // Copy the real RGBA8 render target to the visible canvas for the evidence screenshot.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    equal(gl.getError(), gl.NO_ERROR, "evidence canvas blit");
    const card = document.createElement("figure");
    const picture = document.createElement("img");
    picture.src = canvas.toDataURL("image/png");
    picture.alt = scenario.name;
    const caption = document.createElement("figcaption");
    caption.textContent = `${scenario.name} · ${checkedPixels} exact pixels`;
    card.append(picture, caption);
    document.querySelector("#draws").append(card);
    return {
      name: scenario.name, vertex: scenario.vertex, fragment: scenario.fragment,
      viewport: [WIDTH, HEIGHT], blend: scenario.blend ?? false, clear: scenario.clear ?? [0,0,0,0],
      checkedPixels, checks, rgbaSha256: await digest(pixels), activeAttributes,
      uniformBlocks, uniforms, samplers, logs, glError: gl.NO_ERROR,
    };
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
    for (const texture of textures) gl.deleteTexture(texture);
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
  }
}

export async function runAcceptance() {
  const report = { kind: "virgl-shader-boundary", guestExecution: false, status: "running", translations: [], errors: [], draws: [] };
  window.__virglShaderReport = report;
  const canvas = document.querySelector("#gpu");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: false,
    preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
  require(gl instanceof WebGL2RenderingContext, "real WebGL2 context is required");
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  require(debug, "unmasked hardware renderer identity is required");
  report.renderer = {
    vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
    version: gl.getParameter(gl.VERSION), shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    contextAttributes: gl.getContextAttributes(), extensions: gl.getSupportedExtensions(),
  };
  require(typeof report.renderer.renderer === "string" && report.renderer.renderer.length > 3,
    "renderer identity is empty");
  require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic|mock|fake|null/i.test(report.renderer.renderer),
    `software or fake renderer rejected: ${report.renderer.renderer}`);
  const bridge = await createVirglShaderBridge();
  report.limits = LIMITS;
  const translations = {};
  const sources = {};
  for (const fixture of shaders) {
    const response = await fetch(new URL(fixture.file, import.meta.url));
    require(response.ok, `cannot read literal corpus ${fixture.file}`);
    const text = await response.text();
    const translated = bridge.translate({ stage: fixture.stage, text });
    require(translated.ok === true, `${fixture.name}: translation failed ${JSON.stringify(translated)}`);
    require(typeof translated.glsl === "string" && translated.glsl.length > 0 && translated.glsl.length <= 65536,
      `${fixture.name}: GLSL output must be bounded`);
    equal(translated.metadata.stage, fixture.stage, "metadata stage");
    for (const field of ["attributes", "uniforms", "samplers", "inputs", "outputs"]) {
      require(Array.isArray(translated.metadata[field]), `metadata.${field} must be an array`);
    }
    sources[fixture.name] = text;
    translations[fixture.name] = translated;
    report.translations.push({ ...fixture, sourceSha256: await digest(text), glslSha256: await digest(translated.glsl),
      glsl: translated.glsl, metadata: translated.metadata });
  }
  // Fixed limit is part of this slice's public contract; do not silently adapt to a looser wrapper.
  const textLimit = 16384;
  equal(LIMITS, { textBytes: 16384, tokens: 8192, glslBytes: 65536, instructions: 128, registerIndex: 7, temporaryRegisterIndex: 9 },
    "published fixed profile limits");
  const exactlyBounded = sources.passthrough + "\n".repeat(textLimit - sources.passthrough.length);
  equal(bridge.translate({ stage: "vertex", text: exactlyBounded }), translations.passthrough,
    "exactly 16384 ASCII bytes must remain valid and semantically identical");
  report.exactTextBoundary = { bytes: textLimit, glslAndMetadataIdentical: true };
  const negatives = invalidCases(sources.passthrough, textLimit);
  for (const test of negatives) {
    const output = bridge.translate({ stage: test.stage, text: test.text });
    require(output?.ok === false, `${test.name}: invalid input was accepted`);
    equal(output.error?.code, test.code, `${test.name}: stable error code`);
    require(typeof output.error.message === "string" && output.error.message.length > 0 && output.error.message.length <= 512,
      `${test.name}: bounded structured error message required`);
    require(!Object.hasOwn(output, "glsl"), `${test.name}: failure must not contain substitute GLSL`);
    report.errors.push({ name: test.name, expectedCode: test.code, error: output.error,
      inputBytes: typeof test.text === "string" ? new TextEncoder().encode(test.text).length : null,
      inputSha256: await digest(String(test.text)) });
  }
  for (let round = 0; round < 32; round++) {
    for (const negative of negatives) {
      const failure = bridge.translate({ stage: negative.stage, text: negative.text });
      equal(failure.error?.code, negative.code, `recovery round ${round}: ${negative.name}`);
      const recovered = bridge.translate({ stage: "vertex", text: sources.passthrough });
      equal(recovered, translations.passthrough, `recovery round ${round}: next valid conversion`);
    }
  }
  report.recovery = { rounds: 32, failures: negatives.length * 32, successes: negatives.length * 32,
    outputAndMetadataIdentical: true };
  for (const scenario of draws) report.draws.push(await renderDraw(gl, canvas, scenario, translations));
  report.checkedPixels = report.draws.reduce((total, draw) => total + draw.checkedPixels, 0);
  report.status = "passed";
  document.querySelector("#status").textContent = `${report.draws.length} hardware draws · ${report.checkedPixels} exact interior pixels · ${report.errors.length} structured rejection cases`;
  document.querySelector("#renderer").textContent = report.renderer.renderer;
  return report;
}
