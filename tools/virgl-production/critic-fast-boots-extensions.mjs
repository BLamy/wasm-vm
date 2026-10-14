#!/usr/bin/env node
// Literal optional-extension packets through original Wasm queues and real hardware owners.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:false});
const served=new Map(),errors=[];let browser;
const server=createServer(async(request,response)=>{
  try{
    const name=new URL(request.url,'http://localhost').pathname;
    if(name==='/'){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Original optional-extension critic</title><canvas id="gpu" width="8" height="8"></canvas>');return;}
    if(name==='/favicon.ico'){response.writeHead(204).end();return;}
    assert.ok(/^\/(?:renderer|target\/virgl-production\/pkg|tools\/virgl-command)\//.test(name));
    if(!served.has(name)){const bytes=await fs.readFile(path.join(repo,name));served.set(name,bytes);}
    response.writeHead(200,{'Content-Type':name.endsWith('.wasm')?'application/wasm':'text/javascript'}).end(served.get(name));
  }catch(error){response.writeHead(404).end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const report={scope:'negative original optional-extension requests; not complete API qualification',status:'running'};
try{
  browser=await chromium.launch({headless:false,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu']});
  report.hardware=await(await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  report.result=await page.evaluate(async()=>{
    const wasm=await import('/target/virgl-production/pkg/wasm_vm_wasm.js');await wasm.default();
    const {checker,makeRig,context,resource,idCommand,submission}=await import('/renderer/virgl-command/tests/submit-acceptance.mjs');
    const {packet}=await import('/tools/virgl-command/standard-image-fixtures.mjs');
    const {qualifyVirglHost,createWorkerScanoutPresenter}=await import('/renderer/virgl-command/production.mjs');
    const {createVirglProductionBridge}=await import('/renderer/virgl-command/control-bridge.mjs');
    const {createVirglStandardStreamOutputShaderBridge}=await import('/renderer/virgl-shader/standard.mjs');
    const gl=document.querySelector('#gpu').getContext('webgl2'),qualification=await qualifyVirglHost(gl);
    const compiler=await createVirglStandardStreamOutputShaderBridge(),c=checker();
    const Selected=class{constructor(callback){return wasm.WasmVirglSubmitProof.qualified(callback,qualification.hostWords,qualification.formatRoles,qualification.renderer);}};
    const rig=makeRig(Selected,options=>createVirglProductionBridge({...options,presenter:createWorkerScanoutPresenter(()=>{})}),gl,compiler,c,0,true,false,true);
    const result={predictions:{border:'wrap3 refuses before native sampling; wrap2 control passes',srgb:'sRGB104 original storage admits ordinary view104; original SKIP_DECODE view67 refuses'},qualification};
    try{
      await rig.expect('original context1',context(1));
      await rig.expect('original sRGB104 storage',resource(6,2,104,8,2,2));
      await rig.expect('original sRGB membership',idCommand(0x202,1,6));
      const identity=0|(1<<3)|(2<<6)|(3<<9);
      await rig.expect('matching sRGB104 view',submission(1,packet(1,6,[20,6,104,0,0,identity])));
      await rig.expect('GL_SKIP_DECODE linear67 view',submission(1,packet(1,6,[21,6,67,0,0,identity])),0x1205);
      await rig.expect('clamp-edge control',submission(1,packet(1,7,[77,2+(2<<3)+(2<<6)+(2<<11),0,0,0,0,0,0,0])));
      await rig.expect('CLAMP_TO_BORDER3 original sampler',submission(1,packet(1,7,[78,3+(2<<3)+(2<<6)+(2<<11),0,0,0,0,0,0,0])),0x1205);
      result.records=rig.q.records;result.events=rig.events;result.completions=rig.completions;
      result.guestTrace=rig.q.vm.commandTrace();result.machineDigest=rig.q.vm.machineDigest();
      result.host=rig.host.bridge.inspect();result.assertions=c.assertions;
    }finally{rig.dispose();result.cleanup=rig.trace.snapshot();}
    return result;
  });
  assert.deepEqual(errors,[]);report.status='passed';console.log(JSON.stringify({status:report.status,assertions:report.result.assertions,records:report.result.records.length}));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{
  report.errors=errors;report.served=[...served].map(([name,bytes])=>({name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,(_,value)=>typeof value==='bigint'?value.toString():value,2));
  for(const[name,bytes]of served){const dest=path.join(output,'source',name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes);}
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
