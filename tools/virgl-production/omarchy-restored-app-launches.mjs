// Release acceptance only: launch the installed native applications after restore.
// The larger, independently verified application workflow remains E5.5-T05c.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createApplicationIdentityProof} from './application-identity.mjs';
import {typeGuestText,isWriterDocumentWindow,isWriterTipWindow} from './omarchy-applications.mjs';

const ctl='XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j ';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function verifyRestoredApplicationLaunches(page,command,output,options={}) {
  const name=options.name??'restored-applications';assert.match(name,/^[a-z0-9-]+$/);
  const report={status:'running',scope:'Installed signed native Chromium and LibreOffice Writer launch through stock shortcuts after the actual GPU factory restore; no new browsing, document-editing or application GPU-rasterization claim',steps:[],started:Date.now()};
  const save=()=>fs.writeFile(path.join(output,name+'.json'),JSON.stringify(report,null,2)+'\n');
  const run=async text=>{
    const result=await command(page,text,300000);report.steps.push({kind:'guest-read',command:text,result,time:Date.now()});await save();
    assert.equal(result.exit,0,text);return result.stdout;
  };
  const read=async kind=>JSON.parse(await run(ctl+kind));
  const identity=createApplicationIdentityProof(page,command,output,{...options,name});
  async function health(){
    const sample=await page.evaluate(async()=>{const s=await window.wvmDemo.gpuStats();return Object.fromEntries(['qualified','lost','poisoned','disposed','epoch','pending','counters','lastFailure'].map(k=>[k,s[k]]));});
    report.steps.push({kind:'gpu-health',sample,time:Date.now()});await save();
    assert.equal(sample.qualified,true);assert.equal(sample.lost,false);assert.equal(sample.poisoned,false);assert.equal(sample.disposed,false);assert.equal(sample.lastFailure,null);
    assert.equal(sample.counters.failed,0);assert.equal(sample.counters.cancelled,0);return sample;
  }
  async function wait(readValue,predicate,description,timeout=600000){
    const deadline=Date.now()+timeout;let nextHealth=0;
    do{
      if(Date.now()>=nextHealth){await health();nextHealth=Date.now()+15000;}
      const value=await readValue();if(predicate(value))return value;
      await sleep(1500);
    }while(Date.now()<deadline);
    throw Error('Restored native application deadline: '+description);
  }
  const findWindow=async(predicate,description,timeout)=>{
    const rows=await wait(()=>read('clients'),rows=>rows.some(predicate),description,timeout);return rows.find(predicate);
  };
  async function focus(){
    const canvas=page.locator('#ide-display-canvas');await canvas.focus();
    if(await page.evaluate(()=>document.documentElement.dataset.keyboardCapture)!=='on'){await page.locator('#ide-keyboard-toggle').click();await canvas.focus();}
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'ide-display-canvas');
  }
  async function press(key){await focus();report.steps.push({kind:'trusted-key',key,time:Date.now()});await save();await page.keyboard.press(key,{delay:100});}
  async function shot(label){const file=name+'-'+label+'.png';await page.locator('#ide-display-canvas').screenshot({path:path.join(output,file)});report.steps.push({kind:'screenshot',path:file,time:Date.now()});await save();}
  async function active(pid){return wait(()=>read('activewindow'),row=>row.pid===pid&&row.visible!==false&&row.acceptsInput!==false,'native window has focus',120000);}
  async function closed(predicate){await wait(()=>read('clients'),rows=>!rows.some(predicate),'native application closes',600000);}
  async function clickNative(dialog,x,y){
    const monitors=await read('monitors'),monitor=monitors.find(row=>row.id===dialog.monitor);assert.equal(monitor.scale,1);
    assert.ok(x>=0&&y>=0&&x<monitor.width&&y<monitor.height);
    const box=await page.locator('#ide-display-canvas').boundingBox();assert.ok(box?.width>0&&box.height>0);await focus();
    report.steps.push({kind:'trusted-native-button',dialog,x,y,time:Date.now()});await save();
    await page.mouse.click(box.x+x*box.width/monitor.width,box.y+y*box.height/monitor.height,{delay:120});
  }
  try{
    assert.equal(await page.evaluate(()=>window.__linuxCtl.restoredFromBootSnapshot()),true,'applications launch after real restoration');
    assert.equal((await run('id -u')).trim(),'1000');
    report.beforeGpu=await health();
    report.inputStart=await page.evaluate(()=>window.__criticTrustedInputEvents.length);
    const initial=await read('clients');assert.ok(!initial.some(row=>/chromium|libreoffice|soffice/i.test(row.class)),'factory has no prelaunched browser or office window');
    const started=Date.now();await press('Meta+Shift+b');
    let chrome=await findWindow(row=>row.visible!==false&&(row.class===''&&row.title==='Chromium Additional Terms of Service'||/chromium/i.test(row.class)),'stock Chromium shortcut opens its native window');
    if(chrome.title==='Chromium Additional Terms of Service'){
      report.chromiumFirstRun=await identity.process(chrome,'/usr/lib/chromium/chromium',name+'-chromium-first-run');
      await active(chrome.pid);await shot('chromium-first-run');await press('Enter');
      const address=chrome.address;
      chrome=await findWindow(row=>/chromium/i.test(row.class)&&row.address!==address&&row.visible!==false,'Chromium completes its genuine first-run dialog');
    }
    report.chromium=await identity.process(chrome,'/usr/lib/chromium/chromium',name+'-chromium');
    assert.ok(chrome.size[0]>300&&chrome.size[1]>300,'actual browser window, not a splash');
    const prompts=(await read('clients')).filter(row=>row.class==='gcr-prompter'&&row.visible!==false);
    assert.ok(prompts.length<=1,'bounded original keyring prompt');
    if(prompts.length){
      report.keyringPrompt=await identity.process(prompts[0],'/usr/lib/gcr-prompter',name+'-keyring');
      await active(prompts[0].pid);await shot('keyring');await press('Escape');await closed(row=>row.address===prompts[0].address);
    }
    await active(chrome.pid);await shot('chromium');report.chromiumLaunchMs=Date.now()-started;await save();
    await press('Meta+w');await closed(row=>/chromium/i.test(row.class));

    const writerStarted=Date.now();await press('Meta+Alt+Space');
    await wait(()=>read('layers'),rows=>Object.values(rows).flatMap(m=>Object.values(m.levels??{}).flat()).some(row=>row.namespace==='omarchy-menu'&&row.alpha>0),'stock Apps menu maps',300000);
    await focus();report.steps.push({kind:'trusted-text',text:'libreoffice writer',time:Date.now()});await save();await typeGuestText(page,'libreoffice writer');await sleep(1500);await shot('apps-menu');await press('Enter');
    const writer=await findWindow(isWriterDocumentWindow,'native Writer editor maps',1200000);
    report.writer=await identity.process(writer,'/usr/lib/libreoffice/program/soffice.bin',name+'-writer');
    for(let step=0;step<3;step++){
      const dialog=await read('activewindow');if(dialog.pid!==writer.pid||dialog.title!=='Welcome to LibreOffice!')break;
      assert.equal(dialog.class,'soffice');const monitor=(await read('monitors')).find(row=>row.id===dialog.monitor);
      await shot('writer-welcome-'+step);await clickNative(dialog,Math.min(dialog.at[0]+dialog.size[0]-45,monitor.width-15),dialog.at[1]+dialog.size[1]-27);
      await sleep(1500);
    }
    let front=await wait(()=>read('activewindow'),row=>row.pid===writer.pid&&row.title!=='Welcome to LibreOffice!'&&row.visible!==false,'native welcome has completed',120000);
    if(isWriterTipWindow(front,writer.pid)){await shot('writer-tip');await press('Escape');front=await wait(()=>read('activewindow'),row=>row.address===writer.address,'Writer owns focus after native tip closes',120000);}
    assert.ok(isWriterDocumentWindow(front),'the restored app launch reaches an actual editor');
    await shot('writer');report.writerLaunchMs=Date.now()-writerStarted;await save();
    await press('Control+q');await closed(row=>/libreoffice|soffice/i.test(row.class));
    report.afterGpu=await health();
    assert.ok(report.afterGpu.counters.draws>report.beforeGpu.counters.draws,'restored compositor draws real application windows');
    report.trusted=await page.evaluate(at=>window.__criticTrustedInputEvents.slice(at),report.inputStart);
    assert.ok(report.trusted.length>0&&report.trusted.every(row=>row.trusted));
    assert.deepEqual(await page.evaluate(()=>window.__keyboardCapture.heldSnapshot()),[]);
    report.status='passed';report.finished=Date.now();await save();return report;
  }catch(error){report.status='failed';report.error=error.stack??String(error);report.finished=Date.now();await save();await shot('failure').catch(()=>{});throw error;}
}
