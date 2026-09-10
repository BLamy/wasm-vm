import assert from "node:assert/strict";
import { chromium } from "/Users/blamy/Documents/Codex/wasm-vm/web/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ serviceWorkers: "block" });
  await page.goto("http://127.0.0.1:8000/?noAutoBoot=1");
  const result = await page.evaluate(async () => {
    const { default: init, WasmLinux } = await import("/pkg/wasm_vm_wasm.js");
    await init();
    const hash = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const chunkHash = await hash(new Uint8Array(4096));
    const manifest = JSON.stringify({ version: 1, image_len: 8192, chunk_size: 4096, layout: "split", chunks: [chunkHash, chunkHash] });
    const base = await hash(new TextEncoder().encode(manifest));
    const seed = new Uint8Array(61 + 8 + 4096), view = new DataView(seed.buffer);
    seed.set(new TextEncoder().encode("WVOD1")); view.setUint32(5, 4096, true);
    view.setBigUint64(9, 8192n, true); seed.set(Uint8Array.from(base.match(/../g), (b) => parseInt(b, 16)), 17);
    view.setBigUint64(49, 23n, true); view.setUint32(57, 1, true); view.setBigUint64(61, 0n, true); seed.fill(0x55, 69);
    const create = () => WasmLinux.newChunkedDiskSeeded(16, new Uint8Array([0x6f, 0, 0, 0]), manifest,
      "http://127.0.0.1:8000/unused-fixture/", 1, new Uint32Array(), "console=ttyS0", () => {}, false, seed);
    const a = create(), b = create();
    const aSnapshot23 = a.saveSnapshot(), bSnapshot23 = b.saveSnapshot();
    const a24 = a.advanceOverlayGeneration();
    const bStill23 = b.overlayGeneration();
    const bAcceptsOwn = b.restoreDecisionCode(bSnapshot23, bStill23);
    const aRejectsBAt24 = a.restoreDecisionCode(bSnapshot23, a24);
    seed.fill(0xa7);
    const aAfterInputMutation = a.overlayGeneration(), bAfterInputMutation = b.overlayGeneration();
    const aAcceptsOriginalAt24 = a.restoreDecisionCode(aSnapshot23, a24);
    a.free(); b.free();
    return { a24, bStill23, bAcceptsOwn, aRejectsBAt24, aAfterInputMutation, bAfterInputMutation, aAcceptsOriginalAt24 };
  });
  assert.equal(result.a24, 24);
  assert.equal(result.bStill23, 23);
  assert.equal(result.bAcceptsOwn, "resume");
  assert.notEqual(result.aRejectsBAt24, "resume");
  assert.equal(result.aAfterInputMutation, 24);
  assert.equal(result.bAfterInputMutation, 23);
  assert.notEqual(result.aAcceptsOriginalAt24, "resume");
  console.log(`OMARCHY_SEEDED_ISOLATION_ATTACK_PASS ${JSON.stringify(result)}`);
} finally { await browser.close(); }
