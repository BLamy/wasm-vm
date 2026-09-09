#!/usr/bin/env node
// Execute a real status=0 guest MMIO store, not a mocked reset/controller call.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),root=path.join(repo,"web/dist");
const out=path.resolve(process.env.E5_T22E_OUT||path.join(repo,"evidence/e5-t22e/browser"));
const sha=data=>createHash("sha256").update(data).digest("hex");
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,"http://local").pathname);
  const file=path.resolve(root,"."+pathname);
  if(!file.startsWith(root+"/"))return res.writeHead(404).end();
  try{const bytes=await readFile(pathname==="/artifacts-alpine.json"?path.join(repo,"web/artifacts-alpine.json"):file);
    res.writeHead(200,{"Content-Type":({".html":"text/html",".js":"text/javascript",".wasm":"application/wasm",".json":"application/json",".css":"text/css"})[path.extname(file)]||"application/octet-stream",
      "Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"}).end(bytes);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port;
const {chromium}=await import(pathToFileURL(path.join(repo,"web/node_modules/playwright/index.mjs")));
const browser=await chromium.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
const errors=[],results=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100},serviceWorkers:"block"});
  page.on("pageerror",e=>errors.push(String(e)));
  page.on("console",m=>{if(m.type()==="error"&&!m.location().url.endsWith("/favicon.ico"))errors.push(m.text());});
  page.on("response",r=>{if(r.status()>=400&&!r.url().endsWith("/favicon.ico"))errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(base+"/display-hotplug.html");
  for(const backend of ["direct","worker"]){
    results.push(await page.evaluate(async backend=>{
      const {startLinuxBoot}=await import("./loader.js");
      const {startLinuxBootWorker,stopLinuxController}=await import("./linux-worker-host.js");
      const ensure=(ok,message)=>{if(!ok)throw Error(message);};
      const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
      // LUI GPU; SW zero,status; LW events; LUI UART; ADDI a1,'R'; SB a1,UART; JAL self.
      const words=[0x100082b7,0x0602a823,0x1002a503,0x10000337,0x05200593,0x00b30023,0x0000006f];
      const kernel=new Uint8Array(words.length*4),view=new DataView(kernel.buffer);
      words.forEach((word,i)=>view.setUint32(i*4,word,true));
      const manifest={artifacts:{kernel:{url:"data:application/octet-stream;base64,"+btoa(String.fromCharCode(...kernel)),sha256:await hash(kernel)},
        initramfs:{url:"data:application/octet-stream;base64,",sha256:await hash(new Uint8Array())}}};
      const samples=[];
      for(const [width,height] of [[901,701],[1,1],[4095,4095],[802,601]]){
        let output="";
        const controller=await (backend==="direct"?startLinuxBoot:startLinuxBootWorker)({
          manifestUrl:"data:application/json,"+encodeURIComponent(JSON.stringify(manifest)),
          ramMib:16,startPaused:true,jit:false,slirpNet:false,
          onOutput:bytes=>{output+=new TextDecoder().decode(bytes);},
        });
        try{
          const stats=async()=>{const s=await controller.displayStats();return {...s,edid:Array.from(s.edid)};};
          const fresh=await stats();ensure(fresh.advertisedWidth===1280&&fresh.advertisedHeight===800,"fresh VM monitor isolation");
          await controller.setDisplay(width,height);const before=await stats();
          ensure(before.pendingEvents===1,"pending event before reset");
          await controller.resume();
          const deadline=performance.now()+20000;
          while(!output.includes("R")&&performance.now()<deadline)await new Promise(r=>setTimeout(r,10));
          ensure(output.includes("R"),"guest reset fixture did not reach UART marker");
          await controller.pause();
          const after=await stats();
          ensure(after.advertisedWidth===width&&after.advertisedHeight===height,"reset lost host dimensions");
          ensure(JSON.stringify(after.edid)===JSON.stringify(before.edid),"reset lost EDID bytes");
          ensure((after.edid[56]|((after.edid[58]&240)<<4))===width,"EDID width independently decoded");
          ensure((after.edid[59]|((after.edid[61]&240)<<4))===height,"EDID height independently decoded");
          ensure(after.pendingEvents===0&&after.resourceCount===0&&after.scanoutResource===null,"guest reset state not cleared");
          await controller.setDisplay(1111,777);const subsequent=await stats();
          ensure(subsequent.pendingEvents===1&&subsequent.advertisedWidth===1111,"new host event after reset");
          samples.push({width,height,fresh,before,after,subsequent,output,digest:await controller.stateDigest(),scheduler:await controller.schedulerStats()});
        }finally{await stopLinuxController(controller);}
      }
      return {backend,words,samples};
    },backend));
  }
  await page.goto(base+"/app.html?noAutoBoot=1");
  await page.waitForFunction(()=>document.getElementById("suite-run")?.disabled===false,null,{timeout:60000});
  await page.locator("#suite-run").evaluate(el=>el.click());
  await page.waitForFunction(()=>document.getElementById("metric-done")?.textContent.trim()==="126",null,{timeout:120000});
  const metrics=await page.evaluate(()=>["metric-pass","metric-fail","metric-done"].map(id=>document.getElementById(id).textContent.trim()));
  assert.deepEqual(metrics,["126","0","126"]);
  await page.locator("#rm-search").fill("E5-T22e");
  await page.locator(".rm-g-label").filter({hasText:"E5-T22e"}).click();
  const detail=await page.locator("#rm-detail").innerText();
  const png=await page.screenshot({path:path.join(out,"demo-suite.png")});
  assert.deepEqual(errors,[]);
  const digests={};
  for(const file of ["crates/core/src/dev/virtio/gpu/mod.rs","crates/wasm/src/display_tests.rs","web/roadmap.js","web/tasks.json",
    "web/dist/pkg/wasm_vm_wasm_bg.wasm","tools/verify/e5-t22e-display-reset.mjs"])
    digests[file]=sha(await readFile(path.join(repo,file)));
  const result={head:execFileSync("git",["rev-parse","HEAD"],{cwd:repo,encoding:"utf8"}).trim(),digests,browser:browser.version(),results,metrics,detail,screenshotSha256:sha(png),errors};
  await writeFile(path.join(out,"browser-proof.json"),JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify({backends:results.map(r=>({backend:r.backend,guestResets:r.samples.length})),metrics,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
