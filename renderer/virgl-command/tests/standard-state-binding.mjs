import { decodeSubmission, decodeStandardSubmission } from "../decoder.mjs";
import { parseConstantDomain, parseStandardShaderMetadata, normalizeStandardShaderResult,
  normalizeStandardShaderPair, deriveStandardShaderInterface } from "../constant-domain.mjs";
import { createVirglStandardAsyncRenderer, createVirglAsyncRenderer } from "../state.mjs";
import { createResourceStore, createWebGL2TransferBackend } from "../resources.mjs";
import { createVirglStandardShaderBridge } from "../../virgl-shader/standard.mjs";
import { createVirglShaderBridge } from "../../virgl-shader/index.mjs";
import { originalOracle } from "../../../tools/virgl-original-programs/oracle.mjs";

const VS = "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n";
const FS = "FRAG\nDCL CONST[0]\nDCL OUT[0], COLOR\n0: MOV OUT[0], CONST[0]\n1: END\n";
const RAW = [0x7fc00001, 0xffffffff, 0x7f800000, 0x80000000];
const word = value => { const v = new DataView(new ArrayBuffer(4)); v.setFloat32(0, value, true); return v.getUint32(0, true); };
const float = value => { const v = new DataView(new ArrayBuffer(4)); v.setUint32(0, value, true); return v.getFloat32(0, true); };
const quant = values => values.map(value => Math.round(Math.min(1, Math.max(0, value)) * 255));
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
const copy = value => JSON.parse(JSON.stringify(value));
function checks() {
  const rows = [];
  const same = (observed, expected, prediction) => {
    const held = JSON.stringify(observed) === JSON.stringify(expected);
    rows.push({ prediction, expected, observed, held });
    if (!held) throw new Error(prediction + ": expected " + JSON.stringify(expected) + ", observed " + JSON.stringify(observed));
  };
  const ok = (result, label) => { same(result?.ok, true, label + " " + (result?.error?.message ?? "")); return result; };
  return { rows, same, ok };
}
export function packet(op, kind, words) {
  const raw = new Uint8Array((words.length + 1) * 4), view = new DataView(raw.buffer);
  view.setUint32(0, op | kind << 8 | words.length << 16, true);
  words.forEach((value, index) => view.setUint32(4 + index * 4, value, true));
  return raw;
}
export function join(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0; for (const part of parts) { result.set(part, at); at += part.length; }
  return result;
}
const constants = (stage, words) => packet(12, 0, [stage, 0, ...words]);
function shader(handle, stage, text) {
  const raw = packet(1, 4, [handle, stage, text.length + 1, 8192, 0, ...Array(Math.ceil((text.length + 1) / 4)).fill(0)]);
  raw.set(new TextEncoder().encode(text), 24); return raw;
}
function tgsi(stage, declarations, instructions) {
  return (stage === "vertex" ? "VERT\n" : "FRAG\n") + declarations + "\n" +
    [...instructions, "END"].map((value, index) => index + ": " + value + "\n").join("");
}
export function runWireAcceptance() {
  const c = checks(), records = [];
  for (const stage of [0, 1, 2, 3, 4, 5]) for (const index of [0, 1, 14, 15])
    for (const count of [0, 1, 4, 184, 188, 512, 516, 2048, 2052]) {
      const bytes = packet(12, 0, [stage, index, ...Array(count).fill(0)]);
      const validSlot = index < 15 && (count === 0 || stage <= 1 && index === 0), whole = count % 4 === 0;
      const standard = decodeStandardSubmission(bytes), old = decodeSubmission(bytes);
      c.same(standard.ok, validSlot && whole && count <= 2048, "independent raw constant extent " + [stage, index, count]);
      c.same(old.ok, validSlot && whole && count <= (stage === 0 ? 512 : 184), "retained finite constant extent " + [stage, index, count]);
      if (standard.ok) {
        c.same(standard.profile, "virgl-standard-commands-v1", "distinct standard command profile");
        c.same(Object.keys(standard.commands[0].fields), ["stage", "index", "words"], "raw fields have no float reinterpretation");
        bytes.fill(255);
        c.same(standard.commands[0].fields.words, Array(count).fill(0), "decoded words own their original snapshot");
      }
      records.push({ stage, index, count, standard: standard.ok, old: old.ok });
    }
  for (const bits of RAW) {
    const bytes = constants(1, [bits, bits, bits, bits]), raw = decodeStandardSubmission(bytes), old = decodeSubmission(bytes);
    c.same(raw.commands[0].fields.words, Array(4).fill(bits), "arbitrary word preserved " + bits);
    c.same(old.ok, bits === 0x80000000, "retained finite predicate " + bits);
  }
  for (const decoder of [decodeSubmission, decodeStandardSubmission]) {
    c.same(decoder(constants(1, [0, 0, 0, 0]), { standard: true }).error.code, "invalid-provenance", "labels cannot select a facet");
    c.same(decoder(join(constants(1, [0, 0, 0, 0]), packet(8, 0, []))).ok, false, "malformed tail rejects the complete snapshot");
    let getters = 0;
    const labels = {}; Object.defineProperty(labels, "event", { get() { getters++; return 1; } });
    c.same(decoder(new Uint8Array(), labels).ok, false, "provenance accessor rejects"); c.same(getters, 0, "provenance getter never runs");
    c.same(decoder(new Uint8Array(new SharedArrayBuffer(4))).ok, false, "shared input refuses concurrent mutation");
    const detached = new Uint8Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
    c.same(decoder(detached).ok, false, "detached input rejects");
  }
  return { status: "passed", records, predictions: c.rows };
}
export async function runMetadataAcceptance(bridge) {
  const c = checks(), vertex = bridge.translate({ stage: "vertex", text: VS }),
    fragment = bridge.translate({ stage: "fragment", text: FS }), pair = bridge.translatePair({ vertexText: VS, fragmentText: FS });
  c.ok(normalizeStandardShaderResult(vertex, "vertex"), "real vertex result");
  c.ok(normalizeStandardShaderResult(fragment, "fragment"), "real fragment result");
  c.ok(normalizeStandardShaderPair(pair), "real paired result");
  c.same(parseConstantDomain(fragment.metadata, "fragment").ok, false, "old facet rejects standard numerical authority");
  const faults = [
    ["profile", m => { m.profile = "virgl-webgl2-raw-bits-v42"; }],
    ["exact fact", m => { m.constantExactDomains = []; }],
    ["exact authority", m => { m.standardSemantics.exactAuthority = true; }],
    ["GPU execution bound", m => { m.standardSemantics.gpuExecutionBound = true; }],
    ["float storage", m => { m.standardSemantics.registerStorage = "vec4"; }],
    ["513 vectors", m => { m.uniforms[0].count = 513; }],
    ["float encoding", m => { m.uniforms[0].encoding = "float32-bits"; }],
    ["physical32", m => { m.outputs[0].index = 32; }],
    ["color1", m => { m.outputs[0].semanticIndex = 1; }],
    ["broadcast", m => { m.broadcastColor0 = true; }],
    ["write mask wrap", m => { m.outputs[0].syntacticWriteMask = 4294967296; }],
    ["missing color", m => { m.outputs = []; }],
    ["foreign sampler", m => { m.samplers = [{ index: 15, name: "vssamp15", type: "sampler2D" }]; }],
    ["sparse outputs", m => { delete m.outputs[0]; }],
    ["extra array field", m => { m.outputs.extra = 1; }],
    ["symbol field", m => { m[Symbol("authority")] = true; }],
  ];
  for (const [name, change] of faults) {
    const metadata = copy(fragment.metadata); change(metadata);
    c.same(parseStandardShaderMetadata(metadata, "fragment").ok, false, "metadata rejects " + name);
  }
  let getters = 0;
  const metadata = copy(fragment.metadata); Object.defineProperty(metadata.outputs[0], "name", { get() { getters++; return "fsout_c0"; } });
  c.same(parseStandardShaderMetadata(metadata, "fragment").ok, false, "nested accessor rejects"); c.same(getters, 0, "nested accessor never runs");
  const response = copy(fragment); Object.defineProperty(response, "glsl", { get() { getters++; return fragment.glsl; } });
  c.same(normalizeStandardShaderResult(response, "fragment").ok, false, "result accessor rejects before freezing");
  c.same(getters, 0, "result getter never runs");
  const unusable = new Proxy({}, { ownKeys() { throw new Error("unusable"); } });
  c.same(parseStandardShaderMetadata(unusable, "fragment").ok, false, "throwing proxy rejects");
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  c.same(parseStandardShaderMetadata(revoked.proxy, "fragment").ok, false, "revoked proxy rejects");
  const foreign = copy(pair); foreign.interfaceKey += "spoof";
  c.same(normalizeStandardShaderPair(foreign).ok, false, "pair key is independently derived");
  const owned = c.ok(normalizeStandardShaderResult(fragment, "fragment"), "owned result");
  c.same(Object.isFrozen(owned.metadata.outputs[0]), true, "copied nested metadata is frozen");
  fragment.metadata.outputs[0].name = "changed";
  c.same(owned.metadata.outputs[0].name, "fsout_c0", "metadata does not retain foreign references");
  const shiftedPosition = copy(vertex.metadata); shiftedPosition.outputs[0].index = 1;
  c.same(parseStandardShaderMetadata(shiftedPosition, "vertex").ok, false, "vertex POSITION keeps compiler physical zero");
  const trapped = new Proxy(fragment.metadata, { getOwnPropertyDescriptor() { throw new Error("trapped"); } });
  c.same(parseStandardShaderMetadata(trapped, "fragment").ok, false, "descriptor trap rejects without foreign execution escape");
  return { status: "passed", predictions: c.rows };
}

const meta = (id, target, format, bind, width, height = 1) =>
  ({ id, target, format, bind, width, height, depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 });
const transfer = (id, width, height = 1, direction = 1) => packet(43, 0, [id, 0, 0, 0, 0, 0, 0, 0, width, height, 1, 0, direction]);
const draw = (count = 4, mode = 5) => packet(8, 0, [0, count, mode, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
function clear(values) {
  const raw = packet(7, 0, [4, ...values.map(word), 0, 0, 0]);
  new DataView(raw.buffer).setFloat64(24, 1, true); return raw;
}
function traceGL(gl, c, delay) {
  const objects = new Map(), syncs = new Map(), methods = new Map(), calls = [], events = [];
  let turn = 0, next = 1, currentLabel = "";
  const traced = new Proxy(gl, { get(target, name) {
    const value = Reflect.get(target, name, target);
    if (typeof value !== "function") return value;
    if (methods.has(name)) return methods.get(name);
    const fn = (...args) => {
      if (name === "finish") c.same(true, false, "renderer never calls finish");
      if (name === "clientWaitSync") {
        c.same(args.slice(1), [0, 0], "zero timeout fence poll");
        const owned = syncs.get(args[0]); c.same(Boolean(owned), true, "poll uses an owned sync");
        c.same(turn > owned.turn && turn !== owned.lastPoll, true, "fence poll is one per later task"); owned.lastPoll = turn;
        const actual = value.apply(target, args), ready = actual === gl.ALREADY_SIGNALED || actual === gl.CONDITION_SATISFIED;
        const delivered = ready && owned.left-- > 0 ? gl.TIMEOUT_EXPIRED : actual;
        events.push({ name, turn, label: currentLabel, sync: owned.id, actual, delivered }); return delivered;
      }
      if (name === "drawArrays" || name === "drawElements") calls.push({ name, args: [...args], turn, label: currentLabel,
        program: gl.getParameter(gl.CURRENT_PROGRAM), activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE) });
      const result = value.apply(target, args);
      if (name === "getActiveAttrib") events.push({ name, turn, label: currentLabel,
        index: args[1], result: result ? { name: result.name, type: result.type, size: result.size } : null });
      if (/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name) && result) objects.set(result, next++);
      if (name === "fenceSync" && result) {
        const entry = { id: next++, turn, lastPoll: -1, left: delay }; syncs.set(result, entry);
        events.push({ name, turn, label: currentLabel, sync: entry.id });
      }
      if (name === "getBufferSubData") events.push({ name, turn, label: currentLabel, bytes: args[2].byteLength });
      if (name === "uniform4uiv") events.push({ name, turn, label: currentLabel, words: [...args[1]] });
      if (name === "deleteSync") syncs.delete(args[0]);
      return result;
    };
    methods.set(name, fn); return fn;
  } });
  return { gl: traced, calls, events, id: value => objects.get(value) ?? null,
    nextTurn() { turn++; }, label(value) { currentLabel = value; } };
}
function rig(gl, bridge, c, { delay = 0, step = 64, width = 16, height = 16, limits, cacheLimits, legacy = false } = {}) {
  const trace = traceGL(gl, c, delay), allocations = [];
  const backend = c.ok(createWebGL2TransferBackend(trace.gl), "real transfer backend").backend;
  const owner = c.ok(createResourceStore({ backend: { ...backend, allocate(metadata) {
    const storage = backend.allocate(metadata); allocations.push({ metadata, storage }); return storage;
  } } }), "owned resources");
  const renderer = c.ok((legacy ? createVirglAsyncRenderer : createVirglStandardAsyncRenderer)({
    gl: trace.gl, shaderBridge: bridge, resources: owner.store, bindings: owner.bindings, asyncAccess: owner.asyncAccess,
    jobLimits: { commandsPerStep: step }, ...(limits ? { limits } : {}), ...(cacheLimits ? { cacheLimits } : {}),
  }), "host-selected renderer").renderer;
  c.same(Object.hasOwn(renderer, "executeSubmission"), false, "async factory has no synchronous escape");
  for (const ctx of [1, 2]) { c.ok(owner.store.createContext(ctx), "resource context"); c.ok(renderer.createContext(ctx), "renderer context"); }
  const r = { gl, bridge, c, ...owner, renderer, trace, allocations, width, height, frame: 0, history: [], exchanges: [], frames: [] };
  add(r, meta(1, 2, 67, 2, width, height), new Uint8Array(width * height * 4));
  return r;
}
function add(r, metadata, bytes) {
  const resource = r.c.ok(r.store.createResource(metadata), "resource " + metadata.id).resource;
  r.allocations.at(-1).generation = resource.generation;
  for (const ctx of [1, 2]) r.c.ok(r.store.attachContext(ctx, metadata.id), "resource membership");
  if (bytes) r.c.ok(r.store.attachBacking(metadata.id, [bytes]), "owned backing");
  return resource;
}
async function submit(r, ctx, bytes, label) {
  const { c, renderer, trace } = r, original = bytes.slice();
  trace.label(label); c.ok(renderer.beginFrame(++r.frame), "begin host record");
  const begun = renderer.beginSubmission(ctx, bytes);
  let result, steps = 0;
  if (!begun.ok) result = begun;
  else {
    bytes.fill(255);
    for (; steps < 10000; steps++) {
      await new Promise(resolve => setTimeout(resolve, steps % 3)); trace.nextTurn();
      const step = c.ok(renderer.step(begun.job), "owned later-task step");
      if (step.status === "done") { result = step.result; break; }
      if (step.status === "needs-input") {
        const request = step.request, layout = request.layout, rows = [];
        for (let row = 0; row < layout.rowCount; row++)
          rows.push(c.ok(r.store.readBacking(request.resource.id, layout.offset + row * layout.rowStride, layout.rowBytes), "fresh input row").bytes);
        const input = join(...rows);
        r.exchanges.push({ label, direction: "upload", resource: request.resource, layout, hex: hex(input) });
        c.ok(renderer.provideInput(begun.job, request.token, input), "owned input exchange"); input.fill(255);
        c.same(renderer.provideInput(begun.job, request.token, input).ok, false, "consumed input token rejects");
      } else if (step.status === "needs-output") {
        const request = step.request;
        r.exchanges.push({ label, direction: "download", resource: request.resource, layout: request.layout, bytes: [...request.bytes] });
        c.ok(renderer.acknowledgeOutput(begun.job, request.token), "output publication acknowledgement");
        c.same(renderer.acknowledgeOutput(begun.job, request.token).ok, false, "consumed output token rejects");
      }
    }
    c.same(Boolean(result), true, "bounded job completion");
    c.same(renderer.step(begun.job).ok, false, "consumed job rejects");
  }
  const dump = c.ok(renderer.endFrame(r.frame), "end host record").dump;
  const record = { label, ctx, hex: hex(original), result, steps, dump }; r.history.push(record);
  if (!result.ok && globalThis.window?.__standardStateEvidence) window.__standardStateEvidence.failedJob =
    { record, events: trace.events, inspection: renderer.inspect() };
  return record;
}
function geometry(values) { return new Uint8Array(new Float32Array(values).buffer); }
const QUAD = [-1, -1, 0, 1, -1, 1, 0, 1, 1, -1, 0, 1, 1, 1, 0, 1];
function setup(r, { vertex = VS, fragment = FS, input = 0, position = QUAD, fragmentWords = [word(.25), word(.5), word(.75), word(1)],
  vertexWords = [], attributes = null, stride = 16, color = [0, 0, 0, 0] } = {}) {
  if (!r.allocations.some(entry => entry.metadata.id === 3)) add(r, meta(3, 0, 64, 16, position.length * 4), geometry(position));
  const elements = attributes ?? Array.from({ length: input + 1 }, () => [0, 0, 0, 31]);
  return join(transfer(3, position.length * 4), shader(1, 0, vertex), shader(2, 1, fragment),
    packet(1, 5, [3, ...elements.flat()]), packet(2, 5, [3]), packet(6, 0, [stride, 0, 3]),
    packet(1, 8, [4, 1, 67, 0, 0]), packet(5, 0, [1, 0, 4]),
    packet(4, 0, [0, ...[r.width / 2, r.height / 2, .5, r.width / 2, r.height / 2, .5].map(word)]),
    constants(0, vertexWords), constants(1, fragmentWords), packet(31, 0, [1, 0]), packet(31, 0, [2, 1]), clear(color));
}
async function encodedPixels(raw) {
  const zipped = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const bytes = new Uint8Array(zipped), sha = async data => [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
  let binary = ""; for (const value of bytes) binary += String.fromCharCode(value);
  return { bytes: raw.length, sha256: await sha(raw), gzipSha256: await sha(bytes), gzipBase64: btoa(binary) };
}
function nativeState(r, record) {
  const gl = r.gl, call = r.trace.calls.filter(call => call.label === record.label).at(-1), program = call.program;
  const capture = record.dump.programs.find(entry => entry.generation === record.dump.draws.at(-1).programGeneration);
  const uniforms = [];
  for (const [stage, name] of [[0, "vsconst0"], [1, "fsconst0"]]) {
    const reflection = capture.reflection.uniforms.find(entry => entry.stage === (stage === 0 ? "vertex" : "fragment"));
    if (!reflection?.activeCount) continue;
    const words = [];
    for (let index = 0; index < reflection.activeCount; index++)
      words.push(...gl.getUniform(program, gl.getUniformLocation(program, name + "[" + index + "]")));
    uniforms.push({ stage, declaredCount: reflection.count, activeCount: reflection.activeCount, words });
  }
  const attributes = [], systemValues = [];
  for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES); index++) {
    const actual = gl.getActiveAttrib(program, index), location = gl.getAttribLocation(program, actual.name);
    if (location === -1) { systemValues.push({ name: actual.name, location, type: actual.type, size: actual.size }); continue; }
    const buffer = gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
      owned = r.allocations.find(entry => entry.storage.buffer === buffer), bytes = new Uint8Array(owned.metadata.width);
    gl.bindBuffer(gl.COPY_READ_BUFFER, buffer); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, bytes); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    attributes.push({ name: actual.name, location, components: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_SIZE),
      stride: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_STRIDE), offset: gl.getVertexAttribOffset(location, gl.VERTEX_ATTRIB_ARRAY_POINTER),
      resourceId: owned.metadata.id, generation: owned.generation, hex: hex(bytes) });
  }
  const samplers = [];
  for (const sampler of capture.reflection.samplers) {
    gl.activeTexture(gl.TEXTURE0 + sampler.unit);
    const texture = gl.getParameter(gl.TEXTURE_BINDING_2D), location = gl.getUniformLocation(program, sampler.name);
    samplers.push({ ...sampler, value: location === null ? null : gl.getUniform(program, location),
      resourceId: r.allocations.find(entry => entry.storage.texture === texture)?.metadata.id ?? null,
      samplerObject: r.trace.id(gl.getParameter(gl.SAMPLER_BINDING)) });
  }
  gl.activeTexture(gl.TEXTURE0);
  return { op: call.name, args: call.args, programObject: r.trace.id(program), uniforms, attributes, systemValues, samplers };
}
async function frame(r, record, expected, fixture) {
  const { c, gl } = r;
  c.ok(record.result, record.label + " job outcome"); c.same(record.result.gpuComplete, true, record.label + " final fence completed");
  const fb = gl.createFramebuffer(), output = r.allocations.find(entry => entry.metadata.id === 1).storage.texture;
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
  gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1); gl.pixelStorei(gl.PACK_ROW_LENGTH, 0); gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
  const raw = new Uint8Array(r.width * r.height * 4); gl.readPixels(0, 0, r.width, r.height, gl.RGBA, gl.UNSIGNED_BYTE, raw); gl.deleteFramebuffer(fb);
  const mismatches = []; let maxError = 0;
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
    const wanted = expected(x, y), observed = [...raw.slice((y * r.width + x) * 4, (y * r.width + x + 1) * 4)];
    const errors = observed.map((value, lane) => Math.abs(value - wanted[lane]));
    maxError = Math.max(maxError, ...errors);
    if (errors.some(value => value > (fixture.budget ?? 1)) && mismatches.length < 4) mismatches.push({ x, y, expected: wanted, observed, errors });
  }
  const native = nativeState(r, record), result = { label: record.label, width: r.width, height: r.height, fixture, maxError,
    mismatches, history: r.history.map(entry => ({ label: entry.label, ctx: entry.ctx, hex: entry.hex, result: entry.result })),
    dump: record.dump, native, pixels: await encodedPixels(raw) };
  r.frames.push(result);
  c.same(mismatches, [], record.label + " independent physical pixel oracle");
  c.same(gl.getError(), gl.NO_ERROR, record.label + " zero GL errors");
  return result;
}
function dispose(r) {
  r.c.ok(r.renderer.dispose(), "renderer cleanup"); r.c.ok(r.store.dispose(), "resource cleanup");
  for (const owner of [r.renderer, r.store]) for (const [name, value] of Object.entries(r.c.ok(owner.inspect(), "cleanup counters").budgets))
    r.c.same(value, 0, "zero owned budget " + name);
  r.c.same(r.gl.getError(), r.gl.NO_ERROR, "cleanup has no GL error");
}

const words = values => values.map(word);
const colorOracle = color => () => quant(color);
const samplerView = (handle, resource, swizzle) => packet(1, 6, [handle, resource, 67 | 2 << 24, 0, 0,
  swizzle.reduce((packed, lane, index) => packed | lane << (index * 3), 0)]);
const bindSampler = (stage, view, state = 8) => join(packet(10, 0, [stage, 15, view]), packet(18, 0, [stage, 15, state]));
function poison(gl) {
  gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.ZERO); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 0, 0);
  gl.colorMask(false, false, false, false); gl.viewport(0, 0, 1, 1); gl.useProgram(null);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 8); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
}
export async function runAcceptance({ geometryPath = null, banksPath = null, originals = null, smoke = false } = {}) {
  const c = checks(), report = { schema: "virgl-standard-state-binding-v1", status: "running",
    guestExecution: false, productionNegotiation: false, predictions: c.rows, frames: [], runs: [] };
  window.__standardStateEvidence = report;
  const gl = document.querySelector("#gpu").getContext("webgl2",
    { antialias: false, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true });
  c.same(gl instanceof WebGL2RenderingContext, true, "actual WebGL2 context");
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  c.same(Boolean(debug), true, "measured GPU identity");
  report.gpu = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  c.same(/swiftshader|llvmpipe|softpipe|software/i.test(report.gpu), false, "physical GPU");
  report.limits = Object.fromEntries(["MAX_VERTEX_UNIFORM_COMPONENTS", "MAX_FRAGMENT_UNIFORM_COMPONENTS",
    "MAX_VARYING_VECTORS", "MAX_VERTEX_ATTRIBS", "MAX_COMBINED_TEXTURE_IMAGE_UNITS"].map(name => [name, gl.getParameter(gl[name])]));
  const bridge = await createVirglStandardShaderBridge();
  report.metadata = await runMetadataAcceptance(bridge);
  const make = (options, compiler = bridge) => { const r = rig(gl, compiler, c, options); r.frames = report.frames; return r; };
  const done = r => {
    report.runs.push({ history: r.history, exchanges: r.exchanges, events: r.trace.events,
      work: c.ok(r.renderer.inspect(), "final owned renderer").work });
    dispose(r);
  };
  const vertex = tgsi("vertex", "DCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[31], GENERIC[15]\nDCL CONST[0..511]",
    ["MOV OUT[0], IN[0]", "MOV OUT[31], CONST[511]"]);
  const fragment = tgsi("fragment", "DCL IN[31], GENERIC[15], PERSPECTIVE\nDCL OUT[31], COLOR\nDCL CONST[0..511]\nDCL TEMP[0]",
    ["ADD TEMP[0], CONST[511], CONST[0]", "ADD OUT[31], TEMP[0], IN[31]"]);
  for (const [delay, step] of (smoke ? [[0, 64]] : [[0, 64], [2, 1], [5, 2]])) {
    const r = make({ delay, step, limits: { programs: 2 }, cacheLimits: { translations: 3 } }),
      v = Array(2048).fill(0), f = Array(2048).fill(0);
    v.splice(2044, 4, ...words([.125, .125, .125, .125]));
    f.splice(0, 4, ...words([.125, .25, .375, .125])); f.splice(2044, 4, ...words([.25, .125, .0625, .5]));
    let rec = await submit(r, 1, join(setup(r, { vertex, fragment, vertexWords: v, fragmentWords: f }), draw()), "max-banks-" + delay);
    let saved = await frame(r, rec, colorOracle([.5, .5, .5625, .75]), { kind: "bank", vertex: v, fragment: f });
    for (const native of saved.native.uniforms) c.same(native.words, native.stage === 0 ? v : f, "all actual 512 vectors preserved");
    const short = words([.25, .125, .0625, .5]);
    rec = await submit(r, 1, join(constants(1, short), clear([0, 0, 0, 0]), draw()), "short-bank-" + delay);
    saved = await frame(r, rec, colorOracle([.375, .25, .1875, .625]), { kind: "bank", vertex: v, fragment: short });
    c.same(saved.native.uniforms.find(u => u.stage === 1).words, [...short, ...Array(2044).fill(0)], "short bank clears every native suffix");
    rec = await submit(r, 1, join(constants(1, []), clear([0, 0, 0, 0]), draw()), "reset-bank-" + delay);
    await frame(r, rec, colorOracle([.125, .125, .125, .125]), { kind: "bank", vertex: v, fragment: [] });
    rec = await submit(r, 1, join(constants(0, short), clear([0, 0, 0, 0]), draw()), "short-both-" + delay);
    await frame(r, rec, colorOracle([0, 0, 0, 0]), { kind: "bank", vertex: short, fragment: [] });
    rec = await submit(r, 2, join(setup(r, { vertex, fragment, vertexWords: v, fragmentWords: short }), draw()), "context-B-" + delay);
    await frame(r, rec, colorOracle([.375, .25, .1875, .625]), { kind: "bank", vertex: v, fragment: short });
    poison(gl);
    rec = await submit(r, 1, join(clear([0, 0, 0, 0]), draw()), "context-A-restored-" + delay);
    await frame(r, rec, colorOracle([0, 0, 0, 0]), { kind: "bank", vertex: short, fragment: [] });
    rec = await submit(r, 1, join(transfer(1, r.width, r.height, 2)), "actual-download-" + delay);
    c.ok(rec.result, "fenced target download");
    c.same(r.exchanges.at(-1).bytes, Array(r.width * r.height * 4).fill(0), "actual PBO bytes after bank reset");
    c.ok(r.renderer.resetCaches(), "standard explicit cache retirement");
    poison(gl);
    rec = await submit(r, 1, join(clear([0, 0, 0, 0]), draw()), "standard-cache-relink-" + delay);
    await frame(r, rec, colorOracle([0, 0, 0, 0]), { kind: "bank", vertex: short, fragment: [] });
    const before = c.ok(r.renderer.inspect(), "old retained selector identity").contexts.find(x => x.id === 1).subContexts[0].bindings.fragmentShader;
    const replacement = tgsi("fragment", "DCL OUT[31], COLOR\nDCL CONST[0..510]", ["MOV OUT[31], CONST[510]"]);
    rec = await submit(r, 1, join(packet(3, 4, [2]), shader(2, 1, replacement), clear([0, 0, 0, 0]), draw()), "standard-retained-selector-" + delay);
    await frame(r, rec, colorOracle([0, 0, 0, 0]), { kind: "bank", vertex: short, fragment: [] });
    const reuse = Array(2044).fill(0); reuse.splice(2040, 4, ...words([.25, .5, .75, 1]));
    rec = await submit(r, 1, join(constants(1, reuse), packet(31, 0, [2, 1]), clear([0, 0, 0, 0]), draw()), "standard-rebound-selector-" + delay);
    await frame(r, rec, colorOracle([.25, .5, .75, 1]), { kind: "bank", vertex: short, fragment: reuse });
    const after = c.ok(r.renderer.inspect(), "new selector identity").contexts.find(x => x.id === 1).subContexts[0].bindings.fragmentShader;
    c.same(before.handle, after.handle, "same public shader name");
    c.same(after.generation > before.generation, true, "new selector has new owned generation");
    rec = await submit(r, 2, join(clear([0, 0, 0, 0]), draw()), "standard-context-B-relink-" + delay);
    await frame(r, rec, colorOracle([.375, .25, .1875, .625]), { kind: "bank", vertex: v, fragment: short });
    const pressure = words([.125, .25, .5, 1]);
    rec = await submit(r, 1, join(shader(11, 1, FS), constants(1, pressure), packet(31, 0, [11, 1]),
      clear([0, 0, 0, 0]), draw()), "standard-cache-pressure-" + delay);
    await frame(r, rec, colorOracle([.125, .25, .5, 1]), { kind: "bank", vertex: short, fragment: pressure });
    c.same(c.ok(r.renderer.inspect(), "standard cache pressure").caches.program.evictions > 0, true, "standard generation pressure evicts native programs");
    done(r);
  }
  {
    const r = make({ delay: 2, step: 2 }), v = Array(2048).fill(0); v.splice(2044, 4, ...RAW);
    const vs = tgsi("vertex", "DCL IN[15]\nDCL OUT[0], POSITION\nDCL OUT[31], GENERIC[15]\nDCL CONST[511]",
      ["MOV OUT[0], IN[15]", "MOV OUT[31], CONST[511]"]),
      fs = tgsi("fragment", "DCL IN[31], GENERIC[15], CONSTANT\nDCL OUT[31], COLOR\nDCL CONST[0]\nDCL TEMP[0]\nIMM[0] FLT32 {0.25, 0.5, 0.75, 1.0}\nIMM[1] FLT32 {0.0, 0.0, 0.0, 0.0}",
        ["USEQ TEMP[0], IN[31], CONST[0]", "UCMP OUT[31], TEMP[0], IMM[0], IMM[1]"]);
    const rec = await submit(r, 1, join(setup(r, { vertex: vs, fragment: fs, input: 15, vertexWords: v, fragmentWords: RAW }), draw()), "flat-raw-attribute15");
    const saved = await frame(r, rec, colorOracle([.25, .5, .75, 1]), { kind: "flat", vertex: v, fragment: RAW });
    c.same(saved.native.uniforms.find(u => u.stage === 0).words, v, "NaN payload and signed zero retain raw native VS words");
    c.same(saved.native.uniforms.find(u => u.stage === 1).words, RAW, "arbitrary raw native FS words");
    c.same(saved.dump.programs[0].reflection.attributes.map(a => [a.name, a.index]), [["in_15", 15]], "guest attribute slot 15");
    c.same(saved.native.attributes[0].location, saved.dump.programs[0].reflection.attributes[0].location, "actual reflected native attribute location");
    c.same(saved.dump.programs[0].vertexESSL300.includes("flat out uvec4 vso_g15"), true, "flat paired VS word storage");
    done(r);
  }
  if (smoke) { report.status = "passed"; return report; }
  {
    const r = make({ delay: 5, step: 1 }), vsDecl = ["DCL IN[15]", "DCL OUT[0], POSITION", "DCL CONST[0..15]"],
      fsDecl = ["DCL OUT[31], COLOR", "DCL TEMP[0]", "IMM[0] FLT32 {0.0625, 0.0625, 0.0625, 0.0625}"],
      vsBody = ["MOV OUT[0], IN[15]"], fsBody = ["MOV TEMP[0], IN[0]"], v = [];
    for (let index = 0; index < 16; index++) {
      const physical = index === 15 ? 31 : index + 1, input = index === 15 ? 31 : index;
      vsDecl.push("DCL OUT[" + physical + "], GENERIC[" + index + "]");
      fsDecl.push("DCL IN[" + input + "], GENERIC[" + index + "], PERSPECTIVE");
      vsBody.push("MOV OUT[" + physical + "], CONST[" + index + "]");
      if (index) fsBody.push("ADD TEMP[0], TEMP[0], IN[" + input + "]");
      v.push(...words([(index + 1) / 32, .25, .5, 1]));
    }
    fsBody.push("MUL OUT[31], TEMP[0], IMM[0]");
    const rec = await submit(r, 1, join(setup(r, { input: 15, vertex: tgsi("vertex", vsDecl.join("\n"), vsBody),
      fragment: tgsi("fragment", fsDecl.join("\n"), fsBody), vertexWords: v, fragmentWords: [] }), draw()), "all-sixteen-generic-semantics");
    await frame(r, rec, colorOracle([17 / 64, .25, .5, 1]), { kind: "generic16", vertex: v, fragment: [] });
    done(r);
  }
  {
    const r = make({ delay: 2, step: 1 }), a = [32, 48, 64, 80], b = [96, 64, 32, 144];
    add(r, meta(5, 2, 67, 8, 1), new Uint8Array(a)); add(r, meta(6, 2, 67, 8, 1), new Uint8Array(b));
    const vs = tgsi("vertex", "DCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[31], GENERIC[15]\nDCL SAMP[15]\nDCL SVIEW[15], 2D, FLOAT\nIMM[0] FLT32 {0.5, 0.5, 0.0, 1.0}",
      ["MOV OUT[0], IN[0]", "TEX OUT[31], IMM[0], SAMP[15], 2D"]),
      fs = tgsi("fragment", "DCL IN[31], GENERIC[15], PERSPECTIVE\nDCL OUT[31], COLOR\nDCL TEMP[0]\nDCL SAMP[15]\nDCL SVIEW[15], 2D, FLOAT\nIMM[0] FLT32 {0.5, 0.5, 0.0, 1.0}",
        ["TEX TEMP[0], IMM[0], SAMP[15], 2D", "ADD OUT[31], TEMP[0], IN[31]"]);
    const init = join(setup(r, { vertex: vs, fragment: fs, fragmentWords: [] }), transfer(5, 1), transfer(6, 1),
      packet(1, 7, [8, 2 | 2 << 3 | 2 << 11, 0, 0, word(1), 0, 0, 0, 0]),
      samplerView(6, 5, [0, 1, 2, 3]), samplerView(7, 6, [0, 1, 2, 3]), bindSampler(0, 6), bindSampler(1, 7));
    let rec = await submit(r, 1, join(init, draw()), "both-stage-sampler15-identity"),
      saved = await frame(r, rec, () => [128, 112, 96, 224], { kind: "samplers", images: [a, b], views: [[0, 1, 2, 3], [0, 1, 2, 3]] });
    c.same(saved.native.samplers.map(s => [s.stage, s.unit, s.value, s.resourceId]), [["vertex", 31, 31, 5], ["fragment", 15, 15, 6]],
      "actual both-stage units and distinct native textures");
    for (const [name, views, expected] of [
      ["vertex-swizzle", [[2, 1, 0, 3], [0, 1, 2, 3]], [160, 112, 64, 224]],
      ["fragment-constants", [[0, 1, 2, 3], [4, 5, 1, 3]], [32, 255, 128, 224]],
      ["both-all-constant", [[4, 5, 4, 5], [5, 4, 5, 4]], [255, 255, 255, 255]],
      ["identity-restored", [[0, 1, 2, 3], [0, 1, 2, 3]], [128, 112, 96, 224]],
    ]) {
      poison(gl);
      rec = await submit(r, 1, join(samplerView(9, 5, views[0]), samplerView(10, 6, views[1]), bindSampler(0, 9), bindSampler(1, 10),
        clear([0, 0, 0, 0]), draw(), packet(3, 6, [9]), packet(3, 6, [10])), "sampler15-" + name);
      saved = await frame(r, rec, () => expected, { kind: "samplers", images: [a, b], views });
      if (name === "both-all-constant") c.same(saved.native.samplers.map(s => s.value), [null, null], "constant views may prune native samplers");
    }
    done(r);
  }
  await coordinateCases(make, done);
  await rejectionCases(gl, bridge, c, report);
  await cancellationCases(make, done, report);
  if (geometryPath && banksPath && originals) await originalCases(make, done, geometryPath, banksPath, originals);
  report.status = "passed"; return report;
}

async function coordinateCases(make, done) {
  const coords = "PROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[31], POSITION, LINEAR";
  for (const kind of ["position", "dynamic-discard", "terminal-discard", "system-values", "inactive-uniforms"]) {
    const r = make({ delay: 2, step: 2 }), c = r.c; let vertex = VS, fragment, fw = [], expected, fixture;
    if (kind === "position") {
      fw = words([1 / r.width, 1 / r.height, .5, 1]);
      fragment = tgsi("fragment", coords + "\nDCL OUT[31], COLOR\nDCL CONST[0]", ["MUL OUT[31], IN[31], CONST[0]"]);
      expected = (x, y) => quant([(x + .5) / r.width, (y + .5) / r.height, .25, 1]);
      fixture = { kind, fragment: fw };
    } else if (kind === "dynamic-discard") {
      fw = words([r.width / 2, r.width / 2, r.width / 2, r.width / 2, .25, .5, .75, 1]);
      fragment = tgsi("fragment", coords + "\nDCL OUT[31], COLOR\nDCL CONST[0..1]\nDCL TEMP[0]",
        ["SUB TEMP[0], IN[31].xxxx, CONST[0]", "KILL_IF TEMP[0]", "MOV OUT[31], CONST[1]"]);
      expected = x => x < r.width / 2 ? [0, 0, 255, 255] : quant([.25, .5, .75, 1]);
      fixture = { kind, fragment: fw };
    } else if (kind === "terminal-discard") {
      fragment = tgsi("fragment", "DCL OUT[31], COLOR", ["KILL"]); expected = () => [0, 0, 255, 255]; fixture = { kind };
    } else if (kind === "system-values") {
      vertex = tgsi("vertex", "DCL IN[0]\nDCL SV[0], VERTEXID\nDCL SV[1], INSTANCEID\nDCL OUT[0], POSITION\nDCL OUT[31], GENERIC[15]\nDCL TEMP[0..1]\nIMM[0] FLT32 {0.25,0.25,0.25,0.25}",
        ["MOV OUT[0], IN[0]", "I2F TEMP[0], SV[0]", "I2F TEMP[1], SV[1]", "ADD TEMP[0], TEMP[0], TEMP[1]", "MUL OUT[31], TEMP[0], IMM[0]"]);
      fragment = tgsi("fragment", "DCL IN[31], GENERIC[15], PERSPECTIVE\nDCL OUT[31], COLOR", ["MOV OUT[31], IN[31]"]);
      expected = (x, y) => quant(Array(4).fill((2 * (x + .5) / r.width + (y + .5) / r.height) / 4)); fixture = { kind };
    } else {
      fw = RAW;
      fragment = tgsi("fragment", "DCL CONST[0]\nDCL OUT[31], COLOR\nDCL TEMP[0]\nIMM[0] FLT32 {0.25,0.5,0.75,1}",
        ["MOV OUT[31], IMM[0]"]);
      expected = colorOracle([.25, .5, .75, 1]); fixture = { kind, fragment: fw };
    }
    const rec = await submit(r, 1, join(setup(r, { vertex, fragment, fragmentWords: fw, color: [0, 0, 1, 1] }), draw()), kind);
    const saved = await frame(r, rec, expected, fixture);
    if (kind === "terminal-discard") c.same(saved.dump.programs[0].reflection.outputs[0].location, -1, "discard prunes COLOR0 while clear retains target");
    if (kind === "inactive-uniforms") c.same(saved.native.uniforms, [], "unused raw bank need not reflect natively");
    done(r);
  }
  {
    const r = make({ delay: 5, step: 1 }), c = r.c,
      vertex = tgsi("vertex", "DCL IN[0]\nDCL OUT[0], POSITION\nIMM[0] FLT32 {0,0,0,0}", ["MOV OUT[0], IN[0]", "MOV OUT[0].y, IMM[0].xxxx"]);
    const rec = await submit(r, 1, join(setup(r, { vertex, color: [0, 0, 1, 1] }), draw()), "zero-Y-system-block");
    const saved = await frame(r, rec, () => [0, 0, 255, 255], { kind: "degenerate-line" });
    c.same(saved.dump.programs[0].reflection.uniformBlocks[0].byteLength, 656, "declared system block still has checked native extent");
    done(r);
  }
}
async function rejectionCases(gl, bridge, c, report) {
  const old = await createVirglShaderBridge();
  const failures = [
    ["old-profile-in-standard", old],
    ["standard-profile-in-old", bridge, { legacy: true }],
    ["oversized-metadata", { ...bridge, translate(request) { const out = copy(bridge.translate(request));
      if (request.stage === "fragment") out.metadata.uniforms[0].count = 513; return out; } }],
    ["foreign-color", { ...bridge, translate(request) { const out = copy(bridge.translate(request));
      if (request.stage === "fragment") out.metadata.outputs[0].semanticIndex = 1; return out; } }],
    ["spoof-pair-key", { ...bridge, translatePair(request) { const out = copy(bridge.translatePair(request)); out.interfaceKey += "spoof"; return out; } }],
    ["incompatible-pair", { ...bridge, translatePair(request) { const out = copy(bridge.translatePair(request));
      out.fragment.glsl += "\n// foreign paired response"; return out; } }],
    ["program-quota", bridge, { limits: { programs: 0 } }],
    ["variant-byte-quota", bridge, { limits: { shaderBytes: 32 } }],
    ["actual-compiler-error", { ...bridge, translate(request) { return bridge.translate({ ...request, text: request.text + "junk" }); } }],
    ["actual-pair-compiler-error", { ...bridge, translatePair(request) { return bridge.translatePair({ ...request, fragmentText: request.fragmentText + "junk" }); } }],
  ];
  let getters = 0;
  failures.push(["accessor-response", { ...bridge, translate(request) {
    const out = bridge.translate(request); Object.defineProperty(out, "glsl", { get() { getters++; return "bad"; } }); return out;
  } }]);
  for (const [label, compiler, options] of failures) {
    const r = rig(gl, compiler, c, options);
    const rec = await submit(r, 1, join(setup(r), draw()), label);
    c.same(rec.result.ok, false, label + " structured rejection");
    c.same(typeof rec.result.error.code, "string", label + " error code");
    c.same(typeof rec.result.error.byteOffset, "number", label + " packet provenance");
    c.same(r.trace.calls.length, 0, label + " fails before native draw");
    report.runs.push({ history: r.history, events: r.trace.events, exchanges: r.exchanges }); dispose(r);
  }
  c.same(getters, 0, "standard result accessor is never invoked");
  {
    const r = rig(gl, bridge, c);
    const rec = await submit(r, 1, join(constants(1, [1, 2, 3, 4]), packet(8, 0, [])), "malformed-tail-zero-mutation");
    c.same(rec.result.ok, false, "malformed tail refuses job admission");
    c.same(c.ok(r.renderer.inspect(), "malformed-tail counters").work.appliedCommands, 0, "malformed tail applies no prefix");
    c.same(r.trace.events.length, 0, "malformed tail issues no native upload or fence");
    report.runs.push({ history: r.history, events: r.trace.events }); dispose(r);
  }
}
async function cancellationCases(make, done, report) {
  for (const delay of [2, 5]) {
    const r = make({ delay, step: 1 }), { renderer, c, trace } = r;
    c.ok((await submit(r, 1, setup(r), "cancel-setup-" + delay)).result, "real setup before cancellation");
    c.ok(renderer.beginFrame(++r.frame), "cancel recording");
    trace.label("cancel-drain-" + delay);
    const begun = c.ok(renderer.beginSubmission(1, join(draw(), transfer(1, r.width, r.height, 2))), "queued standard draw before cancel");
    c.same(renderer.resetCaches().error.code, "busy", "active standard job refuses cache reset");
    c.same(renderer.destroyContext(1).error.code, "busy", "active standard job refuses context destruction");
    for (let index = 0; index < 2; index++) {
      await new Promise(resolve => setTimeout(resolve, 1)); trace.nextTurn();
      c.ok(renderer.step(begun.job), "issue actual GPU work before cancellation");
    }
    c.same(trace.calls.length, 1, "cancelled job really issued a draw");
    c.ok(renderer.cancel(begun.job), "cancel standard native work");
    let result;
    for (let index = 0; index < 1000; index++) {
      await new Promise(resolve => setTimeout(resolve, index % 3)); trace.nextTurn();
      const step = c.ok(renderer.step(begun.job), "later-task drain");
      if (step.status === "done") { result = step.result; break; }
    }
    c.same(result?.error?.code, "cancelled", "drained job reports cancellation");
    c.same(result?.gpuComplete, true, "cancellation drains an actual completion fence");
    const dump = c.ok(renderer.endFrame(r.frame), "cancel capture").dump;
    report.cancelledJobs ??= []; report.cancelledJobs.push({ delay, result, dump, events: trace.events });
    c.same(renderer.step(begun.job).ok, false, "consumed cancelled job cannot resume");
    done(r);
  }
}
function c580Color(bank) {
  const a = [1053486281, 1046281129, 1082291371, 1055439406].map(float),
    b = [1037578380, 1031980538, 1035420539, 1067798374].map(float),
    d = [1079226764, 1051640170, 1060377406].map(float), e = [1047298914, 1076299332, 1071289118].map(float),
    k = [1067605037, 998866771].map(float), color = bank.slice(12, 16).map(float);
  const s = color[0] + color[1] * a[0] + color[2] * a[1],
    u = color[0] - color[1] * (b[0] + b[2]) - color[2] * (b[1] + b[3]), s3 = s * s * s, u3 = u * u * u;
  const linear = [s3 * a[2] - u3 * d[0] + u3 * e[0], -s3 * k[0] + u3 * e[1] - u3 * d[1], -s3 * k[1] - u3 * d[2] + u3 * e[2]],
    opacity = color[3] * float(bank[28 * 4]);
  return linear.map(n => Math.max(n, 0) ** a[3] * opacity).concat(opacity);
}
async function originalCases(make, done, geometryPath, banksPath, originals) {
  const data = new DataView(await (await fetch(geometryPath)).arrayBuffer()),
    read = (view, at, count) => Array.from({ length: count }, (_, i) => view.getUint32(at + i * 4, true));
  if (data.byteLength !== 2040 || data.getUint32(4, true) !== 3) throw new Error("authenticated original 92cb geometry extent");
  for (let bank = 0; bank < 3; bank++) {
    const r = make({ width: 1024, height: 768, delay: bank, step: bank + 1 }),
      vertex = read(data, 72 + bank * 656, 16), fragment = read(data, 136 + bank * 656, 148), position = read(data, 8, 16).map(float),
      axis = (axis, pixel) => {
        const scale = axis ? 384 : 512, start = scale * (float(vertex[8 + axis]) + 1),
          end = scale * (float(vertex[axis ? 5 : 0]) + float(vertex[8 + axis]) + 1);
        return { start, end, value: float(fragment[16 + axis]) * (pixel + .5 - start) / (end - start) };
      };
    const rec = await submit(r, 1, join(setup(r, { vertex: originals.v92, fragment: originals.f92, vertexWords: vertex,
      fragmentWords: fragment, position, attributes: [[0, 0, 0, 29], [8, 0, 0, 29]], color: [0, 0, 1, 1] }), draw()), "full-original-92cb-" + bank);
    const saved = await frame(r, rec, (x, y) => {
      const a = axis(0, x), b = axis(1, y);
      if (x + .5 < a.start || x + .5 > a.end || y + .5 < b.start || y + .5 > b.end) return [0, 0, 255, 255];
      const out = originalOracle(fragment, a.value, b.value); return out.discard ? [0, 0, 255, 255] : quant(out.color);
    }, { kind: "original92", bank, vertex, fragment, position });
    for (const uniform of saved.native.uniforms) {
      const original = uniform.stage === 0 ? vertex : fragment;
      r.c.same(uniform.words, original.slice(0, uniform.activeCount * 4), "authentic original 92cb native bank");
    }
    done(r);
  }
  const data580 = new DataView(await (await fetch(banksPath)).arrayBuffer());
  if (data580.byteLength !== 1784 || data580.getUint32(4, true) !== 3) throw new Error("authenticated original c580 paired bank extent");
  for (let bank = 0; bank < 3; bank++) for (const edge of ["near", "far"]) {
    const r = make({ width: 4, height: 4, delay: bank + 1, step: bank + 1 }), vertex = read(data580, 8 + bank * 592, 12),
      fragment = read(data580, 56 + bank * 592, 136), w = float(fragment[0]), h = float(fragment[1]),
      sx = float(vertex[0]), sy = float(vertex[5]), ox = float(vertex[8]), oy = float(vertex[9]), position = [];
    for (const [x, y] of [[-1, -1], [3, -1], [-1, 3]]) position.push((x - ox) / sx, (y - oy) / sy, 0, 1,
      ((edge === "near" ? 0 : w - 4) + (x + 1) * 2) / w, ((edge === "near" ? 0 : h - 4) + (y + 1) * 2) / h, 0, 0);
    const color = quant(c580Color(fragment)), rec = await submit(r, 1, join(setup(r, {
      vertex: originals.vc580, fragment: originals.fc580, vertexWords: vertex, fragmentWords: fragment, position,
      attributes: [[0, 0, 0, 31], [16, 0, 0, 31]], stride: 32, color: [0, 0, 1, 1] }), draw(3, 4)), "full-original-c580-" + bank + "-" + edge);
    const saved = await frame(r, rec, (x, y) => {
      const px = (edge === "near" ? 0 : w - 4) + x + .5, py = (edge === "near" ? 0 : h - 4) + y + .5;
      return Math.min(px, w - px, py, h - py) <= 1 ? color : [0, 0, 255, 255];
    }, { kind: "originalC580", bank, edge, vertex, fragment, position, budget: 6 });
    for (const uniform of saved.native.uniforms) {
      const original = uniform.stage === 0 ? vertex : fragment;
      r.c.same(uniform.words, original.slice(0, uniform.activeCount * 4), "authentic original c580 native bank");
    }
    done(r);
  }
}
