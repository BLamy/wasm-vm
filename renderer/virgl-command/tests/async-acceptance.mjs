// Original inputs drive execution. Expected pixels come only from the literal
// oracle in tools/virgl-capture/workloads/textured-scene.c, never saved outputs.
import { createVirglShaderBridge } from "../../virgl-shader/index.mjs";
import { createResourceStore, createWebGL2TransferBackend } from "../resources.mjs";
import { createVirglAsyncRenderer, JOB_LIMITS } from "../state.mjs";

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
  let assertions = 0, failure = null;
  const attacks = [];
  const equal = (actual, expected, label) => {
    assertions++;
    if (!Object.is(actual, expected)) { failure = new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); throw failure; }
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
  return { equal, same, truth, ok, bad, attacks, get assertions() { return assertions; }, get failure() { return failure; } };
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

// Instrument real calls. Delays only withhold an actual signal; they never invent one.
function instrument(gl, c, schedule = 0) {
  const objects = new Map(), buffers = new Map(), syncs = new Map(), events = [], calls = [];
  let nextId = 1, turn = 0, fenceCount = 0, collectCount = 0, drawCount = 0, polls = 0;
  const control = { waitFailed: false, lost: false, nullBuffer: false, nullSync: false, label: "initialization" };
  const id = (value) => value === null ? null : objects.get(value)?.id ?? null;
  const binding = (target) => gl.getParameter(new Map([[gl.ARRAY_BUFFER, gl.ARRAY_BUFFER_BINDING], [gl.UNIFORM_BUFFER, gl.UNIFORM_BUFFER_BINDING],
    [gl.ELEMENT_ARRAY_BUFFER, gl.ELEMENT_ARRAY_BUFFER_BINDING], [gl.COPY_READ_BUFFER, gl.COPY_READ_BUFFER_BINDING],
    [gl.COPY_WRITE_BUFFER, gl.COPY_WRITE_BUFFER_BINDING], [gl.PIXEL_PACK_BUFFER, gl.PIXEL_PACK_BUFFER_BINDING],
    [gl.PIXEL_UNPACK_BUFFER, gl.PIXEL_UNPACK_BUFFER_BINDING]]).get(target));
  const oracle = (test, label) => { try { c.truth(test, label); } catch (error) { control.oracleFailure = error; throw error; } };
  const record = (name, fields = {}) => events.push({ sequence: events.length, turn, name, label: control.label, ...fields });
  const wrapped = new Proxy(gl, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (typeof value !== "function") return value;
    return (...args) => { try {
      if (key === "isContextLost" && control.lost) return true;
      if (key === "createBuffer" && control.nullBuffer) { control.nullBuffer = false; record("fault:createBuffer"); return null; }
      if (key === "fenceSync" && control.nullSync) { control.nullSync = false; record("fault:fenceSync"); return null; }
      c.truth(key !== "finish", "async path must never finish");
      if (key === "bindBuffer" && args[1]) {
        const entry = buffers.get(args[1]);
        if (entry && entry.firstTarget === null) entry.firstTarget = args[0];
      }
      if (key === "bufferData") { const b = buffers.get(binding(args[0])); if (b) b.bytes = typeof args[1] === "number" ? args[1] : args[1].byteLength; }
      if (key === "copyBufferSubData") {
        const source = binding(args[0]), destination = binding(args[1]), src = buffers.get(source), dst = buffers.get(destination);
        c.truth(src && dst, "async copy uses tracked real buffers");
        if (src.firstTarget === gl.ELEMENT_ARRAY_BUFFER) oracle(dst.firstTarget === gl.ELEMENT_ARRAY_BUFFER, "async index staging uses element-array class");
        c.truth((src.firstTarget === gl.ELEMENT_ARRAY_BUFFER) === (dst.firstTarget === gl.ELEMENT_ARRAY_BUFFER), "async staged buffer classes match");
        dst.produced = true; dst.sync = null;
        record("copyBufferSubData", { source: id(source), destination: id(destination), sourceClass: src.firstTarget, destinationClass: dst.firstTarget, sourceOffset: args[2], destinationOffset: args[3], bytes: args[4] });
      }
      if (key === "readPixels") {
        c.equal(typeof args[6], "number", "async texture read uses numeric PBO offset");
        const handle = binding(gl.PIXEL_PACK_BUFFER), b = buffers.get(handle);
        c.truth(b, "async texture read has actual PIXEL_PACK_BUFFER");
        b.produced = true; b.sync = null;
        record("readPixels:PBO", { buffer: id(handle), box: args.slice(0, 4), offset: args[6] });
      }
      if (key === "clientWaitSync") {
        c.same(args.slice(1), [0, 0], "async wait flags and timeout are zero");
        const s = syncs.get(args[0]); c.truth(s, "async wait uses owned live sync");
        c.truth(turn > s.turn, "async fence polling occurs in a later browser task");
        c.truth(s.lastPollTurn !== turn, "async each fence is polled at most once per host step"); s.lastPollTurn = turn;
        const actual = value.apply(target, args); polls++;
        let delivered = actual;
        if (control.waitFailed) { control.waitFailed = false; delivered = gl.WAIT_FAILED; }
        else if ((actual === gl.ALREADY_SIGNALED || actual === gl.CONDITION_SATISFIED) && s.withheld > 0) { s.withheld--; delivered = gl.TIMEOUT_EXPIRED; }
        s.signaled = delivered === gl.ALREADY_SIGNALED || delivered === gl.CONDITION_SATISFIED;
        record("clientWaitSync", { sync: s.id, actual, delivered }); return delivered;
      }
      if (key === "getBufferSubData") {
        const b = buffers.get(binding(args[0])), s = b && syncs.get(b.sync);
        oracle(b?.produced && s?.signaled, "async CPU collection requires a signaled fence");
        collectCount++; record("getBufferSubData", { buffer: id(binding(args[0])), sync: s.id, offset: args[1], bytes: args[2].byteLength });
      }
      if (key === "drawElements") { drawCount++; calls.push({ mode: args[0], count: args[1], type: args[2], offset: args[3], turn }); record("drawElements", { count: args[1], offset: args[3] }); }
      const result = value.apply(target, args);
      if (/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(key) && result) {
        objects.set(result, { id: nextId++, kind: key.slice(6) });
        if (key === "createBuffer") buffers.set(result, { firstTarget: null, bytes: 0, produced: false, sync: null });
      }
      if (key === "fenceSync" && result) {
        const entry = { id: nextId++, turn, signaled: false, lastPollTurn: -1, withheld: schedule === 0 ? 0 : schedule === 1 ? 1 : ((Math.imul(fenceCount, 1664525) + schedule + 1013904223) >>> 0) % 4 };
        objects.set(result, { id: entry.id, kind: "Sync" }); syncs.set(result, entry); fenceCount++;
        for (const b of buffers.values()) if (b.produced && b.sync === null) b.sync = result;
        record("fenceSync", { sync: entry.id });
      }
      if (key === "flush") record("flush");
      if (/^delete(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader|Sync)$/.test(key) && args[0]) {
        record(key, { object: id(args[0]) }); objects.delete(args[0]);
        if (key === "deleteBuffer") buffers.delete(args[0]); if (key === "deleteSync") syncs.delete(args[0]);
      }
      return result;
    } catch (error) { control.driverError = error; throw error; } };
  } });
  return { gl: wrapped, control, events, calls, objects, buffers, syncs,
    nextTurn() { turn++; }, get turn() { return turn; },
    snapshot() { return { turns: turn, fences: fenceCount, polls, collections: collectCount, gpuDraws: drawCount,
      pboReads: events.filter((e) => e.name === "readPixels:PBO").length,
      stagedCopies: events.filter((e) => e.name === "copyBufferSubData").length, liveObjects: objects.size, liveSyncs: syncs.size }; } };
}
function makeRig(gl, bridge, c, { schedule = 0, jobLimits, resourceLimits, drawLimits, omitStagedBackend = false } = {}) {
  const trace = instrument(gl, c, schedule), backend = c.ok(createWebGL2TransferBackend(trace.gl), "actual async backend").backend;
  const diagnosticBackend = Object.fromEntries(Object.entries(backend).map(([key,value]) => [key, typeof value === "function" ? (...args) => { try { return value(...args); } catch(error) { trace.control.backendError = {method:key,message:error.message,stack:error.stack}; throw error; } } : value]));
  if(omitStagedBackend) delete diagnosticBackend.beginReadback;
  const { store, bindings, asyncAccess } = c.ok(createResourceStore({ backend: diagnosticBackend, ...(resourceLimits ? { limits: resourceLimits } : {}) }), "async store");
  const translations = [];
  const shaderBridge = { translate(request) { const answer = bridge.translate(request); translations.push({ stage: request.stage, text: request.text, glsl: answer.glsl, metadata: answer.metadata }); return answer; } };
  const config = { gl: trace.gl, resources: store, bindings, asyncAccess, shaderBridge, ...(jobLimits ? { jobLimits } : {}), ...(drawLimits ? { drawLimits } : {}) };
  const renderer = c.ok(createVirglAsyncRenderer(config), "actual async renderer").renderer;
  return { gl, store, bindings, asyncAccess, renderer, trace, config, translations, ram: new Map(), identities: new Map(), exchanges: [], jobs: [], pendingHeartbeats: 0 };
}
function initialize(rig, fixtures, c) {
  const actions = [];
  c.same(fixtures.initialization.map((e) => e.event), [96,100,104,107,111,115,118,122,126,129,133,137,140,144,148,151], "original public initialization order");
  for (const action of fixtures.initialization) {
    c.equal(action.eventsSha256, EVENTS_SHA, "original initialization provenance");
    if (action.type === "context_create") { c.ok(rig.store.createContext(action.contextId), "resource context"); c.ok(rig.renderer.createContext(action.contextId), "renderer context"); }
    else if (action.type === "resource_create") c.ok(rig.store.createResource(action.metadata), "original resource creation");
    else if (action.type === "resource_attach_iov") {
      c.ok(rig.store.attachBacking(action.resourceId, action.iovLengths.map((n) => new Uint8Array(n))), "zero SG attachment");
      rig.ram.set(action.resourceId, new Uint8Array(action.iovLengths.reduce((a,b) => a+b, 0)));
      rig.identities.set(action.resourceId, c.ok(rig.asyncAccess.describeBacking(action.resourceId), "attach-time DMA identity"));
    } else c.ok(rig.store.attachContext(action.contextId, action.resourceId), "original membership");
    actions.push(action);
  }
  let written = 0;
  for (const snapshot of fixtures.backing) for (const range of snapshot.ranges) {
    rig.ram.get(snapshot.resourceId).set(range.data, range.offset); written += range.data.length;
  }
  c.equal(written, 92, "fresh simulated RAM input bytes");
  c.truth(c.ok(rig.store.readBacking(3,0,64), "private copy is deliberately stale").bytes.every((v) => v === 0), "async never relies on attachment byte copy");
  return { actions, written, privateBackingCopiesRemainZero: true };
}
function lifecycle(rig, action, c) {
  c.equal(action.eventsSha256, EVENTS_SHA, "original cleanup provenance");
  if (action.type === "ctx_detach_resource") c.ok(rig.store.detachContext(action.contextId, action.resourceId), "original detach");
  else if (action.type === "resource_detach_iov") c.ok(rig.store.detachBacking(action.resourceId), "original backing detach");
  else if (action.type === "resource_unref") c.ok(rig.store.unref(action.resourceId), "original unref");
  else if (action.type === "context_destroy") { c.ok(rig.renderer.destroyContext(action.contextId), "original renderer destroy"); c.ok(rig.store.destroyContext(action.contextId), "original context destroy"); }
}
function dense(ram, layout) {
  const bytes = new Uint8Array(layout.rowBytes * layout.rowCount);
  for (let row = 0; row < layout.rowCount; row++) bytes.set(ram.subarray(layout.offset + row * layout.rowStride, layout.offset + row * layout.rowStride + layout.rowBytes), row * layout.rowBytes);
  return bytes;
}
function scatter(ram, layout, bytes) {
  for (let row = 0; row < layout.rowCount; row++) ram.set(bytes.subarray(row * layout.rowBytes, (row+1) * layout.rowBytes), layout.offset + row * layout.rowStride);
}
async function nextTask(rig) { await new Promise((resolve) => setTimeout(resolve, 0)); rig.trace.nextTurn(); }
function requestRecord(request) { return { command: request.command, resource: request.resource, backingGeneration: request.backingGeneration, layout: request.layout }; }
async function drain(rig, job, c, { onYield, expectedError, expectedGpuComplete = true, corruptInputAfterHandoff = true } = {}) {
  const states = [], startTurn = rig.trace.turn, peak={inputBytes:0,outputBytes:0,stagingBytes:0,scratchBytes:0,gpuBytes:0}; let requestCount = 0;
  const heartbeat = setInterval(() => { rig.pendingHeartbeats++; }, 0);
  try {
    for (let steps = 0; steps < 10000; steps++) {
      const stepped = rig.renderer.step(job); if (rig.trace.control.driverError) throw rig.trace.control.driverError; if (c.failure) throw c.failure; if (rig.trace.control.oracleFailure) throw rig.trace.control.oracleFailure;
      const state = c.ok(stepped, "async step"); states.push({ status: state.status, appliedCommands: state.appliedCommands });
      const inspection=rig.renderer.inspect().jobs, resourceBudget=rig.store.inspect().budgets;
      for(const key of Object.keys(peak))peak[key]=Math.max(peak[key],inspection[key]??resourceBudget[key]??0);
      if (onYield && await onYield(state, job, steps)) { await nextTask(rig); continue; }
      if (state.status === "done") {
        c.equal(state.result.gpuComplete, expectedGpuComplete, "terminal job confirms GPU completion "+rig.trace.control.label+" "+JSON.stringify({result:state.result,backend:rig.trace.control.backendError,trace:rig.trace.events.slice(-15)}));
        if (!state.result.ok && !expectedError) throw new Error(JSON.stringify({label:rig.trace.control.label,result:state.result,trace:rig.trace.events.slice(-20)}));
        if (expectedError) c.bad(state.result, "expected async failure", expectedError, state.result.appliedCommands); else c.ok(state.result, "async completed result "+rig.trace.control.label);
        const entry = { states, result: state.result, turns: rig.trace.turn-startTurn, requestCount, peakOwnedBytes:peak };
        rig.jobs.push(entry); return entry;
      }
      if (state.status === "needs-input" || state.status === "needs-output") {
        const request = state.request, record = requestRecord(request), ram = rig.ram.get(request.resource.id);
        c.truth(ram, "DMA request identifies known simulated RAM backing");
        const identity=rig.identities.get(request.resource.id);
        c.same(request.resource,identity.resource,"DMA request exact attach-time resource identity");
        c.equal(request.backingGeneration,identity.backingGeneration,"DMA request exact attach-time backing generation");
        c.equal(ram.byteLength,identity.byteLength,"DMA provider backing byte length");
        c.equal(typeof request.resource.generation, "number", "DMA captures resource generation");
        c.equal(typeof request.backingGeneration, "number", "DMA captures backing generation");
        c.equal(request.layout.tightBytes, request.layout.rowBytes*request.layout.rowCount, "DMA row layout dense size");
        if (state.status === "needs-input") {
          const bytes = dense(ram, request.layout);
          c.ok(rig.renderer.provideInput(job, request.token, bytes), "fresh DMA input handoff");
          peak.inputBytes=Math.max(peak.inputBytes,rig.renderer.inspect().jobs.inputBytes);
          if (corruptInputAfterHandoff) bytes.fill(0xee);
        } else {
          c.equal(request.bytes.byteLength, request.layout.tightBytes, "actual output dense byte length");
          scatter(ram, request.layout, request.bytes);
          record.bytes = [...request.bytes];
          c.ok(rig.renderer.acknowledgeOutput(job, request.token), "DMA output scatter acknowledgment");
        }
        rig.exchanges.push({ status: state.status, ...record }); requestCount++;
      } else c.truth(["ready", "waiting-gpu"].includes(state.status), "bounded async step status");
      await nextTask(rig);
    }
    throw new Error("bounded async job exceeded 10000 host steps");
  } finally { clearInterval(heartbeat); }
}
async function execute(rig, bytes, c, label, options = {}) {
  rig.trace.control.label = label;
  const submitted = new Uint8Array(bytes), started = c.ok(rig.renderer.beginSubmission(options.contextId ?? 2, submitted, options.provenance ?? {}), label+" begin");
  submitted.fill(0); // The renderer must own the raw command bytes after begin.
  return drain(rig, started.job, c, options);
}
function dispose(rig, c, label) {
  c.ok(rig.renderer.dispose(), `${label} renderer disposal`); c.ok(rig.store.dispose(), `${label} resource disposal`);
  const state = c.ok(rig.renderer.inspect(), `${label} final state`).budgets;
  const resources = c.ok(rig.store.inspect(), `${label} final resources`).budgets;
  for (const [key, value] of Object.entries(state)) c.equal(value, 0, `${label} final state ${key}`);
  for (const [key, value] of Object.entries(resources)) c.equal(value, 0, `${label} final resource ${key}`);
  c.equal(rig.trace.objects.size, 0, `${label} actual GL objects released`);
  c.equal(rig.gl.getError(), rig.gl.NO_ERROR, `${label} no actual GL errors`);
  return { state, resources, async: rig.asyncAccess.inspect(), actualGl: rig.trace.snapshot() };
}
async function replay(gl, bridge, fixtures, c, label, schedule, display) {
  const rig = makeRig(gl,bridge,c,{schedule}), initialization = initialize(rig,fixtures,c), submissions = [], frames = [], lifecycleEvents=[];
  let packetCount=0;
  for (let index=0; index<EVENTS.length; index++) {
    const event=EVENTS[index], source=fixtures.commands.submissions.find((s)=>s.event===event), bytes=Uint8Array.from(source.data);
    if (event===249) for (const action of fixtures.lifecycle.filter((e)=>e.event<249)) { lifecycle(rig,action,c); lifecycleEvents.push(action); }
    const commandHeaders=headers(bytes,c,`${label} ${event}`); c.equal(commandHeaders.length,COUNTS[index],"original independent packet count"); packetCount+=commandHeaders.length;
    const result=await execute(rig,bytes,c,`${label} ${event}`,{provenance:{sourceSha256:source.sourceSha256,event,contextId:2}});
    c.equal(result.result.appliedCommands,COUNTS[index],"original all commands applied");
    const phase=[161,185,209].indexOf(event), readPhase=[173,197,221].indexOf(event);
    c.equal(result.result.draws.length,phase<0?0:1,"original draw result count");
    submissions.push({event,sourceSha256:source.sourceSha256,byteLength:bytes.length,commands:commandHeaders,...result});
    if (phase>=0) {
      const draw=result.result.draws[0],call=rig.trace.calls.at(-1);
      c.same([call.mode,call.count,call.type,call.offset],[gl.TRIANGLES,6,gl.UNSIGNED_SHORT,0],"original actual indexed GPU draw");
      c.same([draw.actualMinIndex,draw.actualMaxIndex,draw.indexByteLength],[0,3,12],"original staged index bounds");
      frames.push({phase,event,draw,actualGlCall:call,bindings:c.ok(rig.renderer.inspect(2),"original actual reflection")});
    }
    if (readPhase>=0) {
      const image=rig.ram.get(7).slice(OFFSETS[readPhase],OFFSETS[readPhase]+4096),ex=rig.exchanges.at(-1);
      c.same([ex.status,ex.resource.id,ex.layout.offset,ex.layout.rowBytes,ex.layout.rowCount,ex.layout.rowStride],["needs-output",7,OFFSETS[readPhase],128,32,128],"original precise output rows");
      Object.assign(frames[readPhase],{readback:{event,stagingResourceId:7,offset:OFFSETS[readPhase],byteLength:4096,rgbaSha256:await sha(image)},pixels:pixelOracle(image,EXPECTED[readPhase],c,`${label} phase ${readPhase}`)});
      if(display)tile(image,`Async phase ${readPhase}: 256 literal pixels`);
    }
    c.equal(gl.getError(),gl.NO_ERROR,"original asynchronous GL errors");
  }
  for(const action of fixtures.lifecycle.filter((e)=>e.event>249)){lifecycle(rig,action,c);lifecycleEvents.push(action);}
  c.equal(packetCount,210,"all original packets");c.equal(rig.trace.calls.length,3,"three original actual draws");
  c.truth(rig.pendingHeartbeats>0,"browser heartbeat progresses while jobs pending");
  c.same(rig.translations.map((t)=>[t.stage,t.text]),[["vertex",fixtures.commands.shaders.VERT],["fragment",fixtures.commands.shaders.FRAG]],"exact original TGSI inputs");
  const sequencing=rig.trace.snapshot();c.equal(sequencing.pboReads,3,"three real asynchronous texture PBO readbacks");c.equal(sequencing.stagedCopies,3,"three real index staging copies");
  const cleanup=dispose(rig,c,label);
  return {packetCount,gpuDraws:3,checkedPixels:768,initialization,submissions,frames,translations:rig.translations,lifecycle:lifecycleEvents,sequencing,heartbeatTicks:rig.pendingHeartbeats,exchanges:rig.exchanges,glTrace:rig.trace.events,cleanup};
}
function transferPacket(id, { width=3,height=2,x=1,y=0,offset=7,stride=20,direction=1 }={}) {
  return packet(43,0,[id,0,0,stride,0,x,y,0,width,height,1,offset,direction]);
}
function synthetic(rig,c,id=90,width=8,height=2,bytes=64) {
  c.ok(rig.store.createContext(2),"synthetic resource context");c.ok(rig.renderer.createContext(2),"synthetic renderer context");
  const meta={id,target:2,format:67,bind:10,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0};
  c.ok(rig.store.createResource(meta),"synthetic texture");c.ok(rig.store.attachContext(2,id),"synthetic membership");
  c.ok(rig.store.attachBacking(id,[new Uint8Array(8),new Uint8Array(bytes-8)]),"synthetic split-pixel SG identity");
  rig.ram.set(id,new Uint8Array(bytes).fill(0xa5));rig.identities.set(id,c.ok(rig.asyncAccess.describeBacking(id),"synthetic attach-time identity"));return meta;
}
async function rowAttacks(gl,bridge,c) {
  const reports=[];
  for(const stride of [20,0]) {
    const rig=makeRig(gl,bridge,c),meta=synthetic(rig,c),ram=rig.ram.get(90),actualStride=stride||32;
    const input=Uint8Array.from({length:24},(_,i)=>(i*7+17)&255);
    ram.set(input.subarray(0,12),7);ram.set(input.subarray(12),7+actualStride);
    await execute(rig,transferPacket(90,{stride}),c,"fresh nonzero offset subbox upload");
    ram.fill(0xa5);
    await execute(rig,transferPacket(90,{stride,direction:2}),c,"padded subbox output");
    const out=rig.exchanges.at(-1);c.same([out.layout.offset,out.layout.rowBytes,out.layout.rowCount,out.layout.rowStride,out.layout.requiredEnd],[7,12,2,actualStride,19+actualStride],"independent exact row descriptor");
    c.same(out.bytes,[...input],"actual GPU subbox bytes");
    const expected=new Uint8Array(64).fill(0xa5);expected.set(input.subarray(0,12),7);expected.set(input.subarray(12),7+actualStride);
    c.same([...ram],[...expected],"only acknowledged destination rows changed; padding preserved");
    c.truth(c.ok(rig.store.readBacking(90,0,64),"private readback copy untouched").bytes.every((v)=>v===0),"async output never scatters private backing");
    c.ok(rig.store.detachBacking(90),"exact fit detach");c.ok(rig.store.attachBacking(90,[new Uint8Array(19+actualStride)]),"exact fit backing");
    rig.ram.set(90,new Uint8Array(19+actualStride));rig.identities.set(90,c.ok(rig.asyncAccess.describeBacking(90),"exact fit new backing identity"));await execute(rig,transferPacket(90,{stride,direction:2}),c,"exact last row excludes padding");
    c.ok(rig.store.detachBacking(90),"short detach");c.ok(rig.store.attachBacking(90,[new Uint8Array(18+actualStride)]),"one byte short backing");
    await execute(rig,transferPacket(90,{stride,direction:2}),c,"one byte short rows",{expectedError:"out-of-bounds"});
    reports.push({stride,meta,output:out,cleanup:dispose(rig,c,"row layout")});
  }
  return reports;
}
async function ownershipAttacks(gl,bridge,fixtures,c) {
  const rig=makeRig(gl,bridge,c,{schedule:1});initialize(rig,fixtures,c);
  const first=raw(fixtures,161),draw=first.slice(5684),reports=[];
  const badBegin=c.bad(rig.renderer.beginSubmission(2,new Uint8Array([...first,0xff])),"malformed tail rejects before any prefix");
  c.equal(rig.trace.calls.length,0,"malformed raw tail cannot draw");c.equal(rig.exchanges.length,0,"malformed raw tail cannot request input");
  const job=c.ok(rig.renderer.beginSubmission(2,first.slice(0,56)),"single upload begin").job;
  const request=c.ok(rig.renderer.step(job),"upload needs fresh input");c.equal(request.status,"needs-input","upload yields input");
  const repeated=c.ok(rig.renderer.step(job),"repeat input observation");c.equal(repeated.request,request.request,"same outstanding input request");c.equal(repeated.appliedCommands,0,"unfulfilled input never advances");
  c.bad(rig.renderer.beginSubmission(2,draw),"overlapping job rejects");
  c.bad(rig.renderer.destroyContext(2),"active context destruction requires cancellation","busy");
  c.bad(rig.renderer.provideInput({},request.request.token,new Uint8Array(64)),"foreign job rejected");
  c.bad(rig.renderer.provideInput(job,{},new Uint8Array(64)),"foreign input token rejected");
  c.bad(rig.renderer.provideInput(job,request.request.token,new Uint8Array(63)),"wrong dense input length rejected");
  const input=dense(rig.ram.get(3),request.request.layout);c.ok(rig.renderer.provideInput(job,request.request.token,input),"correct input after rejected tokens");input.fill(255);
  c.equal(rig.renderer.inspect().jobs.inputBytes,64,"upload-ready owned input byte budget");
  c.bad(rig.renderer.provideInput(job,request.request.token,new Uint8Array(64)),"duplicate input consumption rejected");
  await nextTask(rig);await drain(rig,job,c);c.bad(rig.renderer.step(job),"completed job single use");c.bad(rig.renderer.cancel(job),"completed job cannot cancel another job");
  // A completed vertex upload is independent of the now-mutated caller buffer.
  await execute(rig,first.slice(56),c,"remaining first original submission");
  await execute(rig,raw(fixtures,173),c,"first actual output ownership",{onYield:async(state,active)=>{
    if(state.status!=="needs-output")return false;
    const q=state.request,again=c.ok(rig.renderer.step(active),"repeat output observation");
    c.equal(again.request,q,"same outstanding output request");c.equal(again.appliedCommands,state.appliedCommands,"unacknowledged output never advances");
    c.equal(rig.renderer.inspect().jobs.outputBytes,4096,"outstanding output byte budget");c.bad(rig.renderer.acknowledgeOutput(active,{}),"foreign output acknowledgment rejected");
    scatter(rig.ram.get(q.resource.id),q.layout,q.bytes);c.ok(rig.renderer.acknowledgeOutput(active,q.token),"valid output acknowledgment");
    c.bad(rig.renderer.acknowledgeOutput(active,q.token),"duplicate output acknowledgment rejected");return true;
  }});
  pixelOracle(rig.ram.get(7).slice(64,4160),EXPECTED[0],c,"owned input survives caller mutation");
  // Mutation of actual storage between staging and draw must never use old validated indices.
  let changed=false,before=rig.trace.calls.length;
  const mutation=await execute(rig,draw,c,"index revision race",{expectedError:"stale-storage",onYield:async(state)=>{
    if(!changed&&state.status==="waiting-gpu"&&rig.asyncAccess.inspect().reads>0){
      const upload={opcode:43,fields:{resourceHandle:4,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:12,height:1,depth:1},dataOffset:0,direction:1}};
      c.ok(rig.store.writeBacking(4,0,new Uint8Array([4,0,1,0,2,0,2,0,1,0,3,0])),"revision race writes private backing");
      c.ok(rig.store.executeTransfer(c.ok(rig.store.prepareTransfer(2,upload),"revision race prepare").ticket),"revision race actual GPU upload");changed=true;
    }return false;
  }});
  c.truth(changed,"actual live index contents changed while staging pending");c.equal(rig.trace.calls.length,before,"stale staged indices cannot issue a draw");
  await execute(rig,first.slice(56,112),c,"restore actual index from fresh RAM");await execute(rig,draw,c,"valid draw after stale-index rejection");
  // Positive offset selects the original second triangle and stages exactly those bytes.
  await execute(rig,first.slice(4848,4884),c,"blue clear before nonzero index offset");
  await execute(rig,packet(11,0,[4,2,6]),c,"nonzero index offset binding");
  const three=draw.slice();word(three,8,3);
  const offset=await execute(rig,three,c,"nonzero index offset draw");
  c.same([rig.trace.calls.at(-1).count,rig.trace.calls.at(-1).offset],[3,6],"actual nonzero indexed draw arguments");
  c.same([offset.result.draws[0].actualMinIndex,offset.result.draws[0].actualMaxIndex],[1,3],"nonzero offset staged actual bounds");
  await execute(rig,raw(fixtures,173),c,"nonzero offset pixels");
  const image=rig.ram.get(7).slice(64,4160);
  for(const [x,y,color] of [[8,8,[0,0,255,255]],[24,24,[255,255,0,255]]]) c.same([...image.slice((y*32+x)*4,(y*32+x)*4+4)],color,"nonzero offset independent triangle pixel");
  reports.push({malformedCode:badBegin.error.code,mutation,nonzeroOffset:offset});
  return {reports,cleanup:dispose(rig,c,"ownership")};
}
async function lifecycleAttacks(gl,bridge,fixtures,c) {
  const reports=[];
  for(const point of ["needs-input","waiting-index","waiting-transfer","needs-output"]) {
    const rig=makeRig(gl,bridge,c,{schedule:1});initialize(rig,fixtures,c);
    const first=raw(fixtures,161);
    if(point!=="needs-input") await execute(rig,first,c,"cancel setup original draw");
    const bytes=point==="needs-input"?first.slice(0,56):point==="waiting-index"?first.slice(5684):raw(fixtures,173);
    let cancelled=false,oldRequest;
    const job=await execute(rig,bytes,c,"cancel at "+point,{expectedError:"cancelled",onYield:async(state,token)=>{
      const phase=rig.renderer.inspect().jobs.status;
      if(!cancelled&&(state.status===point||phase===point)) {
        oldRequest=state.request; c.ok(rig.renderer.cancel(token),"cancel outstanding "+point);
        c.bad(rig.renderer.cancel(token),"duplicate cancellation rejected");cancelled=true;
        if(oldRequest) c.bad(rig.renderer.provideInput(token,oldRequest.token,new Uint8Array(64)),"cancel revokes request identity");
        return true;
      }return false;
    }});
    c.truth(cancelled,"reached selected cancellation point "+point);
    c.equal(rig.renderer.inspect().jobs.active,0,"cancel drained active job");c.equal(rig.asyncAccess.inspect().stagingBytes,0,"cancel drained staging bytes");
    await execute(rig,new Uint8Array(),c,"empty job recovers after cancellation");
    c.ok(rig.renderer.destroyContext(2),"context destroy after cancel drain");c.ok(rig.store.destroyContext(2),"resource context destroy after drain");
    c.ok(rig.store.createContext(2),"reuse resource context ID");c.ok(rig.renderer.createContext(2),"reuse renderer context ID");
    await execute(rig,new Uint8Array(),c,"new context generation empty job");
    reports.push({point,job,cleanup:dispose(rig,c,"cancel "+point)});
  }
  for(const mutation of ["backing","membership","resource","context","output-backing"]) {
    const rig=makeRig(gl,bridge,c);synthetic(rig,c);let changed=false,oldRequest,oldGeneration;
    if(mutation==="output-backing") await execute(rig,transferPacket(90),c,"stale output setup upload");
    const job=await execute(rig,transferPacket(90,{direction:mutation==="output-backing"?2:1}),c,"stale "+mutation,{expectedError:mutation==="context"?"stale-context":"stale-ticket",onYield:async(state,token)=>{
      if(changed||!state.status.startsWith("needs-"))return false;
      oldRequest=state.request;oldGeneration=oldRequest.resource.generation;
      if(mutation==="backing"||mutation==="output-backing") {c.ok(rig.store.detachBacking(90),"detach suspended backing");c.ok(rig.store.attachBacking(90,[new Uint8Array(64)]),"reattach new backing generation");}
      else if(mutation==="membership") {c.ok(rig.store.detachContext(2,90),"detach membership");c.ok(rig.store.attachContext(2,90),"reattach membership new identity");}
      else if(mutation==="resource") {
        c.ok(rig.store.unref(90),"remove suspended public ID");
        c.ok(rig.store.createResource({id:90,target:2,format:67,bind:10,width:8,height:2,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),"replace same public resource ID");
        c.ok(rig.store.attachContext(2,90),"replacement membership");c.ok(rig.store.attachBacking(90,[new Uint8Array(64)]),"replacement backing");
        c.truth(rig.store.inspect().resources.find((r)=>r.id===90&&r.public).generation!==oldGeneration,"replacement storage has fresh generation");
      } else {c.ok(rig.store.destroyContext(2),"external resource context destroy");c.ok(rig.store.createContext(2),"external resource context reuse");}
      const rejected=state.status==="needs-input"?rig.renderer.provideInput(token,oldRequest.token,new Uint8Array(24)):rig.renderer.acknowledgeOutput(token,oldRequest.token);
      c.bad(rejected,"stale request cannot advance "+mutation);changed=true;return true;
    }});
    c.truth(changed,"identity changed at suspension "+mutation);
    c.equal(rig.ram.get(90).every((b)=>b===0xa5),true,"stale output never scatters to simulated RAM");
    reports.push({mutation,oldGeneration,job,cleanup:dispose(rig,c,"stale "+mutation)});
  }
  for(const bytes of [new Uint8Array(),packet(44,0,[])]) {
    const rig=makeRig(gl,bridge,c,{schedule:1});synthetic(rig,c);
    const token=c.ok(rig.renderer.beginSubmission(2,bytes),"zero GPU serial job").job;
    c.equal(c.ok(rig.renderer.step(token),"initial completion fence").status,"waiting-gpu","empty or END-only job must fence");
    c.ok(rig.renderer.cancel(token),"cancel before zero-serial final signal");
    await nextTask(rig);
    const pending=c.ok(rig.renderer.step(token),"cancelled zero-serial pending fence");
    c.equal(pending.status,"waiting-gpu","cancellation cannot mistake serial zero for a signaled fence");
    await nextTask(rig);const result=await drain(rig,token,c,{expectedError:"cancelled"});
    reports.push({zeroSerialCommands:bytes.length?1:0,result,cleanup:dispose(rig,c,"zero-serial cancellation")});
  }
  // Disposing either owner is terminal and cannot leave a resurrectable job.
  for(const order of ["renderer-first","store-first"]) {
    const rig=makeRig(gl,bridge,c);synthetic(rig,c);
    await execute(rig,transferPacket(90),c,"dispose setup upload");
    const token=c.ok(rig.renderer.beginSubmission(2,transferPacket(90,{direction:2})),"dispose pending read begin").job;
    const state=c.ok(rig.renderer.step(token),"dispose staged read");c.equal(state.status,"waiting-gpu","disposal occurs with real staged GPU work");
    if(order==="store-first")c.ok(rig.store.dispose(),"store first disposal");
    c.ok(rig.renderer.dispose(),"dispose cancels active renderer job");
    c.bad(rig.renderer.step(token),"disposed job cannot resume");c.bad(rig.renderer.beginSubmission(2,new Uint8Array()),"disposed renderer cannot start");
    reports.push({order,cleanup:dispose(rig,c,"pending disposal "+order)});
  }
  return reports;
}
async function budgetAndFaultAttacks(gl,bridge,fixtures,c) {
  const reports=[];
  {
    const rig=makeRig(gl,bridge,c,{jobLimits:{commandsPerStep:2}});synthetic(rig,c);
    const noops=packet(44,0,[]),bytes=new Uint8Array(4*7);for(let i=0;i<7;i++)bytes.set(noops,i*4);
    const result=await execute(rig,bytes,c,"deterministic command budget");
    c.same(result.states.slice(0,3).map((s)=>[s.status,s.appliedCommands]),[["ready",2],["ready",4],["ready",6]],"no-readback submission yields at command budget");
    const max=new Uint8Array(262144);word(max,0,44+65535*65536);
    await execute(rig,max,c,"maximum raw submission bytes");
    c.bad(rig.renderer.beginSubmission(2,new Uint8Array(262148)),"submission byte limit plus four rejected");
    const tooMany=new Uint8Array(4097*4);for(let i=0;i<4097;i++)tooMany.set(noops,i*4);
    c.bad(rig.renderer.beginSubmission(2,tooMany),"whole decode command limit rejects");
    for(const jobLimits of [{jobs:2},{commandsPerStep:0},{commandsPerStep:65},{submissionBytes:262145},{transferBytes:4194305},{unknown:1}]) c.bad(createVirglAsyncRenderer({...rig.config,jobLimits}),"invalid bounded job limits","invalid-input");
    const {asyncAccess,...without}=rig.config;c.bad(createVirglAsyncRenderer(without),"async capability required","invalid-input");
    reports.push({commandBudget:result,largestSubmissionBytes:262144,cleanup:dispose(rig,c,"job byte and command budgets")});
  }
  for(const jobLimits of [{jobs:0},{submissionBytes:3},{transferBytes:23}]) {
    const rig=makeRig(gl,bridge,c,{jobLimits});synthetic(rig,c);
    if(jobLimits.transferBytes===23)await execute(rig,transferPacket(90),c,"transfer byte quota",{expectedError:"limit-exceeded"});
    else c.bad(rig.renderer.beginSubmission(2,packet(44,0,[])),"disabled or too-small job byte quota","limit-exceeded");
    reports.push({jobLimits,cleanup:dispose(rig,c,"quota rejection")});
  }
  {
    const rig=makeRig(gl,bridge,c,{jobLimits:{transferBytes:24}});synthetic(rig,c);
    await execute(rig,transferPacket(90),c,"exact dense transfer byte quota");
    await execute(rig,transferPacket(90,{direction:2}),c,"exact dense output byte quota");
    reports.push({transferBytes:24,cleanup:dispose(rig,c,"exact transfer quota")});
  }
  for(const fault of ["nullBuffer","nullSync","waitFailed","lost"]) {
    const rig=makeRig(gl,bridge,c);synthetic(rig,c);
    await execute(rig,transferPacket(90),c,"fault baseline upload");
    let injected=false;
    if(fault==="nullBuffer"||fault==="nullSync"){rig.trace.control[fault]=true;injected=true;}
    const result=await execute(rig,transferPacket(90,{direction:2}),c,"trusted host fault "+fault,{expectedError:"backend-error",expectedGpuComplete:fault==="waitFailed"||fault==="lost"?false:true,onYield:async(state)=>{
      if(!injected&&state.status==="waiting-gpu"){rig.trace.control[fault]=true;injected=true;}return false;
    }});
    rig.trace.control.lost=false;c.truth(injected,"trusted fault reached "+fault);
    await execute(rig,transferPacket(90,{direction:2}),c,"actual GPU recovery after trusted fault "+fault);
    reports.push({fault,trustedFaultControl:true,result,cleanup:dispose(rig,c,"trusted fault "+fault)});
  }
  return reports;
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
async function contextAndQuotaAttacks(gl,bridge,fixtures,c) {
  const rig=makeRig(gl,bridge,c),first=raw(fixtures,161),draw=first.slice(5684);initialize(rig,fixtures,c);
  await execute(rig,first,c,"context A setup");
  c.ok(rig.store.createContext(3),"context B resource owner");c.ok(rig.renderer.createContext(3),"context B renderer owner");
  for(const meta of fixtures.resources){c.ok(rig.store.createResource({...meta,id:meta.id+100}),"B separate storage");c.ok(rig.store.attachContext(3,meta.id+100),"B membership");}
  for(const backing of fixtures.backing){
    const id=backing.resourceId+100,length=backing.iovLengths.reduce((a,b)=>a+b,0);
    c.ok(rig.store.attachBacking(id,backing.iovLengths.map((n)=>new Uint8Array(n))),"B zero SG attachment");
    rig.ram.set(id,new Uint8Array(length));rig.identities.set(id,c.ok(rig.asyncAccess.describeBacking(id),"B attach-time identity"));
    for(const range of backing.ranges)rig.ram.get(id).set(range.data,range.offset);
  }
  const b=first.slice();
  for(const [offset,id] of [[4,103],[60,104],[4740,106],[4784,107],[4804,105],[5100,106],[5644,104],[5668,103],[5680,103]])word(b,offset,id);
  ORANGE.forEach((value,index)=>word(b,5348+index*4,value));
  await execute(rig,b,c,"context B same handles different resources",{contextId:3});
  const sub=b.slice(4112);BLUE.forEach((value,index)=>word(sub,5348-4112+index*4,value));
  await execute(rig,packet(29,0,[2]),c,"B create subcontext2",{contextId:3});await execute(rig,sub,c,"B subcontext2 same handles",{contextId:3});
  const switches=[];
  for(const [ctx,subcontext,delta,expected,label] of [[2,1,0,EXPECTED[0],"A"],[3,1,100,EXPECTED[1],"B1"],[2,1,0,EXPECTED[0],"A"],[3,2,100,BLUE_EXPECTED,"B2"],[2,1,0,EXPECTED[0],"A"]]){
    await execute(rig,packet(28,0,[subcontext]),c,"select "+label,{contextId:ctx});let undo,poisoned=false;
    await execute(rig,draw,c,"suspended poisoned "+label,{contextId:ctx,onYield:async(state)=>{
      if(!poisoned&&state.status==="waiting-gpu"&&rig.renderer.inspect().jobs.status==="waiting-index"){
        undo=poison(gl);c.equal(gl.getError(),gl.NO_ERROR,"host poison establishes valid state");
        c.bad(rig.renderer.restoreContext(ctx===2?3:2),"suspended job prevents external renderer context switch","busy");
        poisoned=true;
      }return false;
    }});undo();c.truth(poisoned,"poison occurred during staged index wait");
    const read=raw(fixtures,173);if(delta){word(read,4108,5+delta);word(read,4152,7+delta);}
    await execute(rig,read,c,"context output "+label,{contextId:ctx});
    pixelOracle(rig.ram.get(7+delta).slice(64,4160),expected,c,"async isolated "+label);switches.push({contextId:ctx,subContextId:subcontext,label});
  }
  const contextCleanup=dispose(rig,c,"asynchronous context and subcontext switching"),quotas=[];
  for(const drawLimits of [{drawsPerSubmission:0},{indicesPerSubmission:0},{drawsPerSubmission:1},{indicesPerSubmission:12}]){
    const test=makeRig(gl,bridge,c,{drawLimits,jobLimits:{commandsPerStep:1}});initialize(test,fixtures,c);await execute(test,first.slice(0,5684),c,"quota original state prefix");
    const count=drawLimits.drawsPerSubmission??Math.floor(drawLimits.indicesPerSubmission/6),bytes=join(...Array.from({length:count+1},()=>draw));
    const result=await execute(test,bytes,c,"whole submission draw quota across yields",{expectedError:"limit-exceeded"});
    c.equal(result.result.appliedCommands,count,"quota error retains successful command prefix");c.equal(result.result.draws.length,count,"quota preserves actual successful draws");c.equal(test.trace.calls.length,count,"quota limits actual GL draw calls");
    c.equal(result.result.error.byteOffset,count*52,"quota error points at original submission offset");
    quotas.push({drawLimits,result,cleanup:dispose(test,c,"whole submission quota")});
  }
  return {switches,contextCleanup,quotas};
}
async function capabilityAttacks(gl,bridge,c) {
  const rig=makeRig(gl,bridge,c);synthetic(rig,c);
  const command=(direction)=>({opcode:43,fields:{resourceHandle:90,level:0,usage:0,stride:20,layerStride:0,box:{x:1,y:0,z:0,width:3,height:2,depth:1},dataOffset:7,direction}});
  const asynchronous=c.ok(rig.asyncAccess.prepareTransfer(2,command(1)),"direct asynchronous prepare");
  c.bad(rig.store.executeTransfer(asynchronous.ticket),"synchronous execute rejects async ticket without consuming","invalid-ticket");
  c.bad(rig.store.cancelTransfer(asynchronous.ticket),"synchronous cancel rejects async ticket without consuming","invalid-ticket");
  c.ok(rig.asyncAccess.validate(asynchronous.ticket),"async ticket survives wrong-owner calls");
  c.bad(rig.asyncAccess.beginTransferRead(asynchronous.ticket),"upload ticket cannot begin readback","invalid-ticket");
  c.bad(rig.asyncAccess.upload(asynchronous.ticket),"upload requires fresh bytes","invalid-ticket");
  const input=Uint8Array.from({length:24},(_,i)=>i+3);
  c.ok(rig.asyncAccess.provideInput(asynchronous.ticket,input),"direct fresh input");
  c.bad(rig.asyncAccess.provideInput(asynchronous.ticket,input),"direct input single use","invalid-ticket");
  c.ok(rig.asyncAccess.upload(asynchronous.ticket),"direct actual upload");
  c.bad(rig.asyncAccess.upload(asynchronous.ticket),"direct actual upload single use","invalid-ticket");
  c.bad(rig.asyncAccess.provideInput(asynchronous.ticket,input),"upload cannot be rearmed","invalid-ticket");
  c.ok(rig.asyncAccess.release(asynchronous.ticket),"release direct upload");c.bad(rig.asyncAccess.release(asynchronous.ticket),"released access single use","invalid-ticket");
  const synchronous=c.ok(rig.store.prepareTransfer(2,command(1)),"direct synchronous prepare");
  c.bad(rig.asyncAccess.validate(synchronous.ticket),"async validate rejects synchronous ticket","invalid-ticket");
  c.bad(rig.asyncAccess.release(synchronous.ticket),"async release rejects synchronous ticket","invalid-ticket");
  c.ok(rig.store.cancelTransfer(synchronous.ticket),"sync owner retains its ticket after wrong-owner calls");
  const read=c.ok(rig.asyncAccess.prepareTransfer(2,command(2)),"direct async output prepare");
  c.bad(rig.asyncAccess.poll(read.ticket),"read cannot poll before issue","invalid-ticket");
  c.bad(rig.asyncAccess.provideInput(read.ticket,input),"read cannot accept upload bytes","invalid-ticket");
  c.ok(rig.asyncAccess.beginTransferRead(read.ticket),"direct actual staged read");
  c.bad(rig.asyncAccess.beginTransferRead(read.ticket),"read cannot issue twice","invalid-ticket");
  c.bad(rig.asyncAccess.poll(read.ticket,1),"discard flag must be boolean","invalid-input");
  let result;
  for(let i=0;i<1000;i++){await nextTask(rig);result=c.ok(rig.asyncAccess.poll(read.ticket),"direct zero-timeout read poll");if(result.status==="ready")break;}
  c.equal(result.status,"ready","direct read eventually signals");c.same([...result.bytes],[...input],"direct actual PBO collection exact bytes");
  c.same([...c.ok(rig.asyncAccess.poll(read.ticket),"ready read may be observed again").bytes],[...input],"ready output cached without duplicate GL collection");
  c.ok(rig.asyncAccess.release(read.ticket),"release direct output");
  const lease=c.ok(rig.store.retainStorage(2,90,"view"),"retained texture lease").lease;
  const region={x:1,y:0,z:0,width:3,height:2,depth:1};
  c.bad(rig.asyncAccess.beginStorageRead({},region),"foreign retained storage lease","invalid-lease");
  const retained=c.ok(rig.asyncAccess.beginStorageRead(lease,region),"retained GPU copy");
  c.ok(rig.store.unref(90),"public unref while retained read pending");
  c.bad(rig.asyncAccess.describeBacking(90),"removed public ID has no DMA identity","missing-resource");
  for(let i=0;i<1000;i++){await nextTask(rig);result=c.ok(rig.asyncAccess.poll(retained.ticket),"retained staging poll");if(result.status==="ready")break;}
  c.equal(result.status,"ready","retained read ready");c.same([...result.bytes],[...input],"retained GPU data survives public unref");
  c.ok(rig.asyncAccess.release(retained.ticket),"release retained staged read");c.ok(rig.store.releaseStorage(lease),"release retained storage generation");
  const cleanup=dispose(rig,c,"capability ownership");
  c.bad(rig.asyncAccess.describeBacking(90),"disposed owner has no DMA identity","disposed");
  const budgets=[];
  for(const resourceLimits of [{gpuBytes:64},{scratchBytes:23},{tickets:0}]) {
    const test=makeRig(gl,bridge,c,{resourceLimits});synthetic(test,c);
    await execute(test,transferPacket(90,{direction:2}),c,"async resource budget rollback",{expectedError:"limit-exceeded"});
    c.equal(test.asyncAccess.inspect().stagingBytes,0,"failed preparation has no staging allocation");
    c.equal(test.store.inspect().budgets.scratchBytes,0,"failed preparation returns scratch budget");
    budgets.push({resourceLimits,cleanup:dispose(test,c,"resource quota rollback")});
  }
  return {cleanup,budgets};
}
async function finalCoverage(gl,bridge,fixtures,c) {
  const reports=[];
  for(const fault of ["allocation","GPU budget"]) {
    const rig=makeRig(gl,bridge,c,fault==="GPU budget"?{resourceLimits:{gpuBytes:4188}}:{});initialize(rig,fixtures,c);
    await execute(rig,raw(fixtures,161).slice(0,5684),c,"index fault complete original state");
    const before=rig.store.inspect().resources.find((r)=>r.id===4).references;
    if(fault==="allocation")rig.trace.control.nullBuffer=true;
    const result=await execute(rig,raw(fixtures,161).slice(5684),c,"index staging "+fault+" rollback",{expectedError:fault==="allocation"?"backend-error":"limit-exceeded"});
    c.equal(rig.trace.calls.length,0,"failed index stage cannot draw");c.equal(rig.store.inspect().resources.find((r)=>r.id===4).references,before,"failed index stage restores extra storage reference");
    c.equal(rig.store.inspect().budgets.scratchBytes,0,"failed index stage returns scratch");c.equal(rig.asyncAccess.inspect().stagingBytes,0,"failed index stage returns GPU staging budget");
    reports.push({fault,result,cleanup:dispose(rig,c,"index staging rollback")});
  }
  {
    const rig=makeRig(gl,bridge,c);synthetic(rig,c);
    c.ok(rig.store.createResource({id:91,target:0,format:64,bind:16,width:17,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),"other-data vertex buffer");
    c.ok(rig.store.attachContext(2,91),"other-data membership");c.ok(rig.store.attachBacking(91,[new Uint8Array(5),new Uint8Array(12)]),"other-data SG");
    const expected=Uint8Array.from({length:17},(_,i)=>(11+i*13)&255);rig.ram.set(91,expected.slice());rig.identities.set(91,c.ok(rig.asyncAccess.describeBacking(91),"other-data identity"));
    await execute(rig,transferPacket(91,{x:0,width:17,height:1,offset:0,stride:0}),c,"other-data actual upload");rig.ram.get(91).fill(0);
    await execute(rig,transferPacket(91,{x:0,width:17,height:1,offset:0,stride:0,direction:2}),c,"other-data actual staged read");
    c.same([...rig.ram.get(91)],[...expected],"actual non-index staging bytes");
    const copy=rig.trace.events.find((e)=>e.name==="copyBufferSubData");c.same([copy.sourceClass,copy.destinationClass],[gl.ARRAY_BUFFER,gl.ARRAY_BUFFER],"non-index staging first bindings use other-data class");
    reports.push({nonIndexCopy:copy,cleanup:dispose(rig,c,"other-data staging")});
  }
  {
    const rig=makeRig(gl,bridge,c);synthetic(rig,c);
    const token=c.ok(rig.renderer.beginSubmission(2,new Uint8Array()),"empty outstanding completion").job;
    c.equal(c.ok(rig.renderer.step(token),"empty final fence issued").status,"waiting-gpu","empty final sync exists");c.equal(rig.trace.syncs.size,1,"one actual final completion sync");
    c.ok(rig.renderer.dispose(),"dispose outstanding final sync");c.equal(rig.trace.syncs.size,0,"dispose deletes final completion sync");
    reports.push({cleanup:dispose(rig,c,"outstanding final sync disposal")});
  }
  {
    const rig=makeRig(gl,bridge,c);synthetic(rig,c);rig.trace.control.nullSync=true;
    const result=await execute(rig,transferPacket(999),c,"semantic failure and unavailable completion fence",{expectedError:"missing-resource",expectedGpuComplete:false});
    c.equal(result.result.appliedCommands,0,"failed fence preserves original semantic prefix");reports.push({result,cleanup:dispose(rig,c,"failed failure-fence")});
  }
  {
    const trace=instrument(gl,c),backend=c.ok(createWebGL2TransferBackend(trace.gl),"direct backend lifecycle").backend;
    const meta={id:1,kind:"texture",format:67,width:2,height:2,byteLength:16,lastLevel:0};
    const storage=backend.allocate(meta),layout={box:{x:0,y:0,width:2,height:2},tightBytes:16};
    backend.upload(storage,meta,layout,new Uint8Array([1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255]));
    backend.beginReadback(storage,meta,layout);c.equal(trace.syncs.size,1,"direct backend holds staged read sync");
    backend.dispose();backend.dispose();c.equal(trace.objects.size,0,"direct backend disposal releases pending staging and owned helpers");
    c.equal(gl.getError(),gl.NO_ERROR,"direct backend cleanup GL error");reports.push({directBackendCleanup:trace.snapshot()});
  }
  {
    const rig=makeRig(gl,bridge,c);synthetic(rig,c);
    const command={opcode:43,fields:{resourceHandle:90,level:0,usage:0,stride:20,layerStride:0,box:{x:1,y:0,z:0,width:3,height:2,depth:1},dataOffset:7,direction:1}};
    const upload=c.ok(rig.asyncAccess.prepareTransfer(2,command),"revoked async transfer").ticket;
    const sync=c.ok(rig.store.prepareTransfer(2,command),"synchronous token excluded from tombstones").ticket;
    const lease=c.ok(rig.store.retainStorage(2,90,"view"),"revoked read lease").lease;
    const read=c.ok(rig.asyncAccess.beginStorageRead(lease,{x:0,y:0,z:0,width:2,height:2,depth:1}),"revoked actual staged read").ticket;
    c.ok(rig.store.dispose(),"revoke live asynchronous accesses");c.ok(rig.store.dispose(),"repeated disposal preserves authentic token tombstones");
    c.bad(rig.asyncAccess.release({}),"foreign token rejected after disposal","invalid-ticket");
    c.bad(rig.asyncAccess.release(sync),"synchronous token has no async disposal ownership","invalid-ticket");
    for(const token of [upload,read]){c.ok(rig.asyncAccess.release(token),"authentic revoked token releases once");c.bad(rig.asyncAccess.release(token),"revoked token cannot release twice","invalid-ticket");}
    reports.push({revokedTokens:2,cleanup:dispose(rig,c,"revoked access ownership")});
  }
  {
    const rig=makeRig(gl,bridge,c,{omitStagedBackend:true});synthetic(rig,c);
    const result=await execute(rig,transferPacket(90,{direction:2}),c,"explicit unsupported staged backend",{expectedError:"unsupported-backend"});
    c.equal(rig.trace.events.filter((e)=>e.name==="readPixels:PBO").length,0,"unsupported backend never falls back to synchronous read");
    reports.push({trustedCapabilityOmission:true,result,cleanup:dispose(rig,c,"unsupported staged capability")});
  }
  return reports;
}
export async function runBrowserAcceptance(fixtures,options={}) {
  const c=checker(),canvas=document.getElementById("gpu");c.truth(canvas,"actual GPU canvas");
  const gl=canvas.getContext("webgl2",{antialias:false,preserveDrawingBuffer:true});c.truth(gl,"actual hardware WebGL2 context");
  const bridge=await createVirglShaderBridge(options.bridgeOptions??{});
  const original=await replay(gl,bridge,fixtures,c,"original",0,true);
  const poisoned={...fixtures,referenceOutputSnapshots:fixtures.referenceOutputSnapshots.map((s)=>({...s,data:s.data.map((b)=>b^255)}))};
  const poisonedBytes=poisoned.referenceOutputSnapshots.reduce((n,s)=>n+s.data.length,0);c.equal(poisonedBytes,12288,"all selected reference bytes poisoned");
  const poisonReplay=await replay(gl,bridge,poisoned,c,"poisoned outputs and delayed readiness",1,false);
  c.same(poisonReplay.frames.map((f)=>f.readback.rgbaSha256),original.frames.map((f)=>f.readback.rgbaSha256),"poisoned reference output never enters execution");
  const scheduleSeed=options.scheduleSeed??0x243f6a88;c.truth(Number.isInteger(scheduleSeed)&&scheduleSeed>=2&&scheduleSeed<=0xffffffff,"bounded explicit schedule seed");
  const varied=await replay(gl,bridge,fixtures,c,"seeded readiness withholding",scheduleSeed,false);
  c.same(varied.frames.map((f)=>f.readback.rgbaSha256),original.frames.map((f)=>f.readback.rgbaSha256),"varied delayed schedule identical pixels");
  const rows=await rowAttacks(gl,bridge,c),ownership=await ownershipAttacks(gl,bridge,fixtures,c),lifecycle=await lifecycleAttacks(gl,bridge,fixtures,c),budgets=await budgetAndFaultAttacks(gl,bridge,fixtures,c),contexts=await contextAndQuotaAttacks(gl,bridge,fixtures,c),capabilities=await capabilityAttacks(gl,bridge,c),coverage=await finalCoverage(gl,bridge,fixtures,c);
  c.equal(gl.getError(),gl.NO_ERROR,"final actual hardware GL error");
  return {status:"passed",primaryAsyncReplay:true,guestExecution:false,assertions:c.assertions,
    summary:{status:"passed",originalSubmissions:8,originalPackets:210,actualOriginalGpuDraws:3,originalInteriorPixels:768,readbackOffsets:OFFSETS,referenceOutputPoisonBytes:poisonedBytes,attacks:c.attacks.length,zeroGlErrors:true,guestExecution:false},
    selection:fixtures.selection,original,outputReferencePoison:{bytes:poisonedBytes,hashes:poisonReplay.frames.map((f)=>f.readback.rgbaSha256),cleanup:poisonReplay.cleanup},
    schedules:[{name:"baseline",...original.sequencing},{name:"one withheld signal",...poisonReplay.sequencing},{name:"seeded zero to three withheld signals",seed:scheduleSeed,...varied.sequencing}],rows,ownership,lifecycle,budgets,contexts,capabilities,coverage,attacks:c.attacks};
}
