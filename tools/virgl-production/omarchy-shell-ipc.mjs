// Actual cold-start configuration and ordinary keybind dispatcher proof.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=b=>createHash('sha256').update(b).digest('hex');
const hypr='XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j ';

export async function verifyOmarchyShellIpc(page,command,output,{name='native-shell-ipc'}={}) {
  const report={status:'running',scope:'actual loaded user config and trusted normal Apps shortcut; no CLI timeout override',phases:[]};
  const save=()=>fs.writeFile(path.join(output,name+'.json'),JSON.stringify(report,null,2)+'\n');
  const run=async text=>{const result=await command(page,text,300000);report.phases.push({command:text,result,time:Date.now()});await save();assert.equal(result.exit,0);return result.stdout;};
  const visible=layers=>Object.values(layers).flatMap(m=>Object.values(m.levels||{}).flat()).find(l=>l.namespace==='omarchy-menu'&&l.alpha>0);
  const code="from pathlib import Path;import stat,base64,hashlib,json;p=Path.home()/'.config/hypr/hyprland.lua';s=p.lstat();b=p.read_bytes();print(json.dumps(dict(path=str(p),uid=s.st_uid,mode=oct(stat.S_IMODE(s.st_mode)),nlink=s.st_nlink,isRegular=stat.S_ISREG(s.st_mode),bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),base64=base64.b64encode(b).decode())))";
  try {
    report.config=JSON.parse(await run('python3 -c '+"'"+code.replaceAll("'","'\\''")+"'"));
    const bytes=Buffer.from(report.config.base64,'base64');assert.equal(bytes.length,1161);assert.equal(sha(bytes),'73c5b469059b9aa8159cf6712a62a5d067216414fbe94d2ffb35ea3fdfa2341d');
    assert.equal(report.config.sha256,sha(bytes));assert.equal(report.config.uid,1000);assert.equal(report.config.mode,'0o644');assert.equal(report.config.nlink,1);assert.equal(report.config.isRegular,true);
    report.configErrors=JSON.parse(await run(hypr+'configerrors'));
    assert.ok(Array.isArray(report.configErrors)&&report.configErrors.every(line=>line===''),'no nonempty native configuration errors');
    assert.equal(visible(JSON.parse(await run(hypr+'layers'))),undefined,'no menu was already mapped');
    await page.evaluate(()=>{window.__shellIpcTrusted=[];window.__shellIpcListener=e=>window.__shellIpcTrusted.push({type:e.type,key:e.key,trusted:e.isTrusted});for(const type of ['keydown','keyup'])document.addEventListener(type,window.__shellIpcListener,true);});
    const canvas=page.locator('#ide-display-canvas');await canvas.focus({timeout:120000});
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.keyboardCapture),'on');
    report.beforeGpu=await page.evaluate(()=>window.wvmDemo.gpuStats());
    const started=Date.now();await page.keyboard.press('Meta+Alt+Space',{delay:100});
    const deadline=Date.now()+180000;
    while(Date.now()<deadline){report.menu=visible(JSON.parse(await run(hypr+'layers')));if(report.menu)break;await sleep(3000);}
    assert.ok(report.menu,'normal Apps shortcut maps the native menu');report.openMs=Date.now()-started;
    await canvas.screenshot({path:path.join(output,name+'-menu.png'),timeout:120000});
    await page.keyboard.press('Escape',{delay:100});let mapped=true;const closeDeadline=Date.now()+120000;
    while(Date.now()<closeDeadline){mapped=!!visible(JSON.parse(await run(hypr+'layers')));if(!mapped)break;await sleep(3000);}
    assert.equal(mapped,false,'normal Escape closes the actual menu');
    report.afterGpu=await page.evaluate(()=>window.wvmDemo.gpuStats());
    for(const state of [report.beforeGpu,report.afterGpu]){assert.equal(state.qualified,true);assert.equal(state.counters.failed,0);assert.equal(state.lost,false);}
    assert.equal(report.afterGpu.epoch,report.beforeGpu.epoch);
    report.trusted=await page.evaluate(()=>window.__shellIpcTrusted);assert.ok(report.trusted.length>=8&&report.trusted.every(row=>row.trusted===true));
    report.status='passed';await save();return report;
  } catch(error){report.status='failed';report.error=error.stack;await save();throw error;}
  finally{await page.evaluate(()=>{if(window.__shellIpcListener)for(const type of ['keydown','keyup'])document.removeEventListener(type,window.__shellIpcListener,true);}).catch(()=>{});}
}
