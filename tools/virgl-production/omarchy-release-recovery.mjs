#!/usr/bin/env node
// A publication-bound failure followed by the user's explicit software choice.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {expectedPublishedSource} from './published-source.mjs';
import {assertWarmFailureUi} from './critic-warm-ui-fixtures.mjs';
import {finalizeReleaseRecord} from './finalize-release-record.mjs';
import {indexPublishedReleaseAssets} from './published-release-assets.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
assert.equal(process.argv[2],'--output');assert.ok(process.argv[3]);
assert.equal(process.argv[4],'--url');assert.equal(process.argv.length,6);
const output=path.resolve(process.argv[3]),url=new URL(process.argv[5]);
assert.equal(url.protocol,'https:');assert.equal(url.pathname,'/');
assert.equal(url.search+url.hash+url.username+url.password,'');
const web=path.join(repo,'web/dist'),hash=b=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(output,{recursive:false});
const descriptor=JSON.parse(expectedPublishedSource('artifacts-omarchy-virgl.json',await fs.readFile(path.join(web,'artifacts-omarchy-virgl.json'))));
const pin=descriptor.artifacts.gpuCheckpoint;assert.ok(pin);
const pairUrl=new URL(pin.url,url).href;
const report={schema:'omarchy-published-recovery-v1',status:'running',
  scope:'The original published GPU request receives its independently published same-size last-bit-flip fixture through native HTTPS; refusal precedes a trusted visible software choice restoring the published software factory. Wider context-loss/reset fuzzing remains E6-T11e.',
  head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
  command:[process.execPath,...process.argv.slice(1)],url:url.href,pin,sources:[],requests:[],trusted:[],pageErrors:[],routeErrors:[],browserLifecycle:[]};
let saved=Promise.resolve();
const save=()=>{const body=JSON.stringify(report,null,2)+'\n';saved=saved.then(()=>fs.writeFile(path.join(output,'report.json'),body));return saved;};
await save();let browser,context,page,stage='refusal';
let rejectRouteFailure;
const routeFailure=new Promise((_,reject)=>{rejectRouteFailure=reject;});
void routeFailure.catch(()=>{});
const guarded=promise=>Promise.race([promise,routeFailure]);
function observe(){
  globalThis.__releaseRecovery={boots:[],errors:[],desktopReady:[],states:[]};
  for(const [type,name]of [['wvm:guest-error','errors'],['wvm:desktop-ready','desktopReady'],['wvm:guest-state','states']])
    addEventListener(type,event=>globalThis.__releaseRecovery[name].push(event.detail));
  const original=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(message,...rest){
    if(message?.type==='boot')globalThis.__releaseRecovery.boots.push(message.opts);
    return original.call(this,message,...rest);
  };
  addEventListener('click',event=>{
    if(event.target.closest?.('#gpu-retry'))void globalThis.__recordRecoveryPointer({trusted:event.isTrusted,target:'gpu-retry',time:performance.now()});
  },true);
}
async function state(){
  return page.evaluate(async()=>{
    const action=selector=>{
      const el=document.querySelector(selector),r=el?.getBoundingClientRect();
      const x=r?(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2:0,y=r?(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2:0;
      return{visible:Boolean(el?.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'),
        hitTestable:Boolean(r&&el.contains(document.elementFromPoint(x,y))),disabled:el?.disabled??false,href:el?.href??null};
    };
    return{...globalThis.__releaseRecovery,isolated:crossOriginIsolated,ready:Boolean(globalThis.wvmDemo?.isGuestReady?.()),
      up:Boolean(globalThis.wvmDemo?.isGuestUp?.()),restored:Boolean(globalThis.__linux?.restoredFromBootSnapshot?.()),
      graphics:document.querySelector('#desktop-graphics')?.value,message:document.querySelector('#gpu-status')?.textContent,
      actions:{software:action('#gpu-retry'),cold:action('#gpu-cold-retry'),retry:action('[data-os="omarchy"]')},
      gpu:await globalThis.wvmDemo?.gpuStats?.(),display:globalThis.__presentation?.state?.()};
  });
}
try{
  const names=['artifacts.json','artifacts-alpine.json','artifacts-node-alpine.json','artifacts-omarchy.json','artifacts-omarchy-virgl.json'];
  const releasePins=indexPublishedReleaseAssets(await Promise.all(names.map(async name=>({name,bytes:await fs.readFile(path.join(web,name))}))),url);
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args:['--enable-gpu','--use-gl=angle','--use-angle=metal']});
  browser.on('disconnected',()=>report.browserLifecycle.push({event:'browser-disconnected',stage,time:Date.now()}));
  const hardware=await browser.newBrowserCDPSession();report.hardware=await hardware.send('SystemInfo.getInfo');
  report.commandLine=await hardware.send('Browser.getBrowserCommandLine');
  assert.equal(report.hardware.gpu.featureStatus.webgl2??report.hardware.gpu.featureStatus.webgl,'enabled');
  assert.ok(!report.commandLine.arguments.some(s=>/swiftshader|llvmpipe|softpipe|--disable-gpu(?:$|=)/i.test(s)));
  context=await browser.newContext({viewport:{width:1280,height:850},serviceWorkers:'block'});
  context.on('close',()=>report.browserLifecycle.push({event:'context-close',stage,time:Date.now()}));
  await context.route('**/*',async route=>{
    const request=route.request(),actual=new URL(request.url());
    report.requests.push({stage,url:actual.href,method:request.method()});
    try{
      if(actual.href===pairUrl){
        assert.equal(stage,'refusal');assert.equal(report.corruption,undefined,'only one attempted original GPU download');
        const original=await route.fetch({timeout:180000,maxRetries:2});assert.equal(original.status(),200);
        const bytes=await original.body();assert.equal(bytes.length,pin.size);assert.equal(hash(bytes),pin.sha256);
        assert.equal(bytes.subarray(0,8).toString(),'WVGPAIR1');
        const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
        const fixtureUrl=new URL('/sha256/'+hash(changed)+'/verification-fixtures/omarchy-gpu-checkpoint-last-bitflip.wvgpair',actual).href;
        report.corruption={url:actual.href,status:200,originalBytes:bytes.length,originalSha256:hash(bytes),
          changedByte:changed.length-1,changedSha256:hash(changed),fixtureUrl,originalFetch:{timeout:180000,maxRetries:2},
          scope:'same-size bit flip only; published manifest/source bytes remain unchanged; only this request URL is overridden to the independently published fixture on the same HTTPS origin, keeping the large response outside the DevTools pipe'};
        await save();await route.continue({url:fixtureUrl});return;
      }
      if(actual.origin!==url.origin||request.method()!=='GET'){await route.continue();return;}
      const original=await route.fetch({timeout:180000});
      if(original.status()!==200){await route.fulfill({response:original});return;}
      const relative=actual.pathname==='/app'?'app.html':actual.pathname==='/'?'index.html':decodeURIComponent(actual.pathname.slice(1));
      const body=await original.body();let releasePin;
      if(relative.startsWith('releases/')){
        releasePin=releasePins.get(actual.href);assert.ok(releasePin,'unlisted staged boot asset '+relative);
        assert.equal(body.length,releasePin.size);assert.equal(hash(body),releasePin.sha256,'published release asset '+relative);
      }else{
        const expected=expectedPublishedSource(relative,await fs.readFile(path.join(web,relative)));
        assert.equal(hash(body),hash(expected),'original published source '+relative);
      }
      const bodyPath=path.join('source',relative);await fs.mkdir(path.dirname(path.join(output,bodyPath)),{recursive:true});
      await fs.writeFile(path.join(output,bodyPath),body);
      report.sources.push({stage,path:relative,url:actual.href,status:200,bytes:body.length,sha256:hash(body),bodyPath,forwardedUnchanged:true,...(releasePin?{releasePin}: {})});
      await route.fulfill({response:original,body});
    }catch(error){report.routeErrors.push({stage,url:actual.href,error:error.stack??String(error)});await save();rejectRouteFailure(error);await route.abort().catch(error=>report.routeErrors.push({stage,url:actual.href,error:String(error),during:'abort'}));}
  });
  await context.addInitScript(observe);page=await context.newPage();
  page.on('close',()=>report.browserLifecycle.push({event:'page-close',stage,time:Date.now()}));
  page.on('crash',()=>report.browserLifecycle.push({event:'page-crash',stage,time:Date.now()}));
  await page.exposeFunction('__recordRecoveryPointer',value=>report.trusted.push(value));
  page.on('pageerror',error=>report.pageErrors.push({stage,message:String(error)}));
  page.on('console',message=>{if(message.type()==='error'&&!/favicon\.ico/.test(message.location().url??''))report.pageErrors.push({stage,message:message.text()});});
  await page.goto(new URL('app?guest=omarchy&desktop=1#ide',url).href);
  await guarded(page.waitForFunction(()=>globalThis.__releaseRecovery?.errors.length>0,null,{timeout:300000}));
  await page.waitForTimeout(1000);report.refusal=await state();
  assertWarmFailureUi({...report.refusal,pageErrors:report.pageErrors.filter(r=>r.stage==='refusal')},'digest-mismatch');
  assert.ok(report.corruption);assert.deepEqual(report.routeErrors,[]);
  assert.ok(report.refusal.errors.some(row=>row.message.includes('expected '+pin.sha256+', got '+report.corruption.changedSha256)),
    'the original worker hashes the exact published same-size corrupted body');
  await page.screenshot({path:path.join(output,'refused.png'),fullPage:true});await save();
  stage='explicit-software';
  report.softwareActionStarted=Date.now();await save();
  await guarded(Promise.all([page.waitForURL('**/app?guest=omarchy&desktop=1&gpu=0#ide',{waitUntil:'commit',timeout:60000}),page.locator('#gpu-retry').click()]));
  report.softwareNavigation={url:page.url(),time:Date.now()};await save();
  await guarded(page.waitForFunction(()=>globalThis.wvmDemo?.isGuestReady?.()&&globalThis.__linux?.restoredFromBootSnapshot?.()&&
    globalThis.__releaseRecovery?.desktopReady.length>0,null,{timeout:600000}));
  report.software=await state();
  assert.equal(report.software.isolated,true);assert.equal(report.software.ready,true);assert.equal(report.software.restored,true);
  assert.equal(report.software.graphics,'software');assert.equal(report.software.boots.length,1);
  assert.equal(Boolean(report.software.boots[0].virgl),false);assert.equal(report.software.boots[0].bootSnapshot,true);
  assert.equal(report.software.gpu?.qualified??false,false);assert.deepEqual(report.software.errors,[]);
  report.native=await page.evaluate(()=>globalThis.wvmDemo.run('id -u; uname -m',300000));
  assert.equal(report.native.exit,0);assert.equal(report.native.stdout.trim(),'1000\nriscv64');
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.routeErrors,[]);
  assert.equal(report.trusted.length,1);assert.equal(report.trusted[0].trusted,true);
  await page.screenshot({path:path.join(output,'software-recovered.png'),fullPage:true});
  report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}
finally{await finalizeReleaseRecord(report,save,[
  {name:'context',close:()=>context?.close()},
  {name:'browser',close:()=>browser?.close()},
]);}
console.log(JSON.stringify({status:report.status,error:report.error,sources:report.sources.length}));
if(report.status!=='passed')process.exitCode=1;
