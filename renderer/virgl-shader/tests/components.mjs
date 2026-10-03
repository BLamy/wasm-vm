// E6-T12e1: original shader bytes, bounded grammar, and independent hardware pixels.
import { createVirglShaderBridge, LIMITS } from '../index.mjs';
import { createProgram, texture2d, bindSystemBlocks, bindConstants, digest } from './browser.mjs';

const corpus = [
  ['003270109615e05345631cf8a2273ebc1bf3d86c7590e05ddc8424c441db7605',389,'fragment','kmscube'],
  ['0ec6a7a8741638e5a62cbf4a1f6896dd91bb2d60182e8e01f60866adf40fbed6',83,'vertex','compositor'],
  ['12f6d594f42e244d2d35c6a0b51cee809d219cc0729d9cee697b40725139f373',969,'vertex','glmark2-es2'],
  ['23b5f8a83172e68c9365028d2f3fedbb4d0a12d3b02a39b694388e89304910d3',150,'vertex','glmark2-es2'],
  ['3f78a90d838490257666b66477683b24c6ff110c6469504ecba701815312a572',466,'vertex','compositor'],
  ['403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c',419,'vertex','glmark2-es2'],
  ['5a243fc7a19476612a000906c6060a6c1883fee7f2d87d7137d508269a0cd998',5593,'fragment','glmark2-es2'],
  ['616a643d02f33f502b08d9bd6368de93ba1bd9c7e6bacdee0e0aa946a2c3e4ad',3881,'fragment','glmark2-es2'],
  ['67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa',102,'fragment','compositor'],
  ['80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808',261,'fragment','textured-scene'],
  ['9819066def2df1cd09f36f142fd2bc6b659395aa21bea6db7f58fbcc122c7c83',389,'fragment','glmark2-es2'],
  ['a6143f113a7d0a3ce6118a518c12bc7c537bebfdfa9a0af6580496709188379e',8800,'fragment','glmark2-es2'],
  ['b28f0dbcbc79d9931938c29cb77b62a42ba8e95d65bbd1a720d9aecd3f8ec030',228,'fragment','compositor'],
  ['c00de140c2e9b128f07f7fba74bd60f3257b832d3251ae52a044bf8e68d90518',124,'fragment','compositor'],
  ['d4f702f7a846a93b6f767bc73ed99a9c0f4fbe5fcb55662bca99e3f07f47d450',1396,'vertex','kmscube'],
  ['e911b393909ab041c24f608b41497143eba765cc8d7db1206a47896934d43c51',6783,'fragment','glmark2-es2'],
  ['e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33',256,'vertex','textured-scene'],
  ['e9bc6d3b61e3cda2c215ac8b44a432e2eb1bd4891cfa921c6f914fd3fd86b551',351,'vertex','glmark2-es2'],
  ['ef095954837a421fd04071ffd1d99e70f56b258614d47a40fc9148238d6d3c88',162,'fragment','compositor'],
];
export const ORIGINAL_INPUTS = Object.freeze(corpus.map(([sha256,size,stage,workload]) => Object.freeze({
  sha256, size, stage, path: `evidence/virgl-corpus/captures/${workload}/shaders/${sha256}.tgsi`,
})));
export const NEW_HASHES = Object.freeze([corpus[0][0], corpus[10][0], corpus[5][0], corpus[17][0]]);
const ACCEPTED = new Set([0,1,3,5,8,9,10,12,13,16,17,18].map((index) => corpus[index][0]));
const WIDTH = 32, HEIGHT = 32;
const require = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (actual, expected, label) => require(JSON.stringify(actual) === JSON.stringify(expected),
  `${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`);
const QUAD = [[-1,-1],[1,-1],[-1,1],[-1,1],[1,-1],[1,1]];
// Even RGB bytes make half-brightness exact; unequal alpha catches the scalar y write.
const TEXELS = [240,40,80,255, 20,200,60,128, 80,40,240,64, 160,220,40,0];
const FRAGMENT_PHASES = [
  { brightness: 0, expected: [[0,0,0,255],[0,0,0,128],[0,0,0,64],[0,0,0,0]] },
  { brightness: 0.5, expected: [[120,20,40,255],[10,100,30,128],[40,20,120,64],[80,110,20,0]] },
  { brightness: 1, expected: [[240,40,80,255],[20,200,60,128],[80,40,240,64],[160,220,40,0]] },
];
const XYZ_VERTEX = `VERT
DCL IN[0]
DCL IN[1]
DCL OUT[0], POSITION
DCL OUT[1].xyz, GENERIC[0]
MOV OUT[0], IN[0]
MOV OUT[1].xyz, IN[1]
END
`;
const SOLID_FRAGMENT = `FRAG
DCL OUT[0], COLOR
IMM[0] FLT32 {1, 0.25, 0.5, 1}
MOV OUT[0], IMM[0]
END
`;

async function readOriginals(bridge, report) {
  const result = new Map();
  for (const input of ORIGINAL_INPUTS) {
    const response = await fetch(`/${input.path}`);
    require(response.ok, `missing unchanged original ${input.sha256}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    equal(bytes.length, input.size, 'original byte length'); equal(await digest(bytes), input.sha256, 'original SHA-256');
    require(bytes.every((byte) => [9,10,13].includes(byte) || byte >= 32 && byte <= 126), 'original text must remain ASCII');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const translated = bridge.translate({ stage: input.stage, text });
    equal(translated.ok, ACCEPTED.has(input.sha256), `original ${input.sha256} unchanged outcome`);
    if (translated.ok) {
      equal(translated.metadata.profile, 'virgl-webgl2-straight-line-v5', 'component profile');
      equal(translated.metadata.stage, input.stage, 'original stage');
      require(translated.glsl.length > 0 && translated.glsl.length <= LIMITS.glslBytes, 'bounded GLSL');
    } else {
      equal(translated.error?.code, 'unsupported-feature',
        `original ${input.sha256} exact remaining rejection`);
      require(text.includes('PRECISE'), 'unsupported original retains PRECISE');
      require(!Object.hasOwn(translated, 'glsl'), 'rejection cannot substitute GLSL');
    }
    const entry = { path: input.path, sha256: input.sha256, bytes: bytes.length, stage: input.stage,
      result: translated, glslSha256: translated.ok ? await digest(translated.glsl) : null };
    report.corpus.push(entry);
    if (NEW_HASHES.includes(input.sha256)) {
      report.translations.push(entry); result.set(input.sha256, { text, ...translated });
    }
  }
  equal(report.corpus.filter((entry) => entry.result.ok).length, 12, 'exactly twelve original acceptances');
  equal(report.translations.length, 4, 'four newly accepted originals');
  return result;
}

async function boundaryRecovery(bridge, originals, report) {
  const response = await fetch(new URL('component-cases.json', import.meta.url));
  require(response.ok, 'shared component boundary fixture');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const cases = JSON.parse(new TextDecoder().decode(bytes));
  require(Array.isArray(cases) && cases.length > 0 && cases.length <= 256, 'bounded shared cases');
  report.boundary = { fixtureSha256: await digest(bytes), cases: [], recovery: { rounds: 2, conversions: 0 } };
  const names = new Set();
  for (const test of cases) {
    equal(Object.keys(test).sort(), ['name','ok','stage','text'], 'shared case schema');
    require(typeof test.name === 'string' && !names.has(test.name), 'unique boundary name'); names.add(test.name);
    require(['vertex','fragment'].includes(test.stage) && typeof test.text === 'string' && typeof test.ok === 'boolean', 'typed shared case');
    const result = bridge.translate({ stage: test.stage, text: test.text });
    equal(result.ok, test.ok, `${test.name} expected boundary outcome`);
    if (!test.ok) require(['parse-error','unsupported-feature'].includes(result.error?.code) && !Object.hasOwn(result, 'glsl'), `${test.name} guard rejection`);
    report.boundary.cases.push({ name: test.name, stage: test.stage, inputSha256: await digest(test.text), ok: result.ok, result });
  }
  for (let round = 0; round < report.boundary.recovery.rounds; round++) {
    for (const [index, test] of cases.entries()) {
      equal(bridge.translate({ stage: test.stage, text: test.text }), report.boundary.cases[index].result, `repeat ${round}/${test.name}`);
      for (const entry of report.translations) {
        equal(bridge.translate({ stage: entry.stage, text: originals.get(entry.sha256).text }), entry.result,
          `exact original recovery ${round}/${test.name}/${entry.sha256}`);
        report.boundary.recovery.conversions++;
      }
    }
  }
  report.boundary.recovery.outputsAndMetadataIdentical = true;
}

async function helper(bridge, stage, text, name, report) {
  const result = bridge.translate({ stage, text });
  require(result.ok, `${name} independent helper: ${JSON.stringify(result)}`);
  report.helpers.push({ name, stage, text, inputSha256: await digest(text), glslSha256: await digest(result.glsl), result });
  return result;
}

function tile(gl, canvas, framebuffer, label) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.blitFramebuffer(0, 0, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  equal(gl.getError(), gl.NO_ERROR, 'evidence tile blit');
  const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
  image.src = canvas.toDataURL('image/png'); image.alt = label; caption.textContent = label;
  figure.append(image, caption); document.querySelector('#draws').append(figure);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
}

async function draw(gl, canvas, vertex, fragment, specification, report) {
  const draw = { name: specification.name, shaderSha256: specification.shaderSha256,
    expectedOracle: specification.expectedOracle, checks: [], checkedPixels: 0, attributes: [], uniforms: [],
    vertexGlslSha256: await digest(vertex.glsl), fragmentGlslSha256: await digest(fragment.glsl), depth: specification.depth };
  report.draws.push(draw);
  const { program, logs } = createProgram(gl, vertex, fragment);
  draw.programLogs = logs;
  const buffers = [], textures = [], vao = gl.createVertexArray(), framebuffer = gl.createFramebuffer();
  let depth;
  require(vao && framebuffer, 'draw resource allocation');
  try {
    gl.useProgram(program); gl.bindVertexArray(vao);
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES); i++) {
      const active = gl.getActiveAttrib(program, i);
      const metadata = vertex.metadata.attributes.find((entry) => entry.name === active.name);
      require(metadata && specification.attributes[metadata.index], `active attribute ${active.name} binding`);
      equal([active.type, active.size], [gl.FLOAT_VEC4, 1], 'actual vec4 attribute');
      const values = specification.attributes[metadata.index]; equal(values.length, 24, 'six vec4 attribute vertices');
      const buffer = gl.createBuffer(); require(buffer, 'vertex buffer'); buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, active.name);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0);
      draw.attributes.push({ index: metadata.index, name: active.name, location, values, type: active.type });
    }
    draw.uniformBlocks = bindSystemBlocks(gl, program, vertex.metadata, buffers);
    bindConstants(gl, program, vertex.metadata, specification.constants, draw.uniforms);
    bindConstants(gl, program, fragment.metadata, undefined, draw.uniforms);
    textures.push(texture2d(gl, WIDTH, HEIGHT, null));
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[0], 0);
    if (specification.depth) {
      depth = gl.createRenderbuffer(); require(depth, 'depth buffer'); gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, WIDTH, HEIGHT);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, 'actual framebuffer completeness');
    for (const sampler of fragment.metadata.samplers) {
      equal([sampler.index,sampler.type], [0,'sampler2D'], 'original 2D sampler');
      gl.activeTexture(gl.TEXTURE0); textures.push(texture2d(gl, 2, 2, new Uint8Array(TEXELS)));
      const location = gl.getUniformLocation(program, sampler.name); require(location !== null, 'active texture sampler'); gl.uniform1i(location, 0);
    }
    gl.viewport(0, 0, WIDTH, HEIGHT);
    for (const capability of [gl.DITHER,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.BLEND]) gl.disable(capability);
    gl.colorMask(true,true,true,true); gl.depthMask(true); gl.depthFunc(gl.LESS); gl.clearDepth(0.5);
    if (specification.depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0,0,1,1); gl.clear(gl.COLOR_BUFFER_BIT | (specification.depth ? gl.DEPTH_BUFFER_BIT : 0));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    equal(gl.getError(), gl.NO_ERROR, `${draw.name} actual draw/readback`);
    draw.rgbaSha256 = await digest(pixels);
    for (const { x, y, expected } of specification.checks) {
      const offset = (y * WIDTH + x) * 4, observed = [...pixels.subarray(offset, offset + 4)];
      draw.checks.push({ pixel: [x,y], expected, observed });
      if (JSON.stringify(expected) !== JSON.stringify(observed)) {
        draw.failure = { pixel: [x,y], expected, observed };
        tile(gl, canvas, framebuffer, `${draw.name} FAILED`);
      }
      equal(observed, expected, `${draw.name} independent pixel (${x},${y})`); draw.checkedPixels++;
    }
    tile(gl, canvas, framebuffer, `${draw.name} · ${draw.checkedPixels} pixels`);
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null); gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    for (const texture of textures) gl.deleteTexture(texture);
    if (depth) gl.deleteRenderbuffer(depth);
    gl.deleteFramebuffer(framebuffer); gl.deleteVertexArray(vao); gl.deleteProgram(program);
  }
}

function textureChecks(colors) {
  const checks = [];
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    for (let y = 4 + 16 * (quadrant >> 1); y < 12 + 16 * (quadrant >> 1); y++) {
      for (let x = 4 + 16 * (quadrant & 1); x < 12 + 16 * (quadrant & 1); x++) checks.push({ x, y, expected: colors[quadrant] });
    }
  }
  return checks;
}

// Independent geometric specification: this inverse affine map is written from
// the desired quadrilateral, never from GLSL, metadata, constants or readback.
// Exclude the raster boundary; all interior vertices have z<0, so LESS against
// clear-depth 0.5 distinguishes an omitted z write (zero must not draw).
function affineChecks(mirror) {
  const checks = [];
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const px = ((x + 0.5) / 16 - 1) * (mirror ? -1 : 1);
    const py = ((y + 0.5) / 16 - 1) * (mirror ? -1 : 1);
    const u = (32 * (px - 0.25) + 8 * (py + 0.25)) / 17;
    const v = (-8 * (px - 0.25) + 32 * (py + 0.25)) / 17;
    const edge = Math.max(Math.abs(u), Math.abs(v));
    if (edge < 0.8) checks.push({ x, y, expected: [255,64,128,255] });
    else if (edge > 1.2) checks.push({ x, y, expected: [0,0,255,255] });
  }
  require(checks.some((entry) => entry.expected[0] === 255), 'oracle must include drawn foreground');
  return checks;
}

async function omitMaskedWrite(vertex, report) {
  const pattern = /(^[ \t]*)gl_Position\.xyz\s*=\s*([^;\n]+);/m;
  const match = pattern.exec(vertex.glsl);
  require(match, 'masked-write sabotage must identify the single original position.xyz assignment');
  const replacement = `${match[1]}gl_Position.xy = (${match[2]}).xy;\n${match[1]}gl_Position.z = 0.0;`;
  const glsl = vertex.glsl.slice(0, match.index) + replacement + vertex.glsl.slice(match.index + match[0].length);
  report.omissions.push({ kind: 'masked-write', shaderSha256: corpus[5][0], original: match[0], replacement,
    originalGlslSha256: await digest(vertex.glsl), servedGlslSha256: await digest(glsl),
    meaning: 'omit z from the xyz write and define that dropped lane as zero; captured TGSI remains unchanged' });
  return { ...vertex, glsl };
}

export async function runAcceptance({ sabotage = null } = {}) {
  require(sabotage === null || sabotage === 'masked-write', 'known omission control');
  const report = { kind: 'captured-components', guestExecution: false, commandStreamReplay: false,
    productionVirgl: false, status: 'running', sabotage, limits: LIMITS, corpus: [], translations: [], helpers: [], draws: [], omissions: [] };
  window.__virglComponentsReport = report;
  try {
    const canvas = document.querySelector('#gpu'); canvas.width = WIDTH; canvas.height = HEIGHT;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: false,
      preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
    require(gl instanceof WebGL2RenderingContext, 'actual WebGL2 context');
    const debug = gl.getExtension('WEBGL_debug_renderer_info'); require(debug, 'hardware renderer identity');
    report.renderer = { vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      version: gl.getParameter(gl.VERSION), shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION) };
    require(!/swiftshader|llvmpipe|softpipe|lavapipe|software|mock|fake|null/i.test(report.renderer.renderer), 'hardware renderer required');
    const bridge = await createVirglShaderBridge(), originals = await readOriginals(bridge, report);
    await boundaryRecovery(bridge, originals, report);
    const vertexHelper = await helper(bridge, 'vertex', XYZ_VERTEX, 'literal-xyz-varying', report);
    const fragmentHelper = await helper(bridge, 'fragment', SOLID_FRAGMENT, 'literal-solid-color', report);
    for (const shaderSha256 of NEW_HASHES.slice(0,2)) {
      for (const phase of FRAGMENT_PHASES) {
        await draw(gl, canvas, vertexHelper, originals.get(shaderSha256), {
          name: `${shaderSha256.slice(0,8)} brightness=${phase.brightness}`, shaderSha256, depth: false,
          attributes: [QUAD.flatMap(([x,y]) => [x,y,0,1]), QUAD.flatMap(([x,y]) => [phase.brightness,(x+1)/2,(y+1)/2,0])],
          checks: textureChecks(phase.expected), expectedOracle: { type: 'literal texels and exact RGB scaling; alpha unchanged', texels: TEXELS,
            brightness: phase.brightness, expectedQuadrants: phase.expected },
        }, report);
      }
    }
    for (const shaderSha256 of NEW_HASHES.slice(2)) {
      const original = originals.get(shaderSha256), affine = shaderSha256 === corpus[5][0];
      const vertex = sabotage && affine ? await omitMaskedWrite(original, report) : original;
      for (const mirror of [false,true]) {
        const sign = mirror ? -1 : 1;
        const constants = affine
          ? [[sign*0.5,sign*0.125,0.125,0],[sign*-0.125,sign*0.5,0.25,0],[sign*0.25,sign*-0.25,-0.5,0]]
          : [[sign,sign*0.25,0.25,0],[sign*-0.25,sign,0.5,0],[sign*0.5,sign*-0.5,1,0],[sign*0.25,sign*-0.25,-1.5,2]];
        await draw(gl, canvas, vertex, fragmentHelper, {
          name: `${shaderSha256.slice(0,8)} ${mirror ? 'mirrored' : 'affine'}`, shaderSha256, depth: true,
          attributes: [QUAD.flatMap(([x,y]) => affine ? [x,y,0.75,0.5] : [x,y,0.5,1]), QUAD.flatMap(([x,y]) => [(x+1)/2,(y+1)/2,0,1])],
          constants, checks: affineChecks(mirror), expectedOracle: { type: 'independent affine interior/exterior with depth-sensitive z',
            inverseMap: ['(32*(x-.25)+8*(y+.25))/17','(-8*(x-.25)+32*(y+.25))/17'], mirror,
            interiorMargin: 0.8, exteriorMargin: 1.2, foreground: [255,64,128,255], background: [0,0,255,255],
            clearDepth: 0.5, depthFunction: 'LESS', omittedZ: 'zero fails depth' },
        }, report);
      }
    }
    equal(report.draws.length, 10, 'ten actual draws of four original shader bodies');
    equal(report.omissions.length, 0, 'an omission control cannot claim success');
    report.checkedPixels = report.draws.reduce((sum, entry) => sum + entry.checkedPixels, 0);
    report.status = 'passed';
    document.querySelector('#status').textContent = `12/19 unchanged original bodies · four new originals · ten draws · ${report.checkedPixels} independent pixels`;
    document.querySelector('#renderer').textContent = report.renderer.renderer;
    return report;
  } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; throw error; }
}
