import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {chromium} from '../web/node_modules/playwright/index.mjs';
const repo=path.resolve(process.argv[2]),web=path.join(repo,'web/dist'),out=path.resolve(process.argv[3]);
await fs.mkdir(out,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(web,'artifacts-omarchy-virgl.json'),'utf8'));
const fallbacks=new Map(Object.values(manifest.artifacts).map(a=>['/'+a.url,'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+a.sha256+'/'+a.url]));
const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.wasm':'application/wasm','.css':'text/css'};
const server=createServer(async(req,res)=>{const p=new URL(req.url,'http://localhost').pathname;
 try{if(p==='/favicon.ico'){res.writeHead(204).end();return;}
 const file=path.join(p.startsWith('/releases/')?repo:web,p);
 let b;try{b=await fs.readFile(file);}catch(e){if(e.code==='ENOENT'&&fallbacks.has(p)){console.log('REDIRECT',p);res.writeHead(302,{Location:fallbacks.get(p)}).end();return;}throw e;}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(b);
 }catch(e){console.log('404',p,e.message);res.writeHead(404).end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const ctx=await chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-gpu','--use-gl=angle','--use-angle=metal'],serviceWorkers:'block',viewport:{width:1440,height:1000}});
const logs=[];const log=(...v)=>{logs.push(v);console.log(...v);};ctx.on('requestfailed',r=>log('FAIL',r.url(),r.failure()));
const page=ctx.pages()[0];page.on('console',m=>log('CONSOLE',m.type(),m.text()));page.on('pageerror',e=>log('PAGEERROR',e.message));
await ctx.tracing.start({screenshots:true,snapshots:true,sources:true});
const cdp=await ctx.newCDPSession(page);await cdp.send('Network.enable');cdp.on('Network.loadingFailed',v=>log('CDPFAIL',v));
try{await page.goto(`http://127.0.0.1:${server.address().port}/app.html?noAutoBoot&testHooks=1`);await page.waitForFunction(()=>window.__ready===true);
 await page.locator('#desktop-graphics').selectOption('gpu');
 if(process.argv.includes('--route')) await page.route('**/__e9-proof/*',route=>route.fulfill({status:204,body:''}));
 let result=await page.evaluate(()=>wvmDemo.bootOmarchy());log('BOOT',result);
 if(!result.ok && process.argv.includes('--route')) {await page.unroute('**/__e9-proof/*'); result=await page.evaluate(()=>wvmDemo.bootOmarchy());log('BOOT-AFTER-UNROUTE',result);}
 if(result.ok){await page.waitForFunction(()=>wvmDemo.isGuestReady()&&__linux.restoredFromBootSnapshot(),null,{timeout:600000});log('READY',await page.evaluate(async()=>({gpu:await __linuxCtl.gpuStats(),scheduler:await __linuxCtl.schedulerStats()})));}
 await page.screenshot({path:path.join(out,'result.png')});
}catch(e){log('ERROR',e.stack);process.exitCode=1;}
finally{await fs.writeFile(path.join(out,'logs.json'),JSON.stringify(logs,null,2));await ctx.tracing.stop({path:path.join(out,'trace.zip')});await ctx.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
