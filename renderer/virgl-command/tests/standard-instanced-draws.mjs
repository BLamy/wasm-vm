import { decodeSubmission, decodeStandardSubmission } from "../decoder.mjs";
import { createVirglStandardAsyncRenderer } from "../state.mjs";
import { createResourceStore, createWebGL2TransferBackend } from "../resources.mjs";
import { createVirglStandardShaderBridge } from "../../virgl-shader/standard.mjs";
import { drawModel, comparePixels } from "../../../tools/virgl-command/standard-draw-oracle.mjs";
const word = value => { const v = new DataView(new ArrayBuffer(4)); v.setFloat32(0, value, true); return v.getUint32(0, true); };
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
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
function shader(handle, stage, text) {
  const raw = packet(1, 4, [handle, stage, text.length + 1, 8192, 0, ...Array(Math.ceil((text.length + 1) / 4)).fill(0)]);
  raw.set(new TextEncoder().encode(text), 24); return raw;
}
function tgsi(stage, declarations, instructions) {
  return (stage === "vertex" ? "VERT\n" : "FRAG\n") + declarations + "\n" +
    [...instructions, "END"].map((value, index) => index + ": " + value + "\n").join("");
}
const meta = (id, target, format, bind, width, height = 1) =>
  ({ id, target, format, bind, width, height, depth: 1, arraySize: 1, lastLevel: 0, nrSamples: 0, flags: 0 });
const transfer = (id, width, height = 1, direction = 1) => packet(43, 0, [id, 0, 0, 0, 0, 0, 0, 0, width, height, 1, 0, direction]);
function clear(values) {
  const raw = packet(7, 0, [4, ...values.map(word), 0, 0, 0]);
  new DataView(raw.buffer).setFloat64(24, 1, true); return raw;
}
function traceGL(gl, c, delay, hostIndexLimit) {
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
      if (["drawArrays","drawElements","drawArraysInstanced","drawElementsInstanced"].includes(name)) calls.push({ name, args: [...args], turn, label: currentLabel,
        program: gl.getParameter(gl.CURRENT_PROGRAM), activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),
        indexBuffer: objects.get(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)) ?? null,
        attributes: Array.from({length:gl.getProgramParameter(gl.getParameter(gl.CURRENT_PROGRAM),gl.ACTIVE_ATTRIBUTES)},(_,i)=>{
          const p=gl.getParameter(gl.CURRENT_PROGRAM),a=gl.getActiveAttrib(p,i),location=gl.getAttribLocation(p,a.name);
          return location<0?{name:a.name,location}:{name:a.name,location,
            divisor:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_DIVISOR),
            stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),
            offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),
            components:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_SIZE),
            enabled:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_ENABLED),
            genericValues:[...gl.getVertexAttrib(location,gl.CURRENT_VERTEX_ATTRIB)],
            buffer:objects.get(gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING))??null};
        }) });
      const result = value.apply(target, args);
      if (name==="getParameter" && args[0]===gl.MAX_ELEMENT_INDEX) {
        const delivered=hostIndexLimit===undefined?result:hostIndexLimit;
        events.push({name,parameter:"MAX_ELEMENT_INDEX",actual:result,delivered});
        return delivered;
      }
      if (name === "getActiveAttrib" || name === "getActiveUniform") events.push({ name, turn, label: currentLabel,
        index: args[1], result: result ? { name: result.name, type: result.type, size: result.size } : null });
      if (/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name) && result) objects.set(result, next++);
      if (name === "fenceSync" && result) {
        const entry = { id: next++, turn, lastPoll: -1, left: typeof delay === "function" ? delay({turn,label:currentLabel,ordinal:events.filter(e=>e.name==="fenceSync").length}) : delay }; syncs.set(result, entry);
        events.push({ name, turn, label: currentLabel, sync: entry.id });
      }
      if (name === "getBufferSubData") events.push({ name, turn, label: currentLabel, bytes: args[2].byteLength, ...(args[2].byteLength<=64?{hex:hex(new Uint8Array(args[2].buffer,args[2].byteOffset,args[2].byteLength))}:{}) });
      if (name === "copyBufferSubData") events.push({ name, turn, label: currentLabel, args: [...args],
        source: objects.get(gl.getParameter(gl.COPY_READ_BUFFER_BINDING)) ?? null,
        destination: objects.get(gl.getParameter(gl.COPY_WRITE_BUFFER_BINDING)) ?? null });
      if (name === "vertexAttrib4fv") events.push({ name, turn, label: currentLabel, location: args[0], values: [...args[1]] });
      if (name === "uniform4uiv") events.push({ name, turn, label: currentLabel, words: [...args[1]] });
      if (name === "deleteSync") { events.push({ name, turn, label: currentLabel, sync: syncs.get(args[0])?.id ?? null }); syncs.delete(args[0]); }
      return result;
    };
    methods.set(name, fn); return fn;
  } });
  return { gl: traced, calls, events, id: value => objects.get(value) ?? null,
    nextTurn() { turn++; }, label(value) { currentLabel = value; } };
}
function rig(gl, bridge, c, { delay = 0, step = 64, width = 16, height = 16, drawLimits, hostIndexLimit, resourceLimits, jobLimits,
  factory = createVirglStandardAsyncRenderer } = {}) {
  const trace = traceGL(gl, c, delay, hostIndexLimit), allocations = [];
  const backend = c.ok(createWebGL2TransferBackend(trace.gl), "real transfer backend").backend;
  const owner = c.ok(createResourceStore({ backend: { ...backend, allocate(metadata) {
    const storage = backend.allocate(metadata); allocations.push({ metadata, storage }); return storage;
  } }, ...(resourceLimits ? { limits: resourceLimits } : {}) }), "owned resources");
  const renderer = c.ok(factory({
    gl: trace.gl, shaderBridge: bridge, resources: owner.store, bindings: owner.bindings, asyncAccess: owner.asyncAccess,
    jobLimits: { commandsPerStep: step, ...jobLimits }, ...(drawLimits ? { drawLimits } : {}),
  }), "host-selected renderer").renderer;
  c.same(Object.hasOwn(renderer, "executeSubmission"), false, "async factory has no synchronous escape");
  for (const ctx of [1, 2]) { c.ok(owner.store.createContext(ctx), "resource context"); c.ok(renderer.createContext(ctx), "renderer context"); }
  const r = { gl, bridge, c, ...owner, renderer, trace, allocations, width, height, frame: 0, history: [], exchanges: [], frames: [], blobs: [] };
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
async function submit(r, ctx, bytes, label, onYield = null) {
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
      if (onYield) await onYield(step,begun.job,r);
      if (step.status === "needs-input") {
        const request = step.request, layout = request.layout, rows = [];
        for (let row = 0; row < layout.rowCount; row++)
          rows.push(c.ok(r.store.readBacking(request.resource.id, layout.offset + row * layout.rowStride, layout.rowBytes), "fresh input row").bytes);
        const input = join(...rows);
        r.exchanges.push({ label, direction: "upload", resource: request.resource, layout, blob: await blob(r,input) });
        c.ok(renderer.provideInput(begun.job, request.token, input), "owned input exchange"); input.fill(255);
        c.same(renderer.provideInput(begun.job, request.token, input).ok, false, "consumed input token rejects");
      }
    }
    c.same(Boolean(result), true, "bounded job completion");
    c.same(renderer.step(begun.job).ok, false, "consumed job rejects");
  }
  const dump = c.ok(renderer.endFrame(r.frame), "end host record").dump;
  const record = { label, ctx, hex: hex(original), result, steps, dump }; r.history.push(record);
  if (!result.ok && globalThis.window?.__standardDrawEvidence) window.__standardDrawEvidence.failedJob =
    { record, events: trace.events, inspection: renderer.inspect() };
  return record;
}
async function encodedPixels(raw) {
  const zipped = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const bytes = new Uint8Array(zipped), sha = async data => [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
  let binary = ""; for (const value of bytes) binary += String.fromCharCode(value);
  return { bytes: raw.length, sha256: await sha(raw), gzipSha256: await sha(bytes), gzipBase64: btoa(binary) };
}
function dispose(r) {
  r.c.ok(r.renderer.dispose(), "renderer cleanup"); r.c.ok(r.store.dispose(), "resource cleanup");
  for (const owner of [r.renderer, r.store]) for (const [name, value] of Object.entries(r.c.ok(owner.inspect(), "cleanup counters").budgets))
    r.c.same(value, 0, "zero owned budget " + name);
  r.c.same(r.gl.getError(), r.gl.NO_ERROR, "cleanup has no GL error");
}

export function runWireAcceptance() {
  const c=checks(), records=[];
  const test=(bytes,expected,legacy,label)=>{
    // Predict from literal documented wire fields before invoking either decoder.
    const a=decodeStandardSubmission(bytes),b=decodeSubmission(bytes);
    c.same(a.ok,expected,label+" standard");c.same(b.ok,legacy,label+" legacy");
    records.push({label,hex:hex(bytes),standard:a,legacy:b,expected,legacyExpected:legacy});
  };
  for(const divisor of [0,1,2,65535,0xffffffff])for(const format of [28,29,30,31,32])
    test(packet(1,5,[777,0,divisor,0,format]),format<=32,divisor===0&&format<=31,"element-"+divisor+"-"+format);
  for(const size of [0,1,2,3,4,8])for(const offset of [0,1,4,8,12,0xfffffffc])
    test(packet(11,0,[6,size,offset]),[1,2,4].includes(size)&&offset%size===0,size===2&&offset%2===0,"index-"+size+"-"+offset);
  for(const instances of [0,1,2,5,65536,0xffffffff])for(const mode of [0,4,5]) {
    const bytes=packet(8,0,[0,4,mode,0,instances,0,0,0,0,0,0xffffffff,0]);
    test(bytes,[0,4,5].includes(mode),instances===1&&[4,5].includes(mode),"draw-"+instances+"-"+mode);
  }
  test(join(packet(11,0,[6,4,12]),packet(8,0,[])),false,false,"malformed-tail");
  return {status:"passed",records,predictions:c.rows};
}
async function blob(r,bytes) {
  const saved={key:"blob-"+r.blobs.length.toString().padStart(4,"0"),...await encodedPixels(bytes)};
  r.blobs.push(saved);return {key:saved.key,bytes:saved.bytes,sha256:saved.sha256,gzipSha256:saved.gzipSha256};
}
const drawPacket = (spec,overrides={}) => {
  const o={...spec,...overrides};
  return packet(8,0,[o.indexed?0:o.start,o.mode===4?6:4,o.mode,o.indexed?1:0,o.instances,0,0,0,0,
    o.hints?.[0]??0,o.hints?.[1]??0xffffffff,0]);
};
function source(instances,{idPosition=false,budgetUniform=false}={}) {
  const n=Math.max(1,instances),dx=Math.fround(2/n);
  const instructions=[
    "I2F TEMP[0].x, SV[0].xxxx","MUL TEMP[0].x, TEMP[0].xxxx, IMM[0].xxxx",
    "ADD TEMP[0].x, TEMP[0].xxxx, IMM[0].yyyy",
    ...(idPosition?[
      "AND TEMP[1].x, SV[1].xxxx, IMM[2].xxxx","U2F TEMP[1].x, TEMP[1].xxxx",
      "MAD OUT[0].x, TEMP[1].xxxx, IMM[0].xxxx, TEMP[0].xxxx",
      "USHR TEMP[1].x, SV[1].xxxx, IMM[2].yyyy","AND TEMP[1].x, TEMP[1].xxxx, IMM[2].xxxx",
      "U2F TEMP[1].x, TEMP[1].xxxx","MAD OUT[0].y, TEMP[1].xxxx, IMM[3].xxxx, IMM[0].yyyy",
      "MOV OUT[0].zw, IMM[3].zwzw",
    ]:["MAD OUT[0].x, IN[0].xxxx, IMM[0].xxxx, TEMP[0].xxxx","MOV OUT[0].yzw, IN[0]"]),
    "MOV OUT[1].x, IN[1].xxxx","AND TEMP[1].x, SV[1].xxxx, IMM[1].xxxx","U2F TEMP[1].x, TEMP[1].xxxx",
    "MUL OUT[1].y, TEMP[1].xxxx, IMM[0].zzzz","AND TEMP[1].x, SV[0].xxxx, IMM[2].zzzz",
    "U2F TEMP[1].x, TEMP[1].xxxx","MAD OUT[1].z, TEMP[1].xxxx, IMM[0].wwww, IN[15].zzzz",
    "MOV OUT[1].w, IN[15].wwww",
  ];
  return {
    vertex:tgsi("vertex","DCL IN[0]\nDCL IN[1]\nDCL IN[15]\nDCL SV[0], INSTANCEID\nDCL SV[1], VERTEXID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[15]\nDCL TEMP[0..1]\n"+
      "IMM[0] FLT32 {"+dx+", -1.0, 0.003921568627, "+(budgetUniform?0:.125)+"}\nIMM[1] UINT32 {255,255,255,255}\n"+
      "IMM[2] UINT32 {1,1,7,7}\nIMM[3] FLT32 {2.0,2.0,0.0,1.0}",instructions),
    fragment:"FRAG\nDCL IN[0], GENERIC[15], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n",
  };
}
function specimen(options={}) {
  const s={instances:5,indexed:true,indexSize:4,indexOffset:12,start:5,base:70000,mode:5,
    divisors:[0,2,3],offsets:[16,32,16],sourceOffsets:[16,0,16],seed:0x92cba017,...options};
  s.used=s.idPosition?[1,15]:[0,1,15];s.width=s.width??Math.max(1,s.instances)*8;s.height=8;
  const base=s.indexed?s.base:s.start;
  s.ids=s.mode===4?[base,base+1,base+2,base+2,base+1,base+3]:[base,base+1,base+2,base+3];
  const max=Math.max(...s.ids),n=Math.max(1,s.instances);
  s.data=new Map();
  let seed=s.seed>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  for(let slot=0;slot<3;slot++){
    const divisor=s.divisors[slot],last=divisor?Math.floor((n-1)/divisor):max;
    const records=s.exact?last+1:Math.max(last+1,n),prefix=s.offsets[slot]+s.sourceOffsets[slot];
    let raw=new Uint8Array(prefix+records*16-(s.shortSlot===slot?1:0)),v=new DataView(raw.buffer);
    const indexes=divisor?Array.from({length:records},(_,i)=>i):[...new Set(s.ids)];
    for(const index of indexes){
      const corner=index-base;
      const value=slot===0?[corner===1||corner===3?1:0,corner>=2?1:-1,0,1]:
        slot===1?[s.budgetUniform ? .25 :(16+random()%176)/255,0,0,1]:
          [0,0,s.budgetUniform ? .125 :(4+random()%28)/255,s.budgetUniform ? 1 : (160+random()%80)/255];
      for(let lane=0;lane<4;lane++){const at=prefix+index*16+lane*4;if(at+4<=raw.length)v.setFloat32(at,value[lane],true);}
    }
    s.data.set(3+slot,raw);
  }
  if(s.indexed){
    const raw=new Uint8Array(s.indexOffset+s.ids.length*s.indexSize-(s.shortIndex?1:0)),v=new DataView(raw.buffer);
    s.ids.forEach((value,i)=>{const at=s.indexOffset+i*s.indexSize;if(at+s.indexSize<=raw.length){
      if(s.indexSize===1)v.setUint8(at,value);else if(s.indexSize===2)v.setUint16(at,value,true);else v.setUint32(at,value,true);
    }});s.data.set(6,raw);
  }
  Object.assign(s,source(s.instances,s));return s;
}
function setup(r,s) {
  r.spec=s;r.bufferBytes=s.data;
  for(const [id,raw]of s.data)add(r,meta(id,0,64,id===6?32:16,raw.length),raw);
  const elements=Array.from({length:16},()=>[s.sourceOffsets[0],s.divisors[0],0,31]);
  elements[1]=[s.sourceOffsets[1],s.divisors[1],1,31];elements[15]=[s.sourceOffsets[2],s.divisors[2],2,31];
  return join(...[...s.data].map(([id,raw])=>transfer(id,raw.length)),shader(1,0,s.vertex),shader(2,1,s.fragment),
    packet(1,5,[3,...elements.flat()]),packet(2,5,[3]),packet(6,0,s.offsets.flatMap((offset,slot)=>[16,offset,3+slot])),
    ...(s.indexed?[packet(11,0,[6,s.indexSize,s.indexOffset])]:[]),
    packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),
    packet(4,0,[0,...[r.width/2,r.height/2,.5,r.width/2,r.height/2,.5].map(word)]),
    packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));
}
async function physicalFrame(r,record,{allowError=false}={}) {
  const {gl,c}=r;
  if(!allowError)c.ok(record.result,record.label+" completed draw");
  c.same(record.result.gpuComplete,true,record.label+" real completion fence");
  const model=drawModel(r.history,r.bufferBytes,r.spec.used),fb=gl.createFramebuffer();
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
  for(const name of ["PACK_ROW_LENGTH","PACK_SKIP_PIXELS","PACK_SKIP_ROWS"])gl.pixelStorei(gl[name],0);
  gl.pixelStorei(gl.PACK_ALIGNMENT,1);
  const raw=new Uint8Array(r.width*r.height*4);gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,raw);gl.deleteFramebuffer(fb);
  const calls=r.trace.calls.filter(call=>call.label===record.label),call=calls.at(-1),nativeBuffers=[];
  for(const attr of call.attributes.filter(a=>a.location>=0)){
    const allocation=r.allocations.find(a=>r.trace.id(a.storage.buffer)===attr.buffer);
    const bytes=new Uint8Array(allocation.metadata.width);
    gl.bindBuffer(gl.COPY_READ_BUFFER,allocation.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,bytes);gl.bindBuffer(gl.COPY_READ_BUFFER,null);
    nativeBuffers.push({...attr,resourceId:allocation.metadata.id,generation:allocation.generation,blob:await blob(r,bytes)});
  }
  let nativeIndex=null;
  if(model.draw.indexed){
    const allocation=r.allocations.find(a=>r.trace.id(a.storage.buffer)===call.indexBuffer),bytes=new Uint8Array(allocation.metadata.width);
    gl.bindBuffer(gl.COPY_READ_BUFFER,allocation.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,bytes);gl.bindBuffer(gl.COPY_READ_BUFFER,null);
    nativeIndex={resourceId:allocation.metadata.id,generation:allocation.generation,blob:await blob(r,bytes)};
  }
  const audit=comparePixels(raw,model,r.width,r.height),frame={label:record.label,width:r.width,height:r.height,
    used:r.spec.used,history:r.history.map(h=>({label:h.label,hex:h.hex,ctx:h.ctx,result:h.result})),
    inputs:r.exchanges.filter(e=>e.direction==="upload").map(e=>({resource:e.resource,blob:e.blob})),
    native:{calls:calls.map(({program,...call})=>call),buffers:nativeBuffers,index:nativeIndex},
    predicted:{ids:model.ids,fetches:model.fetches},dump:record.dump,audit,pixels:await blob(r,raw)};
  r.frames.push(frame);
  c.same(audit.misses,[],record.label+" independent physical pixel oracle");
  const result=record.result.draws.at(-1);
  c.same(result.vertexWork,model.draw.count*model.effective,record.label+" charged total vertex-instance work");
  c.same(result.actualMinIndex,model.min,record.label+" actual minimum from bytes");
  c.same(result.actualMaxIndex,model.max,record.label+" actual maximum from bytes");
  c.same(result.indexByteLength,model.draw.indexed?model.draw.count*model.index.size:0,record.label+" actual index staging extent");
  const instanced=model.effective>1,op=model.draw.indexed?"drawElements":"drawArrays";
  c.same(call.name,op+(instanced?"Instanced":""),record.label+" actual native call selection");
  c.same(call.args,model.draw.indexed?[model.draw.mode===4?gl.TRIANGLES:gl.TRIANGLE_STRIP,model.draw.count,
    {1:gl.UNSIGNED_BYTE,2:gl.UNSIGNED_SHORT,4:gl.UNSIGNED_INT}[model.index.size],model.index.offset,...(instanced?[model.effective]:[])]:
    [model.draw.mode===4?gl.TRIANGLES:gl.TRIANGLE_STRIP,model.draw.start,model.draw.count,...(instanced?[model.effective]:[])],record.label+" literal native arguments");
  for(const f of model.fetches){
    const a=nativeBuffers.find(a=>a.name==="in_"+f.attributeIndex),actual=result.vertexFetches.find(a=>a.attributeIndex===f.attributeIndex);
    c.same({divisor:a.divisor,stride:a.stride,offset:a.offset,components:a.components,enabled:a.enabled},
      {divisor:Math.min(f.divisor,65536),stride:f.stride,offset:f.offset,components:f.components,enabled:true},record.label+" native attribute "+f.attributeIndex);
    const keys=["attributeIndex","resourceId","stride","offset","components","firstByte","requiredEnd","divisor","firstElement","lastElement"];
    c.same(Object.fromEntries(keys.map(k=>[k,actual[k]])),Object.fromEntries(keys.map(k=>[k,f[k]])),record.label+" independently predicted fetch "+f.attributeIndex);
  }
  c.same(gl.getError(),gl.NO_ERROR,record.label+" no GL error");return frame;
}
function poison(gl) {
  gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.viewport(0,0,1,1);gl.colorMask(false,false,false,false);
  for(let i=0;i<gl.getParameter(gl.MAX_VERTEX_ATTRIBS);i++)gl.vertexAttribDivisor(i,7);
}
export async function runAcceptance({smoke=false}={}) {
  const c=checks(),report={schema:"virgl-standard-draw-v1",status:"running",guestExecution:false,productionNegotiation:false,
    predictions:c.rows,frames:[],runs:[],blobs:[],rejections:[],suspensions:[]};
  window.__standardDrawEvidence=report;
  const gl=document.querySelector("#gpu").getContext("webgl2",{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
  c.same(gl instanceof WebGL2RenderingContext,true,"actual hardware WebGL2");
  const debug=gl.getExtension("WEBGL_debug_renderer_info");c.same(Boolean(debug),true,"actual GPU identity");
  report.gpu=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);c.same(/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu),false,"physical GPU");
  report.maxElementIndex=gl.getParameter(gl.MAX_ELEMENT_INDEX);
  const bridge=await createVirglStandardShaderBridge();
  const make=(s,options={})=>{const r=rig(gl,bridge,c,{width:s.width,height:s.height,...options});r.frames=report.frames;r.blobs=report.blobs;return r;};
  const done=r=>{report.runs.push({history:r.history,exchanges:r.exchanges,events:r.trace.events,
    calls:r.trace.calls.map(({program,...a})=>a),work:c.ok(r.renderer.inspect(),"final counters").work});dispose(r);};
  const schedules=smoke?[[0,64]]:[[0,64],[2,1],[5,3]];
  for(const [delay,step]of schedules){
    const configs=[
      ["mixed-wide",{}],["byte-instanced",{indexSize:1,base:32,divisors:[0,1,2]}],
      ["short-instanced",{indexSize:2,base:259,mode:4,divisors:[0,2,0]}],
      ["arrays-instanced",{indexed:false,start:5,divisors:[0,0,1]}],
      ["ordinary-zero",{indexed:false,instances:0,divisors:[0,2,0xffffffff]}],
      ["ordinary-one",{indexSize:4,instances:1,divisors:[0,1,2]}],
      ["huge-divisor",{indexSize:2,base:64,divisors:[0,65535,0xffffffff]}],
      ["exact-end",{indexSize:1,base:17,divisors:[0,2,3],exact:true}],
      ["all-instance-attributes",{idPosition:true,base:70000,divisors:[1,2,3]}],
    ];
    for(const [label,options]of(smoke?configs.slice(0,1):configs)){
      const s=specimen(options),r=make(s,{delay,step});
      let rec=await submit(r,1,join(setup(r,s),drawPacket(s)),label+"-"+delay);await physicalFrame(r,rec);
      if(label==="mixed-wide"){
        poison(gl);
        rec=await submit(r,2,join(shader(1,0,s.vertex),shader(2,1,s.fragment),
          // Objects and state are context-local, allocations are shared.
          packet(1,5,[3,...Array.from({length:16},(_,i)=>i===1?[0,1,1,31]:i===15?[16,2,2,31]:[16,0,0,31]).flat()]),
          packet(2,5,[3]),packet(6,0,[16,16,3,16,32,4,16,16,5]),packet(11,0,[6,4,12]),
          packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),packet(4,0,[0,...[s.width/2,4,.5,s.width/2,4,.5].map(word)]),
          packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]),drawPacket(s)),"context-B-"+delay);
        await physicalFrame(r,rec);poison(gl);
        rec=await submit(r,1,join(clear([0,0,0,0]),drawPacket(s)),"context-A-restored-"+delay);
        await physicalFrame(r,rec);
      }
      done(r);
    }
  }
  if(!smoke){
    report.hostFaults=[];
    for(const limit of [-1,1.5,0x100000000]){
      const trace=traceGL(gl,c,0,limit),backend=c.ok(createWebGL2TransferBackend(trace.gl),"fault host transfer").backend;
      const owner=c.ok(createResourceStore({backend}),"fault host resources");
      const rejected=createVirglStandardAsyncRenderer({gl:trace.gl,shaderBridge:bridge,resources:owner.store,
        bindings:owner.bindings,asyncAccess:owner.asyncAccess});
      report.hostFaults.push({limit,result:rejected,events:trace.events});
      c.same(rejected.ok,false,"non-u32 native limit rejects");c.same(rejected.error.code,"unsupported-host","native limit error");
      c.ok(owner.store.dispose(),"fault host cleanup");
    }
    for(const [label,options,extra,code]of[
      ["instance-one-byte-short",{shortSlot:1,exact:true},null,"out-of-bounds"],
      ["vertex-one-byte-short",{shortSlot:0,exact:true},null,"out-of-bounds"],
      ["index-one-byte-short",{shortIndex:true},null,"out-of-bounds"],
      ["false-safe-hints",{shortSlot:0,exact:true,hints:[0,0]},null,"out-of-bounds"],
      ["max-native-index",{}, {hostIndexLimit:69999},"unsupported-draw"],
      ["too-much-work",{instances:16385,width:63,budgetUniform:true},null,"limit-exceeded"],
      ["signed-array-range",{indexed:false,start:0x7fffffff},null,"unsupported-draw"],
    ]){
      // Signed-range rejection needs no gigantic speculative backing allocation.
      const s=specimen(label==="signed-array-range"?{indexed:false,start:5}:options),r=make(s,extra??{});
      const commands=join(setup(r,s),drawPacket(s,label==="signed-array-range"?{start:0x7fffffff}:{}));
      const rec=await submit(r,1,commands,"reject-"+label);
      report.rejections.push({label,result:rec.result,history:r.history,events:r.trace.events,nativeDraws:r.trace.calls.map(({program,...a})=>a)});
      c.same(rec.result.ok,false,label+" rejects");c.same(rec.result.error.code,code,label+" specified error");
      c.same(r.trace.calls.length,0,label+" before native draw");done(r);
    }
    for(const size of [1,2,4]){
      // D9 preserves u8/u16 maximum vertices. Keep this retained negative a
      // genuine one-byte-short source bound; u32max is still not a real index.
      const base=size===1?252:size===2?65532:64,s=specimen({indexSize:size,base,divisors:[0,2,3],...(size<4?{shortSlot:0}:{})}),r=make(s);
      if(size===4)new DataView(s.data.get(6).buffer).setUint32(s.indexOffset,0xffffffff,true);
      const rec=await submit(r,1,join(setup(r,s),drawPacket(s)),"reject-fixed-sentinel-"+size);
      report.rejections.push({label:"fixed-sentinel-"+size,result:rec.result,history:r.history,events:r.trace.events,nativeDraws:r.trace.calls.map(({program,...a})=>a)});
      c.same(rec.result.error.code,size<4?"out-of-bounds":"unsupported-draw","maximum index "+size+" bound fails explicitly");c.same(r.trace.calls.length,0,"maximum index before draw");done(r);
    }
    // Hints are structurally valid but deliberately false; actual bytes win.
    {const s=specimen({indexSize:4,hints:[90000,90000]}),r=make(s),rec=await submit(r,1,join(setup(r,s),drawPacket(s)),"false-large-hints");
      await physicalFrame(r,rec);done(r);}
    {const s=specimen({instances:16384,width:63,budgetUniform:true,divisors:[0,1,2],exact:true}),r=make(s);
      const rec=await submit(r,1,join(setup(r,s),drawPacket(s)),"exact-total-work-budget");await physicalFrame(r,rec);done(r);}
    {const s=specimen({instances:2}),r=make(s,{drawLimits:{indicesPerSubmission:16}});
      const rec=await submit(r,1,join(setup(r,s),drawPacket(s),drawPacket(s),drawPacket(s)),"cumulative-work-budget");
      c.same(rec.result.error.code,"limit-exceeded","third cumulative draw rejects");c.same(r.trace.calls.length,2,"two valid draws precede budget rejection");
      await physicalFrame(r,rec,{allowError:true});done(r);}
    {const s=specimen(),r=make(s),baseline=r.trace.events.length,rec=await submit(r,1,join(setup(r,s),packet(8,0,[])),"malformed-whole-snapshot");
      c.same(rec.result.ok,false,"malformed tail rejects");c.same(c.ok(r.renderer.inspect(),"no prefix").work.appliedCommands,0,"no partial prefix mutation");
      c.same(r.trace.events.length,baseline,"no native mutation before whole decode");report.rejections.push({label:"malformed-whole-snapshot",result:rec.result,history:r.history,events:r.trace.events,nativeDraws:[]});done(r);}
    for(const action of ["cancel","revision","reuse"]){
      const s=specimen(),r=make(s,{delay:3,step:2});c.ok((await submit(r,1,setup(r,s),"suspension-setup-"+action)).result,"suspension initialized");
      let fired=false,oldGeneration,newGeneration;
      const rec=await submit(r,1,join(clear([0,0,0,0]),drawPacket(s)),"pending-index-"+action,async(_step,token)=>{
        if(fired||c.ok(r.renderer.inspect(),"pending inspection").jobs.status!=="waiting-index")return;
        fired=true;oldGeneration=r.allocations.find(a=>a.metadata.id===6).generation;
        if(action==="cancel")c.ok(r.renderer.cancel(token),"pending-index cancellation");
        else if(action==="revision"){
          const command=c.ok(decodeStandardSubmission(transfer(6,s.data.get(6).length)),"literal concurrent index transfer").commands[0];
          const prepared=c.ok(r.store.prepareTransfer(1,command),"concurrent owned index transfer");
          c.ok(r.store.executeTransfer(prepared.ticket),"change actual index content revision");
        }else{
          c.ok(r.store.unref(6),"public index ID unref");newGeneration=add(r,meta(6,0,64,32,s.data.get(6).length),new Uint8Array(s.data.get(6).length)).generation;
          c.same(newGeneration>oldGeneration,true,"same name has newer storage generation");
        }
      });
      c.same(fired,true,"actual GPU index suspension reached");
      if(action==="reuse"){await physicalFrame(r,rec);c.same(rec.result.draws[0].indexResourceGeneration,oldGeneration,"draw retains original index generation");}
      else {c.same(rec.result.error.code,action==="cancel"?"cancelled":"stale-storage","pending index "+action+" fails");
        c.same(rec.result.gpuComplete,true,"pending index "+action+" drains real fence");c.same(r.trace.calls.length,0,"pending "+action+" does not draw");}
      report.suspensions.push({action,oldGeneration,newGeneration,record:rec,events:r.trace.events,
        async:c.ok(r.asyncAccess.inspect(),"drained asynchronous storage"),nativeDraws:r.trace.calls.map(({program,...a})=>a)});
      c.same(r.asyncAccess.inspect().reads,0,"index read released");c.same(r.asyncAccess.inspect().stagingBytes,0,"index scratch released");done(r);
    }
  }
  report.status="passed";return report;
}

// Shared physical fixture drivers for the separately promoted critic cases.
export { checks, rig, meta, add, transfer, shader, clear, submit, dispose,
  specimen, setup, physicalFrame, drawPacket, hex, blob };
