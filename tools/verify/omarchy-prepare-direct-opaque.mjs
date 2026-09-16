#!/usr/bin/env node
// Prepare one local pair, without conflating it with the subsequent input test.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { watchOwnedTrial } from "./omarchy-owned-trial.mjs";
import { assertInputTrialSource, assertInputTrialRuntime } from "./omarchy-input-trial.mjs";
import { modePreparationOptions, validatePreparedPair, MODE_PREPARATION_MS } from "./omarchy-mode-preparation.mjs";
import { assertOriginalPresentation } from "./omarchy-opaque-foot-command.mjs";
import { DIRECT_OPAQUE_COMMAND, auditDirectOpaque } from "./omarchy-direct-opaque-command.mjs";
import { auditSerial } from "./omarchy-latency-receipt.mjs";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert.ok(process.argv[2] && process.argv[3], "usage: omarchy-prepare-direct-opaque.mjs NEW_EVIDENCE_DIR NEW_PAIR_DIR");
const out=path.resolve(process.argv[2]), pair=path.resolve(process.argv[3]);
assert.ok(pair.startsWith(path.join(repo,"target")+path.sep), "private pair must live under target/");
await assert.rejects(fs.stat(pair), { code: "ENOENT" });
await fs.mkdir(out, { recursive:false });
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const receipt={purpose:"offline-direct-opaque-preparation",keyboardAcceptance:false,pairDirectory:pair,
  head:execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim(),
  wasmSha256:sha(await fs.readFile(path.join(repo,"web/dist/pkg/wasm_vm_wasm_bg.wasm"))),startedAt:new Date().toISOString()};
const save=()=>fs.writeFile(path.join(out,"run.json"),JSON.stringify(receipt,null,2)+"\n"); await save();
const env={...process.env}; for(const key of Object.keys(env))if(key.startsWith("OMARCHY_"))delete env[key];
Object.assign(env,{OMARCHY_CANDIDATE_PAIR_DIR:path.join(repo,"target/omarchy-sdr-r3-snapshot"),
  OMARCHY_CANDIDATE_CHUNKS:path.join(repo,"target/omarchy-profile-chunks-sdr-r3-256k"),OMARCHY_MODE_PAIR_OUTPUT_DIR:pair});
receipt.args=["tools/verify/omarchy-desktop-live.mjs","local",path.join(out,"desktop"),"direct-opaque-pair"];
const log=createWriteStream(path.join(out,"desktop.log"),{flags:"wx"});
const child=spawn(process.execPath,receipt.args,{cwd:repo,env,detached:true,stdio:["ignore","pipe","pipe","ipc"]});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
receipt.exit=await watchOwnedTrial(child,{modePreparation:true});
child.stdout.unpipe(log);child.stderr.unpipe(log);await new Promise(resolve=>log.end(resolve));
receipt.finishedAt=new Date().toISOString();await save();
if(!receipt.exit.closed||receipt.exit.watchdog||receipt.exit.error){
  child.unref();child.stdout.destroy();child.stderr.destroy();if(child.connected)child.disconnect();
  throw Error("mode preparation did not close normally; no usable pair");
}
const report=JSON.parse(await fs.readFile(path.join(out,"desktop/report.json"),"utf8"));
try {
  assert.equal(report.mode,"direct-opaque-pair");assert.equal(report.trial.head,receipt.head);assert.equal(report.trial.scopedStatus,"");
  assert.equal(report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256,receipt.wasmSha256);
  assertInputTrialSource(report.candidate.source);assert.equal(report.startup.timeoutMs,MODE_PREPARATION_MS);
  assert.equal(Date.parse(report.startup.deadlineAt)-Date.parse(report.startup.startedAt),MODE_PREPARATION_MS);
  assert.equal(report.cleanup.closed,true);assert.deepEqual(report.errors,[]);assert.equal(report.keyboard,undefined);
  assert.deepEqual(report.inputEvents,[]);
  assert.equal(report.preparationInputFence.ignore,true);
  assert.ok(Date.parse(report.preparationInputFence.acknowledgedAt)<=Date.parse(report.browserRequests[0].timestamp));
  for(const row of report.workerTraffic)assert.ok(!/^(?:send(?:Keyboard|Tablet|Mouse|Agent)|sync(?:Keyboard|Tablet|Mouse))/u.test(row.method??""),"guest input during preparation");
  const allowed=["XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers", DIRECT_OPAQUE_COMMAND];
  receipt.serial=auditSerial(report.workerTraffic,allowed);
  assert.ok(receipt.serial.every(row=>allowed.includes(row.command)));
  for(const row of report.observations.filter(row=>row.runtime))assertInputTrialRuntime(row.runtime,modePreparationOptions());
  if(report.directOpaque) receipt.configuration=auditDirectOpaque(report);
  if(report.result!=="prepared-mode-pair-input-untested"){
    assert.equal(report.result,"failed");assert.equal(report.modePreparation?.status,"preparation-failed-input-untested");
    receipt.result="preparation-failed-input-untested";receipt.usablePair=false;
  }else{
    assert.equal(report.directOpaque.status,"properties-confirmed");
    const prep=report.modePreparation;
    assert.equal(prep.status,"pair-captured-input-untested");assert.ok(prep.lastPixels.pixels.nonblank);
    assertOriginalPresentation(prep.runtimeBefore.presentation);
    assertOriginalPresentation(prep.lastPixels.state);
    assert.ok(prep.lastPixels.state.framesReceived>prep.presentationBaseline.framesReceived);
    assert.ok(prep.lastPixels.state.successfulPresents>prep.presentationBaseline.successfulPresents);
    const configured=receipt.serial.filter(row=>row.command===DIRECT_OPAQUE_COMMAND);
    assert.equal(configured.length,1);assert.equal(configured[0].response?.exit,0);
    assert.deepEqual(report.directOpaque.foot,prep.foot);
    assert.ok(Date.parse(configured[0].completedAt)<=Date.parse(prep.baselineAt));
    assert.ok(Date.parse(configured[0].completedAt)<=Date.parse(prep.visibleAt));
    assert.ok(Date.parse(prep.visibleAt)<Date.parse(report.startup.deadlineAt));
    assert.ok(Date.parse(prep.exportFinishedAt)<Date.parse(prep.exportDeadlineAt));
    assert.equal(report.pair.paused,true);assert.equal(report.pair.restoreDecision,"resume");
    for(const [role,name] of [["snapshot","omarchy-ready.snap.gz"],["delta","omarchy-overlay-delta.bin.gz"]]){
      assert.equal(report.pair[role].filename,path.join(pair,name));
      const bytes=await fs.readFile(path.join(pair,name));
      assert.equal(bytes.length,report.pair[role].size);assert.equal(sha(bytes),report.pair[role].sha256);
    }
    receipt.pair=validatePreparedPair(gunzipSync(await fs.readFile(report.pair.snapshot.filename),{maxOutputLength:2*1024**3}),
      gunzipSync(await fs.readFile(report.pair.delta.filename),{maxOutputLength:512*1024**2}),
      await fs.readFile(report.candidate.source.chunkManifest.filename),report.pair);
    receipt.artifacts={snapshot:report.pair.snapshot,delta:report.pair.delta};
    receipt.result="prepared-pair-awaiting-personal-image-verification";receipt.usablePair=false;
    // Only the worker/critic's real-image inspection can approve this as a
    // visible candidate; this automatic result never grants input acceptance.
  }
}catch(error){receipt.auditError=String(error);throw error;}finally{await save();}
console.log(JSON.stringify(receipt,null,2));
