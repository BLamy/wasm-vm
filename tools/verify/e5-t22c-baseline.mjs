#!/usr/bin/env node
// Observe the unmodified, published Weston 12.0.4 image before choosing adaptation.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyPublication } from "./e5-t18e-publication.mjs";
import { inspectRecoveryCanvas } from "./e5-t18d-surface.mjs";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imageDir=path.resolve(repo,process.env.E5_T22C_BASELINE_IMAGE_DIR||"target/e5-t18d/desktop-image-v5");
const chunks=path.resolve(repo,process.env.E5_T22C_BASELINE_CHUNKS||"target/e5-t18d/chunks/desktop-v5");
const out=path.resolve(repo,process.env.E5_T22C_BASELINE_OUT||"evidence/e5-t22c/baseline");
const root=path.join(repo,"web/dist"), sha=b=>createHash("sha256").update(b).digest("hex");
await mkdir(out,{recursive:true});
const publication=await verifyPublication(repo,imageDir,chunks);
const head=execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim();
const sources={};
for(const file of ["web/desktop-recovery.js","web/src/sink/presentation.js","web/dist/pkg/wasm_vm_wasm_bg.wasm","tools/verify/e5-t22c-baseline.mjs"]){
  sources[file]=sha(await readFile(path.join(repo,file)));
}
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,"http://local").pathname);
  let file;
  if(pathname==="/artifacts-alpine.json")file=path.join(repo,"web/artifacts-alpine.json");
  else if(pathname==="/baseline-desktop/manifest.json"||/^\/baseline-desktop\/chunks\/[0-9a-f]{64}\.bin$/.test(pathname))file=path.join(chunks,pathname.slice("/baseline-desktop/".length));
  else if(pathname==="/releases/kernel/6.6.63/Image")file=path.join(repo,pathname.slice(1));
  else{file=path.resolve(root,"."+pathname);if(!file.startsWith(root+"/"))return res.writeHead(404).end();}
  try{const data=await readFile(file);res.writeHead(200,{"Content-Type":({".html":"text/html",".js":"text/javascript",".mjs":"text/javascript",".json":"application/json",".wasm":"application/wasm",".css":"text/css"})[path.extname(file)]||"application/octet-stream","Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"}).end(data);}
  catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const {chromium}=await import(pathToFileURL(path.join(repo,"web/node_modules/playwright/index.mjs")));
const args=["--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows"];
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",args});
const page=await browser.newPage({viewport:{width:1440,height:1100},serviceWorkers:"block"}),errors=[];
page.on("pageerror",e=>errors.push(String(e)));
page.on("console",m=>{if(m.type()==="error"&&!m.location().url.endsWith("/favicon.ico"))errors.push(m.text());});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,limit=900000){const deadline=Date.now()+limit;while(Date.now()<deadline){const x=await fn();if(x)return x;await sleep(250);}throw Error("bounded wait: "+label);}
async function command(verb,tag){
  const offset=await page.evaluate(()=>__desktopRecovery.serial().length);
  await page.evaluate(verb=>__desktopRecovery.command(verb),verb);
  return until(async()=>{const s=await page.evaluate(n=>__desktopRecovery.serial().slice(n),offset);return s.includes("E5T18D_"+tag+"_END")?s:null;},verb,120000);
}
const timer=setInterval(async()=>{
  try{const progress=await page.evaluate(async()=>({state:window.__desktopRecovery?.state(),retired:(await window.__desktopController?.schedulerStats())?.retiredInstructions,serial:window.__desktopRecovery?.serial().slice(-200)}));
    console.log(JSON.stringify({progress}));await writeFile(path.join(out,"progress.json"),JSON.stringify(progress,null,2)+"\n");}catch{}
},30000);
try{
  await page.goto("http://127.0.0.1:"+server.address().port+"/desktop-recovery.html?recoveryTest=1&imageManifestUrl=/baseline-desktop/manifest.json&baseUrl=/baseline-desktop/&jit=1");
  await until(()=>page.evaluate(()=>window.__desktopRecovery?.serial().includes("E5T18D_TEST_CONSOLE_READY")),"test console");
  await until(async()=>(await page.evaluate(inspectRecoveryCanvas)).desktop,"actual visible desktop");
  const before={status:await command("status","STATUS"),log:await command("log","LOG"),capture:await page.evaluate(()=>__desktopRecovery.capture()),gpu:await page.evaluate(()=>__desktopController.displayStats())};
  const samples=await page.evaluate(async()=>{
    const start=performance.now();await __desktopController.setDisplay(803,603);
    const samples=[];
    for(let i=0;i<32;i++){const gpu=await __desktopController.displayStats();samples.push({ms:performance.now()-start,gpu:{...gpu,edid:Array.from(gpu.edid)}});await new Promise(r=>setTimeout(r,250));}
    return samples;
  });
  const after={status:await command("status","STATUS"),log:await command("log","LOG"),capture:await page.evaluate(()=>__desktopRecovery.capture())};
  const pid=s=>/weston\.pid=(\d+)/.exec(s)?.[1];
  assert.ok(pid(before.status));assert.equal(pid(after.status),pid(before.status));
  assert.equal(before.gpu.scanoutWidth,1280);assert.equal(before.gpu.scanoutHeight,800);
  assert.equal(samples.at(-1).gpu.advertisedWidth,803);assert.equal(samples.at(-1).gpu.advertisedHeight,603);
  const adopted=samples.some(s=>s.gpu.scanoutWidth===803&&s.gpu.scanoutHeight===603);
  const png=await page.screenshot({path:path.join(out,"unchanged-desktop.png")});
  await writeFile(path.join(out,"serial.log"),await page.evaluate(()=>__desktopRecovery.serial()));
  const result={head,sources,publication,browser:browser.version(),args,request:[803,603],before:{...before,gpu:{...before.gpu,edid:Array.from(before.gpu.edid)}},samples,after,adopted,errors,screenshotSha256:sha(png)};
  await writeFile(path.join(out,"baseline.json"),JSON.stringify(result,null,2)+"\n");
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({head,adopted,pid:pid(after.status),old:[before.gpu.scanoutWidth,before.gpu.scanoutHeight],last:[samples.at(-1).gpu.scanoutWidth,samples.at(-1).gpu.scanoutHeight],elapsed:samples.at(-1).ms}));
}finally{clearInterval(timer);await browser.close();await new Promise(r=>server.close(r));}
