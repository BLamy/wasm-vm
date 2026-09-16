import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { terminalInterior, modePreparationOptions, validatePreparedPair, prepareSmallerDesktop } from "./omarchy-mode-preparation.mjs";
import { inputTrialOptions } from "./omarchy-input-trial.mjs";

test("preparation uses a distinct offline budget without altering physical-input deadlines", () => {
  assert.equal(modePreparationOptions().startupMs,900000);
  assert.equal(modePreparationOptions().captureMs,180000);
  const trial=inputTrialOptions({urlArg:"local",pair:"pinned",chunks:"pinned",arm:"candidate",renderer:null,lp:null,experiment:"residency"});
  assert.equal(trial.startupMs,300000);assert.equal(trial.readbackMs,120000);
});

// These are orchestration fixtures, never recordings of a guest or visible text.
function preparationFixture({ active = true, captureError = false, imageError = false, restored = true } = {}) {
  const trace = [], report = { restored };
  const before = { gpu: { scanoutWidth: 1280 }, presentation: { framesReceived: 2, successfulPresents: 2 } };
  const after = { gpu: { advertisedWidth: 640, advertisedHeight: 400, scanoutWidth: 640, scanoutHeight: 448 },
    presentation: { framesReceived: 3, successfulPresents: 3, latest: { resourceWidth: 640, resourceHeight: 448 } } };
  const foot = { address: "fixture-foot", class: "foot", mapped: true, hidden: false, at: [10,36], size: [620,354] };
  const runtime = { jit: { hasExecutor: true, admissionProbe: false,
    coldCounterRecycling: { enabled: false, threshold: 512, capacity: 65536, epochs: "0", discardedCounters: "0" },
    decodedCacheEntries: 4096, jitResidencyPolicy: "cap-256", jitResidencyCap: 256, entryCost: { timingEnabled: false } },
    clock: { mode: "icount", clockDiv: 64 } };
  let requested = false;
  const page = {
    async evaluate(fn) {
      const source = fn.toString();
      if (source.includes("displayStats")) return requested ? after : before;
      if (source.includes("wvmDemo.setDisplay")) { trace.push("mode"); requested = true; return true; }
      if (source.includes("__presentation.readPixels")) {
        trace.push("pixels"); return { state: after.presentation, pixels: { nonblank: true } };
      }
      throw Error("unexpected synthetic page call");
    },
    async waitForFunction() { trace.push("frame"); },
  };
  const operations = {
    async observeRuntime(label) { trace.push(label); return runtime; },
    async exec(command) {
      if (command.endsWith("-j clients")) return { exit: 0, stdout: JSON.stringify([foot]) };
      if (command.endsWith("-j activewindow")) return { exit: 0, stdout: JSON.stringify(active ? foot : { address: "other" }) };
      trace.push("compositor"); return { exit: 0, stdout: "ok\n" };
    },
    async screenshot(name) { assert.equal(name, "prepared-desktop.png"); trace.push("image"); if (imageError) throw Error("image failure"); },
    async capturePair() { trace.push("export"); if (captureError) throw Error("export failure"); },
  };
  return { report, trace, run: deadline => prepareSmallerDesktop(page, deadline, report, operations) };
}
test("offline preparation exports only after smaller focused visible frame and screenshot", async () => {
  const f = preparationFixture(); await f.run(Date.now()+10000);
  assert.deepEqual(f.trace, ["mode-preparation-before", "mode", "compositor", "frame", "pixels", "mode-preparation-ready", "image", "export"]);
  assert.equal(f.report.modePreparation.status, "pair-captured-input-untested");
  assert.equal(f.report.modePreparation.keyboardTested, false); assert.equal(f.report.keyboard, undefined);
  assert.equal(Date.parse(f.report.modePreparation.exportDeadlineAt)-Date.parse(f.report.modePreparation.exportStartedAt), 180000);
});
test("offline preparation preserves focus, image, export and startup failures without acceptance", async () => {
  for (const options of [{active:false}, {imageError:true}, {captureError:true}, {restored:false}]) {
    const f = preparationFixture(options); await assert.rejects(f.run(Date.now()+10000));
    assert.equal(f.report.modePreparation.status, "preparation-failed-input-untested");
    assert.equal(f.report.keyboard, undefined);
    if (!options.captureError) assert.ok(!f.trace.includes("export"));
  }
  const f=preparationFixture(); await assert.rejects(f.run(Date.now()-1), /deadline exceeded/);
  assert.deepEqual(f.trace, []); assert.equal(f.report.modePreparation.status, "preparation-failed-input-untested");
});
test("native-pixel Foot interior rejects black, bar-only and wrong-location content", () => {
  const pixels=new Uint8ClampedArray(1280*800*4);
  const foot={class:"foot",mapped:true,hidden:false,at:[10,36],size:[620,354]};
  const check=()=>terminalInterior(pixels,1280,800,foot);
  assert.equal(check().nonblank,false);
  function paint(y){for(let x=28;x<200;x++){const i=(y*1280+x)*4;pixels.set([160+x%16,170,180,255],i);}}
  paint(12);assert.equal(check().nonblank,false,"bar text is not terminal text");
  paint(60);assert.equal(check().nonblank,true,"native pixel coordinates must not be doubled");
  assert.equal(terminalInterior(pixels,1280,800,{...foot,at:[10,150],size:[620,200]}).nonblank,false);
  assert.throws(()=>terminalInterior(pixels,1280,800,{...foot,mapped:false}));
  assert.throws(()=>terminalInterior(pixels,1280,800,{...foot,size:[1260,754]}));
});
function pairFixture(){
  const manifest={version:1,image_len:4294967296,chunk_size:262144,layout:"split",chunks:Array(16384).fill("a".repeat(64))};
  const bytes=Buffer.from(JSON.stringify(manifest)),base=createHash("sha256").update(bytes).digest("hex");
  const snapshot=Buffer.alloc(1048577);snapshot.write("WVMRESU1");snapshot.writeUInt32LE(1,8);snapshot.write("0.0.1",12);
  Buffer.from(base,"hex").copy(snapshot,44);snapshot.writeBigUInt64LE(7n,76);
  const delta=Buffer.alloc(61+2*4104);delta.write("WVOD1");delta.writeUInt32LE(4096,5);delta.writeBigUInt64LE(4294967296n,9);
  Buffer.from(base,"hex").copy(delta,17);delta.writeBigUInt64LE(7n,49);delta.writeUInt32LE(2,57);
  delta.writeBigUInt64LE(3n,61);delta.writeBigUInt64LE(9n,61+4104);
  return {snapshot,delta,bytes,receipt:{snapshotBytes:snapshot.length,base,coreId:snapshot.subarray(12,44).toString("hex"),generation:7,blocks:2}};
}
test("pair guard rejects foreign core/base/generation and incomplete or duplicate delta records",()=>{
  const f=pairFixture();assert.equal(validatePreparedPair(f.snapshot,f.delta,f.bytes,f.receipt).blocks,2);
  for(const mutate of [
    r=>r.snapshot[12]^=1,r=>r.snapshot[44]^=1,r=>r.snapshot.writeBigUInt64LE(8n,76),
    r=>r.delta[17]^=1,r=>r.delta.writeBigUInt64LE(8n,49),r=>r.delta.writeBigUInt64LE(3n,61+4104),
    r=>r.delta.writeBigUInt64LE(1048576n,61+4104),r=>r.delta=r.delta.subarray(0,-1),
    r=>r.delta=Buffer.concat([r.delta,Buffer.from([0])]),
  ]){const r=pairFixture();mutate(r);assert.throws(()=>validatePreparedPair(r.snapshot,r.delta,r.bytes,r.receipt));}
});
