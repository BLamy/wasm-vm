import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {chromium} from "../../web/node_modules/playwright/index.mjs";
import {attachWorkerProfiler} from "./e5-t22c-cpu-profile.mjs";

test("diagnostic profiler samples the exact owned worker, not the page",async()=>{
  const server=createServer((req,res)=>{
    if(req.url==="/worker.js")res.writeHead(200,{"Content-Type":"text/javascript"}).end(`
      function cpuProbe(){const start=performance.now();let value=1;while(performance.now()-start<300)value=Math.imul(value,1664525)+1013904223;return value;}
      self.onmessage=()=>self.postMessage(cpuProbe());self.postMessage("ready");`);
    else res.writeHead(200,{"Content-Type":"text/html"}).end('<script>window.worker=new Worker("/worker.js");worker.onmessage=e=>window.result=e.data;</script>');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  let profiler;
  try {
    const page=await browser.newPage(),url=`http://127.0.0.1:${server.address().port}`;
    await page.goto(url);await page.waitForFunction(()=>window.result==="ready");
    await assert.rejects(()=>attachWorkerProfiler(browser,url+"/missing.js"),/exact owned worker/);
    profiler=await attachWorkerProfiler(browser,url+"/worker.js");
    await profiler.start();await page.evaluate(()=>worker.postMessage("burn"));
    await page.waitForFunction(()=>typeof window.result==="number");
    const result=await profiler.stop();
    assert.equal(result.url,url+"/worker.js");assert.ok(result.profile.samples.length>10);
    assert.ok(result.profile.nodes.some(n=>n.callFrame.functionName==="cpuProbe"&&n.hitCount>0));
  } finally {await profiler?.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
});
