import {createVirglShaderBridge, LIMITS} from '../index.mjs';
import {createProgram, texture2d, bindSystemBlocks, digest} from './browser.mjs';
import {parseConstantDomain, checkRasterBank} from '../../virgl-command/constant-domain.mjs';
import {word, number, ulp, gearsEquation, compositorEquation, gearsVectors,
  compositorVectors, gearsDraws, compositorDraws, TEXELS} from '../../../tools/virgl-gears-shaders/oracle.mjs';

const WIDTH = 16;
const require = (value, label) => { if (!value) throw new Error(label); };
const equal = (actual, expected, label) => require(JSON.stringify(actual) === JSON.stringify(expected),
  label + ' expected ' + JSON.stringify(expected) + ' observed ' + JSON.stringify(actual));
const clone = value => JSON.parse(JSON.stringify(value));

function monitor(native, report) {
  let serial = 0;
  const ids = new WeakMap(), live = new Map(), objects = [];
  const creates = {createShader: 'Shader', createProgram: 'Program', createBuffer: 'Buffer',
    createTexture: 'Texture', createFramebuffer: 'Framebuffer', createVertexArray: 'VertexArray',
    createTransformFeedback: 'TransformFeedback'};
  const gl = new Proxy(native, {get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== 'function') return value;
    return (...args) => {
      const result = value.apply(target, args);
      if (creates[key] && result) {
        const id = creates[key] + ':' + ++serial;
        ids.set(result, id); live.set(id, creates[key]); objects.push({id, kind: creates[key], object: result});
        report.events.push({call: key, id});
      }
      if (/^delete/.test(key) && args[0]) { live.delete(ids.get(args[0])); report.events.push({call: key, id: ids.get(args[0])}); }
      if (key === 'shaderSource') report.events.push({call: key, id: ids.get(args[0]), source: args[1]});
      if (key === 'compileShader') report.events.push({call: key, id: ids.get(args[0]),
        status: target.getShaderParameter(args[0], target.COMPILE_STATUS), log: target.getShaderInfoLog(args[0])});
      if (key === 'linkProgram') report.events.push({call: key, id: ids.get(args[0]),
        status: target.getProgramParameter(args[0], target.LINK_STATUS), log: target.getProgramInfoLog(args[0])});
      if (['drawArrays', 'beginTransformFeedback', 'endTransformFeedback'].includes(key)) report.events.push({call: key, args});
      return result;
    };
  }});
  return {gl, finish() {
    equal(live.size, 0, 'every original shader probe GL object released');
    for (const item of objects) equal(native['is' + item.kind](item.object), false, 'actual object deleted ' + item.id);
    equal(native.getError(), native.NO_ERROR, 'zero GL errors after disposal');
    report.objects = {created: objects.length, live: live.size, actualDeleted: objects.length};
  }};
}

function upload(gl, program, metadata, constants, uploads) {
  const values = constants.flat().map(word);
  for (const uniform of metadata.uniforms) {
    const location = gl.getUniformLocation(program, uniform.name + '[0]');
    require(location !== null, 'original raw uniform bank active ' + uniform.name);
    const index = gl.getUniformIndices(program, [uniform.name + '[0]'])[0];
    const type = gl.getActiveUniforms(program, [index], gl.UNIFORM_TYPE)[0];
    const count = gl.getActiveUniforms(program, [index], gl.UNIFORM_SIZE)[0];
    equal(type, gl.UNSIGNED_INT_VEC4, 'actual original raw bank type');
    require(count > 0 && count <= uniform.count, 'reflected original bank inside declaration');
    equal(values.length, uniform.count * 4, 'complete original constant bank words');
    const parsed = parseConstantDomain(metadata, metadata.stage);
    require(parsed.ok, 'original domain contract recognized');
    const approved = parsed.rasterDomain ? checkRasterBank(values, parsed.rasterDomain) : {ok: true, words: values};
    require(approved.ok, 'original input bank passes explicit domain ' + JSON.stringify(approved));
    gl.uniform4uiv(location, new Uint32Array(approved.words.slice(0, count * 4)));
    const observed = [];
    for (let lane = 0; lane < count; lane++) observed.push(...gl.getUniform(program, gl.getUniformLocation(program, uniform.name + '[' + lane + ']')));
    equal(observed, approved.words.slice(0, count * 4), 'physical original uniform snapshot');
    uploads.push({name: uniform.name, stage: metadata.stage, declaredCount: uniform.count,
      activeCount: count, type, words: values, approved, observed});
  }
}
function attributes(gl, program, metadata, values, records) {
  for (const attribute of metadata.attributes) {
    const location = gl.getAttribLocation(program, attribute.name);
    require(location >= 0, 'original attribute active ' + attribute.name);
    gl.disableVertexAttribArray(location);
    gl.vertexAttrib4fv(location, new Float32Array(values[attribute.index]));
    const observed = [...gl.getVertexAttrib(location, gl.CURRENT_VERTEX_ATTRIB)].map(word);
    equal(observed, values[attribute.index].map(word), 'physical original attribute words');
    records.push({name: attribute.name, index: attribute.index, location, words: observed});
  }
}
function pairMetadata(vertex, fragment) {
  const metadata = clone(vertex.metadata);
  for (const output of metadata.outputs) for (const input of fragment.metadata.inputs)
    if (output.semantic === 'GENERIC' && output.semanticIndex === input.semanticIndex) output.interpolation = input.interpolation;
  return metadata;
}
function tile(bytes, label) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = WIDTH;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes), WIDTH, WIDTH), 0, 0);
  const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
  image.src = canvas.toDataURL(); image.alt = label; caption.textContent = label;
  figure.append(image, caption); document.querySelector('#draws').append(figure);
}

async function vertexProbe(gl, original, pair, report, seed) {
  const {program, logs} = createProgram(gl, pair.result.vertex, pair.result.fragment);
  const buffers = [], vao = gl.createVertexArray(), feedback = gl.createTransformFeedback(), output = gl.createBuffer();
  require(vao && feedback && output, 'original transform feedback objects'); buffers.push(output);
  const generic = original.metadata.outputs.filter(e => e.semantic === 'GENERIC').sort((a, b) => a.index - b.index);
  const varyings = ['gl_Position', ...generic.map(e => e.name)], components = varyings.length * 4;
  const record = {sha256: original.sha256, pairKind: pair.kind, pair: [pair.vertex, pair.fragment],
    logs, varyings, writtenMasks: [15, ...generic.map(e => e.writtenMask)], reflection: [], vectors: []};
  report.vertices.push(record);
  try {
    gl.transformFeedbackVaryings(program, varyings, gl.INTERLEAVED_ATTRIBS); gl.linkProgram(program);
    require(gl.getProgramParameter(program, gl.LINK_STATUS), 'original transform feedback relink');
    for (let index = 0; index < varyings.length; index++) {
      const info = gl.getTransformFeedbackVarying(program, index);
      equal([info.name, info.type, info.size], [varyings[index], gl.FLOAT_VEC4, 1], 'actual original written output reflection');
      record.reflection.push({name: info.name, type: info.type, size: info.size});
    }
    gl.useProgram(program); gl.bindVertexArray(vao);
    record.systemBlocks = bindSystemBlocks(gl, program, pair.result.vertex.metadata, buffers);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback); gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, components * 4, gl.DYNAMIC_READ); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
    gl.enable(gl.RASTERIZER_DISCARD);
    const isGears = original.sha256.startsWith('80a42bf3');
    for (const vector of (isGears ? gearsVectors(seed) : compositorVectors(seed))) {
      const expected = isGears ? gearsEquation(vector) : compositorEquation(vector);
      const item = {name: vector.name, inputWords: vector.inputs.map(r => r.map(word)),
        constantWords: vector.constants.map(r => r.map(word)), expected, uploads: [], attributes: [], checks: []};
      record.vectors.push(item);
      attributes(gl, program, original.metadata, vector.inputs, item.attributes);
      upload(gl, program, pair.result.vertex.metadata, vector.constants, item.uploads);
      gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, 1); gl.endTransformFeedback();
      const raw = new Uint8Array(components * 4); gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, raw);
      equal(gl.getError(), gl.NO_ERROR, 'original physical transform feedback has no GL errors');
      item.observed = [...new Uint32Array(raw.buffer)]; item.bytes = [...raw]; item.sha256 = await digest(raw);
      const values = [expected.position, ...expected.generic];
      for (let group = 0; group < values.length; group++) for (let lane = 0; lane < values[group].length; lane++) {
        if (!(record.writtenMasks[group] & (1 << lane))) continue;
        const actual = item.observed[group*4 + lane], wanted = values[group][lane], budget = expected.budgets[group];
        const check = {lane: group*4 + lane, expected: wanted, actual, budget, ulp: ulp(actual, wanted)};
        item.checks.push(check);
        if (!(Number.isFinite(number(actual)) && (budget === 0 ? actual === wanted : check.ulp <= budget))) {
          item.failure = check;
          throw new Error('independent gears original vertex mismatch ' + original.sha256 + ' ' + vector.name + ' lane ' + check.lane);
        }
      }
    }
  } finally {
    gl.disable(gl.RASTERIZER_DISCARD); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null); gl.bindVertexArray(null); gl.useProgram(null);
    gl.deleteTransformFeedback(feedback); gl.deleteVertexArray(vao);
    for (const buffer of buffers) gl.deleteBuffer(buffer); gl.deleteProgram(program);
  }
}

async function fragmentProbe(gl, pair, report, seed) {
  const {program, logs} = createProgram(gl, pair.result.vertex, pair.result.fragment);
  const buffers = [], textures = [], vao = gl.createVertexArray(), framebuffer = gl.createFramebuffer();
  require(vao && framebuffer, 'original fragment probe objects');
  const record = {pair: [pair.vertex, pair.fragment], pairKind: pair.kind, logs, draws: []}; report.fragments.push(record);
  try {
    gl.useProgram(program); gl.bindVertexArray(vao);
    record.systemBlocks = bindSystemBlocks(gl, program, pair.result.vertex.metadata, buffers);
    const geometry = [-1,-1,0,1, 1,-1,0,1, -1,1,0,1, -1,1,0,1, 1,-1,0,1, 1,1,0,1];
    const positions = gl.createBuffer(); require(positions, 'original raster geometry'); buffers.push(positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, positions); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, 'in_0'); require(location >= 0, 'original position active');
    gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 16, 0); record.geometry = geometry;
    const target = texture2d(gl, WIDTH, WIDTH, null); textures.push(target); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER), gl.FRAMEBUFFER_COMPLETE, 'original RGBA8 physical target');
    for (const cap of [gl.DITHER, gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST]) gl.disable(cap);
    gl.viewport(0, 0, WIDTH, WIDTH); gl.colorMask(true, true, true, true);
    const isGears = pair.vertex.startsWith('80a42bf3');
    if (!isGears) {
      gl.activeTexture(gl.TEXTURE0); textures.push(texture2d(gl, 2, 2, new Uint8Array(TEXELS)));
      const sampler = pair.result.fragment.metadata.samplers[0], samplerLocation = gl.getUniformLocation(program, sampler.name);
      require(samplerLocation !== null, 'captured texture sampler active'); gl.uniform1i(samplerLocation, 0);
      const index = gl.getUniformIndices(program, [sampler.name])[0];
      equal(gl.getActiveUniforms(program, [index], gl.UNIFORM_TYPE)[0], gl.SAMPLER_2D, 'physical original sampler type');
      equal(gl.getUniform(program, samplerLocation), 0, 'physical original sampler unit');
      record.texture = {width: 2, height: 2, bytes: TEXELS, filter: 'NEAREST', wrap: 'CLAMP_TO_EDGE', sampler: sampler.name};
    }
    for (const vector of (isGears ? gearsDraws(seed) : compositorDraws())) {
      const constants = isGears ? vector.vertexConstants : vector.vertexConstants.slice(0, 3);
      const item = {name: vector.name, inputWords: vector.inputs.map(r => r.map(word)),
        constantWords: constants.map(r => r.map(word)), fragmentWords: vector.fragmentConstants.map(r => r.map(word)),
        expected: vector.expected, pixelBudget: vector.pixelBudget, equation: vector.equation ?? null,
        uv: vector.uv ?? null, texel: vector.texel ?? null, coefficient: vector.coefficient ?? null,
        uploads: [], checkedPixels: 0}; record.draws.push(item);
      const normal = gl.getAttribLocation(program, 'in_1'); require(normal >= 0, 'original varying input active');
      gl.disableVertexAttribArray(normal); gl.vertexAttrib4fv(normal, new Float32Array(vector.inputs[1]));
      equal([...gl.getVertexAttrib(normal, gl.CURRENT_VERTEX_ATTRIB)].map(word), item.inputWords[1], 'physical raster attribute');
      upload(gl, program, pair.result.vertex.metadata, constants, item.uploads);
      upload(gl, program, pair.result.fragment.metadata, vector.fragmentConstants, item.uploads);
      gl.clearColor(.03, .07, .11, .19); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 6);
      const raw = new Uint8Array(WIDTH * WIDTH * 4); gl.readPixels(0, 0, WIDTH, WIDTH, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      equal(gl.getError(), gl.NO_ERROR, 'original physical fragment has no GL errors');
      item.rgbaBytes = [...raw]; item.rgbaSha256 = await digest(raw);
      for (let pixel = 0; pixel < WIDTH * WIDTH; pixel++) {
        const actual = item.rgbaBytes.slice(pixel*4, pixel*4 + 4);
        if (actual.some((value, lane) => Math.abs(value - vector.expected[lane]) > vector.pixelBudget)) {
          item.failure = {x: pixel%WIDTH, y: Math.floor(pixel/WIDTH), expected: vector.expected, actual, budget: vector.pixelBudget};
          tile(raw, 'FAILED ' + pair.name);
          throw new Error('independent gears original fragment mismatch ' + pair.fragment + ' ' + vector.name);
        }
        item.checkedPixels++;
      }
      if ([0, 1, 2, 3].includes(record.draws.length - 1)) tile(raw, pair.name + ' ' + vector.name);
    }
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(null); gl.useProgram(null);
    gl.deleteFramebuffer(framebuffer); gl.deleteVertexArray(vao);
    for (const image of textures) gl.deleteTexture(image);
    for (const buffer of buffers) gl.deleteBuffer(buffer); gl.deleteProgram(program);
  }
}

export async function runAcceptance({seed = 0x6247bda3, fault = null, capturedPairs = []} = {}) {
  const report = {schema: 'gears-originals-gpu-v1', status: 'running', guestExecution: false,
    productionNegotiation: false, seed, fault, originals: [], retainedPartners: [], pairs: [],
    originalPrograms: capturedPairs, rejectedPrograms: [], vertices: [], fragments: [], events: [], mutations: []};
  window.__virglGearsOriginalsReport = report;
  const canvas = document.querySelector('#gpu'); canvas.width = canvas.height = WIDTH;
  const native = canvas.getContext('webgl2', {antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true});
  require(native instanceof WebGL2RenderingContext, 'actual WebGL2');
  const debug = native.getExtension('WEBGL_debug_renderer_info'); require(debug, 'physical renderer identity');
  report.renderer = {vendor: native.getParameter(debug.UNMASKED_VENDOR_WEBGL), renderer: native.getParameter(debug.UNMASKED_RENDERER_WEBGL), version: native.getParameter(native.VERSION)};
  require(!/swiftshader|llvmpipe|softpipe|software|mock|fake/i.test(report.renderer.renderer), 'hardware renderer');
  const {gl, finish} = monitor(native, report);
  try {
    const raw = new Uint8Array(await (await fetch('/renderer/virgl-shader/tests/gears-originals.json')).arrayBuffer());
    const manifest = JSON.parse(new TextDecoder().decode(raw));
    report.manifest = {path: 'renderer/virgl-shader/tests/gears-originals.json', bytes: raw.length, sha256: await digest(raw)};
    equal(LIMITS, manifest.limits, 'unchanged compiler envelope');
    const bridge = await createVirglShaderBridge();
    for (const entry of [...manifest.originals, ...manifest.retainedPartners]) {
      const bytes = new Uint8Array(await (await fetch('/' + entry.path)).arrayBuffer());
      equal(await digest(bytes), entry.sha256, 'literal G1 original source'); equal(bytes.length, entry.bytes, 'original source size');
      const text = new TextDecoder().decode(bytes), result = bridge.translate({stage: entry.stage, text});
      equal(result.ok, entry.admitted, 'unchanged original admission');
      if (entry.admitted) equal(result.metadata, entry.metadata, 'complete original metadata');
      else equal(result.error, entry.rejection, 'explicit original rejection');
      const record = {...entry, text, result};
      (entry.role === 'retained-partner' ? report.retainedPartners : report.originals).push(record);
    }
    const by = prefix => {const entry = [...report.originals, ...report.retainedPartners].find(e => e.sha256.startsWith(prefix)); require(entry, 'known original ' + prefix); return entry;};
    for (const [name, v, f, kind] of [['gears','80a42bf3','86d0ee79','captured-program'],
      ['compositor-texture','403b0529','c2474531','captured-program'],
      ['compositor-vertex-isolation','7bf4d0d0','c2474531','compatible-isolation']]) {
      const vertex = by(v), fragment = by(f), result = bridge.translatePair({vertexText: vertex.text, fragmentText: fragment.text});
      require(result.ok, 'original admitted program'); equal(result.vertex.metadata, pairMetadata(vertex, fragment), 'pair vertex metadata');
      equal(result.fragment.metadata, fragment.metadata, 'pair fragment metadata');
      if (kind === 'captured-program') require(capturedPairs.some(p => p.name === name && p.vertex === vertex.sha256 && p.fragment === fragment.sha256), 'actual G1 program citation');
      const pair = {name, kind, vertex: vertex.sha256, fragment: fragment.sha256, result}; report.pairs.push(pair);
      // Mutations affect only owned emitted GLSL in this trusted proof harness.
      // The original compiler result and independent equation stay recorded.
      const selected = fault === 'lighting' && name === 'gears' ? ['vertex','vso_g0.x = float_out[1].x;','vso_g0.x = 0.0;'] :
        fault === 'auxiliary' && kind === 'compatible-isolation' ? ['vertex','vso_g1.x = float_out[2].x;','vso_g1.x = 1.0;'] :
        fault === 'forced-alpha' && name === 'compositor-texture' ? ['fragment','temp0.w = float(','temp0.w = 0.0 * float('] : null;
      if (selected) {
        const [stage, needle, replacement] = selected, source = result[stage].glsl;
        equal(source.split(needle).length, 2, 'physical output fault has one source site');
        pair.originalResult = clone(result); result[stage].glsl = source.replace(needle, replacement);
        report.mutations.push({mode: fault, stage, needle, replacement, source, served: result[stage].glsl,
          sourceSha256: await digest(source), servedSha256: await digest(result[stage].glsl)});
      }
      const compiled = createProgram(gl, result.vertex, result.fragment); pair.logs = compiled.logs; gl.deleteProgram(compiled.program);
    }
    for (const name of ['unsupported-compositor-program', 'unsupported-texture-program']) {
      const captured = capturedPairs.find(p => p.name === name); require(captured, 'unsupported original program citation');
      const vertex = by(captured.vertex), fragment = by(captured.fragment);
      const result = bridge.translatePair({vertexText: vertex.text, fragmentText: fragment.text});
      equal(result.ok, false, 'complete larger original program stays rejected');
      report.rejectedPrograms.push({captured, result});
    }
    await vertexProbe(gl, by('80a42bf3'), report.pairs[0], report, seed);
    await vertexProbe(gl, by('7bf4d0d0'), report.pairs[2], report, seed);
    await fragmentProbe(gl, report.pairs[0], report, seed);
    await fragmentProbe(gl, report.pairs[1], report, seed);
    report.checkedVertexWords = report.vertices.reduce((sum, v) => sum + v.vectors.reduce((sum, x) => sum + x.checks.length, 0), 0);
    report.checkedPixels = report.fragments.reduce((sum, v) => sum + v.draws.reduce((sum, x) => sum + x.checkedPixels, 0), 0);
    report.status = 'passed'; document.querySelector('#status').textContent =
      `Four new original bodies · ${report.checkedVertexWords} written vertex words · ${report.checkedPixels} physical pixels · two larger programs rejected`;
    document.querySelector('#renderer').textContent = report.renderer.renderer;
    return report;
  } catch (error) {
    report.status = 'failed'; report.failure = {message: error.message, stack: error.stack};
    document.querySelector('#status').textContent = error.message; throw error;
  } finally { finish(); }
}
