// Browser harness behavior only; no emulator or synthetic guest acceptance.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { createServer } from "node:http";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { withinTrialDeadline } from "./omarchy-input-trial.mjs";

test("actual preparation captures delivered manifest and excludes trusted input across navigation", async () => {
  const manifest='{"synthetic":"loader-response-fixture"}';
  const server=createServer((req,res)=>req.url.startsWith("/chunked-omarchy/")
    ? res.writeHead(200,{"Content-Type":"application/json"}).end(manifest)
    : res.writeHead(200,{"Content-Type":"text/html"}).end(
    `<canvas tabindex="0" width="200" height="200"></canvas><script>window.events=[];
    fetch('/chunked-omarchy/manifest-${"a".repeat(64)}.json').then(r=>r.text()).then(t=>window.loaded=t);
    for(const type of ['keydown','keyup','pointermove','pointerdown','pointerup','wheel'])
      addEventListener(type,e=>events.push({type,trusted:e.isTrusted}));</script>`));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
    const context=await browser.newContext(),page=await context.newPage(),report={};
    const source=await fs.readFile(new URL("./omarchy-desktop-live.mjs",import.meta.url),"utf8");
    const start=source.indexOf("  if (modePair) {",source.indexOf("async function runLive() {"));
    const end=source.indexOf("  if (coldPair) {",start);
    assert.ok(start>0&&end>start);
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,deadline=Date.now()+10000;
    const routeStart=source.indexOf('if (mode === "capture" || coldPair || ownedRecording) {',source.indexOf('let loaderManifestResponse = null;'));
    const routeEnd=source.indexOf('const pageLabels =',routeStart);
    assert.ok(routeStart>0&&routeEnd>routeStart);
    const captured=await new AsyncFunction('mode','coldPair','ownedRecording','context',
      `let loaderManifestResponse = null; ${source.slice(routeStart,routeEnd)} return ()=>loaderManifestResponse;`)(
      'mode-pair',false,true,context);
    await new AsyncFunction("modePair","report","context","page","startupCall",source.slice(start,end))(
      true,report,context,page,fn=>withinTrialDeadline(fn,deadline,"fixture startup"));
    assert.ok(report.preparationInputFence.acknowledgedAt);
    for(const suffix of ["/first","/second"]) {
      await page.goto(`http://127.0.0.1:${server.address().port}${suffix}`);
      await page.waitForFunction(()=>typeof loaded==='string');
      assert.equal(await page.evaluate(()=>loaded),manifest);
      const response=await captured();
      assert.equal(response.status,200);assert.equal(response.error,null);assert.equal(response.body.toString(),manifest);
      await page.locator("canvas").focus();
      await page.keyboard.press("KeyA");await page.mouse.click(100,100);await page.mouse.wheel(0,10);
      await page.screenshot();
      assert.deepEqual(await page.evaluate(()=>events),[]);
    }
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
