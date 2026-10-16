import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {attachIsolatedInput,assertPhysicalKeyHolds} from './isolated-input.mjs';

const stall=ms=>{const until=performance.now()+ms;while(performance.now()<until){/* Deliberate recorder stall. */}};
test('physical key and mouse releases survive a blocked recorder event loop',{timeout:30000},async()=>{
  const output=process.env.OMARCHY_INPUT_TEST_OUTPUT||await fs.mkdtemp(path.join(os.tmpdir(),'wasm-vm-input-test-'));
  await fs.mkdir(output,{recursive:true});
  const report={status:'running',scope:'Real Chrome trusted DOM events under an intentionally blocked recorder; no guest runtime claim',pageErrors:[]};
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--remote-debugging-port=0']});
  let driver;
  try{
    const page=await browser.newPage({viewport:{width:800,height:400}});
    page.on('pageerror',error=>report.pageErrors.push(String(error)));
    await page.setContent('<html><body style="background:#171820;color:#eee;font:20px monospace"><div id="pad" tabindex="0" style="height:350px">Physical input timing fixture</div></body></html>');
    await page.evaluate(()=>{
      globalThis.events=[];globalThis.frames=[];
      const sample=()=>{frames.push(performance.now());requestAnimationFrame(sample);};requestAnimationFrame(sample);
      for(const type of ['keydown','keyup','pointerdown','pointerup'])addEventListener(type,event=>{
        events.push({type,key:event.key,code:event.code,button:event.button,x:event.clientX,y:event.clientY,
          trusted:event.isTrusted,repeat:event.repeat,time:performance.now(),alt:event.altKey,meta:event.metaKey,shift:event.shiftKey,ctrl:event.ctrlKey});
        event.preventDefault();
      },true);
      document.querySelector('#pad').focus();
    });
    // Sabotage control: the old in-process timer really manufactures a long hold.
    await page.keyboard.down('m');
    const delayedRelease=new Promise(resolve=>setTimeout(resolve,50)).then(()=>page.keyboard.up('m'));
    stall(800);await delayedRelease;
    report.control=await page.evaluate(()=>({events:[...events],frames:[...frames]}));
    const controlDown=report.control.events.find(row=>row.type==='keydown'&&row.code==='KeyM');
    const controlUp=report.control.events.find(row=>row.type==='keyup'&&row.code==='KeyM');
    assert.ok(controlDown.trusted&&controlUp.trusted);
    report.controlHoldMs=controlUp.time-controlDown.time;
    assert.ok(report.controlHoldMs>=750,'the intentional recorder stall delays its own release timer');
    assert.throws(()=>assertPhysicalKeyHolds(report.control.events),/short physical key hold exceeded/);
    assert.ok(report.control.frames.filter(time=>time>controlDown.time&&time<controlUp.time).length>=10,'browser keeps running while the recorder is blocked');
    await page.evaluate(()=>{events.length=0;frames.length=0;});
    driver=await attachIsolatedInput(browser,page,path.join(output,'input.ndjson'));
    const typing=page.keyboard.type('mm',{delay:50});stall(800);await typing;
    const clicking=page.mouse.click(120,120,{delay:120});stall(800);await clicking;
    await page.keyboard.press('Meta+Alt+Space',{delay:50});
    report.isolated=await page.evaluate(()=>({events:[...events],frames:[...frames]}));
    const letters=report.isolated.events.filter(row=>row.code==='KeyM');
    assert.equal(letters.length,4);assert.ok(letters.every(row=>row.trusted&&!row.repeat));
    report.isolatedHoldsMs=[];
    for(let i=0;i<letters.length;i+=2){
      assert.equal(letters[i].type,'keydown');assert.equal(letters[i+1].type,'keyup');
      const duration=letters[i+1].time-letters[i].time;report.isolatedHoldsMs.push(duration);
      assert.ok(duration>=35&&duration<200,'each physical50ms key release survives the800ms parent stall');
    }
    const pointer=report.isolated.events.filter(row=>row.type.startsWith('pointer'));
    assert.deepEqual(pointer.map(row=>row.type),['pointerdown','pointerup']);
    assert.ok(pointer.every(row=>row.trusted&&row.button===0&&row.x===120&&row.y===120));
    report.pointerHoldMs=pointer[1].time-pointer[0].time;
    assert.ok(report.pointerHoldMs>=100&&report.pointerHoldMs<250,'physical120ms pointer release survives the800ms parent stall');
    const chord=report.isolated.events.filter(row=>['MetaLeft','AltLeft','Space'].includes(row.code));
    assert.deepEqual(chord.map(row=>[row.type,row.code]),[['keydown','MetaLeft'],['keydown','AltLeft'],['keydown','Space'],['keyup','Space'],['keyup','AltLeft'],['keyup','MetaLeft']]);
    assert.ok(chord.every(row=>row.trusted));assert.ok(chord[2].alt&&chord[2].meta);
    report.isolatedTiming=assertPhysicalKeyHolds(report.isolated.events);
    await page.evaluate(()=>{events.length=0;});
    const search=page.keyboard.type('libreoffice writer',{delay:100});stall(800);await search;
    report.search=await page.evaluate(()=>[...events]);
    assert.equal(report.search.filter(row=>row.type==='keydown').map(row=>row.key).join(''),'libreoffice writer');
    assert.equal(report.search.length,36);assert.ok(report.search.every(row=>row.trusted&&!row.repeat));
    report.searchTiming=assertPhysicalKeyHolds(report.search);
    for(let i=0;i<report.search.length;i+=2){
      assert.equal(report.search[i].type,'keydown');assert.equal(report.search[i+1].type,'keyup');
      assert.equal(report.search[i].code,report.search[i+1].code);
      const duration=report.search[i+1].time-report.search[i].time;
      assert.ok(duration>=80&&duration<250,'each native Apps100ms character has a bounded physical hold');
    }
    await assert.rejects(page.keyboard.press('not-a-physical-key'),/Unknown key/);
    // The same input-only target session survives new documents and reloads,
    // as the real factory/cache/persistence acceptance paths require.
    await page.goto('data:text/html,<body tabindex="0">New document input target</body>');
    await page.reload();
    await page.evaluate(()=>{
      globalThis.reloadEvents=[];
      for(const type of ['keydown','keyup'])addEventListener(type,event=>{reloadEvents.push({type,code:event.code,trusted:event.isTrusted});event.preventDefault();},true);
      document.body.focus();
    });
    await page.keyboard.press('x',{delay:50});
    report.reloadEvents=await page.evaluate(()=>reloadEvents);
    assert.deepEqual(report.reloadEvents,[{type:'keydown',code:'KeyX',trusted:true},{type:'keyup',code:'KeyX',trusted:true}]);
    report.dispose=await driver.dispose();driver=null;
    assert.deepEqual(report.dispose,{heldKeys:[],heldButtons:[]});
    assert.deepEqual(report.pageErrors,[]);
    await page.screenshot({path:path.join(output,'browser.png')});
    report.status='passed';
  }catch(error){report.status='failed';report.error=error.stack??String(error);throw error;}
  finally{await driver?.dispose();await browser.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
});
