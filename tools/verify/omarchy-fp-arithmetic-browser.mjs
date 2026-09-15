#!/usr/bin/env node
// Actual built WasmMachine: compiled FP arithmetic loop versus interpreter, in Chromium.
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
const out = path.resolve(process.argv[2] || "evidence/omarchy-profile/fp-arithmetic-browser");
await fs.mkdir(out, { recursive: true });
const addi = (rd, rs1, imm) => ((imm << 20) | (rs1 << 15) | (rd << 7) | 0x13) >>> 0;
const bne = (rs1, rs2, offset) => ((((offset >>> 12) & 1) << 31) | (((offset >>> 5) & 63) << 25) |
  (rs2 << 20) | (rs1 << 15) | (1 << 12) | (((offset >>> 1) & 15) << 8) | (((offset >>> 11) & 1) << 7) | 0x63) >>> 0;
const csr = (rd, address) => ((address << 20) | (2 << 12) | (rd << 7) | 0x73) >>> 0;
const load = (wide, rd, base, off) => ((off<<20)|(base<<15)|((wide?3:2)<<12)|(rd<<7)|7)>>>0;
const store = (wide, rs, base, off) => (((off>>>5)<<25)|(rs<<20)|(base<<15)|((wide?3:2)<<12)|((off&31)<<7)|0x27)>>>0;
const integerLoad = (kind, rd, off) => ((off<<20)|(5<<15)|(kind<<12)|(rd<<7)|3)>>>0;
const arithmetic = (mul,rm,rd,rs1,rs2) => (((mul?8:0)<<25)|(rs2<<20)|(rs1<<15)|(rm<<12)|(rd<<7)|0x53)>>>0;
const words = [0x000020b7,0x30009073,0x00145073,0x0021d073,
  0x00002297,addi(5,5,-16),addi(6,0,400),
  load(false,0,5,0),load(false,1,5,4),load(false,2,5,8),load(false,3,5,12),
  arithmetic(false,0,4,0,1),arithmetic(false,7,5,0,1),arithmetic(true,7,6,1,1),arithmetic(true,4,7,2,3),
  addi(6,6,-1),bne(6,0,-20),
  csr(13,1),csr(14,2),csr(15,0x300),
  store(true,4,5,24),store(true,5,5,32),store(true,6,5,40),store(true,7,5,48),
  integerLoad(3,16,24),integerLoad(3,17,32),integerLoad(3,18,40),integerLoad(3,19,48),0x0000006f];
// Minimal ET_EXEC/RISC-V ELF with one executable load segment; no synthetic
// completion: the guest performs its own FP loop and spills its actual FPR bits.
const elf = Buffer.alloc(0x3040);
elf.set([0x7f,0x45,0x4c,0x46,2,1,1]);
elf.writeUInt16LE(2,16); elf.writeUInt16LE(243,18); elf.writeUInt32LE(1,20);
elf.writeBigUInt64LE(0x80000000n,24); elf.writeBigUInt64LE(64n,32);
elf.writeUInt16LE(64,52); elf.writeUInt16LE(56,54); elf.writeUInt16LE(1,56);
elf.writeUInt32LE(1,64); elf.writeUInt32LE(7,68); elf.writeBigUInt64LE(0x1000n,72);
elf.writeBigUInt64LE(0x80000000n,80); elf.writeBigUInt64LE(0x80000000n,88);
elf.writeBigUInt64LE(0x2040n,96); elf.writeBigUInt64LE(12288n,104); elf.writeBigUInt64LE(4096n,112);
words.forEach((word,index) => elf.writeUInt32LE(word,0x1000+index*4));
elf.writeUInt32LE(0x3f800000,0x3000); elf.writeUInt32LE(0x33800000,0x3004);
elf.writeUInt32LE(1,0x3008); elf.writeUInt32LE(0x3f000000,0x300c);
await fs.writeFile(path.join(out,"fp-arithmetic.elf"),elf);
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
    // registers() is [pc,x0..x31]. Check actual guest spills and CSR reads,
    // including distinct RNE/RUP halfway sums and RMM tiny multiplication.
    for(const [register,value] of [[13,"b"],[14,"3"],[16,"ffffffff3f800000"],
      [17,"ffffffff3f800001"],[18,"ffffffff27800000"],[19,"ffffffff00000001"]]) {
      assert.equal(run.registers[register+1],value,`x${register}`);
    }
    assert.equal(BigInt(`0x${run.registers[16]}`)&0x8000000000006000n,0x8000000000006000n);
  }
  assert.deepEqual(jit.registers,oracle.registers); assert.equal(jit.digest,oracle.digest);
  assert.deepEqual(jit.stats,oracle.stats);
  assert.ok(BigInt(jit.jitStats.retiredViaJit)>=3000n,"the FP arithmetic loop itself must compile, beyond the short final spin");
  await page.waitForFunction(() => document.getElementById("suite-run")?.disabled === false, null, {timeout:60000});
  await page.locator("#suite-run").evaluate(button => button.click());
  await page.waitForFunction(total => document.getElementById("metric-done")?.textContent.trim() === total &&
    document.getElementById("suite-run")?.disabled === false, String(RISCV_TESTS.length), {timeout:120000});
  report.suite = await page.evaluate(() => Object.fromEntries(["metric-pass","metric-fail","metric-done"].map(id=>[id,document.getElementById(id)?.textContent.trim()])));
  assert.deepEqual(report.suite, {"metric-pass":String(RISCV_TESTS.length),"metric-fail":"0","metric-done":String(RISCV_TESTS.length)});
  const capability = page.locator(".cap", {hasText:"Floating-point addition and multiplication"});
  assert.match(await capability.locator(".cap-pip").getAttribute("class"), /\blive\b/u);
  report.capability = await capability.innerText();
  const suiteScreenshot = await page.locator("#panel-tests").screenshot({path:path.join(out,"suite.png")});
  report.suiteScreenshotSha256 = sha(suiteScreenshot);
  // Inspection capture of the legacy computed capability: reveal its existing
  // container without changing the suite result, text, classes or pip state.
  await page.locator("#legacy-roadmap").evaluate(element => { element.hidden=false; element.removeAttribute("aria-hidden"); });
  const capabilityScreenshot = await capability.screenshot({path:path.join(out,"capability-inspection.png")});
  report.capabilityInspection = { description:"Legacy computed capability, container revealed for inspection only", sha256:sha(capabilityScreenshot) };
  await page.locator("#rm-search").fill("E5.5-T03w");
  await page.locator(".rm-g-label").filter({hasText:"E5.5-T03w"}).click();
  await page.locator("#rm-detail").waitFor({state:"visible"});
  assert.deepEqual(report.errors,[]); report.passed=true;
  const screenshot=await page.screenshot({path:path.join(out,"built-page.png")}); report.screenshotSha256=sha(screenshot);
  console.log(JSON.stringify({passed:report.passed,wasmSha256:report.wasmSha256,digest:jit.digest,jitStats:jit.jitStats}));
} catch(error) { report.failure=String(error); throw error; }
finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); await fs.writeFile(path.join(out,"report.json"),JSON.stringify(report,null,2)+"\n"); }
