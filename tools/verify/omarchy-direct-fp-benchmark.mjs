#!/usr/bin/env node
// Five paired, alternated comparisons of the exact old and new browser bundles.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import {mixedFpFixture} from "./omarchy-direct-fp-fixture.mjs";
import {withinTrialDeadline} from "./omarchy-input-trial.mjs";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const out=path.resolve(process.argv[2]||"evidence/omarchy-profile/direct-fp-benchmark");
await fs.mkdir(out,{recursive:false});
const sha=data=>createHash("sha256").update(data).digest("hex");
const baseline=JSON.parse(execFileSync("python3",["tools/verify/omarchy-direct-fp-baseline.py"],{cwd:repo,encoding:"utf8"}));
const roots={baseline:baseline.directory,candidate:path.join(repo,"web/dist")};
const fixture=mixedFpFixture();
await fs.writeFile(path.join(out,"mixed-fp.elf"),fixture.elf);
const report={head:execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim(),
  baseline,artifacts:{},elfSha256:sha(fixture.elf),words:fixture.words,
  iterations:fixture.iterations,retirements:fixture.retirements,
  derivedHelperOccurrences:fixture.helperCalls,errors:[],passed:false};
for(const [arm,root] of Object.entries(roots)) {
  report.artifacts[arm]={};
  for(const name of ["pkg/wasm_vm_wasm.js","pkg/wasm_vm_wasm_bg.wasm"])
    report.artifacts[arm][name]=sha(await fs.readFile(path.join(root,name)));
}
assert.notEqual(report.artifacts.baseline["pkg/wasm_vm_wasm_bg.wasm"],report.artifacts.candidate["pkg/wasm_vm_wasm_bg.wasm"]);
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,"http://localhost");
  const headers={"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"};
  if(url.pathname==="/"){res.writeHead(200,{...headers,"Content-Type":"text/html"}).end("<!doctype html><title>Pure FP import comparison</title>");return;}
  const [,arm,...parts]=url.pathname.split("/");const root=roots[arm];
  if(!root){res.writeHead(404).end();return;}
  const name=path.resolve(root,parts.join("/"));
  if(!name.startsWith(root+path.sep)){res.writeHead(404).end();return;}
  try {const data=await fs.readFile(name);res.writeHead(200,{...headers,"Content-Type":path.extname(name)===".wasm"?"application/wasm":"text/javascript"}).end(data);}
  catch{res.writeHead(404).end();}
});
let browser;
try {
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const {chromium}=await import(pathToFileURL(path.join(repo,"web/node_modules/playwright/index.mjs")));
  browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
  report.browser=browser.version();
  const page=await browser.newPage({serviceWorkers:"block"});
  page.on("pageerror",error=>report.errors.push(String(error)));
  page.on("response",r=>{if(r.status()>=400&&!r.url().endsWith("/favicon.ico"))report.errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.measurement=await withinTrialDeadline(()=>page.evaluate(async input=>{
    if(!crossOriginIsolated)throw Error("isolated browser required");
    const modules={};
    for(const arm of ["baseline","candidate"]) {
      const bindings=await import(`/${arm}/pkg/wasm_vm_wasm.js`);const raw=await bindings.default();
      modules[arm]={bindings,raw};
    }
    function run(arm) {
      const vm=new modules[arm].bindings.WasmMachine(8);
      try {
        vm.loadElf(new Uint8Array(input.elf));vm.enableJit(1);
        const prefix=vm.run(256);
        const started=performance.now();const result=vm.run(input.retirements-256);const elapsedMs=performance.now()-started;
        return {arm,elapsedMs,prefix,result,registers:Array.from(vm.registers(),x=>x.toString(16)),
          digest:vm.stateDigest(),stats:vm.getStats(),jitStats:vm.jitStats()};
      } finally {vm.free();}
    }
    const warmups=[];
    for(const order of [["baseline","candidate"],["candidate","baseline"]])for(const arm of order)warmups.push(run(arm));
    const pairs=[];
    for(let pair=0;pair<5;pair++) {
      const order=pair%2?["candidate","baseline"]:["baseline","candidate"];
      pairs.push({pair,order,runs:order.map(run)});
    }
    return {warmups,pairs,candidateExports:Object.keys(modules.candidate.raw).filter(n=>n.startsWith("__jit_fp_")),baselineExports:Object.keys(modules.baseline.raw).filter(n=>n.startsWith("__jit_fp_"))};
  },{elf:Array.from(fixture.elf),retirements:fixture.retirements}),Date.now()+300000,"bounded matched FP import benchmark");
  const all=[...report.measurement.warmups,...report.measurement.pairs.flatMap(p=>p.runs)];
  const oracle=all[0];
  for(const run of all) {
    assert.equal(run.prefix.kind,"max");assert.equal(run.result.kind,"max");
    assert.equal(run.stats.retired,fixture.retirements);
    for(const [r,v] of fixture.expected)assert.equal(run.registers[r+1],v,`x${r}`);
    assert.equal(BigInt(`0x${run.registers[23]}`)&0x8000000000006000n,0x8000000000006000n);
    assert.deepEqual(run.registers,oracle.registers);assert.equal(run.digest,oracle.digest);assert.deepEqual(run.stats,oracle.stats);
    assert.ok(run.jitStats.retiredViaJit>=fixture.retirements*.99,"all five helpers must execute in the compiled loop");
    assert.equal(run.jitStats.retiredViaJit,oracle.jitStats.retiredViaJit);
    const interpreted=fixture.retirements-run.jitStats.retiredViaJit;
    run.compiledHelperLowerBounds=Object.fromEntries(Object.entries(fixture.helperCalls).map(([name,count])=>[name,count-interpreted]));
    assert.ok(Object.values(run.compiledHelperLowerBounds).every(count=>count>0));
  }
  assert.deepEqual(report.measurement.baselineExports,[]);
  assert.deepEqual(report.measurement.candidateExports.sort(),Object.keys(fixture.helperCalls).map(n=>"__jit_"+n).sort());
  const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
  const times=arm=>report.measurement.pairs.flatMap(p=>p.runs).filter(r=>r.arm===arm).map(r=>r.elapsedMs);
  report.medians={baselineMs:median(times("baseline")),candidateMs:median(times("candidate"))};
  report.candidateRatio=report.medians.candidateMs/report.medians.baselineMs;
  assert.deepEqual(report.errors,[]);
  assert.ok(report.candidateRatio<1,"candidate median must improve before promotion");
  report.passed=true;
  console.log(JSON.stringify({passed:true,...report.medians,candidateRatio:report.candidateRatio,digest:oracle.digest,compiled:oracle.jitStats.retiredViaJit}));
} catch(error){report.failure=String(error);throw error;}
finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(out,"report.json"),JSON.stringify(report,null,2)+"\n");}
