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
  constructor(WasmVirglSubmitProof, callback, c, proof = true, portable = false) {
    this.c = c; this.proof = proof; this.portable = portable; this.vm = new WasmVirglSubmitProof(callback, proof); this.base = BigInt('0x' + this.vm.layout().ramBase);
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
    const state=this.vm.inspect(), submit=this.vm.submitState();
    const record={case:entry.label,request:hex(entry.request),response:hex(got),usedIndex:entry.number+1,
      ring:{descriptors:hex(this.read(this.desc+BigInt(entry.head*16),32)),avail:hex(this.read(this.avail,520)),used:hex(this.read(this.used,2056))},
      machineDigest:(this.portable || /original submit (173|197|221)/.test(entry.label)) ? (this.vm.machineDigest ? this.vm.machineDigest() : this.lastRun.machineDigest) : null,transportCanonical:state?hex(state.canonicalBytes):'',transportDigest:state?.digest??'',submitCanonical:submit?hex(submit.canonicalBytes):'',submitDigest:submit?.digest??''};
    this.records.push(record); return record;
  }
  reset() { this.vm.writeMmio(0x70,0); this.run(); this.configure(); this.negotiate(); }
}
function makeRig(WasmVirglSubmitProof, createVirglSubmitBridge, gl, shaderBridge, c, schedule=0, proof=true, portable=false) {
  const trace=instrument(gl,c,schedule), events=[], exchanges=[], completions=[], hooks={}; let q, intercept=null;
  const host=c.ok(createVirglSubmitBridge({gl:trace.gl,shaderBridge,transport:{
    gatherInput(...args) { const before=q.usedIndex(); hooks.beforeGather?.(args); const data=q.vm.gatherInput(...args); hooks.afterGather?.(args,data); exchanges.push({kind:'input',args,bytes:hex(data),usedIndex:before}); return data; },
    scatterOutput(...args) { const before=q.usedIndex(), irqBefore=q.vm.readMmio(0x60)&1; hooks.beforeScatter?.(args); const result=q.vm.scatterOutput(...args); hooks.afterScatter?.(args); c.equal(q.usedIndex(),before,'readback scatter precedes used publication'); c.equal(q.vm.readMmio(0x60)&1,irqBefore,'readback scatter preserves prior IRQ and does not publish completion'); exchanges.push({kind:'output',args:args.slice(0,-1),bytes:hex(args.at(-1)),usedIndex:before}); return result; },
    complete(...args) { const before=q.usedIndex(); if(args[4])c.truth(trace.syncs.size===0,'completion is posted only after all GPU fences retire'); hooks.beforeComplete?.(args); const result=q.vm.complete(...args); hooks.afterComplete?.(args); c.equal(q.usedIndex(),before,'completion mailbox does not publish used during host pump'); completions.push({args,usedIndex:before}); return result; }
  }}),'real asynchronous bridge');
  q=new Queue(WasmVirglSubmitProof,(event)=>{events.push(structuredClone(event)); if(intercept) return intercept(event); return host.bridge.apply(event);},c,proof,portable);
  const step=async()=>{await turn(); trace.nextTurn(); const before=q.usedIndex(), result=host.bridge.pump(); if(trace.control.oracleFailure)throw trace.control.oracleFailure; if(c.failure)throw c.failure; c.ok(result,'host asynchronous pump'); c.equal(q.usedIndex(),before,'host GPU step never publishes used'); return result;};
  const drain=async(target=q.next)=>{
    let turns=0;
    while(q.usedIndex()<target) {
      const polls=trace.snapshot().polls; q.run(); c.equal(trace.snapshot().polls,polls,'Machine.run never polls GPU');
      if(q.usedIndex()>=target)break;
      c.truth(++turns<20000,'bounded completion turns'); await step();
    }
    return turns;
  };
  const expect=async(label,request,expected=OK)=>{const entry=q.enqueue(label,request,expected);q.kick();await drain();const record=q.collect(entry);q.vm.writeMmio(0x64,1);return record;};
  const dispose=()=>{c.ok(host.bridge.dispose(),'dispose bridge');q.vm.free();c.equal(trace.objects.size,0,'zero live GPU objects after disposal');c.equal(gl.getError(),gl.NO_ERROR,'zero final GPU error');};
  return {q,host,trace,events,exchanges,completions,hooks,step,drain,expect,dispose,setIntercept(fn){intercept=fn;}};
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
async function originalReplay(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,fixtures,c,schedule=1,display=true) {
  const rig=makeRig(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c,schedule),ram=await initialize(rig,fixtures,c),frames=[],submissions=[];
  let cleanupIndex=0,checkedPixels=0,packetCount=0;
  for(let i=0;i<EVENTS.length;i++) {
    const event=EVENTS[i];while(cleanupIndex<fixtures.lifecycle.length&&fixtures.lifecycle[cleanupIndex].event<event)await lifecycle(rig,fixtures.lifecycle[cleanupIndex++],c);
    const source=fixtures.commands.submissions.find(s=>s.event===event),commands=Uint8Array.from(source.data),decoded=headers(commands,c,`event ${event}`);
    c.equal(decoded.length,COUNTS[i],`original event ${event} packet count`);packetCount+=decoded.length;
    await rig.expect(`original submit ${event}`,submission(source.contextId,commands,BigInt(event)));
    submissions.push({event,sourceSha256:source.sourceSha256,byteLength:commands.length,packets:decoded});
    if([173,197,221].includes(event)){const phase=frames.length,bytes=ram.read(7,OFFSETS[phase],4096),oracle=pixelOracle(bytes,EXPECTED[phase],c,`original async guest phase ${phase}`);checkedPixels+=oracle.pixels;frames.push({event,offset:OFFSETS[phase],sha256:await sha(bytes),oracle});if(display)tile(bytes,`Guest DMA phase ${phase+1}`);}
  }
  while(cleanupIndex<fixtures.lifecycle.length)await lifecycle(rig,fixtures.lifecycle[cleanupIndex++],c);
  c.equal(packetCount,210,'original packet total');c.equal(rig.trace.calls.length,3,'original actual draw count');c.equal(checkedPixels,768,'original literal pixel total');
  const result={packetCount,gpuDraws:3,checkedPixels,submissions,frames,cleanup:rig.host.bridge.inspect(),sequencing:rig.trace.snapshot(),records:rig.q.records,exchanges:rig.exchanges,submitState:rig.q.vm.submitState(),commandTrace:rig.q.vm.commandTrace()};rig.dispose();return result;
}
async function hundredDraws(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,fixtures,c) {
  const rig=makeRig(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c,3);await initialize(rig,fixtures,c);
  const first=Uint8Array.from(fixtures.commands.submissions.find(s=>s.event===161).data);await rig.expect('hundred setup first original draw',submission(2,first));
  const before=rig.trace.calls.length,entries=[],fences=[0n,0xffffffffffffffffn,7n,7n,0x20000000000001n,1n];
  for(let i=0;i<100;i++)entries.push(rig.q.enqueue(`queued fenced draw ${i}`,submission(2,first.slice(5684),fences[i%fences.length])));
  const destroy=header(0x201,2,24);u32(destroy,4,1);u64(destroy,8,0n);entries.push(rig.q.enqueue('destroy immediately after 100 draws',destroy));
  rig.q.kick();rig.q.run();c.equal(rig.q.usedIndex(),entries[0].number,'hundred queue admits only one pending head');
  let maximumPending=0,heartbeats=0;const interval=setInterval(()=>heartbeats++,0);
  try{while(rig.q.usedIndex()<rig.q.next){const state=rig.q.vm.submitInspect();maximumPending=Math.max(maximumPending,state.active?1:0);const polls=rig.trace.snapshot().polls;rig.q.run();c.equal(rig.trace.snapshot().polls,polls,'queued guest run does not poll host GPU');if(rig.q.usedIndex()<rig.q.next)await rig.step();}}finally{clearInterval(interval);}
  for(const entry of entries)rig.q.collect(entry);
  c.equal(rig.trace.calls.length-before,100,'100 actual GPU draws before context destroy');c.equal(maximumPending,1,'capacity-one pending job');c.truth(heartbeats>0,'browser heartbeat progresses while fences wait');c.equal(rig.host.bridge.inspect().contexts.length,0,'ordered destroy occurs after draws');
  const result={queuedCommands:101,gpuDraws:100,maximumPending,heartbeats,fences:fences.map(address),records:rig.q.records,submitState:rig.q.vm.submitState(),commandTrace:rig.q.vm.commandTrace(),machineDigest:rig.q.vm.machineDigest?.()??null,sequencing:rig.trace.snapshot()};rig.dispose();return result;
}



function cursorWhilePending(q,c) {
  const desc=q.base+0xa000n,avail=q.base+0xb000n,used=q.base+0xc000n,request=q.base+0xd000n,responseAt=q.base+0xd100n;
  q.write(avail,new Uint8Array(40));q.write(used,new Uint8Array(136));q.write(request,header(0x300,0,56));q.write(responseAt,new Uint8Array(24).fill(0xa5));
  const descriptors=new Uint8Array(32);u64(descriptors,0,request);u32(descriptors,8,56);u16(descriptors,12,1);u16(descriptors,14,1);u64(descriptors,16,responseAt);u32(descriptors,24,24);u16(descriptors,28,2);q.write(desc,descriptors);
  q.vm.writeMmio(0x30,1);q.vm.writeMmio(0x38,16);for(const [off,addr]of[[0x80,desc],[0x90,avail],[0xa0,used]]){q.vm.writeMmio(off,Number(addr&0xffffffffn));q.vm.writeMmio(off+4,Number(addr>>32n));}q.vm.writeMmio(0x44,1);q.vm.writeMmio(0x30,0);
  return ()=>{const before=q.usedIndex(),entry=Uint8Array.of(1,0);q.write(avail+2n,entry);q.vm.writeMmio(0x50,1);q.run();c.equal(get16(q.read(used+2n,2)),1,'cursor queue progresses while control GPU work waits');c.equal(hex(q.read(responseAt,24)),hex(header(OK,0,24)),'cursor independent exact response');c.equal(q.usedIndex(),before,'cursor progress does not complete pending control');q.vm.writeMmio(0x64,1);};
}
async function protocolAttacks(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c) {
  const rig=makeRig(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c),{q}=rig;
  c.throws(()=>q.vm.readRam('1',1),'short hex address');c.throws(()=>q.vm.writeRam('g'.repeat(16),new Uint8Array()),'nonhex address');c.throws(()=>q.vm.readRam(address(q.base+4194304n),1),'RAM end overflow');
  c.throws(()=>q.vm.complete('0'.repeat(16),'0'.repeat(16),'0'.repeat(16),7,false,0,0),'unknown completion outcome');
  await rig.expect('attack context',context(2));await rig.expect('attack resource',resource(3,0,64,16,16,1));await rig.expect('attack backing',backing(3,[[q.backing,32]]));await rig.expect('attack attach',idCommand(0x202,2,3));
  const invalid=[];
  invalid.push(['u64 narrowing',transfer(2,3,1,[0,0,0,8,1,1],0x100000004n)]);
  invalid.push(['u64 overflow',transfer(2,3,2,[0,0,0,8,1,1],0xffffffffffffffffn)]);
  invalid.push(['one byte short backing',transfer(2,3,1,[0,0,0,8,1,1],25n)]);
  invalid.push(['bad transfer level',(()=>{const b=transfer(2,3,1,[0,0,0,8,1,1]);u32(b,60,1);return b;})()]);
  invalid.push(['unknown header flag',(()=>{const b=submission(2,new Uint8Array());u32(b,4,2);return b;})()]);
  invalid.push(['nonzero ring',(()=>{const b=submission(2,new Uint8Array());b[20]=1;return b;})()]);
  invalid.push(['trailing submit byte',(()=>{const b=submission(2,new Uint8Array());return Uint8Array.from([...b,0]);})()]);
  invalid.push(['mismatched submit length',(()=>{const b=submission(2,new Uint8Array());u32(b,24,4);return b;})()]);
  invalid.push(['malformed embedded packet',submission(2,Uint8Array.of(255,0,0,0))]);
  for(const [label,wire]of invalid){const draws=rig.trace.calls.length;await rig.expect(label,wire,BAD_PARAMETER);c.equal(rig.trace.calls.length,draws,`${label} issues no draw`);c.attacks.push({name:label,code:'invalid-parameter'});}
  const short=q.enqueue('incomplete response capacity',submission(2,new Uint8Array()),OK,23);q.kick();await rig.drain();q.collect(short);q.vm.writeMmio(0x64,1);
  const incompleteDraw=new Uint8Array(52);[8+(12<<16),0,6,4,1,1,0,0,0,0,0,3,0].forEach((v,i)=>u32(incompleteDraw,i*4,v));await rig.expect('valid packet incomplete draw state',submission(2,incompleteDraw),BAD_PARAMETER);c.attacks.push({name:'valid incomplete draw retires explicit error',code:'invalid-parameter'});
  await rig.expect('recovery valid empty',submission(2,new Uint8Array(),7n));
  const saved=rig.completions.at(-1).args;c.throws(()=>q.vm.complete(...saved),'duplicate completion after used');
  // Current pending identity exists before begin callback; mailbox inspection does not borrow Machine.
  let observed=false;rig.setIntercept(event=>{if(event.type==='beginJob'){const active=q.vm.submitInspect().active;c.same(active,{epoch:event.epoch,sequence:event.sequence},'armed mailbox visible inside begin callback');c.throws(()=>q.vm.submitState(),'reentrant machine inspection');c.throws(()=>q.vm.readRam(address(q.backing),1),'reentrant RAM access');observed=true;}return rig.host.bridge.apply(event);});
  await rig.expect('reentrant callback recovery',submission(2,new Uint8Array()));rig.setIntercept(null);c.truth(observed,'callback reentrancy path exercised');
  // These are explicit trusted mailbox controls, not evidence of GPU success.
  for(const [code,expected]of[[0,OK],[1,BAD_CONTEXT],[2,BAD_RESOURCE],[3,BAD_PARAMETER],[4,OOM],[5,UNSPEC],[6,UNSPEC]]){
    rig.setIntercept(event=>{if(event.type==='beginJob'){q.vm.complete(event.epoch,event.sequence,'0000000000000000',code,code!==6,0,0);return {ok:true};}return rig.host.bridge.apply(event);});
    await rig.expect(`trusted immediate completion outcome ${code}`,submission(2,new Uint8Array(),BigInt(code)),expected);
  }
  rig.setIntercept(null);q.reset();await rig.expect('uncertain immediate completion reset',context(2));
  const pending=q.enqueue('reset pending final fence',submission(2,new Uint8Array(),0n));q.kick();q.run();await rig.step();
  c.equal(rig.host.bridge.inspect().pending.status,'waiting-gpu','empty job final GPU fence is pending');const key=q.vm.submitInspect().active,ring=hex(q.read(q.used,2056)),reply=hex(q.read(pending.responseAddress,64));
  q.vm.writeMmio(0x70,0);c.throws(()=>q.vm.complete(key.epoch,key.sequence,'0'.repeat(16),0,true,0,0),'late reset completion');
  c.equal(hex(q.read(q.used,2056)),ring,'reset late callback preserves old used ring');c.equal(hex(q.read(pending.responseAddress,64)),reply,'reset late callback preserves response');c.equal(rig.trace.syncs.size,0,'reset releases pending GL sync');q.configure();q.negotiate();
  await rig.expect('reuse context after reset',context(2));await rig.expect('new epoch job',submission(2,new Uint8Array()));
  const rewrite=q.enqueue('queue reconfigure pending',submission(2,new Uint8Array()));q.kick();q.run();await rig.step();const old=q.vm.submitInspect().active;const before=hex(q.read(q.used,2056));q.vm.writeMmio(0x44,0);q.vm.writeMmio(0x44,1);q.run();
  c.truth(q.vm.readMmio(0x70)&64,'queue reconfiguration requires reset');c.equal(hex(q.read(q.used,2056)),before,'queue reconfiguration cannot write used');c.throws(()=>q.vm.complete(old.epoch,old.sequence,'0'.repeat(16),0,true,0,0),'late reconfigured completion');
  let drains=0;while(rig.host.bridge.inspect().pending){c.truth(++drains<100,'bounded cancellation drain');await rig.step();}c.equal(hex(q.read(rewrite.responseAddress,24)),'a5'.repeat(24),'cancelled control response remains untouched');
  q.reset();await rig.expect('queue rewrite reset recovery',context(2));const result={records:q.records,attacks:invalid.length+10,events:rig.events.map(e=>({type:e.type,epoch:e.epoch,sequence:e.sequence})),machineDigest:q.vm.machineDigest?.()??null};rig.dispose();
  const plain=makeRig(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c,0,false);plain.q.vm.writeMmio(0x14,0);c.equal(plain.q.vm.readMmio(0x10)&1,0,'ordinary proof-off VIRGL feature remains absent');c.equal(plain.q.vm.inspect(),null,'proof-off control snapshot absent');c.equal(plain.q.vm.submitState(),null,'proof-off submit snapshot absent');await plain.expect('proof-off context rejected',context(2),UNSPEC);plain.dispose();return result;
}


async function postScatterFaults(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,fixtures,c) {
  const results=[];
  for(const fault of ['throw-after-scatter','ack-after-backing-revocation']) {
    const rig=makeRig(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c,1);await initialize(rig,fixtures,c);
    const first=Uint8Array.from(fixtures.commands.submissions.find(s=>s.event===161).data),read=Uint8Array.from(fixtures.commands.submissions.find(s=>s.event===173).data),commands=new Uint8Array(first.length+read.length);commands.set(first);commands.set(read,first.length);
    if(fault==='throw-after-scatter')rig.hooks.afterScatter=()=>{delete rig.hooks.afterScatter;throw new Error('trusted exception after committed Rust scatter');};
    else rig.hooks.beforeScatter=()=>{delete rig.hooks.beforeScatter;c.ok(rig.host.probes.owners().store.detachBacking(7),'trusted backing revocation before ACK');};
    const entry=rig.q.enqueue(fault,submission(2,commands,99n),UNSPEC);rig.q.kick();rig.q.run();let turns=0,sawFailure=false;
    while(rig.q.usedIndex()<rig.q.next||rig.host.bridge.inspect().pending){c.truth(++turns<300,'bounded poisoned job retirement');await turn();rig.trace.nextTurn();const result=rig.host.bridge.pump();if(!result.ok){c.equal(result.error.code,'bridge-poisoned','uncertain host exchange fails closed');sawFailure=true;}rig.q.run();}
    c.truth(sawFailure,`${fault} exercised`);rig.q.collect(entry);c.equal(rig.trace.calls.length,1,'one real draw precedes failed DMA acknowledgment');
    const completion=rig.completions.at(-1).args;c.equal(completion[3],6,'uncertain completion has bridge-poisoned outcome');c.equal(completion[4],false,'uncertain completion cannot claim GPU success');c.equal(completion[6],1,'uncertain completion retains actual successful draw prefix');
    c.equal(rig.q.vm.submitState().counters.draws,'0000000000000001','transport diagnostic retains draw prefix');c.equal(rig.q.vm.submitInspect().active,null,'uncertain completion retires owned head');
    c.truth(rig.host.bridge.inspect().poisoned,'host remains poisoned until reset');c.bad(rig.host.bridge.pump(),'poisoned idle bridge blocks pumping','bridge-poisoned');results.push({fault,completion,submitState:rig.q.vm.submitState(),records:rig.q.records});rig.dispose();c.attacks.push({name:fault,code:'bridge-poisoned'});
  }
  return results;
}


async function trustedBridgeAttacks(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c) {
  const transport={gatherInput(){return new Uint8Array();},scatterOutput(){},complete(){}};
  const config={gl,shaderBridge,transport};
  for(const [label,opts]of[['missing transport',{gl,shaderBridge}],['invalid transport member',{...config,transport:{...transport,complete:0}}],['invalid job limit',{...config,jobLimits:{commandsPerStep:0}}],['invalid draw limit',{...config,drawLimits:{drawsPerSubmission:65}}]])c.bad(createVirglSubmitBridge(opts),`trusted async constructor ${label}`,'invalid-parameter');
  const limited=c.ok(createVirglSubmitBridge({...config,resourceLimits:{resources:1},stateLimits:{contexts:1},jobLimits:{commandsPerStep:1},drawLimits:{drawsPerSubmission:0}}),'tightened async limits');
  c.ok(limited.bridge.dispose(),'tightened owner disposal');c.ok(limited.bridge.dispose(),'idempotent bridge disposal');c.bad(limited.bridge.pump(),'disposed pump','bridge-poisoned');c.bad(limited.bridge.apply({}),'disposed apply','bridge-poisoned');
  const rig=makeRig(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c),{q}=rig;
  for(const malformed of [null,{}, {type:'beginJob',epoch:'bad'}, {type:'cancelJob',epoch:'0000000000000001',sequence:'0000000000000001'}])c.bad(rig.host.bridge.apply(malformed),'malformed or stale host event','invalid-parameter');
  await rig.expect('trusted probe context',context(2));await rig.expect('trusted probe resource',resource(3,0,64,16,16,1));await rig.expect('trusted probe attach context',idCommand(0x202,2,3));
  await rig.expect('accepted resource has no backing',submission(2,new Uint8Array()));await rig.expect('trusted probe backing',backing(3,[[q.backing,32]]));
  rig.hooks.beforeGather=()=>{delete rig.hooks.beforeGather;c.bad(rig.host.bridge.pump(),'reentrant host pump','bridge-poisoned');c.bad(rig.host.bridge.apply({}),'reentrant host apply','bridge-poisoned');c.bad(rig.host.bridge.dispose(),'reentrant host disposal','bridge-poisoned');};
  await rig.expect('host reentrancy recovery',transfer(2,3,1,[0,0,0,8,1,1]));
  const template=rig.events.filter(e=>e.type==='beginJob').at(-1),nextSequence=address(BigInt('0x'+template.sequence)+1n);
  const mutations=[['stale context',e=>e.context.generation='ffffffffffffffff','invalid-context-id'],['stale resource',e=>e.resources[0].identity.generation='ffffffffffffffff','invalid-resource-id'],['allocation metadata',e=>e.resources[0].metadata.width++, 'invalid-parameter'],['backing generation',e=>e.resources[0].backing.generation='ffffffffffffffff','invalid-parameter'],['outer full width offset',e=>e.transfer.offset='0000000100000000','invalid-parameter'],['header context',e=>e.header.contextId=3,'invalid-parameter'],['unknown field',e=>e.unknown=1,'invalid-parameter'],['oversize command copy',e=>{e.kind='commands';e.header.type=0x207;delete e.transfer;e.commands=new Uint8Array(262145);},'invalid-parameter']];
  for(const [label,mutate,code]of mutations){const event=structuredClone(template);event.sequence=nextSequence;mutate(event);c.bad(rig.host.bridge.apply(event),`trusted admission rejects ${label}`,code);c.equal(rig.host.bridge.inspect().pending,null,'invalid admission publishes no renderer job');}
  // A rejected mailbox post cannot be silently converted into completion.
  rig.hooks.beforeComplete=()=>{throw new Error('trusted complete capability rejects every post');};
  const parked=q.enqueue('failed mailbox post',submission(2,new Uint8Array()));q.kick();q.run();let turns=0;
  while(rig.host.bridge.inspect().pending){c.truth(++turns<100,'bounded failed mailbox retirement');await turn();rig.trace.nextTurn();const result=rig.host.bridge.pump();if(!result.ok)c.equal(result.error.code,'bridge-poisoned','failed mailbox poisons bridge');}
  c.equal(rig.host.bridge.inspect().lastFailure.completionRejected,true,'mailbox failure is explicit');c.equal(q.usedIndex(),parked.number,'failed mailbox never publishes success');c.truth(q.vm.submitInspect().active,'transport remains pending until reset');
  delete rig.hooks.beforeComplete;q.reset();await rig.expect('mailbox reset recovery',context(2));const result={records:q.records,machineDigest:q.vm.machineDigest?.()??null};rig.dispose();return result;
}


async function orderedDma(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c) {
  const rig=makeRig(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c,2),{q}=rig;
  for(const ctx of[2,3])await rig.expect(`interleave context ${ctx}`,context(ctx));
  for(const [id,ctx,addr]of[[3,2,q.backing],[4,3,q.backing+0x1000n]]){await rig.expect(`interleave resource ${id}`,resource(id,0,64,16,16,1));await rig.expect(`interleave backing ${id}`,backing(id,[[addr,32]]));await rig.expect(`interleave attach ${id}`,idCommand(0x202,ctx,id));}
  const a=Uint8Array.of(11,22,33,44,55,66,77,88),b=Uint8Array.of(201,202,203,204,205,206,207,208),newer=Uint8Array.of(91,92,93,94,95,96,97,98);
  q.write(q.backing,a);q.write(q.backing+0x1000n,b);
  await rig.expect('A upload',transfer(2,3,1,[0,0,0,8,1,1]));await rig.expect('B upload',transfer(3,4,1,[0,0,0,8,1,1]));await rig.expect('A readback after B',transfer(2,3,2,[0,0,0,8,1,1],16n));await rig.expect('B readback after A',transfer(3,4,2,[0,0,0,8,1,1],16n));
  c.same([...q.read(q.backing+16n,8)],[...a],'independent context A data');c.same([...q.read(q.backing+0x1010n,8)],[...b],'independent context B data');await rig.expect('cross-context transfer rejected',transfer(3,3,1,[0,0,0,8,1,1]),BAD_RESOURCE);
  const replacement=q.backing+0x2000n;q.write(replacement,newer);
  const entries=[q.enqueue('queued old backing upload',transfer(2,3,1,[0,0,0,8,1,1],0n,0,0,7n)),q.enqueue('queued backing detach',idCommand(0x107,0,3)),q.enqueue('queued backing reattach',backing(3,[[replacement,32]])),q.enqueue('queued new backing upload',transfer(2,3,1,[0,0,0,8,1,1],0n,0,0,7n)),q.enqueue('queued new backing readback',transfer(2,3,2,[0,0,0,8,1,1],16n,0,0,7n))];
  const before=rig.exchanges.length;q.kick();q.run();c.equal(q.usedIndex(),entries[0].number,'queued detach waits behind owned upload');
  // The later head still belongs to the guest until it is admitted.
  u64(entries[3].request,8,0x20000000000003n);q.write(entries[3].requestAddress,entries[3].request);
  await rig.drain();for(const entry of entries)q.collect(entry);q.vm.writeMmio(0x64,1);
  c.same([...q.read(replacement+16n,8)],[...newer],'queued reattach DMA uses new backing mapping');const exchanged=rig.exchanges.slice(before);c.equal(exchanged.length,3,'queued backing cycle has three precise exchanges');c.equal(exchanged[0].bytes,hex(a),'old owned upload reads old SG');c.equal(exchanged[1].bytes,hex(newer),'later upload reads reattached SG');c.truth(exchanged[0].args[5]!==exchanged[1].args[5],'backing generation changes on successful reattach');
  const oldResource=q.vm.inspect().resources.find(r=>r.identity.id===3).identity;
  await rig.expect('unref old public resource',idCommand(0x102,0,3));await rig.expect('reuse public resource ID',resource(3,0,64,16,16,1));const newResource=q.vm.inspect().resources.find(r=>r.identity.id===3).identity;c.truth(newResource.generation!==oldResource.generation,'public resource reuse changes transport generation');
  const staleEvent={type:'unrefResource',epoch:q.vm.inspect().epoch,resource:oldResource};c.bad(rig.host.bridge.apply(staleEvent),'stale resource generation rejected','invalid-resource-id');
  const result={contexts:[2,3],exchanges:exchanged,records:q.records,oldResource,newResource,machineDigest:q.vm.machineDigest?.()??null};rig.dispose();return result;
}


async function uncertainGpuFailure(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c) {
  const rig=makeRig(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c),{q}=rig;
  await rig.expect('GPU failure context',context(2));const entry=q.enqueue('trusted wait failure on actual final fence',submission(2,new Uint8Array(),17n),UNSPEC);q.kick();q.run();await rig.step();
  c.equal(rig.trace.syncs.size,1,'wait fault targets an actual owned GL fence');rig.trace.control.waitFailed=true;await rig.step();q.run();q.collect(entry);
  c.equal(rig.completions.length,1,'uncertain GPU failure posts one valid terminal result');const args=rig.completions[0].args;c.equal(args[3],6,'uncertain GPU failure maps directly to bridge poison');c.equal(args[4],false,'failed GPU wait cannot claim completion');
  c.equal(rig.host.bridge.inspect().lastFailure.code,'backend-error','underlying GPU error preserved');c.truth(rig.host.bridge.inspect().poisoned,'uncertain GPU failure requires reset');
  const result={trustedFaultControl:true,completion:args,error:rig.host.bridge.inspect().lastFailure,records:q.records};q.reset();await rig.expect('GPU failure reset recovery',context(2));rig.dispose();c.attacks.push({name:'trusted WAIT_FAILED on actual fence',code:'bridge-poisoned'});return result;
}

async function portableReplay(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c) {
  const rig=makeRig(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c,0,true,true),{q}=rig;
  await rig.expect('context',header(0x200,2,96));await rig.expect('resource',resource(3,0,64,16,16,1));
  const a=q.base+0x20000n,b=q.base+0x30000n;await rig.expect('backing',backing(3,[[a,7],[b,25]]));await rig.expect('attach',idCommand(0x202,2,3));
  const fresh=Uint8Array.from({length:32},(_,i)=>i);q.write(a,fresh.subarray(0,7));q.write(b,fresh.subarray(7));
  await rig.expect('upload',transfer(2,3,1,[0,0,0,8,1,1],4n,0,0,0xffffffffffffffffn));
  await rig.expect('readback',transfer(2,3,2,[0,0,0,8,1,1],8n,0,0,7n));
  const expected=new Uint8Array(fresh);expected.set(fresh.slice(4,12),8);const actual=new Uint8Array(32);actual.set(q.read(a,7));actual.set(q.read(b,25),7);c.same([...actual],[...expected],'portable fresh DMA and exact scatter');
  await rig.expect('submit',submission(2,new Uint8Array(),7n));const destroy=header(0x201,2,24);u32(destroy,4,1);u64(destroy,8,0n);await rig.expect('destroy',destroy);
  const records=q.records;rig.dispose();return records;
}

export async function runBrowserAcceptance({WasmVirglSubmitProof,createVirglSubmitBridge,fixtures,wasmMemory},options={}) {
  const c=checker(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true}); c.truth(gl,'actual WebGL2');
  const shaderBridge=await createVirglShaderBridge(),rig=makeRig(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c,1),{q}=rig;
  await rig.expect('create context',context(2));
  await rig.expect('create texture',resource(3,2,67,10,4,4));
  // Pixel split across SG entries. Initial bytes are zero; DMA must read later RAM.
  const first=q.backing,second=q.backing+0x1000n;
  await rig.expect('attach split backing',backing(3,[[first,3],[second,125]]));
  await rig.expect('attach texture context',idCommand(0x202,2,3));
  const dense=Uint8Array.from({length:64},(_,i)=>(i*17+3)&255),back=new Uint8Array(128).fill(0x9a);back.set(dense,5);
  q.write(first,back.subarray(0,3));q.write(second,back.subarray(3));
  const cursorProgress=cursorWhilePending(q,c);
  const up=q.enqueue('outer fresh upload',transfer(2,3,1,[0,0,0,4,4,1],5n,16,0,0x123456789abcdef0n));q.kick();q.run();
  c.equal(q.usedIndex(),up.number,'upload used withheld after admission');cursorProgress();
  const redirected=q.base+0xf0000n;q.write(redirected,new Uint8Array(24).fill(0x4d));q.descriptor(up.head+1,redirected,24,2,0);
  // Admission owns command bytes, while the later needs-input boundary owns fresh DMA.
  dense[0]^=0x55;back.set(dense,5);q.write(first,back.subarray(0,3));q.write(second,back.subarray(3));
  q.write(up.requestAddress,new Uint8Array(up.request.length).fill(0xee));
  if(wasmMemory){wasmMemory.grow(1);c.equal(q.usedIndex(),up.number,'memory growth preserves owned pending request');}
  await rig.drain();q.collect(up);q.vm.writeMmio(0x64,1);c.equal(hex(q.read(redirected,24)),'4d'.repeat(24),'admitted response descriptors are immutable');
  const guarded=new Uint8Array(128).fill(0xc7);q.write(first,guarded.subarray(0,3));q.write(second,guarded.subarray(3));
  const readEntry=q.enqueue('outer padded readback',transfer(2,3,2,[0,0,0,4,4,1],7n,20,0,0xffffffffffffffffn));q.kick();q.run();q.write(second+22n,Uint8Array.of(0x5d));c.equal(q.vm.readMmio(0x60)&1,0,'readback starts without completion IRQ');await rig.drain();c.equal(q.vm.readMmio(0x60)&1,1,'used publication raises completion IRQ');q.collect(readEntry);q.vm.writeMmio(0x64,1);
  const actual=new Uint8Array(128);actual.set(q.read(first,3));actual.set(q.read(second,125),3);
  const expected=new Uint8Array(128).fill(0xc7);expected[25]=0x5d;for(let row=0;row<4;row++)expected.set(dense.subarray(row*16,row*16+16),7+row*20);
  c.same([...actual],[...expected],'fresh DMA texture readback and exact dirty rows');
  c.truth(rig.trace.snapshot().pboReads>0,'actual PBO texture readback');
  await rig.expect('detach texture context',idCommand(0x203,2,3));await rig.expect('detach backing',idCommand(0x107,0,3));await rig.expect('unref texture',idCommand(0x102,0,3));await rig.expect('destroy context',header(0x201,2,24));
  const result={status:'passed',guestQueueReplay:true,guestExecution:false,productionVirgl:false,assertions:c.assertions,attacks:c.attacks,records:q.records,portableRecords:[],
    minimal:{denseBytes:64,dirtyRows:4,splitPixel:true,memoryGrowth:Boolean(wasmMemory)},sequencing:rig.trace.snapshot(),exchanges:rig.exchanges,completions:rig.completions,
    submitState:q.vm.submitState(),commandTrace:q.vm.commandTrace()};
  rig.dispose();
  result.uncertainGpuFailure=await uncertainGpuFailure(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c);
  result.orderedDma=await orderedDma(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c);
  result.trusted=await trustedBridgeAttacks(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c);
  result.protocol=await protocolAttacks(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c);
  result.portableRecords=await portableReplay(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,c);
  result.original=await originalReplay(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,fixtures,c);
  const poisoned=structuredClone(fixtures);let poisonedBytes=0;for(const ref of poisoned.referenceOutputSnapshots){ref.data.fill(0xe3);poisonedBytes+=ref.data.length;}
  const replay=await originalReplay(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,poisoned,c,4,false);c.same(replay.frames.map(f=>f.sha256),result.original.frames.map(f=>f.sha256),'saved output references never initialize guest DMA');
  result.outputReferencePoison={bytes:poisonedBytes,hashes:replay.frames.map(f=>f.sha256)};
  result.postScatterFaults=await postScatterFaults(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,fixtures,c);
  result.ordered=await hundredDraws(WasmVirglSubmitProof,createVirglSubmitBridge,gl,shaderBridge,fixtures,c);result.assertions=c.assertions;
  result.summary={status:result.status,assertions:result.assertions,minimal:result.minimal,original:{packetCount:result.original.packetCount,gpuDraws:result.original.gpuDraws,checkedPixels:result.original.checkedPixels},ordered:{queuedCommands:result.ordered.queuedCommands,gpuDraws:result.ordered.gpuDraws,maximumPending:result.ordered.maximumPending},sequencing:result.sequencing};return result;
}
