import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {chromium} from '../../../web/node_modules/playwright/index.mjs';
import {checkDiskRootCritic,checkDiskRootIoCritic} from '../../../tools/verify/e9-disk-roots-critic.mjs';
const root=process.cwd(),out=path.join(root,'evidence/e9-t04/verifier');
const types={'.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.html':'text/html','.mjs':'text/javascript'};
const server=createServer(async(request,response)=>{try{
 const name=new URL(request.url,'http://localhost').pathname;
 if(name==='/critic.html'){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>E9-T04 critic</title>');return;}
 if(name==='/favicon.ico'){response.writeHead(204).end();return;}
 const base=name.startsWith('/releases/')?root:path.join(root,'web/dist');
 const file=path.resolve(base,'.'+decodeURIComponent(name));assert.ok(file.startsWith(base+path.sep));
 const bytes=await fs.readFile(file);response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream',
 'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
}catch{response.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,context,page;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 context=await browser.newContext({serviceWorkers:'block'});page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});await page.coverage.startJSCoverage({resetOnNavigation:false});
 await page.goto(`http://127.0.0.1:${server.address().port}/critic.html`);
 const fixture=JSON.parse(await fs.readFile(path.join(root,'web/dist/session-software-fixture.json'),'utf8'));
 const checks={guards:await checkDiskRootCritic(page,fixture),io:await checkDiskRootIoCritic(page,fixture)};
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'browser-critic.json'),JSON.stringify({status:'passed',checks,errors},null,2)+'\n');
 await fs.writeFile(path.join(out,'browser-critic-coverage.json'),JSON.stringify(await page.coverage.stopJSCoverage()));
 await context.tracing.stop({path:path.join(root,'target/evidence/e9-t04-critic-trace.zip')});
 console.log(JSON.stringify({status:'passed',checks,errors},null,2));
}finally{await context?.close();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
