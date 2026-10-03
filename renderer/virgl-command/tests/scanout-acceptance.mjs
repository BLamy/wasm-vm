// Literal guest packets and independent pixels through real Wasm queues and WebGL2.
import { createVirglShaderBridge } from '../../virgl-shader/index.mjs';
const OK = 0x1100, UNSPEC = 0x1200, OOM = 0x1201, BAD_RESOURCE = 0x1203, BAD_CONTEXT = 0x1204, BAD_PARAMETER = 0x1205;
const hex = (bytes) => [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
const address = (value) => BigInt(value).toString(16).padStart(16, '0');
const json = (value) => JSON.stringify(value, (_, v) => v instanceof Uint8Array ? [...v] : v);
const u32 = (bytes, offset, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
const u16 = (bytes, offset, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
const u64 = (bytes, offset, value) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(offset, BigInt(value), true);
const get16 = (bytes, offset = 0) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
const get32 = (bytes, offset = 0) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
function header(opcode, ctx, length) { const bytes = new Uint8Array(length); u32(bytes, 0, opcode); u32(bytes, 16, ctx); return bytes; }
function context(id) { const bytes = header(0x200, id, 96); u32(bytes, 24, 5); bytes.set([112, 114, 111, 111, 102], 32); return bytes; }
function resource(id, target, format, bind, width, height) {
  const bytes = header(0x204, 0, 72);
  [id, target, format, bind, width, height, 1, 1, 0, 0, 0, 0].forEach((v, i) => u32(bytes, 24 + 4 * i, v)); return bytes;
}
function idCommand(opcode, ctx, id) { const bytes = header(opcode, ctx, 32); u32(bytes, 24, id); return bytes; }
function backing(id, entries) {
  const bytes = header(0x106, 0, 32 + 16 * entries.length); u32(bytes, 24, id); u32(bytes, 28, entries.length);
  entries.forEach(([addr, length], i) => { u64(bytes, 32 + i * 16, addr); u32(bytes, 40 + i * 16, length); }); return bytes;
}
function response(request, type) {
  const bytes = header(type, get32(request, 16), 24), fenced = get32(request, 4) & 1;
  u32(bytes, 4, fenced); if (fenced) bytes.set(request.subarray(8, 16), 8); bytes[20] = request[20]; return bytes;
}
function checker() {
  let assertions = 0, failure = null; const attacks = [];
  const equal = (a, b, label) => { assertions++; if (!Object.is(a, b)) { failure = new Error(`${label}: expected ${json(b)}, got ${json(a)}`); throw failure; } };
  const same = (a, b, label) => equal(json(a), json(b), label);
  const truth = (v, label) => equal(Boolean(v), true, label);
  const ok = (v, label) => { equal(v?.ok, true, `${label}: ${v?.error?.code ?? ''} ${v?.error?.message ?? ''}`); return v; };
  const bad = (v, label, code) => { equal(v?.ok, false, `${label} rejected`); truth(typeof v?.error?.message === 'string', `${label} structured message`); if (code) equal(v.error.code, code, `${label} code`); attacks.push({ name: label, code: v.error.code }); return v; };
  const throws = (fn, label) => { let threw = false; try { fn(); } catch { threw = true; } truth(threw, `${label} throws`); attacks.push({ name: label, code: 'host-input-rejected' }); };
  return { equal, same, truth, ok, bad, throws, attacks, get assertions() { return assertions; }, get failure() { return failure; } };
}

function instrument(gl, c, schedule = 0) {
  const objects = new Map(), buffers = new Map(), syncs = new Map(), events = [], calls = [];
  let nextId = 1, turn = 0, fenceCount = 0, collectCount = 0, drawCount = 0, polls = 0;
  const control = { waitFailed: false, lost: false, nullBuffer: false, nullSync: false, label: "initialization" };
  const id = (value) => value === null ? null : objects.get(value)?.id ?? null;
  const binding = (target) => gl.getParameter(new Map([[gl.ARRAY_BUFFER, gl.ARRAY_BUFFER_BINDING], [gl.UNIFORM_BUFFER, gl.UNIFORM_BUFFER_BINDING],
    [gl.ELEMENT_ARRAY_BUFFER, gl.ELEMENT_ARRAY_BUFFER_BINDING], [gl.COPY_READ_BUFFER, gl.COPY_READ_BUFFER],
    [gl.COPY_WRITE_BUFFER, gl.COPY_WRITE_BUFFER], [gl.PIXEL_PACK_BUFFER, gl.PIXEL_PACK_BUFFER_BINDING],
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


const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
function submission(ctx, commands, fence = null) {
  const raw = header(0x207, ctx, 32 + commands.length); u32(raw, 24, commands.length); raw.set(commands, 32);
  if (fence !== null) { u32(raw, 4, 1); u64(raw, 8, fence); } return raw;
}
function transfer(ctx, id, direction, box, offset = 0n, stride = 0, layerStride = 0, fence = null) {
  const raw = header(direction === 1 ? 0x205 : 0x206, ctx, 72);
  box.forEach((v, i) => u32(raw, 24 + i * 4, v)); u64(raw, 48, offset); u32(raw, 56, id); u32(raw, 64, stride); u32(raw, 68, layerStride);
  if (fence !== null) { u32(raw, 4, 1); u64(raw, 8, fence); } return raw;
}
class Queue {
  constructor(WasmVirglScanoutProof, callback, frameCallback, c, proof = true, portable = false) {
    this.c = c; this.proof = proof; this.portable = portable; this.vm = new WasmVirglScanoutProof(callback, frameCallback, proof); this.base = BigInt('0x' + this.vm.layout().ramBase);
    this.records = []; this.next = 0; this.requestCursor = 0x10000;
    for (const [key, offset] of Object.entries({desc:0x6000,avail:0x8000,used:0x9000,response:0xe0000,backing:0x100000})) this[key] = this.base + BigInt(offset);
    if(portable){this.avail=this.base+0x7000n;this.used=this.base+0x8000n;this.response=this.base+0x14000n;}
    this.configure(); this.negotiate();
  }
  write(addr, data) { this.vm.writeRam(address(addr), data); }
  read(addr, length) { return this.vm.readRam(address(addr), length); }
  configure() {
    this.next = 0; this.requestCursor = 0x10000; this.write(this.avail, new Uint8Array(520)); this.write(this.used, new Uint8Array(2056));
    this.vm.writeMmio(0x30, 0); this.vm.writeMmio(0x38, 256);
    for (const [offset, addr] of [[0x80,this.desc],[0x90,this.avail],[0xa0,this.used]]) { this.vm.writeMmio(offset, Number(addr & 0xffffffffn)); this.vm.writeMmio(offset+4,Number(addr>>32n)); }
    this.vm.writeMmio(0x44,1);
  }
  negotiate() {
    this.vm.writeMmio(0x70,3); this.vm.writeMmio(0x24,0); this.vm.writeMmio(0x20,this.proof?1:0);
    this.vm.writeMmio(0x24,1); this.vm.writeMmio(0x20,1); this.vm.writeMmio(0x70,11); this.vm.writeMmio(0x70,15);
  }
  descriptor(index, addr, length, flags, next) {
    const raw = new Uint8Array(16); u64(raw,0,addr); u32(raw,8,length); u16(raw,12,flags); u16(raw,14,next); this.write(this.desc + BigInt(index*16),raw);
  }
  usedIndex() { return get16(this.read(this.used+2n,2)); }
  enqueue(label, request, expected = OK, responseCapacity = 24) {
    const number=this.next, head=this.portable?0:(number%128)*2, requestAddress=this.base+BigInt(this.portable?0x10000:this.requestCursor), responseAddress=this.response+BigInt(this.portable?0:(number%128)*64);
    this.requestCursor += (request.length+63)&~63; this.c.truth(this.requestCursor < 0xd0000,'bounded copied request fixtures');
    this.write(requestAddress,request); this.write(responseAddress,new Uint8Array(64).fill(0xa5));
    this.descriptor(head,requestAddress,request.length,1,head+1); this.descriptor(head+1,responseAddress,responseCapacity,2,0);
    const value=new Uint8Array(2); u16(value,0,head); this.write(this.avail+4n+BigInt((number%256)*2),value); this.next++;
    u16(value,0,this.next); this.write(this.avail+2n,value);
    return {label,request:new Uint8Array(request),requestAddress,responseAddress,head,number,expected,responseCapacity};
  }
  kick() { this.vm.writeMmio(0x50,0); }
  run() { const r=this.vm.run1(); this.c.equal(r.outcome,'MaxInstrs','actual Machine.run boundary'); this.lastRun=r; return r; }
  collect(entry) {
    const got=this.read(entry.responseAddress,24), used=this.read(this.used+4n+BigInt((entry.number%256)*8),8);
    this.c.equal(get32(used),entry.head,`${entry.label} ordered used head`); this.c.equal(get32(used,4),entry.responseCapacity<24?0:24,`${entry.label} full response length`);
    this.c.equal(hex(got),entry.responseCapacity<24?'a5'.repeat(24):hex(response(entry.request,entry.expected)),`${entry.label} exact fence response`);
    this.c.equal(hex(this.read(entry.responseAddress+24n,40)),'a5'.repeat(40),`${entry.label} response guard`);
    const state=this.vm.inspect(), submit=this.vm.submitState(), scanout=this.vm.scanoutState();
    const record={case:entry.label,request:hex(entry.request),response:hex(got),usedIndex:entry.number+1,
      ring:{descriptors:hex(this.read(this.desc+BigInt(entry.head*16),32)),avail:hex(this.read(this.avail,520)),used:hex(this.read(this.used,2056))},
      machineDigest:(this.portable || /original submit (173|197|221)/.test(entry.label)) ? (this.vm.machineDigest ? this.vm.machineDigest() : this.lastRun.machineDigest) : null,transportCanonical:state?hex(state.canonicalBytes):'',transportDigest:state?.digest??'',submitCanonical:submit?hex(submit.canonicalBytes):'',submitDigest:submit?.digest??'', scanoutCanonical:scanout?hex(scanout.canonicalBytes):'',scanoutDigest:scanout?.digest??''};
    this.records.push(record); return record;
  }
  reset() { this.vm.writeMmio(0x70,0); this.run(); this.configure(); this.negotiate(); }
}
function makeRig(api, gl, shaderBridge, c, schedule=1, portable=false, extra={}) {
  const trace=instrument(gl,c,schedule),events=[],completions=[],callbacks=new Map();let q,number=0;
  const canvas=document.createElement('canvas');canvas.width=3;canvas.height=2;canvas.style.width='240px';canvas.style.height='160px';canvas.style.imageRendering='pixelated';document.querySelector('#draws').append(canvas);
  const presenter=c.ok(api.createVirglScanoutPresenter({canvas,requestFrame(fn){const id=++number;callbacks.set(id,fn);return id;},cancelFrame(id){callbacks.delete(id);},controllerOptions:{defaultBackend:'canvas2d'}}),'built presenter').presenter;
  const host=c.ok(api.createVirglScanoutBridge({gl:trace.gl,shaderBridge,presenter:extra.presenter ? extra.presenter(presenter) : presenter,...(extra.resourceLimits ? {resourceLimits:extra.resourceLimits} : {}),transport:{
    gatherInput(...args){return q.vm.gatherInput(...args);},scatterOutput(...args){return q.vm.scatterOutput(...args);},
    complete(...args){const before=q.usedIndex();if(args[4])c.truth([...trace.syncs.values()].every(s=>s.signaled),'scanout completion requires signaled GPU work');q.vm.complete(...args);c.equal(q.usedIndex(),before,'mailbox completion does not publish used');completions.push({args,usedIndex:before});}
  }}),'scanout bridge');
  q=new Queue(api.WasmVirglScanoutProof,event=>{events.push(structuredClone(event));return host.bridge.apply(event);},frame=>host.bridge.present2D(frame),c,true,portable);
  const step=async()=>{await turn();trace.nextTurn();const before=q.usedIndex(),result=host.bridge.pump();if(trace.control.oracleFailure)throw trace.control.oracleFailure;c.ok(result,'outside-run scanout pump');c.equal(q.usedIndex(),before,'scanout pump does not publish used');return result;};
  const drain=async()=>{let turns=0;while(q.usedIndex()<q.next){const polls=trace.snapshot().polls;q.run();c.equal(trace.snapshot().polls,polls,'Machine.run does not poll GPU');if(q.usedIndex()>=q.next)break;c.truth(++turns<10000,'bounded scanout wait');await step();}return turns;};
  const expect=async(label,request,expected=OK)=>{const e=q.enqueue(label,request,expected);q.kick();await drain();const record=q.collect(e);q.vm.writeMmio(0x64,1);return record;};
  const paint=async()=>{await new Promise(resolve=>requestAnimationFrame(time=>{const pending=[...callbacks];callbacks.clear();for(const [,fn]of pending)fn(time);resolve();}));c.same(presenter.inspect().errors,[],'presenter has no callback errors');};
  const pixels=()=>new Uint8Array(presenter.canvas.getContext('2d').getImageData(0,0,presenter.canvas.width,presenter.canvas.height).data);
  const dispose=()=>{c.ok(host.bridge.dispose(),'dispose scanout bridge');q.vm.free();c.equal(callbacks.size,0,'no scheduled callback after disposal');c.equal(trace.objects.size,0,'no live GPU allocation after disposal');c.equal(gl.getError(),gl.NO_ERROR,'zero scanout GL errors');};
  return{q,host,trace,events,completions,presenter,callbacks,step,drain,expect,paint,pixels,dispose};
}

async function initialize(rig, fixtures, c) {
  const memory=new Map();let cursor=rig.q.base+0x210000n;
  for(const action of fixtures.initialization) {
    let wire;
    if(action.type==='context_create')wire=context(action.contextId);
    else if(action.type==='resource_create') { const m=action.metadata;wire=resource(m.id,m.target,m.format,m.bind,m.width,m.height); }
    else if(action.type==='ctx_attach_resource')wire=idCommand(0x202,action.contextId,action.resourceId);
    else {
      c.equal(action.type,'resource_attach_iov','original initialization type');
      const entries=action.iovLengths.map(length=>{const entry=[cursor,length];rig.q.write(cursor,new Uint8Array(length));cursor+=BigInt((length+4095)&~4095);return entry;});
      memory.set(action.resourceId,entries);wire=backing(action.resourceId,entries);
    }
    await rig.expect(`initialize event ${action.event}`,wire);
  }
  const write=(id,offset,data)=>{let logical=0,written=0;for(const [address,length]of memory.get(id)){const start=Math.max(offset,logical),end=Math.min(offset+data.length,logical+length);if(end>start){rig.q.write(address+BigInt(start-logical),data.subarray(start-offset,end-offset));written+=end-start;}logical+=length;}c.equal(written,data.length,'initial RAM selection fits original SG');};
  const read=(id,offset,length)=>{const data=new Uint8Array(length);let logical=0,copied=0;for(const [address,size]of memory.get(id)){const start=Math.max(offset,logical),end=Math.min(offset+length,logical+size);if(end>start){data.set(rig.q.read(address+BigInt(start-logical),end-start),start-offset);copied+=end-start;}logical+=size;}c.equal(copied,length,'guest output fits original SG');return data;};
  let selected=0;for(const b of fixtures.backing)for(const range of b.ranges){write(b.resourceId,range.offset,Uint8Array.from(range.data));selected+=range.data.length;}
  c.equal(selected,92,'original fresh CPU selections');return {memory,read,write};
}
async function lifecycle(rig, action, c) {
  let wire;
  if(action.type==='ctx_detach_resource')wire=idCommand(0x203,action.contextId,action.resourceId);
  else if(action.type==='resource_detach_iov')wire=idCommand(0x107,0,action.resourceId);
  else if(action.type==='resource_unref')wire=idCommand(0x102,0,action.resourceId);
  else {c.equal(action.type,'context_destroy','original teardown type');wire=header(0x201,action.contextId,24);}
  return rig.expect(`cleanup event ${action.event}`,wire);
}

function display(op,id,width,height,fence=null,x=0,y=0){const raw=header(op,0,48);[x,y,width,height].forEach((v,i)=>u32(raw,24+i*4,v));u32(raw,op===0x103?44:40,id);if(fence!==null){u32(raw,4,1);u64(raw,8,fence);}return raw;}
function create2d(id,width,height,format=2){const raw=header(0x101,0,40);[id,format,width,height].forEach((v,i)=>u32(raw,24+i*4,v));return raw;}
function transfer2d(id,width,height){const raw=header(0x105,0,56);u32(raw,32,width);u32(raw,36,height);u32(raw,48,id);return raw;}
function fence(raw,value){u32(raw,4,1);u64(raw,8,value);return raw;}
const LITERAL=Uint8Array.from([255,0,0,255, 255,0,0,128, 0,255,0,255, 0,0,255,255, 0,255,0,64, 255,255,0,255]);
const DISPLAYED=[0,0,255,255, 0,255,0,64, 255,255,0,255, 255,0,0,255, 255,0,0,128, 0,255,0,255];
function literalOracle(rig,c,label='scanout canvas') {const bytes=rig.pixels();c.same([...bytes.subarray(0,4)],DISPLAYED.slice(0,4),`${label} top-left RGBA`);c.same([...bytes],DISPLAYED,`${label} channel, alpha and top-down rows`);return {bytes:[...bytes],sha256:null};}
async function uploadLiteral(rig,c,id=3){await rig.expect('literal context',context(2));await rig.expect('literal texture',resource(id,2,67,10,3,2));await rig.expect('literal backing',backing(id,[[rig.q.backing,3],[rig.q.backing+0x1000n,21]]));await rig.expect('literal context attachment',idCommand(0x202,2,id));rig.q.write(rig.q.backing,LITERAL.subarray(0,3));rig.q.write(rig.q.backing+0x1000n,LITERAL.subarray(3));await rig.expect('literal fresh upload',transfer(2,id,1,[0,0,0,3,2,1]));}
async function portable(api,gl,shader,c){const r=makeRig(api,gl,shader,c,1,true);await r.expect('resource',resource(3,2,67,10,2,2));await r.expect('bind',display(0x103,3,2,2,0xffffffffffffffffn));await r.expect('capture',display(0x104,3,2,2,0xffffffffffffffffn));await r.expect('unref',idCommand(0x102,0,3));await r.expect('reuse',resource(3,2,67,10,1,2));await r.expect('stale-capture',display(0x104,3,1,2),BAD_PARAMETER);await r.expect('rebind',display(0x103,3,1,2));await r.expect('recapture',display(0x104,3,1,2));await r.expect('resource2d',create2d(4,2,1));await r.expect('bind2d',display(0x103,4,2,1));await r.expect('flush2d',display(0x104,4,2,1));await r.expect('disable',display(0x103,0,0,0));const result=r.q.records;r.dispose();return result;}
async function literalLifecycle(api,gl,shader,c){
 const r=makeRig(api,gl,shader,c),{q}=r;await uploadLiteral(r,c);await r.expect('literal bind',display(0x103,3,3,2));
 await r.expect('literal FLUSH',display(0x104,3,3,2,0xffffffffffffffffn));
 c.equal(r.presenter.inspect().drawn,0,'guest FLUSH retires before actual draw');c.equal(r.presenter.inspect().pending,1,'one owned frame awaiting animation');c.equal(q.vm.scanoutState().counters.capturesCompleted,'0000000000000001','GPU-ready capture completion counter');
 const owner=r.host.probes.owners();const before=r.host.bridge.inspect().resources.find(x=>x.transport.id===3);await r.expect('detach rendering context before paint',idCommand(0x203,2,3));await r.expect('destroy rendering context before paint',header(0x201,2,24));await r.expect('public unref before paint',idCommand(0x102,0,3));await r.expect('numeric reuse before paint',resource(3,2,67,10,1,2));
 c.equal(owner.store.inspect().budgets.storages,2,'old global generation retained beside reused storage');await r.expect('fresh reused FLUSH is stale',display(0x104,3,1,2),BAD_PARAMETER);
 await r.paint();const oracle=literalOracle(r,c);oracle.sha256=await sha(r.pixels());c.equal(r.presenter.inspect().drawn,1,'actual drawn receipt');c.equal(r.host.bridge.inspect().scanout.retainedFrames,0,'PBO frame released after draw');c.equal(owner.store.inspect().budgets.storages,2,'binding retains old storage until rebind');
 await r.expect('rebind new generation',display(0x103,3,1,2));c.equal(owner.store.inspect().budgets.storages,1,'rebind releases retired old allocation');c.equal(r.presenter.inspect().controller.latest,null,'rebind clears recovery pixels');
 const copies=r.host.bridge.inspect().scanout;c.same([copies.readbackBytes,copies.rgbaConversionBytes,copies.rowMoveBytes,copies.presenter.controllerOwnershipCopyBytes,copies.presenter.backendStagingCopyBytes,copies.presenter.imageDataCopyBytes,copies.presenter.presentationUploadBytes],[24,24,24,24,24,24,24],'literal successful copy accounting');
 const result={oracle,records:q.records,sequencing:r.trace.snapshot(),bridge:r.host.bridge.inspect(),scanoutState:q.vm.scanoutState(),frameDiagnostics:q.vm.frameDiagnostics()};r.dispose();return result;
}
async function capturedDraw(api,gl,shader,fixtures,c){const r=makeRig(api,gl,shader,c);await initialize(r,fixtures,c);const source=fixtures.commands.submissions.find(s=>s.event===161);await r.expect('captured original draw',submission(source.contextId,Uint8Array.from(source.data),161n));c.equal(r.trace.calls.length,1,'original captured actual GPU draw');await r.expect('rendered resource5 bind',display(0x103,5,32,32));await r.expect('rendered resource5 FLUSH',display(0x104,5,32,32,7n));c.equal(r.presenter.inspect().drawn,0,'rendered guest completion precedes paint');await r.paint();const bytes=r.pixels();let checkedPixels=0;for(let quadrant=0;quadrant<4;quadrant++)for(let y=4+16*Math.floor(quadrant/2);y<12+16*Math.floor(quadrant/2);y++)for(let x=4+16*(quadrant%2);x<12+16*(quadrant%2);x++){const at=((31-y)*32+x)*4;c.same([...bytes.subarray(at,at+4)],EXPECTED[0][quadrant],`captured rendered canvas pixel ${x},${31-y}`);checkedPixels++;}const result={event:161,sourceSha256:source.sourceSha256,packets:headers(Uint8Array.from(source.data),c,'captured scanout').length,gpuDraws:r.trace.calls.length,checkedPixels,sha256:await sha(bytes),records:r.q.records,scanout:r.host.bridge.inspect().scanout};r.dispose();return result;}
function hostUpload(owner,c,bytes){c.ok(owner.store.writeBacking(3,0,bytes),'host revision writes backing');const ticket=c.ok(owner.store.prepareTransfer(2,{opcode:43,fields:{resourceHandle:3,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:3,height:2,depth:1},dataOffset:0,direction:1}}),'host revision transfer').ticket;c.ok(owner.store.executeTransfer(ticket),'host revision upload actual GPU');}
async function schedulingAndSwitch(api,gl,shader,c){
 const r=makeRig(api,gl,shader,c),{q}=r;await uploadLiteral(r,c);await r.expect('schedule bind',display(0x103,3,3,2));await r.expect('schedule first flush',display(0x104,3,3,2));
 const before=json(q.vm.scanoutState().binding),pending=r.presenter.inspect().queued;
 for(const [label,wire,expected]of [['cropped scanout',display(0x103,3,2,2),BAD_PARAMETER],['invalid scanout number',(()=>{const w=display(0x103,3,3,2);u32(w,40,1);return w;})(),BAD_PARAMETER],['missing scanout resource',display(0x103,999,3,2),BAD_RESOURCE]]){await r.expect(label,wire,expected);c.equal(json(q.vm.scanoutState().binding),before,`${label} preserves binding`);c.equal(r.presenter.inspect().queued,pending,`${label} preserves pending frame`);c.attacks.push({name:label,code:expected});}
 await r.expect('superseding second flush',display(0x104,3,3,2));c.equal(r.presenter.inspect().superseded,1,'latest frame retires older frame exactly once');c.equal(r.host.bridge.inspect().scanout.retainedFrames,1,'one retained frame after supersession');await r.paint();literalOracle(r,c,'superseded scanout canvas');
 await r.expect('queued frame before valid rebind',display(0x104,3,3,2));await r.expect('valid same resource rebind',display(0x103,3,3,2));c.equal(r.presenter.inspect().cancelled,1,'valid rebind cancels queued frame');c.equal(r.presenter.inspect().controller.latest,null,'rebind clears retained recovery frame');await r.paint();c.truth([...r.pixels()].every(v=>v===0),'no obsolete paint after successful rebind');
 await r.expect('ordinary 2D create',create2d(4,2,1));await r.expect('ordinary 2D backing',backing(4,[[q.backing+0x8000n,8]]));q.write(q.backing+0x8000n,Uint8Array.from([255,0,0,0,0,0,255,0]));await r.expect('ordinary 2D upload',transfer2d(4,2,1));await r.expect('switch to ordinary 2D',display(0x103,4,2,1));await r.expect('ordinary 2D FLUSH',display(0x104,4,2,1));
 c.equal(r.presenter.inspect().pending,1,'2D shares pending display owner');q.write(q.backing+0x8000n,new Uint8Array(8));if(api.wasmMemory)api.wasmMemory.grow(1);await r.paint();c.same([...r.pixels()],[0,0,255,255,255,0,0,255],'ordinary 2D copied BGRA words and opaque X reach canvas after memory growth');
 await r.expect('ordinary 2D unref',idCommand(0x102,0,4));await r.expect('ordinary 2D id reuse',create2d(4,2,1));const draws=r.presenter.inspect().drawn;await r.expect('ordinary 2D unbound FLUSH',display(0x104,4,2,1));c.equal(r.presenter.inspect().pending,0,'unbound 2D flush is accepted without scheduling');await r.paint();c.equal(r.presenter.inspect().drawn,draws,'unbound 2D reused ID cannot paint');c.equal(q.vm.frameDiagnostics().rejected,'0000000000000000','2D callback has no diagnostic failure');
 await r.expect('switch back to renderer',display(0x103,3,3,2));await r.expect('renderer FLUSH after 2D',display(0x104,3,3,2));await r.paint();literalOracle(r,c,'switched back canvas');
 await r.expect('queued before disable',display(0x104,3,3,2));await r.expect('disable scanout',display(0x103,0,0,0));c.equal(r.presenter.inspect().controller.latest,null,'disable clears retained recovery pixels');await r.paint();c.truth([...r.pixels()].every(v=>v===0),'disabled scanout remains clear');
 const result={bridge:r.host.bridge.inspect(),scanoutState:q.vm.scanoutState(),frameDiagnostics:q.vm.frameDiagnostics(),records:q.records};r.dispose();return result;
}
async function immutableSnapshot(api,gl,shader,c){
 const r=makeRig(api,gl,shader,c,3),{q}=r;await uploadLiteral(r,c);await r.expect('immutable bind',display(0x103,3,3,2));const owner=r.host.probes.owners(),resourceRecord=r.host.bridge.inspect().resources.find(v=>v.transport.id===3);
 c.bad(owner.bindings.retainScanout(3,resourceRecord.storageGeneration+1),'wrong global generation','stale-resource');c.bad(owner.asyncAccess.beginScanoutRead({}),'foreign global lease','invalid-lease');
 const normal=c.ok(owner.store.retainStorage(2,3,'view'),'ordinary view lease').lease;c.bad(owner.asyncAccess.beginScanoutRead(normal),'non-scanout lease','invalid-lease');
 const ordinary=c.ok(owner.asyncAccess.beginStorageRead(normal,{x:0,y:0,z:0,width:3,height:2,depth:1}),'ordinary strict read').ticket;
 const entry=q.enqueue('immutable issued capture',display(0x104,3,3,2,7n));q.kick();q.run();await r.step();c.equal(r.host.bridge.inspect().scanout.activeCaptures,1,'capture in flight');const pboCount=r.trace.snapshot().pboReads;c.truth(pboCount>=2,'actual normal and scanout PBO snapshots issued');
 const blue=Uint8Array.from({length:24},(_,i)=>i%4===2||i%4===3?255:0);hostUpload(owner,c,blue);
 c.bad(owner.asyncAccess.validate(ordinary),'normal read still rejects changed content','stale-storage');c.ok(owner.asyncAccess.release(ordinary),'release ordinary read');c.ok(owner.store.releaseStorage(normal),'release ordinary view');
 await r.drain();q.collect(entry);await r.paint();literalOracle(r,c,'immutable issued canvas');
 await r.expect('capture changed contents',display(0x104,3,3,2));await r.paint();c.same([...r.pixels()],[...blue],'next capture sees revised GPU contents');
 const result={bridge:r.host.bridge.inspect(),sequencing:r.trace.snapshot(),records:q.records};r.dispose();return result;
}
async function cancellationAndFaults(api,gl,shader,c){
 const outputs=[];
 for(const mode of ['pending-reset','queued-reset','pending-dispose','allocation-failure','wait-failure']){
  const r=makeRig(api,gl,shader,c,2),{q}=r;await uploadLiteral(r,c);await r.expect(`${mode} bind`,display(0x103,3,3,2));
  if(mode==='allocation-failure')r.trace.control.nullBuffer=true;if(mode==='wait-failure')r.trace.control.waitFailed=true;
  if(mode.endsWith('failure')){await r.expect(mode,display(0x104,3,3,2),UNSPEC);c.truth(r.host.bridge.inspect().poisoned,`${mode} fails closed`);c.equal(r.presenter.inspect().queued,0,`${mode} does not enqueue`);c.attacks.push({name:mode,code:'bridge-poisoned'});q.reset();c.equal(r.host.bridge.inspect().poisoned,false,`${mode} reset recovers`);}
  else if(mode==='queued-reset'){await r.expect(mode,display(0x104,3,3,2));c.equal(r.presenter.inspect().pending,1,'reset case owns queued frame');q.reset();await r.paint();c.equal(r.presenter.inspect().pending,0,'reset cancels queued frame');c.equal(r.presenter.inspect().controller.latest,null,'reset clears recovery frame');}
  else {const entry=q.enqueue(mode,display(0x104,3,3,2));q.kick();q.run();await r.step();c.equal(q.usedIndex(),entry.number,'pending capture response withheld');if(mode==='pending-reset'){q.reset();await r.paint();c.equal(r.host.bridge.inspect().scanout.activeCaptures,0,'reset revokes active capture');c.equal(r.host.bridge.inspect().scanout.retainedFrames,0,'reset releases all capture tickets');}else{c.ok(r.host.bridge.dispose(),'dispose in-flight snapshot');c.equal(r.trace.objects.size,0,'dispose releases active PBO and global lease');}}
  outputs.push({mode,bridge:r.host.bridge.inspect(),sequencing:r.trace.snapshot()});r.dispose();
 }
 return outputs;
}
async function presenterControls(api,c){
 const failures=[],drawn=[];const make=(backend)=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;let cb;const result=api.createVirglScanoutPresenter({canvas,requestFrame(fn){cb=fn;return 1;},cancelFrame(){cb=null;},controllerOptions:{backendFactories:{canvas2d:()=>backend}}});return{presenter:c.ok(result,'fault presenter').presenter,async fire(){await new Promise(resolve=>requestAnimationFrame(time=>{const fn=cb;cb=null;fn?.(time);resolve();}));}};};
 for(const mode of ['no-draw','throw']){const r=make({resize(){},dispose(){},present(){if(mode==='throw')throw new Error('intentional backend failure');},drawsPixels(){return false;}});c.ok(r.presenter.rebind('0000000000000001'),'fault presenter bind');const token=c.ok(r.presenter.enqueueOwned({bindingGeneration:'0000000000000001',frame:{scanout:0,format:1,rect:{x:0,y:0,width:1,height:1},resourceWidth:1,resourceHeight:1,pixels:Uint32Array.of(0xff112233)}},receipt=>failures.push(receipt.status)),'fault enqueue');await r.fire();c.equal(r.presenter.inspect().drawn,0,'accepted backend cannot claim actual drawn');c.equal(r.presenter.inspect().failed,1,'failed actual paint receives separate receipt');c.bad(r.presenter.enqueueOwned({bindingGeneration:'0000000000000000',frame:{}},()=>{}),'stale presenter generation','invalid-parameter');c.ok(r.presenter.dispose(),'fault presenter dispose');c.ok(r.presenter.dispose(),'idempotent presenter dispose');c.attacks.push({name:`trusted presentation ${mode}`,code:'failed-frame'});}
 c.same(failures,['failed','failed'],'exactly-once failure retirements');return{trustedFaultControls:failures};
}

async function directAndCancellation(api,gl,shader,c){
 const results=[];
 for(const issued of [false,true]){const r=makeRig(api,gl,shader,c,3),{q}=r;await uploadLiteral(r,c);await r.expect('cancel bind',display(0x103,3,3,2));const entry=q.enqueue('cancelled scanout',display(0x104,3,3,2));q.kick();q.run();if(issued)await r.step();const ring=hex(q.read(q.used,2056));q.vm.writeMmio(0x44,0);q.vm.writeMmio(0x44,1);q.run();c.truth(q.vm.readMmio(0x70)&64,'reconfigured scanout requires reset');let count=0;while(r.host.bridge.inspect().pending){c.truth(++count<100,'bounded scanout cancellation');await r.step();}c.equal(hex(q.read(q.used,2056)),ring,'cancelled scanout cannot publish used');c.equal(hex(q.read(entry.responseAddress,24)),'a5'.repeat(24),'cancelled scanout preserves response guard');c.equal(r.presenter.inspect().queued,0,'cancelled scanout never presents');results.push({issued,scanout:r.host.bridge.inspect().scanout});q.reset();r.dispose();c.attacks.push({name:issued?'cancel issued scanout':'cancel before PBO issue',code:'cancelled'});}
 const r=makeRig(api,gl,shader,c);await uploadLiteral(r,c);await r.expect('direct binding',display(0x103,3,3,2));const bind=structuredClone(r.events.find(e=>e.type==='bindScanout'));
 for(const mutate of [e=>{e.binding.generation='0000000000000000';},e=>{e.binding.generation='0000000000000002';e.binding.target.resource.generation='000000000000ffff';},e=>{e.binding.generation='0000000000000002';e.binding.target.metadata.width=4;e.binding.rect.width=4;},e=>{e.epoch='0000000000000000';},e=>{e.binding.target.kind='unknown';}]){const invalid=structuredClone(bind);mutate(invalid);c.bad(r.host.bridge.apply(invalid),'malformed or stale direct binding');c.equal(r.host.bridge.inspect().poisoned,false,'invalid binding is failure-atomic');}
 c.bad(r.host.bridge.apply(bind),'duplicate binding generation','invalid-parameter');await r.expect('buffer resource for unsupported scanout',resource(9,0,64,16,16,1));const buffer=r.host.bridge.inspect().resources.find(v=>v.transport.id===9);c.bad(r.host.probes.owners().bindings.retainScanout(9,buffer.storageGeneration),'buffer cannot become scanout','unsupported-resource');
 const wrong={type:'beginScanout',epoch:bind.epoch,sequence:'000000000000ffff',header:{type:0x104,flags:0,fenceId:'0000000000000000',contextId:0,ringIndex:0},binding:structuredClone(bind.binding)};wrong.binding.generation='0000000000000002';c.bad(r.host.bridge.apply(wrong),'stale captured binding','invalid-parameter');
 await r.expect('direct rejection recovery FLUSH',display(0x104,3,3,2));await r.paint();literalOracle(r,c,'direct recovery canvas');r.dispose();
 const quota=makeRig(api,gl,shader,c,1,false,{resourceLimits:{leases:1}});await uploadLiteral(quota,c);await quota.expect('quota original binding',display(0x103,3,3,2));const old=json(quota.q.vm.scanoutState().binding);await quota.expect('binding allocation limit',display(0x103,3,3,2),OOM);c.equal(json(quota.q.vm.scanoutState().binding),old,'allocation limit preserves old binding');await quota.expect('quota retained original FLUSH',display(0x104,3,3,2));await quota.paint();literalOracle(quota,c,'quota recovery canvas');quota.dispose();c.attacks.push({name:'atomic global lease allocation limit',code:'out-of-memory'});
 const enqueueFault=makeRig(api,gl,shader,c,1,false,{presenter(p){return {...p,enqueueOwned(){return {ok:false,error:{code:'invalid-parameter',message:'trusted enqueue failure'}};}};}});await uploadLiteral(enqueueFault,c);await enqueueFault.expect('enqueue fault bind',display(0x103,3,3,2));await enqueueFault.expect('enqueue failure',display(0x104,3,3,2),BAD_PARAMETER);c.equal(enqueueFault.host.bridge.inspect().scanout.retainedFrames,0,'enqueue rejection releases PBO ticket');enqueueFault.dispose();c.attacks.push({name:'trusted enqueue rejection',code:'invalid-parameter'});
 let failRebind=false;
 const bindFault=makeRig(api,gl,shader,c,1,false,{presenter(p){return {...p,rebind(g){if(failRebind){failRebind=false;return {ok:false,error:{code:'invalid-parameter',message:'trusted rebind rejection'}};}return p.rebind(g);}};}});await uploadLiteral(bindFault,c);await bindFault.expect('binding fault original',display(0x103,3,3,2));const previous=json(bindFault.q.vm.scanoutState().binding);failRebind=true;await bindFault.expect('trusted rebind failure',display(0x103,3,3,2),UNSPEC);c.equal(json(bindFault.q.vm.scanoutState().binding),previous,'failed presenter binding preserves transport binding');c.equal(bindFault.host.probes.owners().store.inspect().budgets.leases,1,'failed presenter binding rolls back new global lease');c.truth(bindFault.host.bridge.inspect().poisoned,'uncertain presentation binding fails closed');bindFault.q.reset();bindFault.dispose();c.attacks.push({name:'trusted presentation binding failure',code:'bridge-poisoned'});
 return results;
}
async function presenterWebglAndInputs(api,c){
 c.bad(api.createVirglScanoutPresenter(null),'null presenter options','invalid-parameter');c.bad(api.createVirglScanoutPresenter({canvas:{}}),'invalid presenter canvas','invalid-parameter');
 const canvas=document.createElement('canvas');canvas.width=canvas.height=2;document.querySelector('#draws').append(canvas);let callback;const retirements=[];const p=c.ok(api.createVirglScanoutPresenter({canvas,controllerOptions:{defaultBackend:'webgl2'},requestFrame(fn){callback=fn;return 1;},cancelFrame(){callback=null;}}),'real WebGL presentation backend').presenter;
 c.ok(p.rebind('0000000000000001'),'WebGL presenter bind');const frame={scanout:0,format:1,rect:{x:0,y:0,width:2,height:2},resourceWidth:2,resourceHeight:2,pixels:Uint32Array.from([0xff0000ff,0xffffff00,0xffff0000,0xff00ff00])};
 c.ok(p.enqueueOwned({bindingGeneration:'0000000000000001',frame},r=>retirements.push(r.status)),'WebGL presenter enqueue');const stale=callback;await new Promise(resolve=>requestAnimationFrame(t=>{callback(t);resolve();}));c.same([...c.ok(p.readPixels(),'WebGL actual readback').bytes],[255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255],'built WebGL presenter corners');c.equal(p.canvas.getContext('webgl2').getError(),0,'presentation WebGL zero error');stale(0);c.same(retirements,['drawn'],'stale animation callback cannot retire twice');
 c.ok(p.rebind('0000000000000002'),'invalidate WebGL recovery frame');c.equal(p.inspect().controller.latest,null,'no retained recovery source after rebind');p.canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));c.equal(p.inspect().controller.backend,'canvas2d','existing context recovery fallback exercised');c.truth([...c.ok(p.readPixels(),'fallback clear readback').bytes].every(v=>v===0),'context recovery cannot repaint obsolete binding');
 c.ok(p.enqueueOwned({bindingGeneration:'0000000000000002',frame},()=>{}),'pending frame before presenter disposal');c.ok(p.dispose(),'presenter disposes queued owned frame');c.equal(p.inspect().cancelled,1,'pending presenter disposal has cancellation receipt');c.bad(p.rebind('0000000000000003'),'disposed presenter rejects operations','bridge-poisoned');
 const other=document.createElement('canvas');other.width=other.height=1;const synchronous=c.ok(api.createVirglScanoutPresenter({canvas:other,requestFrame(fn){fn(0);return 1;},cancelFrame(){}}),'synchronous scheduler control').presenter;c.ok(synchronous.rebind('0000000000000001'),'synchronous control bind');c.bad(synchronous.enqueueOwned({bindingGeneration:'0000000000000001',frame:{...frame,rect:{x:0,y:0,width:1,height:1},resourceWidth:1,resourceHeight:1,pixels:Uint32Array.of(0)}},()=>{}),'synchronous scheduler rejected','invalid-parameter');c.ok(synchronous.dispose(),'synchronous control dispose');
 return{retirements,webglCorners:4,recoveryAfterInvalidation:'blank'};
}
export async function runBrowserAcceptance(api){const c=checker(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});c.truth(gl,'actual WebGL2');const shader=await createVirglShaderBridge();const portableRecords=await portable(api,gl,shader,c),literal=await literalLifecycle(api,gl,shader,c),original=await capturedDraw(api,gl,shader,api.fixtures,c),scheduling=await schedulingAndSwitch(api,gl,shader,c),immutable=await immutableSnapshot(api,gl,shader,c),faults=await cancellationAndFaults(api,gl,shader,c),presenter=await presenterControls(api,c),direct=await directAndCancellation(api,gl,shader,c),webglPresenter=await presenterWebglAndInputs(api,c);return{status:'passed',guestQueueReplay:true,guestExecution:false,productionVirgl:false,assertions:c.assertions,attacks:c.attacks,portableRecords,literal,original,scheduling,immutable,faults,presenter,direct,webglPresenter,summary:{status:'passed',assertions:c.assertions,portableRecords:portableRecords.length,checkedPixels:original.checkedPixels,literalPixels:6,scope:'GPU-ready guest completion and separately acknowledged actual canvas draw'}};}
