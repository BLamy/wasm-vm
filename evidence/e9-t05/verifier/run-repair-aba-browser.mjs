import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {chromium} from '../../../web/node_modules/playwright/index.mjs';
import {observeSoftwareCheckpointAba} from '../../../tools/verify/e9-software-checkpoints-aba-critic.mjs';
const root=process.cwd(),out=path.join(root,'evidence/e9-t05/verifier');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const types={'.js':'text/javascript','.json':'application/json','.wasm':'application/wasm','.html':'text/html','.mjs':'text/javascript'};
const server=createServer(async(request,response)=>{try {
  const name=new URL(request.url,'http://localhost').pathname;
  if(name==='/critic.html'){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>E9-T05 critic</title>');return;}
  if(name==='/favicon.ico'){response.writeHead(204).end();return;}
  const base=name.startsWith('/releases/')?root:path.join(root,'web/dist');
  const file=path.resolve(base,'.'+decodeURIComponent(name));assert.ok(file.startsWith(base+path.sep));
  const bytes=await fs.readFile(file);response.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream',
    'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
}catch {response.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,context,page;
const report={status:'running',checks:null,errors:[]};
try {
  browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  context=await browser.newContext({serviceWorkers:'block'});page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});await page.coverage.startJSCoverage({resetOnNavigation:false});
  await page.goto(`http://127.0.0.1:${server.address().port}/critic.html`);
  const fixture=JSON.parse(await fs.readFile(path.join(root,'web/dist/session-software-fixture.json'),'utf8'));
  report.checks=await observeSoftwareCheckpointAba(page,fixture);
  assert.ok(report.checks.every(item=>!item.publication.accepted||item.frameDiskHash===item.rootDiskHash),'a successful checkpoint publication must retain one coherent frame/root tuple');
  assert.deepEqual(report.errors,[]);report.status='passed';
  console.log(JSON.stringify(report,null,2));
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally {
  if(page)await fs.writeFile(path.join(root,'target/evidence/e9-t05-repair-aba-critic-coverage.json'),JSON.stringify(await page.coverage.stopJSCoverage()));
  if(context)await context.tracing.stop({path:path.join(root,'target/evidence/e9-t05-repair-aba-critic-trace.zip')});
  await context?.close();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  report.trace={path:'target/evidence/e9-t05-repair-aba-critic-trace.zip',sha256:sha(await fs.readFile(path.join(root,'target/evidence/e9-t05-repair-aba-critic-trace.zip')))};
  report.coverage={path:'target/evidence/e9-t05-repair-aba-critic-coverage.json',sha256:sha(await fs.readFile(path.join(root,'target/evidence/e9-t05-repair-aba-critic-coverage.json')))};
  await fs.writeFile(path.join(out,'repair-aba-browser.json'),JSON.stringify(report,null,2)+'\n');
}
