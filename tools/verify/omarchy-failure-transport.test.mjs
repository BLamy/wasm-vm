// Synthetic browser transport test only: no guest or desktop success is claimed.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { pauseFailedInput, exportFailedInput } from "./omarchy-failure-checkpoint.mjs";

test("actual CDP query and bounded loopback stream export one paused synthetic instance", { timeout: 30000 }, async () => {
  const bytes = Buffer.alloc(1024 ** 3); bytes.set(Buffer.from("synthetic-kernel"), 64);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/javascript");
    if (req.url === "/pkg/wasm_vm_wasm.js") res.end(`const memory=new WebAssembly.Memory({initial:16384});
      new Uint8Array(memory.buffer).set(new TextEncoder().encode('synthetic-kernel'),64);
      export default ()=>({memory}); export class WasmLinux {
      constructor(){this.__wbg_ptr=1;}
      stateDigest(){return '${digest}';}
    }`);
    else if (req.url === "/linux-worker.js") res.end("import {WasmLinux} from './pkg/wasm_vm_wasm.js';globalThis.vm=new WasmLinux();onmessage=()=>postMessage('alive');postMessage('ready');");
    else { res.setHeader("Content-Type", "text/html"); res.end(`<script>
      window.__linux={pause(){window.paused=true;},isPaused(){return window.paused;}};
      window.worker=new Worker('/linux-worker.js',{type:'module'});worker.onmessage=()=>window.ready=true;
    </script>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "omarchy-endpoint-transport-"));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    const report = { mode: "input-trial", result: "failed", trial: { outcome: "nonce-readback-failed", readbackMs: 120000 },
      keyboard: { typedAt: new Date(1000).toISOString(), enteredAtMs: 1000, deadlineAt: new Date(121000).toISOString(), verified: false } };
    await pauseFailedInput(page, report);
    await exportFailedInput(page, browser, out, report, { ramBytes: bytes.length, anchorOffset: 64, anchor: [...Buffer.from("synthetic-kernel")] });
    assert.equal(report.result, "failed"); assert.equal(report.keyboard.verified, false);
    assert.equal(report.failureCheckpoint.status, "captured");
    assert.equal(await page.evaluate(() => window.paused), true);
    const actual = gunzipSync(await fs.readFile(report.failureCheckpoint.snapshot.file));
    assert.deepEqual(actual, bytes);
  } finally { await browser?.close(); server.closeAllConnections(); server.close(); await fs.rm(out, { recursive: true }); }
});
