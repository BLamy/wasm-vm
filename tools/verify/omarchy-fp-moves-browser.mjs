#!/usr/bin/env node
// Actual built WasmMachine: integer-emitted FP loop versus interpreter, in Chromium.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withinTrialDeadline } from "./omarchy-input-trial.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.join(repo, "web/dist");
const { RISCV_TESTS } = await import(pathToFileURL(path.join(root, "riscv-tests.js")));
const out = path.resolve(process.argv[2] || "evidence/omarchy-profile/fp-moves-browser");
await fs.mkdir(out, { recursive: true });
const fp = (f7, f3, rd, rs1, rs2 = 0) => ((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x53) >>> 0;
const addi = (rd, rs1, imm) => ((imm << 20) | (rs1 << 15) | (rd << 7) | 0x13) >>> 0;
const bne = (rs1, rs2, offset) => ((((offset >>> 12) & 1) << 31) | (((offset >>> 5) & 63) << 25) |
  (rs2 << 20) | (rs1 << 15) | (1 << 12) | (((offset >>> 1) & 15) << 8) | (((offset >>> 11) & 1) << 7) | 0x63) >>> 0;
const csr = (rd, address) => ((address << 20) | (2 << 12) | (rd << 7) | 0x73) >>> 0;
const words = [0x000020b7, 0x30009073, 0x0014d073, 0x0023d073,
  0xffa010b7, addi(1,1,0x234), fp(0x78,0,1,1), fp(0x78,0,2,0), addi(5,0,500),
  fp(0x10,0,0,1,2), fp(0x10,1,31,0,2), fp(0x10,2,0,31,31),
  fp(0x70,0,6,0), fp(0x78,0,1,6), addi(5,5,-1), bne(5,0,-24),
  fp(0x70,0,7,31), csr(8,1), csr(9,2), csr(10,0x300),
  0x00000597, addi(11,11,0x800-20*4), 0x0005b027, 0x01f5b427, 0x0000006f];
// Minimal ET_EXEC/RISC-V ELF with one executable load segment; no synthetic
// completion: the guest performs its own FP loop and spills its actual FPR bits.
const elf = Buffer.alloc(0x1000 + words.length * 4);
elf.set([0x7f,0x45,0x4c,0x46,2,1,1]);
elf.writeUInt16LE(2,16); elf.writeUInt16LE(243,18); elf.writeUInt32LE(1,20);
elf.writeBigUInt64LE(0x80000000n,24); elf.writeBigUInt64LE(64n,32);
elf.writeUInt16LE(64,52); elf.writeUInt16LE(56,54); elf.writeUInt16LE(1,56);
elf.writeUInt32LE(1,64); elf.writeUInt32LE(7,68); elf.writeBigUInt64LE(0x1000n,72);
elf.writeBigUInt64LE(0x80000000n,80); elf.writeBigUInt64LE(0x80000000n,88);
elf.writeBigUInt64LE(BigInt(words.length*4),96); elf.writeBigUInt64LE(4096n,104); elf.writeBigUInt64LE(4096n,112);
words.forEach((word,index) => elf.writeUInt32LE(word,0x1000+index*4));
await fs.writeFile(path.join(out,"fp-moves.elf"),elf);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const report = { head: execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim(),
  wasmSha256: sha(await fs.readFile(path.join(root,"pkg/wasm_vm_wasm_bg.wasm"))),
  elfSha256: sha(elf), words, attemptedBudget: 4000, errors: [], passed: false };
let browser;
const server = createServer(async (request,response) => {
  const pathname = new URL(request.url,"http://localhost").pathname;
  const filename = path.resolve(root, `.${pathname}`);
  if (!filename.startsWith(`${root}/`)) { response.writeHead(404).end(); return; }
  try {
    const body = await fs.readFile(filename);
    const type = {".js":"text/javascript",".wasm":"application/wasm",".html":"text/html",".json":"application/json",".css":"text/css"}[path.extname(filename)] || "application/octet-stream";
    response.writeHead(200,{"Content-Type":type,"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"}).end(body);
  } catch { response.writeHead(404).end(); }
});
try {
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const { chromium } = await import(pathToFileURL(path.join(repo,"web/node_modules/playwright/index.mjs")));
  browser = await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
  report.browser = browser.version();
  const page = await browser.newPage({viewport:{width:1440,height:1050},serviceWorkers:"block"});
  page.on("pageerror",error => report.errors.push(String(error)));
  page.on("console",message => { if(message.type()==="error" && !message.location().url.endsWith("/favicon.ico")) report.errors.push(message.text()); });
  page.on("response",response => { if(response.status()>=400 && !response.url().endsWith("/favicon.ico")) report.errors.push(`${response.status()} ${response.url()}`); });
  // The existing testHooks layout reveals the actual compliance panel. This
  // fixture does not boot the desktop; its physical-input trial forbids hooks.
  await page.goto(`http://127.0.0.1:${server.address().port}/app.html?noAutoBoot=1&testHooks=1`);
  report.runs = await withinTrialDeadline(() => page.evaluate(async bytes => {
    const {default:init,WasmMachine} = await import("./pkg/wasm_vm_wasm.js"); await init();
    if(!crossOriginIsolated) throw Error("isolated production browser path required");
    const runs=[];
    for(const jit of [false,true]) {
      const vm = new WasmMachine(8);
      try {
        vm.loadElf(new Uint8Array(bytes)); if(jit) vm.enableJit(1);
        const statuses=[];
        for(let remaining=4000;remaining>0;) { const count=Math.min(256,remaining); statuses.push(vm.run(count)); remaining-=count; }
        runs.push({jit,statuses,registers:Array.from(vm.registers(),x=>x.toString(16)),digest:vm.stateDigest(),stats:vm.getStats(),jitStats:vm.jitStats()});
      } finally { vm.free(); }
    }
    return runs;
  },Array.from(elf)), Date.now()+60000, "bounded FP fixture");
  const [oracle,jit]=report.runs;
  for(const run of report.runs) {
    assert.ok(run.statuses.every(s=>s.kind==="max"));
    assert.equal(run.stats.retired,4000);
    assert.equal(run.registers[7],"7fa01234");
    assert.equal(run.registers[8],"ffffffffffa01234");
    assert.equal(run.registers[9],"9"); assert.equal(run.registers[10],"7");
    assert.equal(BigInt(`0x${run.registers[11]}`)&0x8000000000006000n,0x8000000000006000n);
  }
  assert.deepEqual(jit.registers,oracle.registers); assert.equal(jit.digest,oracle.digest);
  assert.deepEqual(jit.stats,oracle.stats);
  assert.ok(BigInt(jit.jitStats.retiredViaJit)>=2800n,"the mixed FP loop itself must compile, beyond the short final spin");
  await page.waitForFunction(() => document.getElementById("suite-run")?.disabled === false, null, {timeout:60000});
  await page.locator("#suite-run").evaluate(button => button.click());
  await page.waitForFunction(total => document.getElementById("metric-done")?.textContent.trim() === total &&
    document.getElementById("suite-run")?.disabled === false, String(RISCV_TESTS.length), {timeout:120000});
  report.suite = await page.evaluate(() => Object.fromEntries(["metric-pass","metric-fail","metric-done"].map(id=>[id,document.getElementById(id)?.textContent.trim()])));
  assert.deepEqual(report.suite, {"metric-pass":String(RISCV_TESTS.length),"metric-fail":"0","metric-done":String(RISCV_TESTS.length)});
  const capability = page.locator(".cap", {hasText:"Single-precision FP moves"});
  assert.match(await capability.locator(".cap-pip").getAttribute("class"), /\blive\b/u);
  report.capability = await capability.innerText();
  const suiteScreenshot = await page.locator("#panel-tests").screenshot({path:path.join(out,"suite.png")});
  report.suiteScreenshotSha256 = sha(suiteScreenshot);
  // Inspection capture of the legacy computed capability: reveal its existing
  // container without changing the suite result, text, classes or pip state.
  await page.locator("#legacy-roadmap").evaluate(element => { element.hidden=false; element.removeAttribute("aria-hidden"); });
  const capabilityScreenshot = await capability.screenshot({path:path.join(out,"capability-inspection.png")});
  report.capabilityInspection = { description:"Legacy computed capability, container revealed for inspection only", sha256:sha(capabilityScreenshot) };
  await page.locator("#rm-search").fill("E5.5-T03t");
  await page.locator(".rm-g-label").filter({hasText:"E5.5-T03t"}).click();
  await page.locator("#rm-detail").waitFor({state:"visible"});
  assert.deepEqual(report.errors,[]); report.passed=true;
  const screenshot=await page.screenshot({path:path.join(out,"built-page.png")}); report.screenshotSha256=sha(screenshot);
  console.log(JSON.stringify({passed:report.passed,wasmSha256:report.wasmSha256,digest:jit.digest,jitStats:jit.jitStats}));
} catch(error) { report.failure=String(error); throw error; }
finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); await fs.writeFile(path.join(out,"report.json"),JSON.stringify(report,null,2)+"\n"); }
