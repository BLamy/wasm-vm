// Host harness regression; the synthetic worker is not an Omarchy guest proof.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { installWireEvidence } from "./omarchy-live-recording.mjs";
import { attachWorkerProfiler } from "./e5-t22c-cpu-profile.mjs";
import { fenceWorkerCostInput } from "./omarchy-worker-cost-capture.mjs";

test("host fence preserves Enter then excludes DOM and worker input across screenshots and profiling", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/linux-worker.js") res.writeHead(200, { "Content-Type": "text/javascript" }).end(`
      function cpuProbe(){const start=performance.now();let v=1;while(performance.now()-start<300)v=Math.imul(v,1664525)+1013904223;return v;}
      onmessage=({data})=>data.type==="call"?postMessage({type:"result",id:data.id,result:true}):postMessage(cpuProbe());
      postMessage("ready");`);
    else res.writeHead(200, { "Content-Type": "text/html" }).end(`<canvas id="ide-display-canvas" tabindex="0" width="200" height="200"></canvas>
      <script>window.worker=new Worker("/linux-worker.js");worker.onmessage=e=>window.result=e.data;
      window.dom=[];let id=0;
      for(const type of ["keydown","keyup","pointermove","pointerdown","pointerup","mousemove","mousedown","mouseup","wheel"])
        addEventListener(type,e=>{dom.push({type,code:e.code,trusted:e.isTrusted});
          worker.postMessage({type:"call",id:++id,method:type.startsWith("key")?"sendKeyboardEvent":"sendTabletEvent",args:[1,1,1]});
          worker.postMessage({type:"call",id:++id,method:type.startsWith("key")?"syncKeyboard":"syncTablet",args:[]});});</script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser, profiler;
  try {
    browser = await chromium.launch({ headless: true,
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
    const context = await browser.newContext(); await context.addInitScript(installWireEvidence);
    const page = await context.newPage(), url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url); await page.waitForFunction(() => window.result === "ready");
    await page.mouse.move(30,30); await page.locator("canvas").focus();
    await page.keyboard.press("Enter");
    const enteredAtMs = Date.now(), keyboard = { enteredAtMs, readbackTimeoutMs: 120000,
      deadlineAt: new Date(enteredAtMs+120000).toISOString() };
    const fence = await fenceWorkerCostInput(page, keyboard);
    const before = await page.evaluate(() => ({ dom, wire: __omarchyWireEvidence }));
    assert.ok(before.dom.some(e => e.type === "pointermove"));
    assert.deepEqual(before.dom.filter(e => e.code === "Enter").map(e => [e.type,e.trusted]),
      [["keydown",true],["keyup",true]]);
    assert.ok(Date.parse(fence.acknowledgedAt) >= enteredAtMs);
    assert.ok(Date.parse(fence.acknowledgedAt) < Date.parse(keyboard.deadlineAt));
    const provoke = async () => {
      await page.keyboard.press("KeyA"); await page.mouse.move(100,100);
      await page.mouse.click(100,100); await page.mouse.wheel(0,10);
    };
    await provoke(); await page.screenshot();
    profiler = await attachWorkerProfiler(browser, url+"/linux-worker.js");
    await profiler.start(); await provoke(); await page.screenshot();
    await page.evaluate(() => worker.postMessage({ type: "synthetic-cpu-probe" }));
    await page.waitForFunction(() => typeof window.result === "number");
    const recording = await profiler.stop(); await profiler.close(); profiler = null;
    assert.ok(recording.profile.nodes.some(n => n.callFrame.functionName === "cpuProbe" && n.hitCount > 0));
    const after = await page.evaluate(() => ({ dom, wire: __omarchyWireEvidence }));
    assert.deepEqual(after.dom, before.dom);
    assert.deepEqual(after.wire.inputEvents, before.wire.inputEvents);
    const sends = r => r.wire.workerTraffic.filter(e => e.type === "worker-call");
    assert.deepEqual(sends(after), sends(before));
  } finally {
    await profiler?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
});
