// Observer smoke test only; the synthetic worker is not an Omarchy/guest proof.
import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { installWireEvidence } from "./omarchy-live-recording.mjs";

test("real Chrome keeps physical keys and transferable worker traffic observable without replacing them", async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const context = await browser.newContext();
    await context.addInitScript(installWireEvidence);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.route("http://omarchy-observer.test/", route => route.fulfill({ status: 200,
      contentType: "text/html", body: '<canvas id="ide-display-canvas" tabindex="0" width="100" height="100"></canvas>' }));
    // Normal navigation preserves pre-document observers; setContent/document.open removes them.
    await page.goto("http://omarchy-observer.test/");
    await page.locator("canvas").focus();
    await page.keyboard.press("KeyA");
    const delivered = await page.evaluate(async () => {
      const worker = new Worker(URL.createObjectURL(new Blob([
        'onmessage = event => postMessage({type:"output",buffer:event.data.bytes}, [event.data.bytes])',
      ], { type: "text/javascript" })));
      const response = new Promise(resolve => worker.addEventListener("message", event => resolve(new TextDecoder().decode(event.data.buffer)), { once: true }));
      const bytes = new TextEncoder().encode("observer-only\r");
      worker.postMessage({ type: "input", bytes: bytes.buffer }, [bytes.buffer]);
      const transferred = bytes.byteLength;
      const text = await response;
      worker.terminate();
      return { transferred, text };
    });
    // Promise microtasks can run between independent listeners for the same message.
    await page.waitForFunction(() => window.__omarchyWireEvidence.workerTraffic.some(row => row.type === "serial-output"));
    delivered.evidence = await page.evaluate(() => window.__omarchyWireEvidence);
    assert.deepEqual(errors, []);
    assert.equal(delivered.transferred, 0);
    assert.equal(delivered.text, "observer-only\r");
    assert.deepEqual(delivered.evidence.inputEvents.map(row => [row.type, row.code, row.trusted, row.target]),
      [["keydown", "KeyA", true, "ide-display-canvas"], ["keyup", "KeyA", true, "ide-display-canvas"]]);
    assert.equal(delivered.evidence.workerTraffic.find(row => row.type === "serial-output").text, delivered.text);
    assert.deepEqual(delivered.evidence.workerTraffic.find(row => row.type === "serial-input").bytes,
      Array.from(new TextEncoder().encode(delivered.text)));
    assert.equal(delivered.evidence.workerTraffic.filter(row => row.type === "serial-input").length, 1);
  } finally { await browser.close(); }
});
