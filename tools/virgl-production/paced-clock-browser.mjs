#!/usr/bin/env node
// Actual ordinary Wasm + browser performance source; this is not a Linux desktop proof.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {repo,sha256} from '../virgl-command/fixtures.mjs';

assert.equal(process.argv[2],'--output');assert.ok(process.argv[3]);assert.equal(process.argv.length,4);
const output=path.resolve(process.argv[3]),root=path.join(repo,'web/dist');
await fs.mkdir(output,{recursive:false});
const report={task:'E6-T11d73',status:'running',scope:'Ordinary Wasm API and literal WFI guest in a real browser, not stock Linux input or GPU proof',
  head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),errors:[],served:[],started:new Date().toISOString()};
let server,browser,page;
try {
  server=createServer(async(request,response)=>{
    try {
      response.setHeader('Cross-Origin-Opener-Policy','same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy','require-corp');
      const route=new URL(request.url,'http://localhost').pathname;
      if(route==='/favicon.ico'){response.writeHead(204).end();return;}
      if(route==='/__paced-clock'){
        response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end('<!doctype html><meta charset="utf-8"><title>Paced clock acceptance</title><pre id="result">Running literal guest clock acceptance</pre>');return;
      }
      const file=path.resolve(root,'.'+decodeURIComponent(route));assert.ok(file.startsWith(root+path.sep));
      const bytes=await fs.readFile(file);report.served.push({route,path:path.relative(repo,file),bytes:bytes.length,sha256:sha256(bytes)});
      response.writeHead(200,{'Content-Type':route.endsWith('.wasm')?'application/wasm':'text/javascript','Cache-Control':'no-store'}).end(bytes);
    } catch {response.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));
  browser=await chromium.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false});
  report.browser=browser.version();
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1200,height:900}});page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/__paced-clock`);
  report.actual=await page.evaluate(async()=>{
    const api=await import('/pkg/wasm_vm_wasm.js');await api.default();
    for(const name of ['WasmVirglControlProof','WasmVirglSubmitProof','WasmVirglScanoutProof'])if(Object.hasOwn(api,name))throw Error('Unexpected proof export '+name);
    // SBI TIME fid0 set_timer(30,000,000 ticks); wfi; jal zero,-4.
    const words=[0x01c9c537,0x38050513,0x544958b7,0xd4588893,0x00000813,0x00000073,0x10500073,0xffdff06f];
    const proof=globalThis.__pacedProof={words};
    const bytes=new Uint8Array(words.length*4),view=new DataView(bytes.buffer);words.forEach((w,i)=>view.setUint32(i*4,w,true));
    const m=new api.WasmLinux(8,bytes,new Uint8Array(),'',()=>{},false);
    const check=(condition,message)=>{if(!condition)throw Error(message);};
    try {
      m.setICountDivider(1024);
      const initial=m.guestClockState(),selectStart=performance.now();m.setGuestClock('paced-icount');
      const selectEnd=performance.now(),selected=m.guestClockState();
      Object.assign(proof,{initial,selectStart,selectEnd,selected});
      check(initial.mode==='icount'&&selected.mode==='paced-icount','Actual mode selection');
      check(selected.mtime===initial.mtime&&selected.clockDiv===1024,'Selection preserves time and phase divisor');
      const firstRun=m.runChunk(256),firstEnd=performance.now(),first=m.guestClockState();
      Object.assign(proof,{firstRun,firstEnd,first});
      check(BigInt(first.mtime)<30_000_000n,'A future idle timer must not jump immediately');
      check(BigInt(first.mtime)<=BigInt(Math.ceil((firstEnd-selectStart)*10000))+1n,'Idle ceiling bounded by actual host progress');
      await new Promise(resolve=>setTimeout(resolve,50));
      const idleRead=m.guestClockState();check(idleRead.mtime===first.mtime,'Read-only state does not advance time');
      const secondRun=m.runChunk(256),secondEnd=performance.now(),second=m.guestClockState();
      Object.assign(proof,{idleRead,secondRun,secondEnd,second});
      check(BigInt(second.mtime)>BigInt(first.mtime),'Host tasks progress between bounded guest calls');
      check(BigInt(second.mtime)<=BigInt(Math.ceil((secondEnd-selectStart)*10000))+1n,'Second idle ceiling uses the same host origin');
      await new Promise(resolve=>setTimeout(resolve,200));
      const beforeRebase=m.guestClockState(),rebaseStart=performance.now();m.rebaseGuestClock();
      const rebaseEnd=performance.now(),resumedRun=m.runChunk(256),resumedEnd=performance.now(),resumed=m.guestClockState();
      const maximum=BigInt(beforeRebase.mtime)+BigInt(Math.ceil((resumedEnd-rebaseStart)*10000))+1n;
      check(BigInt(resumed.mtime)<=maximum,'Explicit resume excludes elapsed paused host time');
      m.setGuestClock('icount');m.runChunk(256);const unpaced=m.guestClockState();
      check(unpaced.mode==='icount'&&BigInt(unpaced.mtime)>=30_000_000n,'Unpaced control reaches the actual guest-armed timer');
      // The new busy policy also composes with the actual compiled tier. This
      // guest has no WFI and its mtime must be exactly retired/64 despite yields.
      const busyWords=[0x00130313,0xffdff06f],busyBytes=new Uint8Array(8),busyView=new DataView(busyBytes.buffer);
      busyWords.forEach((w,i)=>busyView.setUint32(i*4,w,true));
      const busy=new api.WasmLinux(8,busyBytes,new Uint8Array(),'',()=>{},false);
      let retired=0,busyState,jitStats;
      try {
        check(crossOriginIsolated,'Actual browser JIT isolation');
        busy.setICountDivider(64);busy.setGuestClock('paced-icount');busy.enableJit(1);
        for(let i=0;i<32;i++){
          retired+=busy.runChunk(16384).retired;
          busyState=busy.guestClockState();jitStats=busy.jitStats();
          check(BigInt(busyState.mtime)===BigInt(Math.floor(retired/64)),'Compiled busy time remains retire-derived');
          if(jitStats.executedBlocks>0&&jitStats.retiredViaJit>0)break;
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        check(jitStats.executedBlocks>0&&jitStats.retiredViaJit>0,'Actual compiled guest blocks executed');
      } finally {busy.free();}
      return {words,initial,selected,selectStart,selectEnd,firstRun,firstEnd,first,idleRead,secondRun,secondEnd,second,beforeRebase,rebaseStart,rebaseEnd,resumedRun,resumedEnd,resumed,unpaced,
        compiledBusy:{busyWords,retired,state:busyState,stats:jitStats},proofExportsAbsent:true};
    } finally {m.free();}
  });
  assert.deepEqual(report.errors,[]);
  assert.equal(report.served.find(x=>x.route==='/pkg/wasm_vm_wasm_bg.wasm')?.sha256,sha256(await fs.readFile(path.join(root,'pkg/wasm_vm_wasm_bg.wasm'))));
  await page.locator('#result').evaluate((node,actual)=>node.textContent=JSON.stringify(actual,null,2),report.actual);
  await page.screenshot({path:path.join(output,'browser.png')});report.status='passed';
} catch(error){report.status='failed';report.failure=error.stack||String(error);report.actual=await page?.evaluate(()=>globalThis.__pacedProof||null).catch(()=>null);process.exitCode=1;}
finally {
  report.finished=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
console.log(JSON.stringify({status:report.status,failure:report.failure,output}));
