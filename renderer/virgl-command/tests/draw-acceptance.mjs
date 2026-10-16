// Original inputs drive execution. Expected pixels come only from the literal
// oracle in tools/virgl-capture/workloads/textured-scene.c, never saved outputs.
import { createVirglShaderBridge } from "../../virgl-shader/index.mjs";
import { createResourceStore, createWebGL2TransferBackend } from "../resources.mjs";
import { createVirglDrawRenderer, createVirglStateRenderer } from "../state.mjs";

const EVENTS_SHA = "c6a95dbcf78f2cdd955af45fbec044cfc5fe4fbb8a4a4a93afefbad37b6856f9";
const EVENTS = [161, 173, 185, 197, 209, 221, 233, 249];
const COUNTS = [39, 3, 6, 3, 8, 3, 6, 142];
const OFFSETS = [64, 4160, 8256];
const EXPECTED = [
  [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]],
  [[255, 0, 0, 255], [0, 128, 0, 255], [0, 0, 0, 255], [255, 128, 0, 255]],
  [[64, 0, 191, 255], [0, 64, 191, 255], [0, 0, 255, 255], [64, 64, 191, 255]],
];
const ORANGE = [0x3f800000, 0x3f000000, 0, 0x3f800000];
const BLUE = [0, 0, 0x3f800000, 0x3f800000];
const BLUE_EXPECTED = [[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 255, 255], [0, 0, 0, 255]];

function checker() {
  let assertions = 0;
  const attacks = [];
  const equal = (actual, expected, label) => {
    assertions++;
    if (!Object.is(actual, expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };
  const same = (actual, expected, label) => equal(JSON.stringify(actual), JSON.stringify(expected), label);
  const truth = (value, label) => equal(Boolean(value), true, label);
  const ok = (result, label) => { equal(result?.ok, true, `${label}: ${result?.error?.code ?? ""} ${result?.error?.message ?? ""}`); return result; };
  const bad = (result, label, code, applied = 0) => {
    equal(result?.ok, false, `${label} rejects`);
    truth(typeof result.error?.code === "string" && typeof result.error?.message === "string", `${label} structured error`);
    if (code) equal(result.error.code, code, `${label} error code`);
    if (result.appliedCommands !== undefined) equal(result.appliedCommands, applied, `${label} applied prefix`);
    attacks.push({ name: label, code: result.error.code, appliedCommands: result.appliedCommands ?? null });
    return result;
  };
  return { equal, same, truth, ok, bad, attacks, get assertions() { return assertions; } };
}
function packet(opcode, type, words) {
  const bytes = new Uint8Array(4 + words.length * 4), view = new DataView(bytes.buffer);
  view.setUint32(0, opcode + type * 256 + words.length * 65536, true);
  words.forEach((word, index) => view.setUint32(4 + index * 4, word, true));
  return bytes;
}
function join(...parts) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
function word(bytes, offset, value) { new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true); }
function raw(fixtures, event) { return Uint8Array.from(fixtures.commands.submissions.find((entry) => entry.event === event).data); }
async function sha(bytes) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((v) => v.toString(16).padStart(2, "0")).join(""); }
function headers(bytes, c, label) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), packets = [];
  for (let offset = 0; offset < bytes.length;) {
    c.truth(offset + 4 <= bytes.length, `${label} independent header fits`);
    const header = view.getUint32(offset, true), payloadDwords = header >>> 16, byteLength = 4 + payloadDwords * 4;
    c.truth(offset + byteLength <= bytes.length, `${label} independent packet fits`);
    packets.push({ byteOffset: offset, opcode: header & 255, objectType: (header >>> 8) & 255, payloadDwords, byteLength });
    offset += byteLength;
  }
  return packets;
}
function pixelOracle(bytes, expected, c, label) {
  c.equal(bytes.length, 4096, `${label} full staging image length`);
  let pixels = 0; const checks = [];
  for (let q = 0; q < 4; q++) {
    const x0 = 4 + (q % 2) * 16, y0 = 4 + Math.floor(q / 2) * 16;
    for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) {
      const actual = [...bytes.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
      c.same(actual, expected[q], `${label} interior pixel (${x},${y})`); pixels++;
    }
    checks.push({ quadrant: q, rectangle: [x0, y0, 8, 8], expected: expected[q], pixels: 64 });
  }
  c.equal(pixels, 256, `${label} checked pixels`);
  return { pixels, checks, orientation: "lower-left row zero; literal red/green below blue/yellow" };
}
function tile(bytes, title) {
  const destination = document.getElementById("draws"); if (!destination) return;
  const figure = document.createElement("figure"), label = document.createElement("figcaption"), canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32; canvas.style.width = canvas.style.height = "192px"; canvas.style.imageRendering = "pixelated";
  label.textContent = title;
  const displayed = new Uint8ClampedArray(bytes.length);
  for (let y = 0; y < 32; y++) displayed.set(bytes.subarray(y * 128, (y + 1) * 128), (31 - y) * 128);
  canvas.getContext("2d").putImageData(new ImageData(displayed, 32, 32), 0, 0);
  figure.append(canvas, label); destination.append(figure);
}

function makeRig(gl, bridge, c, drawLimits) {
  const allocations = new Map(), live = new Set(), calls = [], translations = [];
  const backend = c.ok(createWebGL2TransferBackend(gl), "actual draw resource backend").backend;
  const wrappedBackend = { maxTextureSize: backend.maxTextureSize,
    allocate(meta) { const storage = backend.allocate(meta); allocations.set(meta.id, storage); live.add(storage); return storage; },
    destroy(storage) { backend.destroy(storage); live.delete(storage); },
    upload(...args) { return backend.upload(...args); }, readback(...args) { return backend.readback(...args); }, dispose() { backend.dispose(); } };
  const { store, bindings } = c.ok(createResourceStore({ backend: wrappedBackend }), "draw resource store");
  const identity = (handle, key) => [...allocations].find(([, storage]) => storage[key] === handle)?.[0] ?? null;
  const control = { label: "unlabelled" };
  const wrapped = new Proxy(gl, { get(target, key) {
    const value = Reflect.get(target, key, target); if (typeof value !== "function") return value;
    return (...args) => {
      if (key === "drawElements") {
        const program = target.getParameter(target.CURRENT_PROGRAM), attributes = [];
        for (const name of ["in_0", "in_1"]) {
          const at = target.getAttribLocation(program, name);
          attributes.push({ name, location: at, enabled: target.getVertexAttrib(at, target.VERTEX_ATTRIB_ARRAY_ENABLED),
            stride: target.getVertexAttrib(at, target.VERTEX_ATTRIB_ARRAY_STRIDE), offset: target.getVertexAttribOffset(at, target.VERTEX_ATTRIB_ARRAY_POINTER),
            resourceId: identity(target.getVertexAttrib(at, target.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), "buffer") });
        }
        const location = target.getUniformLocation(program, "fsconst0[0]");
        calls.push({ label: control.label, mode: args[0], count: args[1], indexType: args[2], indexOffset: args[3],
          attributes, constants: [...target.getUniform(program, location)],
          viewport: [...target.getParameter(target.VIEWPORT)], colorMask: [...target.getParameter(target.COLOR_WRITEMASK)],
          blend: target.isEnabled(target.BLEND), blendSource: target.getParameter(target.BLEND_SRC_RGB), blendDestination: target.getParameter(target.BLEND_DST_RGB),
          indexResourceId: identity(target.getParameter(target.ELEMENT_ARRAY_BUFFER_BINDING), "buffer"),
          framebufferResourceId: identity(target.getFramebufferAttachmentParameter(target.DRAW_FRAMEBUFFER, target.COLOR_ATTACHMENT0, target.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME), "texture") });
      }
      return value.apply(target, args);
    };
  } });
  const shaderBridge = { translate(request) {
    const result = bridge.translate(request);
    translations.push({ stage: request.stage, text: request.text, ok: result.ok, glsl: result.glsl ?? null, metadata: result.metadata ?? null });
    return result;
  } };
  const config = { gl: wrapped, resources: store, bindings, shaderBridge, ...(drawLimits ? { drawLimits } : {}) };
  const renderer = c.ok(createVirglDrawRenderer(config), "actual draw renderer").renderer;
  const execute = (contextId, bytes, label, provenance) => { control.label = label; return renderer.executeSubmission(contextId, bytes, provenance); };
  return { gl, store, bindings, renderer, allocations, live, calls, translations, config, execute };
}
function initialize(rig, fixtures, c) {
  const { store, renderer } = rig, actions = [];
  c.same(fixtures.initialization.map((e) => e.event), [96, 100, 104, 107, 111, 115, 118, 122, 126, 129, 133, 137, 140, 144, 148, 151], "original public initialization order");
  for (const action of fixtures.initialization) {
    c.equal(action.eventsSha256, EVENTS_SHA, `initialization ${action.event} provenance`);
    if (action.type === "context_create") {
      c.ok(store.createContext(action.contextId), `original resource context ${action.event}`);
      c.ok(renderer.createContext(action.contextId), `original state context ${action.event}`);
    } else if (action.type === "resource_create") c.ok(store.createResource(action.metadata), `original resource creation ${action.event}`);
    else if (action.type === "resource_attach_iov") {
      c.ok(store.attachBacking(action.resourceId, action.iovLengths.map((n) => new Uint8Array(n))), `original zero SG attachment ${action.event}`);
    } else if (action.type === "ctx_attach_resource") c.ok(store.attachContext(action.contextId, action.resourceId), `original resource membership ${action.event}`);
    else throw new Error(`unexpected initialization ${action.type}`);
    actions.push(action);
  }
  let written = 0; const writes = [];
  for (const snapshot of fixtures.backing) for (const range of snapshot.ranges) {
    c.ok(store.writeBacking(snapshot.resourceId, range.offset, Uint8Array.from(range.data)), `original CPU snapshot ${snapshot.event}`);
    written += range.data.length;
    writes.push({ event: snapshot.event, resourceId: snapshot.resourceId, sourceSha256: snapshot.sourceSha256, offset: range.offset, byteLength: range.data.length });
  }
  c.equal(written, 92, "only 92 original initial CPU bytes written");
  return { actions, writes, written };
}
function lifecycle(rig, action, c) {
  const { store, renderer } = rig;
  c.equal(action.eventsSha256, EVENTS_SHA, `cleanup ${action.event} provenance`);
  if (action.type === "ctx_detach_resource") c.ok(store.detachContext(action.contextId, action.resourceId), `original detach ${action.event}`);
  else if (action.type === "resource_detach_iov") c.ok(store.detachBacking(action.resourceId), `original backing detach ${action.event}`);
  else if (action.type === "resource_unref") c.ok(store.unref(action.resourceId), `original public unref ${action.event}`);
  else if (action.type === "context_destroy") {
    c.ok(renderer.destroyContext(action.contextId), `original state destroy ${action.event}`);
    c.ok(store.destroyContext(action.contextId), `original resource context destroy ${action.event}`);
  } else throw new Error(`unexpected lifecycle ${action.type}`);
}
function dispose(rig, c, label) {
  c.ok(rig.renderer.dispose(), `${label} renderer disposal`); c.ok(rig.store.dispose(), `${label} resource disposal`);
  const state = c.ok(rig.renderer.inspect(), `${label} final state`).budgets, resources = c.ok(rig.store.inspect(), `${label} final resources`).budgets;
  for (const [key, value] of Object.entries(state)) c.equal(value, 0, `${label} final state ${key}`);
  for (const [key, value] of Object.entries(resources)) c.equal(value, 0, `${label} final resource ${key}`);
  c.equal(rig.live.size, 0, `${label} actual resource allocations all deleted`);
  c.equal(rig.gl.getError(), rig.gl.NO_ERROR, `${label} final actual GL error`);
  return { state, resources, liveGpuAllocations: rig.live.size };
}
async function replay(gl, bridge, fixtures, c, label, display) {
  const rig = makeRig(gl, bridge, c), initialization = initialize(rig, fixtures, c), submissions = [], frames = [];
  const originalSurface = rig.allocations.get(5), lifecycleEvents = [];
  let packetCount = 0;
  for (let index = 0; index < EVENTS.length; index++) {
    const event = EVENTS[index], source = fixtures.commands.submissions.find((entry) => entry.event === event), bytes = Uint8Array.from(source.data);
    if (event === 249) {
      for (const action of fixtures.lifecycle.filter((e) => e.event < 249)) { lifecycle(rig, action, c); lifecycleEvents.push(action); }
      c.truth(gl.isTexture(originalSurface.texture), `${label} surface retains actual storage after public resource5 unref`);
      c.bad(rig.store.retainStorage(2, 5, "surface"), `${label} removed resource5 has no public lookup`, "missing-resource");
    }
    const commandHeaders = headers(bytes, c, `${label} event ${event}`);
    c.equal(commandHeaders.length, COUNTS[index], `${label} event ${event} independent command count`);
    packetCount += commandHeaders.length;
    const before = rig.calls.length;
    const result = c.ok(rig.execute(2, bytes, `${label} event ${event}`, { sourceSha256: source.sourceSha256, event, contextId: 2 }), `${label} draw replay event ${event}`);
    c.equal(result.appliedCommands, COUNTS[index], `${label} event ${event} applied all packets`);
    const phase = [161, 185, 209].indexOf(event), expectedDraws = phase < 0 ? 0 : 1;
    c.equal(rig.calls.length - before, expectedDraws, `${label} event ${event} actual GL draw count`);
    c.equal(result.draws.length, expectedDraws, `${label} event ${event} reported draw count`);
    submissions.push({ event, sourceSha256: source.sourceSha256, byteLength: bytes.length, commands: commandHeaders,
      appliedCommands: result.appliedCommands, draws: result.draws });
    if (phase >= 0) {
      const call = rig.calls.at(-1), summary = result.draws[0];
      c.same([call.mode, call.count, call.indexType, call.indexOffset], [gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0], `${label} phase ${phase} actual indexed GPU call`);
      c.same([summary.actualMinIndex, summary.actualMaxIndex, summary.indexByteLength], [0, 3, 12], `${label} phase ${phase} actual index bounds`);
      c.same(call.attributes.map((a) => [a.enabled, a.resourceId, a.stride, a.offset]), [[true, 3, 16, 0], [true, 3, 16, 8]], `${label} phase ${phase} actual vertex fetch bindings`);
      c.same([call.indexResourceId, call.framebufferResourceId], [4, 5], `${label} phase ${phase} actual index and surface identities`);
      frames.push({ phase, event, draw: summary, actualGlCall: call, bindings: c.ok(rig.renderer.inspect(2), `${label} phase ${phase} logical state dump`) });
    }
    const readPhase = [173, 197, 221].indexOf(event);
    if (readPhase >= 0) {
      const image = c.ok(rig.store.readBacking(7, OFFSETS[readPhase], 4096), `${label} original staging readback ${event}`).bytes;
      const pixels = pixelOracle(image, EXPECTED[readPhase], c, `${label} phase ${readPhase}`);
      Object.assign(frames[readPhase], { readback: { event, stagingResourceId: 7, offset: OFFSETS[readPhase], byteLength: 4096, rgbaSha256: await sha(image) }, pixels });
      if (display) tile(image, `Original phase ${readPhase}: 256 exact interior pixels`);
    }
    if (event === 249) c.equal(gl.isTexture(originalSurface.texture), false, `${label} original249 releases final surface storage`);
    c.equal(gl.getError(), gl.NO_ERROR, `${label} event ${event} actual GL errors`);
  }
  for (const action of fixtures.lifecycle.filter((e) => e.event > 249)) { lifecycle(rig, action, c); lifecycleEvents.push(action); }
  c.equal(packetCount, 210, `${label} all original packets`); c.equal(rig.calls.length, 3, `${label} three actual GPU draws`);
  c.same(rig.translations.map((t) => [t.stage, t.text]), [["vertex", fixtures.commands.shaders.VERT], ["fragment", fixtures.commands.shaders.FRAG]], `${label} exact original TGSI bridge inputs`);
  c.truth(rig.translations.every((t) => t.ok && typeof t.glsl === "string"), `${label} original shaders translated to GLSL`);
  const cleanup = dispose(rig, c, label);
  return { packetCount, gpuDraws: rig.calls.length, checkedPixels: frames.reduce((sum, frame) => sum + frame.pixels.pixels, 0),
    initialization, submissions, frames, translations: rig.translations, lifecycle: lifecycleEvents, cleanup };
}

function poison(gl) {
  const vao = gl.createVertexArray(), buffer = gl.createBuffer(), texture = gl.createTexture(), sampler = gl.createSampler(), fbo = gl.createFramebuffer();
  gl.useProgram(null); gl.bindVertexArray(vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, 16, gl.STATIC_DRAW);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
  gl.bindSampler(0, sampler); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.DITHER, gl.RASTERIZER_DISCARD, gl.SAMPLE_COVERAGE]) gl.enable(cap);
  gl.colorMask(false, false, false, false); gl.depthMask(true); gl.scissor(0, 0, 0, 0); gl.viewport(1, 2, 3, 4); gl.frontFace(gl.CW);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 8); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
  return () => { gl.deleteVertexArray(vao); gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteSampler(sampler); gl.deleteFramebuffer(fbo); };
}
function isolatedAttacks(gl, bridge, fixtures, c) {
  const rig = makeRig(gl, bridge, c); initialize(rig, fixtures, c);
  const first = raw(fixtures, 161), draw = first.slice(5684), uploadIndex = first.slice(56, 112), vb = first.slice(5656, 5684);
  const run = (bytes, label, ctx = 2) => c.ok(rig.execute(ctx, bytes, label), label);
  run(first.slice(0, 5684), "isolated attack original state prefix");
  const read = (expected, label, ctx = 2, delta = 0) => {
    const bytes = raw(fixtures, 173); if (delta) { word(bytes, 4108, 5 + delta); word(bytes, 4152, 7 + delta); }
    run(bytes, `${label} actual transfer readback`, ctx);
    const image = c.ok(rig.store.readBacking(7 + delta, 64, 4096), `${label} actual staging bytes`).bytes;
    pixelOracle(image, expected, c, label); return image;
  };
  const valid = (label) => { const before = rig.calls.length; const result = run(draw, label); c.equal(rig.calls.length, before + 1, `${label} actual GPU recovery draw`); c.equal(result.draws.length, 1, `${label} reported recovery draw`); read(EXPECTED[0], label); };
  valid("initial isolated original draw");
  run(first.slice(4848, 4884), "positive index offset starts from original blue CLEAR");
  run(packet(11, 0, [4, 2, 6]), "positive index binding selects second original triangle");
  const secondTriangle = draw.slice(); word(secondTriangle, 8, 3);
  const selected = run(secondTriangle, "positive nonzero index offset actual draw");
  c.same([rig.calls.at(-1).count, rig.calls.at(-1).indexOffset], [3, 6], "positive offset actual GL count and byte offset");
  c.same([selected.draws[0].indexOffset, selected.draws[0].actualMinIndex, selected.draws[0].actualMaxIndex], [6, 1, 3],
    "positive offset scanned second triangle indices");
  run(raw(fixtures, 173), "positive index offset original readback");
  const trianglePixels = c.ok(rig.store.readBacking(7, 64, 4096), "positive index offset actual staging image").bytes;
  for (const [x, y, color] of [[8, 8, [0, 0, 255, 255]], [24, 24, [255, 255, 0, 255]]]) {
    c.same([...trianglePixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)], color,
      `positive nonzero index offset pixel (${x},${y})`);
  }
  run(first.slice(5640, 5656), "restore zero index binding offset");
  valid("positive nonzero index offset full-quad recovery");
  const reject = (input, label, code, recover = () => {}) => {
    const before = rig.calls.length, resources = c.ok(rig.store.inspect(), `${label} resource budget before`).budgets;
    const result = c.bad(rig.execute(2, input, label), label, code);
    c.same(result.draws, [], `${label} no successful draw summary`); c.equal(rig.calls.length, before, `${label} no actual GPU draw`);
    c.same(c.ok(rig.store.inspect(), `${label} resource budget after`).budgets, resources, `${label} no temporary resource leak`);
    c.equal(gl.getError(), gl.NO_ERROR, `${label} actual GL error state`);
    recover(); valid(`${label} recovery`);
  };
  for (const [label, offset, value, code] of [["zero draw count", 8, 0, "unsupported-draw"], ["nonzero indexed start", 4, 1, "unsupported-draw"],
    ["nonindexed range exceeds actual vertex storage", 16, 0, "out-of-bounds"], ["index count exceeds actual storage", 8, 7, "out-of-bounds"]]) {
    const badDraw = draw.slice(); word(badDraw, offset, value); reject(badDraw, label, code);
  }
  run(packet(11, 0, [4, 2, 2]), "set supported aligned nonzero index offset");
  reject(draw, "index offset plus count exceeds storage", "out-of-bounds", () => run(first.slice(5640, 5656), "restore index offset"));
  run(packet(6, 0, [16, 0, 3, 16, 12, 3]), "UV vertex binding starts four bytes too late");
  reject(draw, "last UV fetch exceeds storage", "out-of-bounds", () => run(vb, "restore exact-fit vertex bindings"));
  run(packet(6, 0, [0, 0, 3, 16, 8, 3]), "zero active vertex stride state");
  reject(draw, "Gallium zero stride cannot become packed GL stride", "unsupported-draw", () => run(vb, "restore nonzero vertex stride"));
  const originalIndex = Uint8Array.from(fixtures.backing.find((entry) => entry.resourceId === 4).ranges[0].data);
  for (const [label, index, value, code] of [["actual first index exceeds vertex storage", 0, 4, "out-of-bounds"],
    ["actual last index exceeds vertex storage", 5, 4, "out-of-bounds"], ["ushort fixed restart cannot hide behind wire restart false", 0, 65535, "unsupported-draw"]]) {
    const bytes = originalIndex.slice(); new DataView(bytes.buffer).setUint16(index * 2, value, true);
    c.ok(rig.store.writeBacking(4, 0, bytes), `${label} CPU upload`); run(uploadIndex, `${label} actual GPU index upload`);
    reject(draw, label, code, () => { c.ok(rig.store.writeBacking(4, 0, originalIndex), `${label} restore CPU indices`); run(uploadIndex, `${label} restore actual GPU indices`); });
  }
  const missing = [
    ["fragment shader", packet(31, 0, [0, 1]), packet(31, 0, [2, 1])],
    ["vertex shader", packet(31, 0, [0, 0]), packet(31, 0, [1, 0])],
    ["framebuffer", packet(5, 0, [0, 0]), packet(5, 0, [1, 0, 3])],
    ["vertex elements", packet(2, 5, [0]), packet(2, 5, [9])],
    ["vertex buffers", packet(6, 0, []), vb],
    ["index buffer", packet(11, 0, [0]), first.slice(5640, 5656)],
    ["sampler view", packet(10, 0, [1, 0, 0]), packet(10, 0, [1, 0, 5])],
    ["sampler state", packet(18, 0, [1, 0, 0]), packet(18, 0, [1, 0, 6])],
    ["active fragment constants", packet(12, 0, [1, 0]), first.slice(5336, 5364)],
  ];
  for (const [label, unset, reset] of missing) {
    run(unset, `unset ${label}`); reject(draw, `missing ${label}`, "incomplete-draw", () => run(reset, `restore ${label}`));
  }
  run(packet(29, 0, [3]), "isolated fresh subcontext for genuinely missing viewport");
  run(join(first.slice(4112, 5304), first.slice(5336, 5684)), "complete fresh state except viewport");
  reject(draw, "missing viewport", "incomplete-draw", () => run(packet(28, 0, [1]), "restore original subcontext viewport"));
  run(packet(30, 0, [3]), "delete isolated missing-viewport subcontext");
  run(join(packet(1, 5, [120, 0, 0, 0, 29]), packet(2, 5, [120])), "one of two required vertex elements");
  reject(draw, "missing second reflected vertex element", "incomplete-draw", () => run(join(packet(2, 5, [9]), packet(3, 5, [120])), "restore complete vertex elements"));
  run(join(packet(1, 6, [120, 5, 0x02000043, 0, 0, 0x688]), packet(10, 0, [1, 0, 120])), "bind framebuffer texture as active sampled view");
  reject(draw, "framebuffer texture feedback", "framebuffer-feedback", () => run(join(packet(10, 0, [1, 0, 5]), packet(3, 6, [120])), "restore nonfeedback sampler view"));
  reject(join(draw, packet(255, 0, [])), "malformed wire tail prevents otherwise valid draw", "unsupported-command");

  // Synthetic B uses different resource storage and the same object handles.
  c.ok(rig.store.createContext(3), "synthetic B resource context"); c.ok(rig.renderer.createContext(3), "synthetic B renderer context");
  for (const meta of fixtures.resources) { c.ok(rig.store.createResource({ ...meta, id: meta.id + 100 }), "B resource"); c.ok(rig.store.attachContext(3, meta.id + 100), "B membership"); }
  for (const backing of fixtures.backing) {
    c.ok(rig.store.attachBacking(backing.resourceId + 100, backing.iovLengths.map((n) => new Uint8Array(n))), "B backing");
    for (const range of backing.ranges) c.ok(rig.store.writeBacking(backing.resourceId + 100, range.offset, Uint8Array.from(range.data)), "B upload snapshot");
  }
  const b = first.slice();
  for (const [offset, id] of [[4, 103], [60, 104], [4740, 106], [4784, 107], [4804, 105], [5100, 106], [5644, 104], [5668, 103], [5680, 103]]) word(b, offset, id);
  ORANGE.forEach((value, index) => word(b, 5348 + index * 4, value));
  run(b, "synthetic B same handles different resources and orange constants", 3); read(EXPECTED[1], "synthetic B orange pixels", 3, 100);
  const subB = b.slice(4112); BLUE.forEach((value, index) => word(subB, 5348 - 4112 + index * 4, value));
  run(packet(29, 0, [2]), "synthetic B creates subcontext2", 3); run(subB, "synthetic B subcontext2 same handles blue constants", 3);
  read(BLUE_EXPECTED, "synthetic B2 blue pixels", 3, 100);
  const switches = [[2, 1, 0, EXPECTED[0], "A"], [3, 1, 100, EXPECTED[1], "B1"], [2, 1, 0, EXPECTED[0], "A"], [3, 2, 100, BLUE_EXPECTED, "B2"], [2, 1, 0, EXPECTED[0], "A"]];
  for (const [ctx, sub, delta, expected, label] of switches) {
    run(packet(28, 0, [sub]), `select ${label}`, ctx);
    const cleanupPoison = poison(gl); c.equal(gl.getError(), gl.NO_ERROR, `${label} host poison is valid GL state`);
    run(draw, `${label} draw restores all poisoned state`, ctx); cleanupPoison();
    read(expected, `${label} isolated actual draw pixels`, ctx, delta);
    c.same([rig.calls.at(-1).indexResourceId, rig.calls.at(-1).framebufferResourceId], [4 + delta, 5 + delta], `${label} draw actual resource identity`);
  }
  const cleanup = dispose(rig, c, "isolated attacks");
  return { successfulGpuDraws: rig.calls.length, contextSwitches: "A/B1/A/B2/A", cleanup };
}

function quotaAttacks(gl, bridge, fixtures, c) {
  const reports = [], first = raw(fixtures, 161), draw = first.slice(5684);
  for (const [label, drawLimits] of [["zero draw quota", { drawsPerSubmission: 0 }], ["zero index quota", { indicesPerSubmission: 0 }]]) {
    const rig = makeRig(gl, bridge, c, drawLimits); initialize(rig, fixtures, c);
    c.ok(rig.execute(2, first.slice(0, 5684), `${label} setup`), `${label} original state remains usable`);
    const result = c.bad(rig.execute(2, draw, label), label, "limit-exceeded");
    c.same(result.draws, [], `${label} no successful draw summary`); c.equal(rig.calls.length, 0, `${label} no actual GPU draw`);
    reports.push({ label, drawLimits, prefixDraws: 0, cleanup: dispose(rig, c, label) });
  }
  for (const [label, drawLimits, count] of [["one draw per submission", { drawsPerSubmission: 1 }, 1],
    ["twelve scanned indices per submission", { indicesPerSubmission: 12 }, 2], ["default sixty-four draw bound", {}, 64]]) {
    const rig = makeRig(gl, bridge, c, drawLimits); initialize(rig, fixtures, c);
    c.ok(rig.execute(2, first.slice(0, 5684), `${label} setup`), `${label} original setup`);
    const input = join(...Array.from({ length: count + 1 }, () => draw));
    const result = c.bad(rig.execute(2, input, label), label, "limit-exceeded", count);
    c.equal(result.draws.length, count, `${label} exact successful prefix report`); c.equal(rig.calls.length, count, `${label} exact actual GPU prefix`);
    const recovery = c.ok(rig.execute(2, draw, `${label} next submission`), `${label} quota resets at next submission`);
    c.equal(recovery.draws.length, 1, `${label} next submission draws once`);
    c.equal(rig.calls.length, count + 1, `${label} next submission actual GPU draw`);
    reports.push({ label, drawLimits, prefixDraws: count, cleanup: dispose(rig, c, label) });
  }
  const rig = makeRig(gl, bridge, c); initialize(rig, fixtures, c);
  for (const [label, drawLimits] of [["unknown", { arbitrary: 1 }], ["negative", { drawsPerSubmission: -1 }],
    ["fractional", { indicesPerSubmission: 1.5 }], ["enlarged draw", { drawsPerSubmission: 65 }], ["enlarged index", { indicesPerSubmission: 65537 }]]) {
    c.bad(createVirglDrawRenderer({ ...rig.config, drawLimits }), `invalid ${label} draw limits`, "invalid-input");
  }
  c.bad(createVirglStateRenderer({ ...rig.config, drawLimits: {} }), "state-only renderer does not silently enable draw limits", "invalid-input");
  const resourcesWithoutReadStorage = Object.fromEntries(Object.entries(rig.store).filter(([key]) => key !== "readStorage"));
  c.bad(createVirglDrawRenderer({ ...rig.config, resources: resourcesWithoutReadStorage }),
    "draw factory requires actual storage readback capability", "invalid-input");
  dispose(rig, c, "invalid draw configuration"); return reports;
}

export async function runBrowserAcceptance(fixtures, options = {}) {
  const c = checker(), canvas = document.getElementById("gpu"); c.truth(canvas, "actual GPU canvas");
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true }); c.truth(gl, "actual WebGL2 context");
  const bridge = await createVirglShaderBridge(options.bridgeOptions ?? {});
  const original = await replay(gl, bridge, fixtures, c, "original", true);
  const poisoned = { ...fixtures, referenceOutputSnapshots: fixtures.referenceOutputSnapshots.map((snapshot) => ({ ...snapshot, data: snapshot.data.map((byte) => byte ^ 255) })) };
  const poisonedBytes = poisoned.referenceOutputSnapshots.reduce((sum, snapshot) => sum + snapshot.data.length, 0);
  c.equal(poisonedBytes, 12288, "all selected recorded reference output bytes poisoned");
  const poisonReplay = await replay(gl, bridge, poisoned, c, "poisoned reference replay", false);
  c.same(poisonReplay.frames.map((frame) => frame.readback.rgbaSha256), original.frames.map((frame) => frame.readback.rgbaSha256), "poisoned reference outputs cannot affect actual GPU pixels");
  const isolated = isolatedAttacks(gl, bridge, fixtures, c), quotas = quotaAttacks(gl, bridge, fixtures, c);
  c.equal(gl.getError(), gl.NO_ERROR, "final actual hardware GL error state");
  return { status: "passed", primaryDrawReplay: true, guestExecution: false, assertions: c.assertions,
    summary: { status: "passed", originalSubmissions: 8, originalPackets: 210, actualOriginalGpuDraws: 3, originalInteriorPixels: 768,
      readbackOffsets: OFFSETS, referenceOutputPoisonBytes: poisonedBytes, contextSwitches: isolated.contextSwitches,
      attacks: c.attacks.length, zeroGlErrors: true, guestExecution: false },
    selection: fixtures.selection, original, outputReferencePoison: { bytes: poisonedBytes, replayGpuDraws: poisonReplay.gpuDraws,
      hashes: poisonReplay.frames.map((frame) => frame.readback.rgbaSha256), cleanup: poisonReplay.cleanup },
    isolated, quotas, attacks: c.attacks };
}
