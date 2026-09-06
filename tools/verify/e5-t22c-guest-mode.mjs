#!/usr/bin/env node
// Real guest proof. Iteration mode records failures but never produces a verdict.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectRecoveryCanvas } from "./e5-t18d-surface.mjs";
import { assertDisplayAgreement, inspectResizeContent } from "./e5-t22c-observations.mjs";
import { hashFile, verifyChunkStore } from "./e5-t18e-publication.mjs";
import { verifyDisplayPublication, verifyFrozenRuntime } from "./e5-t22c-publication.mjs";
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const iteration=process.env.E5_T22C_ITERATION==="1";
const imageDir=path.resolve(repo,process.env.E5_T22C_IMAGE_DIR||"target/e5-t22c/acceptance-image");
const chunks=path.resolve(repo,process.env.E5_T22C_CHUNKS||"target/e5-t22c/chunks/acceptance");
const toolsDir=path.resolve(repo,process.env.E5_T22C_TOOLS_OUT||"target/e5-t22c/display-tools");
const out=path.resolve(repo,process.env.E5_T22C_OUT||"evidence/e5-t22c/acceptance");
const root=path.join(repo,"web/dist"),sha=b=>createHash("sha256").update(b).digest("hex");
await mkdir(out,{recursive:true});
const metadata=JSON.parse(await readFile(path.join(imageDir,"desktop-info.json")));
const head=execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim();
const frozen=iteration?null:verifyFrozenRuntime(repo);
const sources={};
for(const file of ["tools/guest/wv-display-resize.c","tools/guest/wv-display-mode.h","tools/guest/wv-display-query.c",
  "tools/rootfs/desktop-test-console","tools/rootfs-inner.sh","tools/build-rootfs.sh","tools/image/desktop.sh",
  "tools/image/build-display-tools.sh","tools/verify/e5-t22c-guest-mode.mjs","tools/verify/e5-t22c-observations.mjs",
  "tools/verify/e5-t22c-publication.mjs",
  "web/desktop-resize.js","web/dist/desktop-resize.js","web/dist/pkg/wasm_vm_wasm_bg.wasm",
  "web/artifacts-alpine.json","releases/kernel/6.6.63/Image"])
  sources[file]=sha(await readFile(path.join(repo,file)));
assert.equal(sources["web/desktop-resize.js"],sources["web/dist/desktop-resize.js"],"rebuild the tested page");
assert.equal(sources["releases/kernel/6.6.63/Image"],JSON.parse(await readFile(path.join(repo,"web/artifacts-alpine.json"))).artifacts.kernel.sha256,"kernel matches committed manifest");
const publication=iteration?{
  imageSha256:metadata.image.sha256,
  packageManifestSha256:metadata.packageManifest.sha256,
  fileManifestSha256:metadata.fileManifest.sha256,
  chunkManifestSha256:await hashFile(path.join(chunks,"manifest.json")),
}:await verifyDisplayPublication(repo,imageDir,chunks,toolsDir);
for(const [file,key] of [["alpine-rootfs.ext4","imageSha256"],["MANIFEST.txt","packageManifestSha256"],["FILE-MANIFEST.txt","fileManifestSha256"]])
  assert.equal(await hashFile(path.join(imageDir,file)),publication[key],file+" drift");
if(iteration)await verifyChunkStore(chunks,publication);
assert.equal(metadata.startup.renderer,"pixman");assert.equal(metadata.startup.inPlaceDisplayResize,true);
const servedRuntime={},expectedRuntime=new Map();
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,"http://local").pathname);let file;
  if(pathname==="/artifacts-alpine.json")file=path.join(repo,"web/artifacts-alpine.json");
  else if(pathname==="/e5t22c-desktop/manifest.json"||/^\/e5t22c-desktop\/chunks\/[0-9a-f]{64}\.bin$/.test(pathname))file=path.join(chunks,pathname.slice("/e5t22c-desktop/".length));
  else if(pathname==="/releases/kernel/6.6.63/Image")file=path.join(repo,pathname.slice(1));
  else{file=path.resolve(root,"."+pathname);if(!file.startsWith(root+"/"))return res.writeHead(404).end();}
  try{const data=await readFile(file);
    if(!iteration&&(file.startsWith(root+"/")||pathname==="/artifacts-alpine.json")){
      const relative=path.relative(repo,file);
      if(!expectedRuntime.has(relative))expectedRuntime.set(relative,sha(execFileSync("git",["show",`${head}:${relative}`],{cwd:repo,maxBuffer:64*1024*1024})));
      const digest=sha(data);assert.equal(digest,expectedRuntime.get(relative),`served ${relative} differs from frozen HEAD`);
      servedRuntime[relative]=digest;
    }
    res.writeHead(200,{"Content-Type":({".html":"text/html",".js":"text/javascript",".json":"application/json",".wasm":"application/wasm",".css":"text/css"})[path.extname(file)]||"application/octet-stream","Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"}).end(data);}
  catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const {chromium}=await import(pathToFileURL(path.join(repo,"web/node_modules/playwright/index.mjs")));
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",args:["--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows"]});
const page=await browser.newPage({viewport:{width:2800,height:1900},serviceWorkers:"block"}),errors=[];
page.on("pageerror",e=>errors.push(String(e)));
page.on("console",m=>{if(m.type()==="error"&&!m.location().url.endsWith("/favicon.ico"))errors.push(m.text());});
page.on("response",r=>{if(r.status()>=400&&!r.url().endsWith("/favicon.ico"))errors.push(`${r.status()} ${r.url()}`);});
page.on("requestfailed",r=>errors.push(`${r.failure()?.errorText} ${r.url()}`));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,limit=900000){const deadline=Date.now()+limit;while(Date.now()<deadline){const x=await fn();if(x)return x;await sleep(100);}throw Error("bounded wait: "+label);}
async function command(verb,tag="DISPLAY"){
  const offset=await page.evaluate(()=>desktopResize.serial().length);
  await page.evaluate(verb=>desktopResize.command(verb),verb);
  return until(async()=>{const s=await page.evaluate(n=>desktopResize.serial().slice(n),offset);return s.includes((tag==="DISPLAY"?"E5T22C_":"E5T18D_")+tag+"_END")?s:null;},verb,240000);
}
let phase="loading",progressBusy=false;
const timer=setInterval(async()=>{if(progressBusy)return;progressBusy=true;try{
  const progress=await page.evaluate(async()=>({state:window.desktopResize?.state(),scheduler:await window.desktopResize?.controller()?.schedulerStats(),jit:await window.desktopResize?.controller()?.jitStats(),gpu:await window.desktopResize?.controller()?.displayStats(),serial:window.desktopResize?.serial().slice(-1000)}));
  if(progress.gpu)progress.gpu.edid=Object.values(progress.gpu.edid);
  progress.phase=phase;
  console.log(JSON.stringify({phase,retired:progress.scheduler?.retiredInstructions,frames:progress.state?.frames,mode:[progress.gpu?.advertisedWidth,progress.gpu?.advertisedHeight],scanout:[progress.gpu?.scanoutWidth,progress.gpu?.scanoutHeight],serial:progress.serial}));await writeFile(path.join(out,"progress.json"),JSON.stringify(progress,null,2)+"\n");
  await writeFile(path.join(out,"serial.log"),await page.evaluate(()=>desktopResize.serial()));
}catch{}finally{progressBusy=false;}},30000);
const results=[],gaps=[];
const pid=s=>/weston\.pid=(\d+)/.exec(s)?.[1];
const clientPids=s=>[...s.matchAll(/WV_CLIENT pid=(\d+) exe=\/usr\/bin\/foot/g)].map(m=>m[1]).sort();
async function gpuState(){return page.evaluate(async()=>{const gpu=await desktopResize.controller().displayStats();return {...gpu,edid:Array.from(gpu.edid)};});}
async function content(){const {rgba,...marker}=await page.evaluate(inspectResizeContent);return {...marker,sha256:rgba?sha(Buffer.from(rgba)):null};}
try{
  await page.goto("http://127.0.0.1:"+server.address().port+"/desktop-resize.html?recoveryTest=1&width=901&height=701");
  phase="guest boot";
  await until(()=>page.evaluate(()=>window.desktopResize?.serial().includes("E5T18D_TEST_CONSOLE_READY")),"test console");
  phase="desktop startup";
  await until(async()=>(await page.evaluate(inspectRecoveryCanvas)).desktop,"visible desktop");
  phase="initial mode";
  const initial={status:await command("status","STATUS"),mode:await command("display"),log:await command("log","LOG"),gpu:await gpuState(),state:await page.evaluate(()=>desktopResize.state())};
  await writeFile(path.join(out,"initial.json"),JSON.stringify(initial,null,2)+"\n");
  await until(()=>page.evaluate(()=>!desktopResize.state().presentation.sizeMismatch&&desktopResize.state().presentation.latest?.resourceWidth===901),"initial requested mode",60000);
  assert.ok(pid(initial.status));
  const firstMode=assertDisplayAgreement({guest:initial.mode,gpu:initial.gpu,state:initial.state,width:901,height:701});
  phase="foot startup";
  await page.evaluate(()=>desktopResize.command("display-watch"));
  await page.evaluate(()=>desktopResize.command("display-client"));
  // The retained T18b real-foot proof uses this same bounded launch budget.
  await until(async()=>(await content()).visible,"actual foot content",240000);
  const client=await command("display"),originalContent=await content();
  assert.equal(clientPids(client).length,1,"one live foot proof client");
  await page.screenshot({path:path.join(out,"initial-client.png"),fullPage:true});
  async function runMode(width,height,pendingFrom=null){
    phase=`resize ${width}x${height}`;
    const beforeScheduler=await page.evaluate(()=>desktopResize.controller().schedulerStats());
    const started=await page.evaluate(([w,h])=>{const el=document.getElementById("viewport");const ms=performance.now();el.style.width=w+"px";el.style.height=h+"px";return ms;},[width,height]);
    let replacementBeforeResume=null;
    if(pendingFrom){
      // The guest is paused at the observed incomplete transition. Require the
      // replacement to reach its real GPU before allowing any guest instruction.
      replacementBeforeResume=await until(async()=>{const gpu=await gpuState();return gpu.advertisedWidth===width&&gpu.advertisedHeight===height?gpu:null;},"replacement accepted while paused",10000);
      const stillPaused=await page.evaluate(()=>desktopResize.controller().schedulerStats());
      assert.equal(stillPaused.retiredInstructions,pendingFrom.pausedScheduler.retiredInstructions,"no guest execution between pending observation and replacement");
      assert.deepEqual([replacementBeforeResume.scanoutWidth,replacementBeforeResume.scanoutHeight],[pendingFrom.gpu.scanoutWidth,pendingFrom.gpu.scanoutHeight]);
      await page.evaluate(()=>desktopResize.controller().resume());
    }
    const paint=await until(()=>page.evaluate(({width,height,started})=>{
      const s=desktopResize.state();return s.paints.find(p=>p.ms>=started&&p.width===width&&p.height===height)||null;
    },{width,height,started}),"matching mode "+width+"x"+height,120000);
    const elapsed=paint.ms-started;
    const afterScheduler=await page.evaluate(()=>desktopResize.controller().schedulerStats());
    if(elapsed>2000)gaps.push(`${width}x${height}: ${elapsed.toFixed(2)}ms exceeds 2000ms`);
    const guest=await command("display"),gpu=await gpuState(),state=await page.evaluate(()=>desktopResize.state());
    const observation=assertDisplayAgreement({guest,gpu,state,width,height,outputId:firstMode.id});
    const status=await command("status","STATUS");assert.equal(pid(status),pid(initial.status),"same compositor process");
    assert.deepEqual(clientPids(guest),clientPids(client),"same foot client process");
    const marker=await content();assert.equal(marker.visible,true,"live terminal text visible");
    assert.equal(marker.sha256,originalContent.sha256,"identical retained terminal text pixels");
    const screenshot=await page.screenshot({path:path.join(out,`${width}x${height}.png`),fullPage:true});
    const result={width,height,started,paint,elapsed,pendingFrom,replacementBeforeResume,beforeScheduler,afterScheduler,guest,gpu,state,observation,status,marker,screenshotSha256:sha(screenshot)};
    results.push(result);console.log(JSON.stringify({mode:[width,height],elapsed,pid:pid(status),foot:clientPids(guest),marker:marker.sha256}));
    await writeFile(path.join(out,"results.json"),JSON.stringify({iteration,head,frozen,sources,servedRuntime,publication,metadata,initial,client,originalContent,results,gaps,errors},null,2)+"\n");
  }
  for(const [width,height] of [[803,603],[640,480],[1280,800],[2560,1600],[801,601],[802,601]])await runMode(width,height);
  // Observe a real host/guest disagreement before issuing the next DOM size.
  // This is not a claim to see Weston's internal pageflip flags; native tests
  // independently cover all three of those pending-work flags.
  phase="pending transition";
  await page.evaluate(()=>{const el=document.getElementById("viewport");el.style.width="1199px";el.style.height="799px";});
  await until(async()=>{
    const gpu=await gpuState(),state=await page.evaluate(()=>desktopResize.state());
    return gpu.advertisedWidth===1199&&gpu.advertisedHeight===799&&gpu.pendingEvents===0&&
      (gpu.scanoutWidth!==1199||gpu.scanoutHeight!==799)&&state.presentation.sizeMismatch?{gpu,state}:null;
  },"observed unfinished transition",10000);
  await page.evaluate(()=>desktopResize.controller().pause());
  const pending={gpu:await gpuState(),state:await page.evaluate(()=>desktopResize.state()),pausedScheduler:await page.evaluate(()=>desktopResize.controller().schedulerStats())};
  assert.deepEqual([pending.gpu.advertisedWidth,pending.gpu.advertisedHeight,pending.gpu.pendingEvents],[1199,799,0]);
  assert.ok(pending.gpu.scanoutWidth!==1199||pending.gpu.scanoutHeight!==799,"transition still unfinished at paused observation");
  assert.equal(pending.state.presentation.sizeMismatch,true);
  await runMode(1201,801,pending);
  const beforeRepeat=await page.evaluate(()=>desktopResize.state());
  await page.evaluate(()=>{const el=document.getElementById("viewport");el.style.width="1201px";el.style.height="801px";});
  await sleep(2500);
  const afterRepeat=await page.evaluate(()=>desktopResize.state());
  assert.equal(afterRepeat.viewport.requests,beforeRepeat.viewport.requests,"repeat has no new host request");
  const finalLog=await command("log","LOG");
  assert.doesNotMatch(finalLog,/cannot run at all|WV_DISPLAY_(RETRY|FATAL)|Assertion|panic|failed to init output/);
  await writeFile(path.join(out,"final-compositor.log"),finalLog);
  await writeFile(path.join(out,"runtime-stats.json"),JSON.stringify(await page.evaluate(async()=>({scheduler:await desktopResize.controller().schedulerStats(),jit:await desktopResize.controller().jitStats(),digest:await desktopResize.controller().stateDigest()})),null,2)+"\n");
  assert.deepEqual(errors,[]);
  if(!iteration){
    assert.deepEqual(verifyFrozenRuntime(repo),frozen,"frozen runtime tree moved during recording");
    assert.equal(execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim(),head,"head moved during recording");
    for(const [file,digest] of Object.entries(sources))assert.equal(sha(await readFile(path.join(repo,file))),digest,`${file} moved during recording`);
    assert.deepEqual(await verifyDisplayPublication(repo,imageDir,chunks,toolsDir),publication);
  }
  if(!iteration)assert.deepEqual(gaps,[],"real guest resize performance");
  console.log(JSON.stringify({iteration,completed:true,gaps,errors}));
}catch(error){
  await writeFile(path.join(out,"failure.json"),JSON.stringify({phase,error:String(error),errors,results},null,2)+"\n");
  await page.screenshot({path:path.join(out,"failure.png")}).catch(()=>{});
  try{await writeFile(path.join(out,"failure-display.json"),JSON.stringify({gpu:await gpuState(),state:await page.evaluate(()=>desktopResize.state()),content:await content(),guest:await command("display"),status:await command("status","STATUS")},null,2)+"\n");}catch{}
  try{await writeFile(path.join(out,"last-compositor.log"),await command("log","LOG"));}catch{}
  throw error;
}finally{clearInterval(timer);await writeFile(path.join(out,"serial.log"),await page.evaluate(()=>desktopResize.serial()).catch(()=>""));await browser.close();await new Promise(r=>server.close(r));}
