#!/usr/bin/env node
// Built Chrome load of the real desktop entry module and its finite wall guard.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {WORKLOAD_ROOT as root,loadQualificationAssets,sha} from './e9-workload-assets.mjs';
import {validateDesktopWallAmendment,QUALIFIED_DESKTOP_WALL_MS} from './e9-workload-wall.mjs';

const args={};for(let i=2;i<process.argv.length;i++){
  const name=process.argv[i];if(name==='--development'){args.development=true;continue;}
  assert(name==='--output'&&!args.output&&process.argv[i+1]);args.output=process.argv[++i];
}assert(args.output);
const out=path.resolve(args.output),web=path.join(root,'web/dist');await fs.mkdir(out);
const git=(...argv)=>execFileSync('git',argv,{cwd:root,encoding:'utf8'}).trim();
const desktop=path.resolve(root,process.env.E9_T22N_DESKTOP??'target/evidence/e9-t22c-submission-a161b0f8d/desktop');
const report={task:'E9-T22n',scope:'Built browser module and finite fake-clock guard; no desktop workload or timing claim',
  status:'running',head:git('rev-parse','HEAD'),dirty:git('status','--porcelain','--untracked-files=all'),
  development:Boolean(args.development),started:new Date().toISOString(),consoleErrors:[],pageErrors:[],
  httpErrors:[],external:[],served:[]};
if(!args.development)assert.equal(report.dirty,'','freeze exact-head source');
let assets,server,context,page;
try{
  const [v10Bytes,v11Bytes,oldReportBytes,desktopSource,wallSource,retentionBytes]=await Promise.all([
    fs.readFile(path.join(root,'docs/design/session-workload-qualification-v10.json')),
    fs.readFile(path.join(root,'docs/design/session-workload-qualification-v11.json')),
    fs.readFile(path.join(desktop,'report.json')),
    fs.readFile(path.join(root,'tools/verify/e9-workload-desktop-page.mjs')),
    fs.readFile(path.join(root,'tools/verify/e9-workload-wall.mjs')),
    fs.readFile(path.join(root,'docs/design/session-workload-retention-v1.json'))]);
  const v11=JSON.parse(v11Bytes),old=JSON.parse(oldReportBytes);
  assert.equal(sha(oldReportBytes),v11.retainedFailure.reportSha256);
  assert.equal(old.head,v11.retainedFailure.head);
  assert.equal(old.result.failurePosition.transition,v11.retainedFailure.transition);
  assert.equal(validateDesktopWallAmendment(v11,sha(v10Bytes)),QUALIFIED_DESKTOP_WALL_MS);
  assets=await loadQualificationAssets('desktop');
  assert.equal(assets.qualification.version,11);
  assert.equal(assets.qualification.desktopHostWallMs,QUALIFIED_DESKTOP_WALL_MS);
  assert.equal(assets.receipt.serializationSha256,sha(v10Bytes));
  assert.equal(assets.receipt.wallProfileSha256,sha(v11Bytes));
  assert.equal(assets.receipt.qualifiedClock.divider,64);
  for(const name of ['contractSha256','bootManifestSha256','kernel','wasm','renderer','image',
    'referenceSha256','serializationSha256','retentionProfileSha256','qualifiedClock','ramMib'])
    assert.deepEqual(assets.receipt[name],old.inputs[name],'unchanged '+name);
  const prior={};for(let version=5;version<=10;version++)
    Object.assign(prior,JSON.parse(await fs.readFile(path.join(root,`docs/design/session-workload-qualification-v${version}.json`))));
  const capacity=JSON.parse(retentionBytes);prior.retention=capacity.retention;
  prior.capacityPreflight=capacity.preflight;
  for(const [name,value] of Object.entries(prior)){
    if(['version','task','scope','previousQualification'].includes(name))continue;
    assert.deepEqual(assets.qualification[name],value,'unchanged qualification '+name);
  }
  assert.deepEqual(Object.keys(assets.qualification).sort(),[...new Set([...Object.keys(prior),...Object.keys(v11)])].sort(),
    'v11 adds only its declared wall fields');
  report.inputs=assets.receipt;
  report.v10Sha256=sha(v10Bytes);report.v11Sha256=sha(v11Bytes);
  report.oldReportSha256=sha(oldReportBytes);report.desktopSourceSha256=sha(desktopSource);
  report.wallSourceSha256=sha(wallSource);
  const seen=new Map(),types={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm',
    '.css':'text/css','.json':'application/json'};
  server=createServer(async(request,response)=>{try{
    assert.equal(request.method,'GET');const name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(name==='/favicon.ico'){response.writeHead(204).end();return;}
    let bytes,mime='application/octet-stream';
    if(name==='/'){
      bytes=Buffer.from('<!doctype html><title>E9-T22n wall proof</title><main><h1>Finite Omarchy wall guard</h1><pre id="proof">Loading built module</pre></main>');mime='text/html';
    }else if(name==='/desktop.mjs'){bytes=desktopSource;mime='text/javascript';}
    else if(name==='/e9-workload-wall.mjs'){bytes=wallSource;mime='text/javascript';}
    else if(name==='/e9-workload-schedule.mjs'){
      bytes=await fs.readFile(path.join(root,'tools/verify/e9-workload-schedule.mjs'));mime='text/javascript';
    }else if(name==='/v11.json'){bytes=v11Bytes;mime='application/json';}
    else if(name==='/v10.json'){bytes=v10Bytes;mime='application/json';}
    else{
      const file=path.resolve(web,'.'+name);assert(file.startsWith(web+path.sep));
      bytes=await fs.readFile(file);mime=types[path.extname(file)]??mime;
    }
    const digest=sha(bytes);assert(!seen.has(name)||seen.get(name)===digest,'served bytes stable');
    if(!seen.has(name)){seen.set(name,digest);report.served.push({path:name,bytes:bytes.length,sha256:digest});}
    response.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store',
      'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(bytes);
  }catch(error){report.httpErrors.push({path:request.url,error:String(error.stack??error)});
    if(!response.headersSent)response.writeHead(500);response.end();}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  context=await chromium.launchPersistentContext(path.join(out,'chrome-profile'),{headless:true,
    executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    serviceWorkers:'block',viewport:{width:960,height:600}});
  await context.tracing.start({screenshots:true,snapshots:false,sources:true});
  page=await context.newPage();
  page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  page.on('pageerror',error=>report.pageErrors.push(String(error.stack??error)));
  page.on('request',request=>{if(/^https?:/.test(request.url())&&new URL(request.url()).origin!==origin)report.external.push(request.url());});
  await page.goto(origin+'/');
  report.chrome=(await(await context.newCDPSession(page)).send('Browser.getVersion')).product;
  assert.equal(report.chrome,'Chrome/155.0.8059.86');
  report.browser=await page.evaluate(async()=>{
    const [desktop,wall,v11,v10]=await Promise.all([
      import('/desktop.mjs'),import('/e9-workload-wall.mjs'),fetch('/v11.json').then(r=>r.json()),
      fetch('/v10.json').then(r=>r.json())]);
    const started=7312,old=wall.OLD_DESKTOP_WALL_MS,newWall=v11.desktopHostWallMs;
    const boundaries={oldRefuses:!wall.desktopWallOpen(started+old,started,old),
      oldAdmitsUnderV11:wall.desktopWallOpen(started+old,started,newWall),
      beforeEndAdmits:wall.desktopWallOpen(started+newWall-1,started,newWall),
      endRefuses:!wall.desktopWallOpen(started+newWall,started,newWall),
      unboundedRefuses:!wall.desktopWallOpen(started,started,Infinity),
      tamperedRejected:false};
    try{wall.validateDesktopWallAmendment({...v11,desktopHostWallMs:Infinity},v11.previousQualification.sha256);}
    catch{boundaries.tamperedRejected=true;}
    const loaded={isolated:crossOriginIsolated,desktopExport:typeof desktop.qualifyDesktopWorkload,
      v10Version:v10.version,v11Version:v11.version,boundaries};
    document.querySelector('#proof').textContent=JSON.stringify(loaded,null,2);return loaded;
  });
  assert.equal(report.browser.isolated,true);
  assert.equal(report.browser.desktopExport,'function');
  assert.equal(report.browser.v10Version,10);
  assert.equal(report.browser.v11Version,11);
  assert(Object.values(report.browser.boundaries).every(Boolean),'all browser fake-clock boundary predictions');
  assert(report.served.some(row=>row.path==='/desktop.mjs'&&row.sha256===report.desktopSourceSha256));
  assert(report.served.some(row=>row.path==='/e9-workload-wall.mjs'&&row.sha256===report.wallSourceSha256));
  assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.pageErrors,[]);
  assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.external,[]);
  await page.screenshot({path:path.join(out,'browser.png')});
  report.status='browser-wall-proof-passed';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;}
finally{
  try{if(context){await context.tracing.stop({path:path.join(out,'browser-trace.zip')});await context.close();}}
  catch(error){report.closeError=String(error.stack??error);report.status='failed';process.exitCode=1;}
  try{if(server)await new Promise(resolve=>server.close(resolve));}catch{}
  try{await assets?.close();}catch(error){report.assetCloseError=String(error.stack??error);report.status='failed';process.exitCode=1;}
  report.finished=new Date().toISOString();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
assert.equal(report.status,'browser-wall-proof-passed',report.failure??report.closeError??report.assetCloseError);
console.log(JSON.stringify({status:report.status,head:report.head,v11:report.v11Sha256,browser:report.chrome,boundaries:report.browser.boundaries}));
