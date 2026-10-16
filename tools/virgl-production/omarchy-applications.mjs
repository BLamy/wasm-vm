// Actual guest applications, driven only by trusted keyboard/mouse events.
// Serial RPC prepares a loopback fixture and reads results; it never writes the
// tested document or the browser's submitted values.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {verifyPublicDesktopInput} from './critic-fast-boots-input.mjs';
import {assertPublicDesktopFinal} from './critic-fast-boots-final.mjs';
import {verifyPublicBarContent} from './critic-fast-boots-bar-content.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hypr = 'XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j ';

export async function typeGuestText(page, text) {
  const shifted = {'~':'`','!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0',
    '_':'-','+':'=','{':'[','}':']','|':'\\',':':';','"':"'",'<':',','>':'.','?':'/'};
  for (const character of text) {
    if (shifted[character]) await page.keyboard.press('Shift+' + shifted[character], {delay:35});
    else if (/[A-Z]/.test(character)) await page.keyboard.press('Shift+' + character.toLowerCase(), {delay:35});
    else if (character === '\n') await page.keyboard.press('Enter', {delay:35});
    else await page.keyboard.type(character, {delay:45});
  }
}

// Select the fixture's actual painted controls, not its DOM autofocus state.
// DOM autofocus does not prove native widget/seat focus. These pixels come from
// scanout; the final submitted value and trust flags still come from the guest.
export function locateFixtureNoteControls(rgba,width,height) {
  assert.ok(Number.isSafeInteger(width)&&width>=300&&width<=4096);
  assert.ok(Number.isSafeInteger(height)&&height>=200&&height<=4096);
  assert.ok(width*height<=4194304,'bounded native control observation');
  assert.equal(rgba.length,width*height*4);
  const seen=new Uint8Array(width*height),queue=new Int32Array(width*height),rectangles=[];
  const white=i=>rgba[i*4]>=220&&rgba[i*4+1]>=220&&rgba[i*4+2]>=220&&rgba[i*4+3]===255;
  for(let seed=0;seed<seen.length;seed++){
    if(seen[seed]||!white(seed))continue;
    let head=0,tail=1,left=width,right=0,top=height,bottom=0;queue[0]=seed;seen[seed]=1;
    while(head<tail){
      const i=queue[head++],x=i%width,y=Math.floor(i/width);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      const visit=j=>{if(!seen[j]&&white(j)){seen[j]=1;queue[tail++]=j;}};
      if(x>0)visit(i-1);if(x+1<width)visit(i+1);if(y>0)visit(i-width);if(y+1<height)visit(i+width);
    }
    const w=right-left+1,h=bottom-top+1;
    if(w>=80&&h>=32&&h<=96&&tail>=w*h*0.55)rectangles.push({x:left,y:top,width:w,height:h,pixels:tail});
  }
  const inputs=rectangles.filter(r=>r.width>=250&&r.width/r.height>=4);
  assert.equal(inputs.length,1,'one actual painted fixture input');
  const input=inputs[0],buttons=rectangles.filter(r=>r.width<input.width*0.6&&r.y>input.y+input.height&&
    r.y<input.y+input.height+100&&Math.abs(r.x-input.x)<32);
  assert.equal(buttons.length,1,'one actual painted Save note button below the input');
  return {input,save:buttons[0]};
}

const html = `<!doctype html><meta charset="utf-8"><title>Omarchy native Chromium</title>
<style>body{font:24px sans-serif;background:#1a1b26;color:#c0caf5;padding:50px}input,button{font:24px sans-serif;padding:12px;margin:12px 0}input{width:650px}button{display:block}#result{color:#9ece6a}</style>
<h1>Native Chromium on RISC-V</h1><p>Guest loopback fixture. External networking is offline.</p>
<label>Note<br><input id="note" autofocus></label><button id="save">Save note</button><p id="result"></p>
<script>let trusted=[];note.addEventListener('input',e=>trusted.push(e.isTrusted));
function ready(){if(document.readyState==='complete'&&document.hasFocus()&&document.activeElement===note){
fetch('/ready',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({readyState:document.readyState,hasFocus:document.hasFocus(),activeElement:document.activeElement.id,location:location.href})});
}else requestAnimationFrame(ready);}requestAnimationFrame(ready);
save.addEventListener('click',async e=>{let data={message:note.value,clickTrusted:e.isTrusted,inputTrusted:trusted};
let r=await fetch('/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
result.textContent=r.ok?'Saved inside the RISC-V guest':'Save failed';});</script>`;

const server = `from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path
import json
HTML=${JSON.stringify(html)}.encode()
ROOT=Path('/tmp/omarchyapps')
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path=='/favicon.ico': self.send_response(204);self.end_headers();return
  if self.path!='/': self.send_error(404);return
  (ROOT/'requested').write_text(self.path)
  self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(HTML)));self.end_headers();self.wfile.write(HTML)
 def do_POST(self):
  length=int(self.headers.get('Content-Length','0'))
  if self.path not in ('/submit','/ready') or not 0<length<=8192: self.send_error(400);return
  data=json.loads(self.rfile.read(length));(ROOT/('ready.json' if self.path=='/ready' else 'submission.json')).write_text(json.dumps(data))
  self.send_response(200);self.end_headers();self.wfile.write(b'ok')
HTTPServer(('127.0.0.1',8765),Handler).serve_forever()
`;

// A previous document can become focused as soon as the keyring closes. Give
// each application recording a new GET and new POST endpoints, so that document
// cannot satisfy the new navigation's readiness or submission.
export function createApplicationFixture(token) {
  assert.match(token,/^[a-f0-9]{32}$/);
  const route='/?run='+token,readyPath='/ready/'+token,submitPath='/submit/'+token;
  const body=html.replace("fetch('/ready',","fetch('"+readyPath+"',")
    .replace("fetch('/submit',","fetch('"+submitPath+"',");
  const source=server.replace('HTML='+JSON.stringify(html)+'.encode()','HTML='+JSON.stringify(body)+'.encode()')
    .replace("if self.path!='/':","if self.path!="+JSON.stringify(route)+":")
    .replace("('/submit','/ready')","("+JSON.stringify(submitPath)+","+JSON.stringify(readyPath)+")")
    .replace("self.path=='/ready'","self.path=="+JSON.stringify(readyPath));
  return {token,route,readyPath,submitPath,url:'http://127.0.0.1:8765'+route,source};
}

export function readFixtureTransition(stdout,token) {
  assert.match(token,/^[a-f0-9]{32}$/);assert.equal(typeof stdout,'string');
  const rows=stdout.split(/\r?\n/).filter(line=>line.trim()),receipts=[];
  for(const line of rows){
    if(line.startsWith('{'))receipts.push(JSON.parse(line));
    else assert.match(line,/^\[\d+\]\+\s+Terminated\s+python3 \/tmp\/omarchyapps\/server\.py > \/tmp\/omarchyapps\/server\.log 2>&1 < \/dev\/null$/,
      'only the known Bash background-job notification may accompany the fixture receipt');
  }
  assert.equal(receipts.length,1);const receipt=receipts[0];
  assert.equal(receipt.scope,'authenticated owned fixture retained before generation change');
  assert.equal(receipt.serverSha256,sha(Buffer.from(server)));
  assert.ok(Number.isSafeInteger(receipt.serverPid)&&receipt.serverPid>1);
  assert.equal(receipt.retainedFixture,'/tmp/omarchyapps-before-'+token);return receipt;
}

// A continuation may carry only the already completed browser prefix. Its
// failed sandbox result remains failed, and all later application work is fresh.
export function authenticateBrowserPrefix(bytes, expectedSha256) {
  assert.match(expectedSha256,/^[a-f0-9]{64}$/);assert.equal(sha(bytes),expectedSha256);
  const prior=JSON.parse(bytes);assert.equal(prior.status,'failed');assert.equal(prior.continueExistingBrowser,true);
  assert.match(prior.error,/native GdkPixbuf decodes the packaged icon under the normal sandbox/);
  const fixture=createApplicationFixture(prior.fixtureToken);
  assert.equal(prior.fixtureServerSha256,sha(Buffer.from(fixture.source)));
  assert.deepEqual(prior.networking,{provider:'offline',fixture:fixture.url,externalBrowsingClaim:false});
  assert.ok(Number.isSafeInteger(prior.browserNavigationMs)&&prior.browserNavigationMs>=0&&prior.browserNavigationMs<=600000);
  assert.deepEqual(prior.browserReady,{readyState:'complete',hasFocus:true,activeElement:'note',location:fixture.url});
  assert.equal(prior.browserRequest.exit,0);assert.equal(prior.browserRequest.stdout.trim(),fixture.route);
  const note='omarchy chromium riscv 42';assert.equal(prior.browserSubmission.message,note);
  assert.equal(prior.browserSubmission.clickTrusted,true);
  assert.ok(prior.browserSubmission.inputTrusted.length>=note.length&&prior.browserSubmission.inputTrusted.every(value=>value===true));
  const commands=prior.phases.filter(row=>row.kind==='guest-command'),last=commands.at(-1);
  assert.ok(last.command.startsWith('timeout -k 1s 10s env RUST_LOG=debug python3 -c '));assert.equal(last.result.exit,124);
  for(const field of ['sandboxedImage','writer','firstSave','secondSave','nodeNpm','wallpaperTransitions'])assert.equal(prior[field],undefined);
  assert.ok(prior.trusted.length>100&&prior.trusted.every(row=>row.trusted===true));
  assert.equal(prior.chromium.executable,'/usr/lib/chromium/chromium');
  assert.equal(prior.chromiumGpu.qualified,true);assert.equal(prior.chromiumGpu.counters.failed,0);
  return {prior,fixture};
}

export function authenticateSandboxPrefix(bytes,expectedSha256) {
  assert.match(expectedSha256,/^[a-f0-9]{64}$/);assert.equal(sha(bytes),expectedSha256);
  const prior=JSON.parse(bytes);assert.equal(prior.status,'failed');assert.equal(prior.continueExistingBrowser,true);
  assert.match(prior.error,/actual completed ODT contains the expected text/);assert.ok(prior.carriedBrowserPrefix);
  const value=prior.sandboxedImage;assert.equal(value.width,48);assert.equal(value.height,48);assert.equal(value.channels,4);assert.equal(value.stride,192);
  assert.equal(value.sourceSha256,'af6b1fbc74b1dec2431352153b747e8cd584b11fcb762d97b1563dc03a2b6a18');
  assert.deepEqual(value.chromiumBefore,value.chromiumAfter);assert.equal(value.chromiumBefore.pid,prior.chromium.window.pid);
  assert.equal(value.chromiumBefore.starttime,prior.chromium.before.data.starttime);assert.equal(value.chromiumBefore.exe,'/usr/lib/chromium/chromium');
  const decoded=prior.phases.filter(row=>row.kind==='guest-command'&&row.command.startsWith('timeout -k 1s 60s env RUST_LOG=debug python3 -c '));
  assert.equal(decoded.length,1);assert.equal(decoded[0].result.exit,0);
  assert.match(decoded[0].result.stdout,/bwrap sandboxing available: true/);assert.match(decoded[0].result.stdout,/"bwrap"[^\n]+"--seccomp"/);
  assert.doesNotMatch(decoded[0].result.stdout,/running without sandbox/i);
  assert.equal(prior.writer.executable,'/usr/lib/libreoffice/program/soffice.bin');
  assert.equal(prior.writer.window.class,'soffice');assert.equal(prior.writer.window.title,'LibreOffice 26.8');
  assert.ok(prior.writer.window.size[1]<300,'the retained failed matcher selected the splash, not an editor');
  for(const field of ['firstSave','secondSave','nodeNpm','wallpaperTransitions'])assert.equal(prior[field],undefined);
  return {prior};
}

export function isWriterDocumentWindow(row) {
  return row.visible!==false&&row.mapped!==false&&/(?:libreoffice|soffice)/i.test(row.class)&&
    /writer/i.test(row.class+' '+row.title)&&row.size?.[0]>300&&row.size?.[1]>300;
}

export function isWriterTipWindow(row,pid) {
  return Number.isSafeInteger(pid)&&pid>1&&row?.pid===pid&&row.visible===true&&row.mapped===true&&
    row.class==='soffice'&&/^Tip of the Day: [1-9]\d*\/[1-9]\d*$/.test(row.title)&&
    row.size?.[0]>100&&row.size?.[1]>100;
}

export function authenticateWriterSavePrefix(bytes,expectedSha256) {
  assert.match(expectedSha256,/^[a-f0-9]{64}$/);assert.equal(sha(bytes),expectedSha256);
  const prior=JSON.parse(bytes);assert.equal(prior.status,'failed');assert.equal(prior.component.name,'writer');
  assert.match(prior.error,/^Error: Actual guest application window did not close\n/);
  for(const field of ['firstSave','secondSave','nodeNpm','wallpaperTransitions'])assert.equal(prior[field],undefined);
  assert.ok(isWriterDocumentWindow(prior.writer.window));
  assert.equal(prior.writer.executable,'/usr/lib/libreoffice/program/soffice.bin');
  assert.equal(prior.writer.executableSha256,'f8717b01e4381e7820938f48a35f18df6e076fcc2641f9176149ac7646ce5fe4');
  const before=prior.writer.before.data,after=prior.writer.after.data;
  for(const key of ['pid','exe','exeStat','pathStat','rootStat','rootBlock','starttime'])assert.deepEqual(before[key],after[key]);
  assert.equal(before.pid,prior.writer.window.pid);assert.equal(before.exe,prior.writer.executable);
  assert.equal(prior.saveDialog.pid,before.pid);assert.equal(prior.saveDialog.class,'soffice');assert.equal(prior.saveDialog.title,'Save');
  assert.equal(prior.fittedSaveDialog.address,prior.saveDialog.address);assert.equal(prior.fittedSaveDialog.pid,before.pid);
  assert.equal(prior.fittedSaveDialog.fullscreen,2,'the retained attempt hid the GTK actions in true fullscreen');
  assert.equal(prior.beforeGpu.qualified,true);assert.equal(prior.beforeGpu.counters.failed,0);
  const input=prior.phases.filter(row=>['trusted-key','trusted-text'].includes(row.kind));
  assert.ok(input.some(row=>row.kind==='trusted-text'&&row.text==='Omarchy riscv document 42'));
  assert.deepEqual(input.slice(-3).map(row=>row.kind==='trusted-key'?row.key:row.text),
    ['Control+l','/home/omarchy/Documents/omarchy-native-applications-42.odt','Enter']);
  assert.ok(prior.trusted.length>100&&prior.trusted.every(row=>row.trusted===true));
  assert.equal(prior.inputFailure.focus,'ide-display-canvas');assert.equal(prior.inputFailure.capture,'on');
  assert.deepEqual(prior.inputFailure.held,[]);assert.equal(prior.inputFailure.device.pendingEvents,0);
  assert.equal(prior.inputFailure.device.droppedEvents,0);assert.equal(prior.inputFailure.device.droppedFrames,0);
  return {prior};
}

// The original Save readback remains failed. This guard carries its authenticated
// typing/button history only; the saved file and native process are read anew.
export function authenticateWriterSavedPrefix(bytes,expectedSha256) {
  assert.match(expectedSha256,/^[a-f0-9]{64}$/);assert.equal(sha(bytes),expectedSha256);
  const prior=JSON.parse(bytes);assert.equal(prior.status,'failed');assert.equal(prior.component.name,'writer');
  assert.match(prior.error,/^AssertionError \[ERR_ASSERTION\]: actual completed ODT contains the expected text\n/);
  for(const field of ['firstSave','secondSave','nodeNpm','wallpaperTransitions'])assert.equal(prior[field],undefined);
  assert.equal(prior.resumedWriterSave.path,'control-applications-writer-launch55.json');
  assert.equal(prior.writer.executable,'/usr/lib/libreoffice/program/soffice.bin');
  assert.equal(prior.writer.executableSha256,'f8717b01e4381e7820938f48a35f18df6e076fcc2641f9176149ac7646ce5fe4');
  const before=prior.writer.before.data,after=prior.writer.after.data;
  for(const key of ['pid','exe','exeStat','pathStat','rootStat','rootBlock','starttime'])assert.deepEqual(before[key],after[key]);
  assert.equal(before.pid,prior.writer.window.pid);assert.equal(before.exe,prior.writer.executable);
  assert.equal(prior.writer.window.class,'libreoffice-writer');
  const dialog=prior.fittedSaveDialog;assert.equal(dialog.address,prior.saveDialog.address);
  assert.equal(dialog.pid,before.pid);assert.equal(dialog.class,'soffice');assert.equal(dialog.title,'Save');assert.equal(dialog.fullscreen,1);
  const actions=prior.phases.filter(row=>['native-save-name-focus','trusted-key','trusted-text','native-save-button'].includes(row.kind));
  assert.deepEqual(actions.map(row=>row.kind),['native-save-name-focus','trusted-key','trusted-text','native-save-button']);
  assert.equal(actions[1].key,'Control+a');assert.equal(actions[2].text,'omarchy-native-applications-42.odt');
  for(const action of [actions[0],actions[3]])assert.deepEqual(action.dialog,dialog);
  assert.deepEqual(actions[0].target,{x:dialog.at[0]+dialog.size[0]*0.5,y:dialog.at[1]+24});
  assert.deepEqual(actions[3].target,{x:dialog.at[0]+dialog.size[0]-48,y:dialog.at[1]+24});
  assert.equal(prior.beforeGpu.qualified,true);assert.equal(prior.beforeGpu.counters.failed,0);assert.deepEqual(prior.pageErrors,[]);
  assert.ok(prior.trusted.length>=64&&prior.trusted.every(row=>row.trusted===true));
  assert.equal(prior.inputFailure.focus,'ide-display-canvas');assert.equal(prior.inputFailure.capture,'on');
  assert.deepEqual(prior.inputFailure.held,[]);assert.equal(prior.inputFailure.device.pendingEvents,0);
  assert.equal(prior.inputFailure.device.droppedEvents,0);assert.equal(prior.inputFailure.device.droppedFrames,0);
  return {prior};
}

export function authenticateWriterReopenPrefix(bytes,expectedSha256) {
  assert.match(expectedSha256,/^[a-f0-9]{64}$/);assert.equal(sha(bytes),expectedSha256);
  const prior=JSON.parse(bytes);assert.equal(prior.status,'failed');assert.equal(prior.component.name,'writer');
  assert.match(prior.error,/^AssertionError \[ERR_ASSERTION\]: normal Omarchy Apps menu is actually mapped\n/);
  assert.equal(prior.resumedWriterSavedDocument.path,'control-applications-writer-save62.json');
  assert.deepEqual(prior.firstSave,{sha256:'d69c48141364b0102e1d8217e5daa0339867b78368ceb2a22d7eaa144c411012',bytes:8730,text:'Omarchy riscv document 42'});
  for(const field of ['reopenedWindow','reopenedWriter','secondSave','nodeNpm','wallpaperTransitions'])assert.equal(prior[field],undefined);
  assert.equal(prior.writer.executableSha256,'f8717b01e4381e7820938f48a35f18df6e076fcc2641f9176149ac7646ce5fe4');
  const before=prior.writer.before.data,after=prior.writer.after.data;
  for(const key of ['pid','exe','exeStat','pathStat','rootStat','rootBlock','starttime'])assert.deepEqual(before[key],after[key]);
  assert.equal(before.pid,prior.writer.window.pid);assert.equal(before.exe,'/usr/lib/libreoffice/program/soffice.bin');
  const input=prior.phases.filter(row=>['trusted-key','trusted-text'].includes(row.kind));
  assert.deepEqual(input.map(row=>row.key),['Control+q','Meta+Alt+Space']);
  const lastClients=prior.phases.filter(row=>row.kind==='guest-command'&&row.command===hypr+'clients').at(-1);
  assert.equal(lastClients.result.exit,0);const windows=JSON.parse(lastClients.result.stdout);
  assert.ok(windows.length>0&&windows.every(row=>/foot/i.test(row.class)));
  assert.ok(lastClients.time>input[0].time&&lastClients.time<input[1].time);
  assert.equal(prior.beforeGpu.qualified,true);assert.equal(prior.beforeGpu.counters.failed,0);assert.deepEqual(prior.pageErrors,[]);
  assert.ok(prior.trusted.length>=8&&prior.trusted.every(row=>row.trusted===true));
  assert.deepEqual(prior.inputFailure.held,[]);assert.equal(prior.inputFailure.device.pendingEvents,0);
  assert.equal(prior.inputFailure.device.droppedEvents,0);assert.equal(prior.inputFailure.device.droppedFrames,0);
  return {prior};
}

export function authenticateWriterOpenPrefix(bytes,expectedSha256) {
  assert.match(expectedSha256,/^[a-f0-9]{64}$/);assert.equal(sha(bytes),expectedSha256);
  const prior=JSON.parse(bytes);assert.equal(prior.status,'failed');assert.equal(prior.component.name,'writer');
  assert.match(prior.error,/^Error: Actual guest application did not acquire focus\n/);
  assert.equal(prior.resumedWriterReopen.path,'control-applications-writer-reopen65.json');
  assert.equal(prior.applicationShellConfig.sha256,'73c5b469059b9aa8159cf6712a62a5d067216414fbe94d2ffb35ea3fdfa2341d');
  assert.equal(prior.resumedWriterReopen.shellConfigSha256,prior.applicationShellConfig.sha256);
  assert.deepEqual(prior.firstSave,{sha256:'d69c48141364b0102e1d8217e5daa0339867b78368ceb2a22d7eaa144c411012',bytes:8730,text:'Omarchy riscv document 42'});
  for(const field of ['writer','openDialog','writerTip','reopenedWindow','reopenedWriter','secondSave','nodeNpm','wallpaperTransitions'])assert.equal(prior[field],undefined);
  const input=prior.phases.filter(row=>['trusted-key','trusted-text'].includes(row.kind));
  assert.deepEqual(input.map(row=>row.kind==='trusted-key'?row.key:row.text),['Meta+Alt+Space','libreoffice writer','Enter','Control+o']);
  const active=prior.phases.filter(row=>row.kind==='guest-command'&&row.command===hypr+'activewindow').at(-1);
  assert.equal(active.result.exit,0);assert.ok(active.time>input.at(-1).time);const tip=JSON.parse(active.result.stdout);
  assert.ok(isWriterTipWindow(tip,tip.pid));
  const clients=prior.phases.filter(row=>row.kind==='guest-command'&&row.command===hypr+'clients').at(-1);
  assert.equal(clients.result.exit,0);const windows=JSON.parse(clients.result.stdout);
  const candidates=windows.filter(row=>row.pid===tip.pid&&isWriterDocumentWindow(row));assert.equal(candidates.length,1);
  assert.ok(windows.every(row=>/foot/i.test(row.class)||row.pid===tip.pid));
  assert.equal(prior.beforeGpu.qualified,true);assert.equal(prior.beforeGpu.counters.failed,0);assert.deepEqual(prior.pageErrors,[]);
  for(const row of prior.phases.filter(row=>row.kind==='gpu-health')){
    assert.equal(row.state.epoch,prior.beforeGpu.epoch);assert.equal(row.state.qualified,true);assert.equal(row.state.counters.failed,0);
  }
  assert.ok(prior.trusted.length>32&&prior.trusted.every(row=>row.trusted===true));
  assert.equal(prior.inputFailure.focus,'ide-display-canvas');assert.equal(prior.inputFailure.capture,'on');
  assert.deepEqual(prior.inputFailure.held,[]);assert.equal(prior.inputFailure.device.pendingEvents,0);
  assert.equal(prior.inputFailure.device.droppedEvents,0);assert.equal(prior.inputFailure.device.droppedFrames,0);
  return {prior,pendingWriter:candidates[0],tip};
}

export async function verifyOmarchyApplications(page, command, output, options = {}) {
  // Re-read at each invocation: a retry can update only this helper's dependency
  // while Node retains the application module from the previous recording.
  const identityModule=new URL('./application-identity.mjs',import.meta.url);
  const identityModuleSha256=sha(await fs.readFile(identityModule));
  identityModule.searchParams.set('recording',identityModuleSha256);
  const {createApplicationIdentityProof}=await import(identityModule.href);
  const name = options.name || 'native-applications';
  let writerOnly=options.component==='writer';
  assert.ok(options.component===undefined||writerOnly,'known explicit application component');
  let continueExistingBrowser=options.continueExistingBrowser===true,continuationRequest,processWitness,browserPrefix,sandboxPrefix,writerComponent,writerLaunchResume,writerSaveResume,writerSavedResume,writerReopenResume,writerOpenResume;
  async function retainedComponent(reference,authenticate,scope){
    assert.ok(processWitness,'same-process native witness is required');
    assert.match(reference.path,/^control-applications-[a-z0-9-]+\.json$/);assert.match(reference.sourceSha256,/^[a-f0-9]{64}$/);
    const bytes=await fs.readFile(path.join(output,reference.path)),authenticated=authenticate(bytes,reference.sha256);
    assert.equal(authenticated.prior.identityModuleSha256,identityModuleSha256);assert.deepEqual(authenticated.prior.processWitness,processWitness);
    const sourcePath=reference.path.replace(/\.json$/,'-source.mjs');assert.equal(sha(await fs.readFile(path.join(output,sourcePath))),reference.sourceSha256);
    const requestPath='control-request-'+reference.path.slice('control-applications-'.length);
    assert.equal(sha(await fs.readFile(path.join(output,requestPath))),authenticated.prior.continuationRequest.sha256);
    return {...authenticated,reference:{...reference,sourcePath,bytes:bytes.length,scope}};
  }
  if(name.startsWith('control-applications-')){
    // The original failed controller predates this option. Its retained, owned
    // control request binds the incremental helper without mutating that loaded
    // controller or restarting the live guest.
    const id=name.slice('control-applications-'.length);assert.match(id,/^[a-z0-9-]+$/);
    const bytes=await fs.readFile(path.join(output,'control-request-'+id+'.json')),request=JSON.parse(bytes);
    assert.equal(request.id,id);assert.equal(request.kind,'retry-applications');
    continueExistingBrowser ||= request.continueExistingBrowser===true;
    if(request.resumeWriterSave){
      assert.ok(!continueExistingBrowser&&!request.writerComponent&&!request.resumeAfterBrowser&&!request.resumeAfterSandbox&&!request.processWitness&&!request.resumeWriterLaunch);
      const reference=request.resumeWriterSave;
      assert.equal(reference.path,'control-applications-writer-launch55.json');
      for(const key of ['sha256','sourceSha256','responseSha256','controllerSha256'])assert.match(reference[key],/^[a-f0-9]{64}$/);
      const parentBytes=await fs.readFile(path.join(output,'report.json'));assert.equal(sha(parentBytes),reference.controllerSha256);
      const parent=JSON.parse(parentBytes);assert.equal(parent.status,'failed');assert.equal(parent.applicationComponent.name,'writer');
      assert.equal(parent.applicationContinuation,true);assert.equal(parent.warmGpu,true);assert.ok(!parent.remoteUrl);
      assert.equal(sha(await fs.readFile(path.join(output,'candidate-manifest.json'))),parent.candidate.manifestSha256);
      assert.equal(parent.expectedGpuPair.identity.imageManifestSha256,parent.candidate.manifestSha256);
      const sourcePath=reference.path.replace(/\.json$/,'-source.mjs');
      assert.equal(sha(await fs.readFile(path.join(output,sourcePath))),reference.sourceSha256);
      const responseBytes=await fs.readFile(path.join(output,'control-response-writer-launch55.json'));
      assert.equal(sha(responseBytes),reference.responseSha256);const response=JSON.parse(responseBytes);
      assert.equal(response.request.id,'writer-launch55');assert.equal(response.request.kind,'retry-applications');
      assert.equal(response.source.bodyPath,sourcePath);assert.equal(response.source.sha256,reference.sourceSha256);
      assert.match(response.error,/^Error: Actual guest application window did not close\n/);
      const authenticated=authenticateWriterSavePrefix(await fs.readFile(path.join(output,reference.path)),reference.sha256);
      assert.equal(authenticated.prior.identityModuleSha256,identityModuleSha256);
      continuationRequest={id,sha256:sha(bytes),scope:'same native unsaved Writer and Save dialog; original waitClosed timeout remains failed'};
      writerOnly=true;writerSaveResume={...authenticated,reference:{...reference,sourcePath}};
    }
    if(request.resumeWriterSavedDocument){
      assert.ok(!continueExistingBrowser&&!request.writerComponent&&!request.resumeAfterBrowser&&!request.resumeAfterSandbox&&!request.processWitness&&!request.resumeWriterLaunch&&!request.resumeWriterSave);
      const reference=request.resumeWriterSavedDocument;assert.equal(reference.path,'control-applications-writer-save62.json');
      for(const key of ['sha256','sourceSha256','responseSha256','controllerSha256','documentSha256'])assert.match(reference[key],/^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(reference.documentBytes)&&reference.documentBytes>0&&reference.documentBytes<1048576);
      const parentBytes=await fs.readFile(path.join(output,'report.json'));assert.equal(sha(parentBytes),reference.controllerSha256);
      const parent=JSON.parse(parentBytes);assert.equal(parent.status,'failed');assert.equal(parent.applicationComponent.name,'writer');
      assert.equal(parent.applicationContinuation,true);assert.equal(parent.warmGpu,true);assert.ok(!parent.remoteUrl);
      assert.equal(sha(await fs.readFile(path.join(output,'candidate-manifest.json'))),parent.candidate.manifestSha256);
      assert.equal(parent.expectedGpuPair.identity.imageManifestSha256,parent.candidate.manifestSha256);
      const sourcePath=reference.path.replace(/\.json$/,'-source.mjs');assert.equal(sha(await fs.readFile(path.join(output,sourcePath))),reference.sourceSha256);
      const responseBytes=await fs.readFile(path.join(output,'control-response-writer-save62.json'));
      assert.equal(sha(responseBytes),reference.responseSha256);const response=JSON.parse(responseBytes);
      assert.equal(response.request.id,'writer-save62');assert.equal(response.request.kind,'retry-applications');
      assert.equal(response.source.bodyPath,sourcePath);assert.equal(response.source.sha256,reference.sourceSha256);
      const authenticated=authenticateWriterSavedPrefix(await fs.readFile(path.join(output,reference.path)),reference.sha256);
      assert.equal(response.error,authenticated.prior.error);assert.equal(authenticated.prior.identityModuleSha256,identityModuleSha256);
      const previousRequest=await fs.readFile(path.join(output,'control-request-writer-save62.json'));
      assert.equal(sha(previousRequest),authenticated.prior.continuationRequest.sha256);
      assert.deepEqual(JSON.parse(previousRequest),response.request);
      const prefix=authenticated.prior.resumedWriterSave;
      const original=authenticateWriterSavePrefix(await fs.readFile(path.join(output,prefix.path)),prefix.sha256).prior;
      assert.equal(original.writer.window.pid,authenticated.prior.writer.window.pid);
      assert.equal(original.writer.before.data.starttime,authenticated.prior.writer.before.data.starttime);
      continuationRequest={id,sha256:sha(bytes),scope:'fresh read of the same native saved Writer document; original62 read deadline remains failed'};
      writerOnly=true;writerSavedResume={...authenticated,reference:{...reference,sourcePath}};
    }
    if(request.resumeWriterReopen){
      assert.ok(!continueExistingBrowser&&!request.writerComponent&&!request.resumeAfterBrowser&&!request.resumeAfterSandbox&&!request.processWitness&&!request.resumeWriterLaunch&&!request.resumeWriterSave&&!request.resumeWriterSavedDocument);
      const reference=request.resumeWriterReopen;assert.equal(reference.path,'control-applications-writer-reopen65.json');
      for(const key of ['sha256','sourceSha256','responseSha256','controllerSha256','shellConfigResponseSha256','shellConfigConfirmationSha256','shellConfigSha256'])assert.match(reference[key],/^[a-f0-9]{64}$/);
      const parentBytes=await fs.readFile(path.join(output,'report.json'));assert.equal(sha(parentBytes),reference.controllerSha256);
      const parent=JSON.parse(parentBytes);assert.equal(parent.status,'failed');assert.equal(parent.applicationComponent.name,'writer');
      assert.equal(parent.applicationContinuation,true);assert.equal(parent.warmGpu,true);assert.ok(!parent.remoteUrl);
      assert.equal(sha(await fs.readFile(path.join(output,'candidate-manifest.json'))),parent.candidate.manifestSha256);
      assert.equal(parent.expectedGpuPair.identity.imageManifestSha256,parent.candidate.manifestSha256);
      const sourcePath=reference.path.replace(/\.json$/,'-source.mjs');assert.equal(sha(await fs.readFile(path.join(output,sourcePath))),reference.sourceSha256);
      const responseBytes=await fs.readFile(path.join(output,'control-response-writer-reopen65.json'));
      assert.equal(sha(responseBytes),reference.responseSha256);const response=JSON.parse(responseBytes);
      assert.equal(response.request.id,'writer-reopen65');assert.equal(response.source.bodyPath,sourcePath);assert.equal(response.source.sha256,reference.sourceSha256);
      const authenticated=authenticateWriterReopenPrefix(await fs.readFile(path.join(output,reference.path)),reference.sha256);
      assert.equal(response.error,authenticated.prior.error);assert.equal(authenticated.prior.identityModuleSha256,identityModuleSha256);
      const previousRequest=await fs.readFile(path.join(output,'control-request-writer-reopen65.json'));
      assert.equal(sha(previousRequest),authenticated.prior.continuationRequest.sha256);assert.deepEqual(JSON.parse(previousRequest),response.request);
      const prefix=authenticated.prior.resumedWriterSavedDocument;
      authenticateWriterSavedPrefix(await fs.readFile(path.join(output,prefix.path)),prefix.sha256);
      const documentBytes=await fs.readFile(path.join(output,'control-applications-writer-reopen65-first-save.odt'));
      assert.equal(documentBytes.length,authenticated.prior.firstSave.bytes);assert.equal(sha(documentBytes),authenticated.prior.firstSave.sha256);
      const configured=await fs.readFile(path.join(output,'control-response-application-shell-config68.json'));
      assert.equal(sha(configured),reference.shellConfigResponseSha256);const applied=JSON.parse(configured);
      assert.equal(applied.request.id,'application-shell-config68');assert.equal(applied.request.kind,'guest-command');assert.equal(applied.result.exit,1);
      assert.match(applied.result.stdout,/AssertionError/); // The original final [] assertion remains failed.
      const confirmed=await fs.readFile(path.join(output,'control-response-application-shell-readonly69.json'));
      assert.equal(sha(confirmed),reference.shellConfigConfirmationSha256);const observed=JSON.parse(confirmed);
      assert.equal(observed.request.id,'application-shell-readonly69');assert.equal(observed.request.kind,'guest-command');assert.equal(observed.result.exit,0);
      const receipt=JSON.parse(observed.result.stdout);assert.equal(receipt.scope,'read-only current configuration confirmation; original68 final assertion remains failed');
      const configuration=Buffer.from(receipt.base64,'base64');assert.equal(configuration.length,1161);assert.equal(sha(configuration),reference.shellConfigSha256);
      assert.equal(receipt.sha256,reference.shellConfigSha256);assert.equal(receipt.uid,1000);assert.equal(receipt.mode,'0o644');assert.equal(receipt.nlink,1);assert.equal(receipt.isRegular,true);
      assert.equal(receipt.documentSha256,authenticated.prior.firstSave.sha256);assert.equal(receipt.packagedShellSha256,'538ece231aba80154c76ab48df8ab013b2f02c5171241d08bddbf08a5fe5ac34');
      assert.equal(receipt.configErrors.exit,0);assert.equal(receipt.configErrors.stderr,'');
      const errors=JSON.parse(receipt.configErrors.stdout);assert.ok(Array.isArray(errors)&&errors.every(line=>line===''),'no nonempty native configuration errors');
      continuationRequest={id,sha256:sha(bytes),scope:'fresh first ODT/read and normal Apps reopen after the explicit guest shell-budget correction; original65 menu failure remains failed'};
      writerOnly=true;writerReopenResume={...authenticated,reference:{...reference,sourcePath}};
    }
    if(request.resumeWriterOpen){
      assert.ok(!continueExistingBrowser&&!request.writerComponent&&!request.resumeAfterBrowser&&!request.resumeAfterSandbox&&!request.processWitness&&!request.resumeWriterLaunch&&!request.resumeWriterSave&&!request.resumeWriterSavedDocument&&!request.resumeWriterReopen);
      const reference=request.resumeWriterOpen;assert.equal(reference.path,'control-applications-writer-reopen70.json');
      for(const key of ['sha256','sourceSha256','responseSha256','controllerSha256'])assert.match(reference[key],/^[a-f0-9]{64}$/);
      const parentBytes=await fs.readFile(path.join(output,'report.json'));assert.equal(sha(parentBytes),reference.controllerSha256);
      const parent=JSON.parse(parentBytes);assert.equal(parent.status,'failed');assert.equal(parent.applicationComponent.name,'writer');
      assert.equal(parent.applicationContinuation,true);assert.equal(parent.warmGpu,true);assert.ok(!parent.remoteUrl);
      assert.equal(sha(await fs.readFile(path.join(output,'candidate-manifest.json'))),parent.candidate.manifestSha256);
      assert.equal(parent.expectedGpuPair.identity.imageManifestSha256,parent.candidate.manifestSha256);
      const sourcePath=reference.path.replace(/\.json$/,'-source.mjs');assert.equal(sha(await fs.readFile(path.join(output,sourcePath))),reference.sourceSha256);
      const responseBytes=await fs.readFile(path.join(output,'control-response-writer-reopen70.json'));
      assert.equal(sha(responseBytes),reference.responseSha256);const response=JSON.parse(responseBytes);
      assert.equal(response.request.id,'writer-reopen70');assert.equal(response.request.kind,'retry-applications');
      assert.equal(response.source.bodyPath,sourcePath);assert.equal(response.source.sha256,reference.sourceSha256);
      const authenticated=authenticateWriterOpenPrefix(await fs.readFile(path.join(output,reference.path)),reference.sha256);
      assert.equal(response.error,authenticated.prior.error);assert.equal(authenticated.prior.identityModuleSha256,identityModuleSha256);
      const previousRequest=await fs.readFile(path.join(output,'control-request-writer-reopen70.json'));
      assert.equal(sha(previousRequest),authenticated.prior.continuationRequest.sha256);assert.deepEqual(JSON.parse(previousRequest),response.request);
      const prefix=authenticated.prior.resumedWriterReopen;
      authenticateWriterReopenPrefix(await fs.readFile(path.join(output,prefix.path)),prefix.sha256);
      assert.equal(sha(await fs.readFile(path.join(output,'control-response-application-shell-readonly69.json'))),prefix.shellConfigConfirmationSha256);
      const documentBytes=await fs.readFile(path.join(output,'control-applications-writer-reopen70-first-save.odt'));
      assert.equal(documentBytes.length,authenticated.prior.firstSave.bytes);assert.equal(sha(documentBytes),authenticated.prior.firstSave.sha256);
      continuationRequest={id,sha256:sha(bytes),scope:'fresh native Writer identity and first ODT; dismiss its observed Tip of the Day and perform a new Open/edit/resave; original70 focus deadline remains failed'};
      writerOnly=true;writerOpenResume={...authenticated,reference:{...reference,sourcePath}};
    }
    if(request.resumeWriterLaunch){
      assert.ok(!continueExistingBrowser&&!request.writerComponent&&!request.resumeAfterBrowser&&!request.resumeAfterSandbox&&!request.processWitness);
      const reference=request.resumeWriterLaunch;
      assert.equal(reference.path,'omarchy-initial-native-applications.json');
      for(const key of ['sha256','sourceSha256','controllerSha256'])assert.match(reference[key],/^[a-f0-9]{64}$/);
      const parentBytes=await fs.readFile(path.join(output,'report.json'));assert.equal(sha(parentBytes),reference.controllerSha256);
      const parent=JSON.parse(parentBytes);assert.equal(parent.status,'failed');assert.equal(parent.applicationComponent.name,'writer');
      assert.equal(parent.applicationContinuation,true);assert.equal(parent.warmGpu,true);assert.ok(!parent.remoteUrl);
      assert.equal(parent.failedPhase,'omarchy-initial');
      assert.equal(sha(await fs.readFile(path.join(output,'candidate-manifest.json'))),parent.candidate.manifestSha256);
      assert.equal(parent.expectedGpuPair.identity.imageManifestSha256,parent.candidate.manifestSha256);
      assert.ok(parent.errors.some(error=>error.startsWith('locator.focus: Timeout 30000ms exceeded.')));
      assert.equal(parent.harnessHashes['omarchy-applications.mjs'],reference.sourceSha256);
      assert.equal(sha(await fs.readFile(path.join(output,'executed-harness/omarchy-applications.mjs'))),reference.sourceSha256);
      const priorBytes=await fs.readFile(path.join(output,reference.path));assert.equal(sha(priorBytes),reference.sha256);
      const prior=JSON.parse(priorBytes);assert.equal(prior.status,'failed');assert.equal(prior.component.name,'writer');
      assert.match(prior.error,/^locator\.focus: Timeout 30000ms exceeded\./);assert.equal(prior.identityModuleSha256,identityModuleSha256);
      for(const key of ['writer','saveDialog','firstSave','secondSave','nodeNpm','wallpaperTransitions'])assert.equal(prior[key],undefined);
      assert.equal(prior.writerPreparation.directory,'/tmp/omarchyapps');
      assert.ok(!prior.phases.some(row=>row.kind==='trusted-text'));
      assert.equal(prior.phases.filter(row=>row.kind==='trusted-key').at(-1).key,'Meta+Alt+Space');
      continuationRequest={id,sha256:sha(bytes),scope:'same owned Writer-only launcher retry; original focus timeout remains failed'};
      writerOnly=true;writerLaunchResume={...reference,epoch:prior.beforeGpu.epoch};
    }
    if(continueExistingBrowser||request.writerComponent){
      if(continueExistingBrowser)assert.equal(request.continueExistingBrowser,true);
      const originalBytes=await fs.readFile(path.join(output,'report.json')),original=JSON.parse(originalBytes);
      assert.equal(original.status,'failed');assert.equal(original.warmGpu,true);
      assert.equal(original.applicationContinuation,true);assert.ok(!original.remoteUrl);
      assert.ok(original.errors.some(error=>error.includes('native Chromium loaded and focused the guest loopback page')));
      continuationRequest={id,sha256:sha(bytes),scope:'owned failed local warm application run; original navigation failure remains retained'};
      if(request.processWitness){
        assert.equal(request.processWitness.path,'omarchy-initial-native-applications-identity-0-filesystem/receipt.json');
        assert.match(request.processWitness.sha256,/^[a-f0-9]{64}$/);processWitness=request.processWitness;
      }
      if(request.writerComponent){
        assert.ok(!continueExistingBrowser&&!request.resumeAfterBrowser&&!request.resumeAfterSandbox);
        assert.ok(processWitness,'the current native Chromium identity must be authenticated before normal close');
        const reference=request.writerComponent;
        assert.equal(reference.path,'omarchy-initial-native-applications.json');
        assert.match(reference.sha256,/^[a-f0-9]{64}$/);assert.match(reference.sourceSha256,/^[a-f0-9]{64}$/);
        assert.match(reference.controllerSha256,/^[a-f0-9]{64}$/);assert.equal(sha(originalBytes),reference.controllerSha256);
        const priorBytes=await fs.readFile(path.join(output,reference.path));assert.equal(sha(priorBytes),reference.sha256);
        assert.equal(original.harnessHashes['omarchy-applications.mjs'],reference.sourceSha256);
        assert.equal(sha(await fs.readFile(path.join(output,'executed-harness/omarchy-applications.mjs'))),reference.sourceSha256);
        const prior=JSON.parse(priorBytes);assert.equal(prior.status,'failed');
        assert.match(prior.error,/native Chromium loaded and focused the guest loopback page/);
        assert.equal(prior.identityModuleSha256,identityModuleSha256);
        assert.ok(prior.chromium&&prior.firstRunWindow&&!prior.firstSave&&!prior.secondSave&&!prior.nodeNpm&&!prior.wallpaperTransitions);
        assert.equal(prior.chromium.window.pid,prior.firstRunWindow.window.pid);
        assert.equal(prior.chromium.before.data.starttime,prior.firstRunWindow.before.data.starttime);
        assert.equal(sha(await fs.readFile(path.join(output,'candidate-manifest.json'))),original.candidate.manifestSha256);
        assert.equal(original.expectedGpuPair.identity.imageManifestSha256,original.candidate.manifestSha256);
        const fixture=createApplicationFixture(prior.fixtureToken);assert.equal(sha(Buffer.from(fixture.source)),prior.fixtureServerSha256);
        writerComponent={prior,fixture,reference:{...reference,scope:'Writer/Node/npm/wallpaper and final desktop only. Original browser deadline remains failed; independent earlier browser/SVG evidence is separate.'}};
      }
      assert.ok(!(request.resumeAfterBrowser&&request.resumeAfterSandbox),'one explicit continuation boundary');
      if(request.resumeAfterBrowser)browserPrefix=await retainedComponent(request.resumeAfterBrowser,authenticateBrowserPrefix,
        'retained successful browser prefix; original navigation timing and submission; later sandbox timeout remains failed');
      if(request.resumeAfterSandbox){
        sandboxPrefix=await retainedComponent(request.resumeAfterSandbox,authenticateSandboxPrefix,
          'retained concurrent sandbox decode and native Chrome close; premature Writer splash interaction remains failed');
        sandboxPrefix.browser=await retainedComponent(sandboxPrefix.prior.carriedBrowserPrefix,authenticateBrowserPrefix,
          'retained successful browser prefix; original navigation timing and submission');
        sandboxPrefix.fixture=sandboxPrefix.browser.fixture;
        assert.equal(sandboxPrefix.prior.fixtureToken,sandboxPrefix.fixture.token);
        assert.equal(sandboxPrefix.prior.fixtureServerSha256,sha(Buffer.from(sandboxPrefix.fixture.source)));
        const stem=request.resumeAfterSandbox.path.replace(/\.json$/,'');
        const pixels=await fs.readFile(path.join(output,stem+'-sandboxed-icon.rgba')),source=await fs.readFile(path.join(output,stem+'-sandboxed-icon.svg'));
        assert.equal(pixels.length,48*48*4);assert.equal(sha(pixels),sandboxPrefix.prior.sandboxedImage.pixelSha256);
        assert.equal(sha(source),sandboxPrefix.prior.sandboxedImage.sourceSha256);
      }
    }
  }
  if(continueExistingBrowser)assert.ok(continuationRequest,'existing browser continuation requires the retained owned failure and request');
  const fixtureSpec=writerComponent?.fixture||sandboxPrefix?.fixture||browserPrefix?.fixture||createApplicationFixture(randomUUID().replaceAll('-',''));
  const report = {status:'running',identityModuleSha256,continueExistingBrowser,fixtureToken:fixtureSpec.token,fixtureServerSha256:sha(Buffer.from(fixtureSpec.source)),networking:{provider:'offline',fixture:fixtureSpec.url,externalBrowsingClaim:false},phases:[]};
  if(writerOnly){
    assert.ok((!name.startsWith('control-applications-')||writerLaunchResume||writerSaveResume||writerSavedResume||writerReopenResume||writerOpenResume)&&!continueExistingBrowser&&!writerComponent&&!browserPrefix&&!sandboxPrefix);
    assert.equal(process.env.CRITIC_FAST_BOOT_APPLICATION_CONTINUATION,'1');
    report.component={name:'writer',scope:'New Writer save/reopen/edit, native Node/npm, wallpaper and final desktop only; prior Chromium/SVG evidence remains separate.'};
    report.networking.fixture=null;
    if(writerLaunchResume)report.resumedWriterLaunch=writerLaunchResume;
    if(writerSaveResume)report.resumedWriterSave=writerSaveResume.reference;
    if(writerSavedResume)report.resumedWriterSavedDocument=writerSavedResume.reference;
    if(writerReopenResume)report.resumedWriterReopen=writerReopenResume.reference;
    if(writerOpenResume)report.resumedWriterOpen=writerOpenResume.reference;
  }
  if(continuationRequest)report.continuationRequest=continuationRequest;
  if(processWitness)report.processWitness=processWitness;
  if(writerComponent)report.writerComponent=writerComponent.reference;
  if(browserPrefix)report.carriedBrowserPrefix=browserPrefix.reference;
  if(sandboxPrefix){report.carriedSandboxPrefix=sandboxPrefix.reference;report.carriedBrowserPrefix=sandboxPrefix.browser.reference;}
  const file = path.join(output,name+'.json');
  const inventoryBytes=await fs.readFile(path.join(output,'input-runtime-elf.json'));
  assert.equal(sha(inventoryBytes),'ae72ccdf528974e203726b058a639201bfa19950ee4190658baad14e0440ab86','accepted signed application inventory');
  const prompters=JSON.parse(inventoryBytes).filter(row=>row.path==='usr/lib/gcr-prompter');assert.equal(prompters.length,1);assert.equal(prompters[0].machine,243);
  const executables={...options.executables,'/usr/lib/gcr-prompter':prompters[0].sha256};
  report.acceptedInventorySha256=sha(inventoryBytes);
  const identityProof=createApplicationIdentityProof(page,command,output,{...options,executables,processWitness});
  let identitySequence=0;
  const pageErrors=[];
  const onError=error=>pageErrors.push(String(error));
  const onConsole=message=>{if(message.type()==='error'&&!/favicon\.ico/.test(message.location().url||''))pageErrors.push(message.text());};
  page.on('pageerror',onError);page.on('console',onConsole);
  async function save() {await fs.writeFile(file,JSON.stringify(report,null,2)+'\n');}
  async function run(text, timeout=300000) {
    const result = await command(page,text,timeout);
    report.phases.push({kind:'guest-command',command:text,result,time:Date.now()});
    await save();return result;
  }
  async function clients() {
    const result=await run(hypr+'clients');assert.equal(result.exit,0);
    return JSON.parse(result.stdout);
  }
  let nextGpuProbe=0;
  async function gpuHealth() {
    if(Date.now()<nextGpuProbe)return;nextGpuProbe=Date.now()+30000;
    const gpu=await page.evaluate(()=>window.wvmDemo.gpuStats());
    const state={epoch:gpu.epoch,qualified:gpu.qualified,lost:gpu.lost,poisoned:gpu.poisoned,disposed:gpu.disposed,counters:gpu.counters,lastFailure:gpu.lastFailure};
    report.phases.push({kind:'gpu-health',state,time:Date.now()});await save();
    assert.equal(state.qualified,true);assert.equal(state.lost,false);assert.equal(state.poisoned,false);assert.equal(state.disposed,false);
    assert.equal(state.counters.failed,0,'actual application GPU work was refused; inspect the original GPU trace');
  }
  let waitCaptureSequence=0;
  // Native hyprctl processes are expensive inside an interpreted guest. The
  // missing-only component yields between observations without changing any
  // wall-clock deadline or the normal canonical scenario.
  const nativePollMs=(writerComponent||writerOnly)?10000:1500;
  async function waitWindow(predicate, timeout=300000) {
    const deadline=Date.now()+timeout;let nextCapture=Date.now()+60000;
    while(Date.now()<deadline){await gpuHealth();const rows=await clients();const found=rows.find(predicate);if(found)return found;if(Date.now()>=nextCapture){nextCapture=Date.now()+60000;await shot('window-wait-'+waitCaptureSequence++);}await sleep(nativePollMs);}
    throw Error('Actual guest application window did not appear');
  }
  async function waitActive(predicate, timeout=300000) {
    const deadline=Date.now()+timeout;let nextCapture=Date.now()+60000;
    while(Date.now()<deadline){await gpuHealth();const result=await run(hypr+'activewindow');assert.equal(result.exit,0);const active=JSON.parse(result.stdout);if(predicate(active))return active;if(Date.now()>=nextCapture){nextCapture=Date.now()+60000;await shot('focus-wait-'+waitCaptureSequence++);}await sleep(nativePollMs);}
    throw Error('Actual guest application did not acquire focus');
  }
  async function waitClosed(predicate, timeout=120000) {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){await gpuHealth();if(!(await clients()).some(predicate))return;await sleep(nativePollMs);}
    throw Error('Actual guest application window did not close');
  }
  const shotCounts=new Map();
  async function shot(label) {
    const count=(shotCounts.get(label)||0)+1;shotCounts.set(label,count);
    const stem=name+'-'+label+(count>1?'-'+count:'');
    await page.locator('#ide-display-canvas').screenshot({path:path.join(output,stem+'.png'),timeout:120000});
    const gpu=await page.evaluate(()=>window.wvmDemo.gpuStats());
    // Preserve every original sample on disk; repeated native waits must not
    // retain large resource/command trees in the controller's live heap.
    const body=Buffer.from(JSON.stringify(gpu,null,2)+'\n'),sample={path:stem+'-gpu.json',bytes:body.length,sha256:sha(body)};
    await fs.writeFile(path.join(output,sample.path),body);
    const summary=Object.fromEntries(['qualified','lost','epoch','highestGeneration','poisoned','disposed','pending','counters','lastFailure'].map(key=>[key,gpu[key]]));
    summary.sample=sample;
    report.phases.push({kind:'screenshot',label,image:stem+'.png',gpu:summary,time:Date.now()});await save();return summary;
  }
  async function waitReadableBar() {
    const started=Date.now();let attempt=0;
    while(Date.now()-started<600000){
      await gpuHealth();
      const result=await run(hypr+'layers');assert.equal(result.exit,0);
      const layer=Object.values(JSON.parse(result.stdout)).flatMap(monitor=>Object.values(monitor.levels||{}).flat())
        .find(layer=>layer.namespace==='omarchy-bar'&&layer.alpha>0);
      if(layer){
        const monitors=await run(hypr+'monitors');assert.equal(monitors.exit,0);
        const monitor=JSON.parse(monitors.stdout)[0];
        const observed=await verifyPublicBarContent(page,output,{layer,monitor,clients:await clients(),
          name:name+'-initial-bar-'+attempt++,requireContent:false});
        report.phases.push({kind:'initial-bar-content',observed,time:Date.now()});await save();
        if(observed.status==='passed'){report.initialBar={...observed,elapsedMs:Date.now()-started};return;}
      }
      await sleep(1500);
    }
    throw Error('The normal Omarchy bar did not finish rendering before application launch');
  }
  async function identity(client, executable) {
    const proof=await identityProof.process(client,executable,name+'-identity-'+identitySequence++);
    report.phases.push({kind:'native-executable-identity',proof,time:Date.now()});await save();return proof;
  }
  async function focusInput(){
    const canvas=page.locator('#ide-display-canvas');await canvas.focus({timeout:120000});
    if(await page.evaluate(()=>document.documentElement.dataset.keyboardCapture)!=='on'){
      await page.locator('#ide-keyboard-toggle').click();await canvas.focus({timeout:120000});
    }
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'ide-display-canvas');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.keyboardCapture),'on');
  }
  async function inputObservation(){
    return await page.evaluate(async()=>({focus:document.activeElement?.id,capture:document.documentElement.dataset.keyboardCapture,
      device:await __linuxCtl.inputDeviceStats(),held:__keyboardCapture.heldSnapshot(),debug:__keyboardCapture.stats(),
      frames:__keyboardCapture.frames(),diagnostics:__keyboardCapture.diagnostics()}));
  }
  async function press(key){await focusInput();const time=Date.now();report.phases.push({kind:'trusted-key',key,time});await page.keyboard.press(key,{delay:100});await save();return time;}
  async function type(text){await focusInput();report.phases.push({kind:'trusted-text',text,time:Date.now()});await typeGuestText(page,text);await save();}
  async function navigateBrowser(chromium){
    const rows=await clients(),client=rows.find(row=>row.pid===chromium.pid&&row.address===chromium.address);
    assert.ok(client?.visible&&client.size[0]>300&&client.size[1]>200);
    const result=await run(hypr+'monitors');assert.equal(result.exit,0);
    const monitor=JSON.parse(result.stdout).find(row=>row.id===client.monitor);assert.equal(monitor.scale,1);
    const box=await page.locator('#ide-display-canvas').boundingBox();assert.ok(box?.width>0&&box.height>0);
    const target={x:client.at[0]+client.size[0]*0.55,y:client.at[1]+64};
    const before=await inputObservation();
    await page.mouse.click(box.x+target.x*box.width/monitor.width,box.y+target.y*box.height/monitor.height,{delay:120});
    // Select the visible native address field through its real pointer surface.
    // This also establishes compositor seat focus after a native modal closes.
    await press('Control+a');await type(fixtureSpec.url);const enteredAt=await press('Enter');
    report.phases.push({kind:'native-address-navigation',target,client,before,enteredAt,after:await inputObservation(),time:Date.now()});await save();
    return enteredAt;
  }
  async function fixtureControls(chromium,label){
    await waitActive(row=>row.pid===chromium.pid&&row.address===chromium.address);
    const client=(await clients()).find(row=>row.pid===chromium.pid&&row.address===chromium.address);
    assert.ok(client?.visible&&client.size[0]>=300&&client.size[1]>=200);
    const result=await run(hypr+'monitors');assert.equal(result.exit,0);
    const monitor=JSON.parse(result.stdout).find(row=>row.id===client.monitor);assert.equal(monitor.scale,1);
    const crop={x:client.at[0],y:client.at[1],width:client.size[0],height:client.size[1]};
    assert.ok(Object.values(crop).every(Number.isSafeInteger)&&crop.x>=0&&crop.y>=0&&
      crop.width>=300&&crop.height>=200&&crop.width<=4096&&crop.height<=4096&&crop.width*crop.height<=4194304);
    const observed=await page.evaluate(crop=>{
      const canvas=document.getElementById('ide-display-canvas');
      if(window.__presentation.state().backend!=='canvas2d'||crop.x<0||crop.y<0||
        crop.x+crop.width>canvas.width||crop.y+crop.height>canvas.height)throw Error('original bounded native scanout is required');
      return {width:canvas.width,height:canvas.height,rgba:Array.from(canvas.getContext('2d').getImageData(crop.x,crop.y,crop.width,crop.height).data)};
    },crop);
    assert.equal(observed.width,monitor.width);assert.equal(observed.height,monitor.height);
    const pixels=Buffer.from(observed.rgba),controls=locateFixtureNoteControls(pixels,crop.width,crop.height);
    const filename=name+'-chromium-'+label+'-controls.rgba';await fs.writeFile(path.join(output,filename),pixels);
    (report.noteControls??=[]).push({label,client,crop,controls,path:filename,bytes:pixels.length,sha256:sha(pixels)});await save();
    return {client,monitor,controls};
  }
  async function clickFixtureControl(observed,key){
    const {client,monitor,controls}=observed,rect=controls[key];assert.ok(rect);
    const target={x:client.at[0]+rect.x+rect.width/2,y:client.at[1]+rect.y+rect.height/2};
    await focusInput();const box=await page.locator('#ide-display-canvas').boundingBox();assert.ok(box?.width>0&&box.height>0);
    await page.mouse.click(box.x+target.x*box.width/monitor.width,box.y+target.y*box.height/monitor.height,{delay:120});
    report.phases.push({kind:'native-fixture-control-click',control:key,target,time:Date.now()});await save();
  }
  async function cancelTestKeyringPrompt(chromium) {
    const prompts=(await clients()).filter(row=>row.class==='gcr-prompter'&&row.visible!==false);
    if(!prompts.length)return false;
    assert.equal(prompts.length,1,'one actual native keyring prompt in the owned application guest');
    const prompt=prompts[0];assert.equal(prompt.title,'');assert.equal(prompt.floating,true);
    report.keyringPrompts??=[];assert.ok(report.keyringPrompts.length<2,'bounded normal keyring cancellation');
    const proof=await identity(prompt,'/usr/lib/gcr-prompter');
    await waitActive(row=>row.pid===prompt.pid,15000);
    const label='chromium-keyring-'+report.keyringPrompts.length;await shot(label);
    // The public test guest has no account credentials to put in a new keyring.
    // Escape selects the normal native Cancel response; keep libsecret and its
    // sandboxed image loader enabled.
    await press('Escape');await waitClosed(row=>row.address===prompt.address,60000);
    await waitActive(row=>row.pid===chromium.pid,60000);
    report.keyringPrompts.push({window:prompt,proof,action:'trusted Escape / native Cancel',screenshot:label,time:Date.now()});
    await save();return true;
  }
  async function wallpaperTransition() {
    const current=await run(hypr+'activeworkspace');assert.equal(current.exit,0);
    const workspace=JSON.parse(current.stdout).id;
    assert.ok(!(await clients()).some(row=>row.workspace?.id===5),'wallpaper test workspace is empty');
    await press('Meta+5');
    const active=await run(hypr+'activeworkspace');assert.equal(active.exit,0);assert.equal(JSON.parse(active.stdout).id,5);
    const code="from pathlib import Path;import hashlib,json;p=Path.home()/'.local/state/omarchy/current/background';a=p.resolve();b=a.parent/'1-quattro.webp';assert a!=b and b.is_file();print(json.dumps([dict(path=str(f),sha256=hashlib.sha256(f.read_bytes()).hexdigest()) for f in (a,b)]))";
    const assets=await run('python3 -c '+"'"+code.replaceAll("'","'\\''")+"'");assert.equal(assets.exit,0);
    const [original,alternate]=JSON.parse(assets.stdout);report.wallpaperTransitions={assets:[original,alternate],samples:[]};
    async function settled(label,{different,expected}={}) {
      const started=Date.now(),clock=await page.evaluate(()=>__linuxCtl.guestClockState());let previous,count=0;
      while(Date.now()-started<300000){
        await gpuHealth();
        const sample=await page.evaluate(async()=>{
          const c=document.getElementById('ide-display-canvas'),context=c.getContext('2d'),data=[];
          for(let y=0;y<24;y++)for(let x=0;x<40;x++)data.push(...context.getImageData(Math.floor(c.width*(0.1+0.8*x/39)),Math.floor(c.height*(0.15+0.7*y/23)),1,1).data);
          return {rgba:data,clock:await __linuxCtl.guestClockState(),presentation:__presentation.state()};
        });
        const bytes=Buffer.from(sample.rgba),hash=sha(bytes);delete sample.rgba;
        const colors=new Set(Array.from({length:bytes.length/4},(_,i)=>bytes.subarray(i*4,i*4+3).toString('hex'))).size;
        count=hash===previous?count+1:1;previous=hash;
        report.wallpaperTransitions.samples.push({label,time:Date.now(),hash,colors,...sample});await save();
        if(count>=8&&colors>=16&&BigInt(sample.clock.mtime)-BigInt(clock.mtime)>=20000000n&&hash!==different&&(!expected||hash===expected)){
          await fs.writeFile(path.join(output,name+'-wallpaper-'+label+'.rgba'),bytes);
          const gpu=await shot('wallpaper-'+label);assert.equal(gpu.counters.failed,0);return {hash,gpu};
        }
        await sleep(750);
      }
      throw Error('Actual wallpaper did not visibly finish '+label);
    }
    const before=await settled('original');
    const set=async asset=>{
      assert.match(asset.path,/^\/home\/omarchy\/[A-Za-z0-9_./-]+$/);
      const result=await run('OMARCHY_PATH=/usr/share/omarchy XDG_RUNTIME_DIR=/run/user/1000 OMARCHY_SHELL_IPC_TIMEOUT=120s omarchy-shell background set '+"'"+asset.path+"'");
      assert.equal(result.exit,0,'original nonquiet Omarchy background IPC');
    };
    await set(alternate);const changed=await settled('alternate',{different:before.hash});
    await set(original);const restored=await settled('restored',{different:changed.hash,expected:before.hash});
    assert.ok(changed.gpu.counters.draws>before.gpu.counters.draws&&restored.gpu.counters.draws>changed.gpu.counters.draws);
    report.wallpaperTransitions.result={status:'passed',before,changed,restored};
    await press('Meta+'+workspace);
  }
  async function launchWriter(pendingPid) {
    if(pendingPid){
      const window=await waitWindow(row=>row.pid===pendingPid&&isWriterDocumentWindow(row),1200000);
      await finishWriterWelcome(window);await shot('writer-open');return window;
    }
    await press('Meta+Alt+Space');
    const deadline=Date.now()+300000;let menu;
    while(Date.now()<deadline){
      const result=await run(hypr+'layers');assert.equal(result.exit,0);
      menu=Object.values(JSON.parse(result.stdout)).flatMap(monitor=>Object.values(monitor.levels||{}).flat()).find(layer=>layer.namespace==='omarchy-menu'&&layer.alpha>0);
      if(menu)break;await sleep(1500);
    }
    assert.ok(menu,'normal Omarchy Apps menu is actually mapped');
    await type('libreoffice writer');await sleep(1500);
    await shot('writer-launcher');await press('Enter');
    const window=await waitWindow(isWriterDocumentWindow,1200000);
    await finishWriterWelcome(window);await shot('writer-open');return window;
  }
  async function finishWriterWelcome(window){
    const initial=await run(hypr+'activewindow');assert.equal(initial.exit,0);const active=JSON.parse(initial.stdout);
    if(active.pid===window.pid&&active.title==='Welcome to LibreOffice!'){
      const proof=await identity(active,'/usr/lib/libreoffice/program/soffice.bin');
      report.writerWelcome??=[];assert.ok(report.writerWelcome.length<3,'bounded normal first-run welcome pages');
      for(let step=0;step<3&&report.writerWelcome.length<3;step++){
        const result=await run(hypr+'activewindow');assert.equal(result.exit,0);const dialog=JSON.parse(result.stdout);
        if(dialog.address===window.address&&isWriterDocumentWindow(dialog))break;
        assert.equal(dialog.pid,window.pid);assert.equal(dialog.title,'Welcome to LibreOffice!');assert.equal(dialog.class,'soffice');
        const monitors=await run(hypr+'monitors');assert.equal(monitors.exit,0);
        const monitor=JSON.parse(monitors.stdout).find(row=>row.id===dialog.monitor);assert.equal(monitor.scale,1);
        // The standard Next/Finish button is at the dialog's bottom right. A
        // tiled parent can place its edge outside the small guest display;
        // click the visible portion of that same native button.
        const target={x:Math.min(dialog.at[0]+dialog.size[0]-45,monitor.width-15),y:dialog.at[1]+dialog.size[1]-27};
        assert.ok(target.x>=0&&target.y>=0&&target.y<monitor.height);
        await shot('writer-welcome-'+report.writerWelcome.length);await focusInput();
        const box=await page.locator('#ide-display-canvas').boundingBox();assert.ok(box?.width>0&&box.height>0);
        await page.mouse.click(box.x+target.x*box.width/monitor.width,box.y+target.y*box.height/monitor.height,{delay:120});
        report.writerWelcome.push({dialog,target,proof,action:'trusted native Next/Finish button',time:Date.now()});await save();
      }
    }
    await waitActive(row=>row.address===window.address&&isWriterDocumentWindow(row));
  }
  async function focusWriterContent(window){
    for(let attempt=0;attempt<2;attempt++){
      await focusInput();const rows=await clients(),client=rows.find(row=>row.address===window.address);
      assert.ok(isWriterDocumentWindow(client));
      const result=await run(hypr+'monitors');assert.equal(result.exit,0);
      const monitor=JSON.parse(result.stdout).find(row=>row.id===client.monitor);assert.equal(monitor.scale,1);
      const box=await page.locator('#ide-display-canvas').boundingBox();assert.ok(box?.width>0&&box.height>0);
      const target={x:client.at[0]+client.size[0]*0.5,y:client.at[1]+client.size[1]*0.5};
      await page.mouse.click(box.x+target.x*box.width/monitor.width,box.y+target.y*box.height/monitor.height,{delay:120});
      report.phases.push({kind:'native-writer-content-click',client,target,time:Date.now()});await save();
      const active=await waitActive(row=>(row.address===window.address&&isWriterDocumentWindow(row))||
        (row.pid===window.pid&&row.class==='soffice'&&row.title==='Welcome to LibreOffice!'));
      if(active.title!=='Welcome to LibreOffice!')return;
      await finishWriterWelcome(window);
    }
    throw Error('The bounded native Welcome handling did not focus the Writer document');
  }
  async function saveWriterText(window,text){
    for(let attempt=0;attempt<2;attempt++){
      await finishWriterWelcome(window);await focusWriterContent(window);
      await press('Control+a');await type(text);await press('Control+s');
      const active=await waitActive(row=>(row.pid===window.pid&&/^Save(?: As)?$/i.test(row.title))||
        (row.pid===window.pid&&row.class==='soffice'&&row.title==='Welcome to LibreOffice!'));
      if(/^Save(?: As)?$/i.test(active.title))return active;
      report.phases.push({kind:'native-delayed-writer-welcome',dialog:active,attempt,time:Date.now()});await save();
      await finishWriterWelcome(window);
    }
    throw Error('The bounded native Welcome handling did not reach Save');
  }
  async function focusFileDialog(dialog){
    const result=await run(hypr+'monitors');assert.equal(result.exit,0);
    const monitor=JSON.parse(result.stdout).find(row=>row.id===dialog.monitor);assert.equal(monitor.scale,1);
    let current=await waitActive(row=>row.address===dialog.address);
    async function clickVisible(){
      await focusInput();const box=await page.locator('#ide-display-canvas').boundingBox();assert.ok(box?.width>0&&box.height>0);
      const target={x:Math.max(15,Math.min(monitor.width-15,current.at[0]+current.size[0]*0.5)),y:Math.max(15,Math.min(monitor.height-15,current.at[1]+current.size[1]*0.5))};
      await page.mouse.click(box.x+target.x*box.width/monitor.width,box.y+target.y*box.height/monitor.height,{delay:120});
      report.phases.push({kind:'native-file-dialog-focus',dialog:current,target,time:Date.now()});await save();
    }
    await clickVisible();
    if(current.fullscreen===2||current.at[0]<0||current.at[1]<0||current.at[0]+current.size[0]>monitor.width||current.at[1]+current.size[1]>monitor.height){
      // GTK puts its Name and Save/Open actions in the title bar. Omarchy's
      // maximize binding fits the chooser while retaining those native controls.
      await press('Meta+Alt+f');
      current=await waitActive(row=>row.address===dialog.address&&row.fullscreen===1&&row.at[0]>=0&&row.at[1]>=0&&row.at[0]+row.size[0]<=monitor.width&&row.at[1]+row.size[1]<=monitor.height);
      await clickVisible();
    }
    await waitActive(row=>row.address===dialog.address);return current;
  }
  async function saveFileDialog(dialog){
    const result=await run(hypr+'monitors');assert.equal(result.exit,0);
    const monitor=JSON.parse(result.stdout).find(row=>row.id===dialog.monitor);assert.equal(monitor.scale,1);
    const box=await page.locator('#ide-display-canvas').boundingBox();assert.ok(box?.width>0&&box.height>0);
    // The pinned GTK Save chooser exposes its Name entry and action in the
    // title bar. Use those actual controls, retaining its visible Documents folder.
    const nameTarget={x:dialog.at[0]+dialog.size[0]*0.5,y:dialog.at[1]+24};
    const saveTarget={x:dialog.at[0]+dialog.size[0]-48,y:dialog.at[1]+24};
    const click=async target=>{
      assert.ok(target.x>=0&&target.x<monitor.width&&target.y>=0&&target.y<monitor.height);
      await focusInput();await page.mouse.click(box.x+target.x*box.width/monitor.width,box.y+target.y*box.height/monitor.height,{delay:120});
    };
    await click(nameTarget);report.phases.push({kind:'native-save-name-focus',dialog,target:nameTarget,time:Date.now()});await save();
    await press('Control+a');await type(path.basename(document));await shot('writer-save-name');
    await waitActive(row=>row.address===dialog.address&&row.pid===dialog.pid&&row.title==='Save');
    await click(saveTarget);report.phases.push({kind:'native-save-button',dialog,target:saveTarget,time:Date.now()});await save();
  }
  async function openWriterFile(window){
    // The packaged Tip of the Day can map after the document window. Observe
    // that actual modal before dismissing it; an early Ctrl+O alone cannot
    // prove the document received the shortcut.
    await press('Control+o');
    const active=await waitActive(row=>row.pid===window.pid&&
      (/^Open(?: File)?$/i.test(row.title)||isWriterTipWindow(row,window.pid)));
    if(/^Open(?: File)?$/i.test(active.title))return active;
    await shot('writer-tip-of-the-day');
    const result=await run(hypr+'monitors');assert.equal(result.exit,0);
    const monitor=JSON.parse(result.stdout).find(row=>row.id===active.monitor);assert.equal(monitor.scale,1);
    const target={x:active.at[0]+active.size[0]-60,y:active.at[1]+active.size[1]-27};
    assert.ok(target.x>=0&&target.x<monitor.width&&target.y>=0&&target.y<monitor.height);
    await focusInput();const box=await page.locator('#ide-display-canvas').boundingBox();assert.ok(box?.width>0&&box.height>0);
    await page.mouse.click(box.x+target.x*box.width/monitor.width,box.y+target.y*box.height/monitor.height,{delay:120});
    report.writerTip={window:active,target,action:'trusted native OK button',time:Date.now()};await save();
    await waitClosed(row=>row.address===active.address,600000);
    await waitActive(row=>row.address===window.address&&isWriterDocumentWindow(row));
    await press('Control+o');
    return await waitActive(row=>row.pid===window.pid&&/^Open(?: File)?$/i.test(row.title));
  }
  async function verifySandboxedImage(chromium) {
    const expected={pid:chromium.pid,starttime:report.chromium.before.data.starttime,exe:'/usr/lib/chromium/chromium'};
    const code=`import gi,hashlib,json,os,base64;from pathlib import Path;expected=json.loads(${JSON.stringify(JSON.stringify(expected))})\ndef process():\n p=Path('/proc')/str(expected['pid']);s=(p/'stat').read_text();value=dict(pid=expected['pid'],starttime=s[s.rfind(')')+2:].split()[19],exe=os.readlink(p/'exe'));assert value==expected;return value\nbefore=process();gi.require_version('GdkPixbuf','2.0');from gi.repository import GdkPixbuf;assert 'GLYCIN_DISABLE_SANDBOX' not in os.environ;p='/usr/share/icons/Adwaita/scalable/status/image-missing.svg';source=open(p,'rb').read();b=GdkPixbuf.Pixbuf.new_from_file_at_scale(p,48,48,True);pixels=b.get_pixels();after=process();assert before==after;print(json.dumps({'chromiumBefore':before,'chromiumAfter':after,'width':b.get_width(),'height':b.get_height(),'channels':b.get_n_channels(),'stride':b.get_rowstride(),'pixelSha256':hashlib.sha256(pixels).hexdigest(),'sourceSha256':hashlib.sha256(source).hexdigest(),'pixels':base64.b64encode(pixels).decode(),'source':base64.b64encode(source).decode()}),flush=True)`;
    const result=await run('timeout -k 1s 60s env RUST_LOG=debug python3 -c '+"'"+code.replaceAll("'","'\\''")+"'");
    assert.equal(result.exit,0,'native GdkPixbuf decodes the packaged icon under the normal sandbox');
    assert.match(result.stdout,/bwrap sandboxing available: true/);
    assert.match(result.stdout,/"bwrap"[^\n]+"--seccomp"/);
    assert.doesNotMatch(result.stdout,/running without sandbox/i);
    const value=JSON.parse(result.stdout.split('\n').findLast(line=>line.startsWith('{')));
    assert.deepEqual(value.chromiumBefore,expected);assert.deepEqual(value.chromiumAfter,expected);
    assert.equal(value.width,48);assert.equal(value.height,48);assert.equal(value.channels,4);assert.equal(value.stride,192);
    const pixels=Buffer.from(value.pixels,'base64'),source=Buffer.from(value.source,'base64');
    assert.equal(pixels.length,48*48*4);assert.equal(sha(pixels),value.pixelSha256);assert.equal(sha(source),value.sourceSha256);
    assert.equal(value.sourceSha256,'af6b1fbc74b1dec2431352153b747e8cd584b11fcb762d97b1563dc03a2b6a18');
    assert.ok(pixels.some((value,index)=>index%4===3&&value>0),'actual icon has foreground pixels');
    assert.ok(pixels.some((value,index)=>index%4===3&&value===0),'actual icon retains transparent background');
    await fs.writeFile(path.join(output,name+'-sandboxed-icon.rgba'),pixels);
    await fs.writeFile(path.join(output,name+'-sandboxed-icon.svg'),source);
    delete value.pixels;delete value.source;report.sandboxedImage=value;await save();
  }
  const document='/home/omarchy/Documents/omarchy-native-applications-42.odt';
  async function readDocument(label, expectedText) {
    const code=`from pathlib import Path;import base64,hashlib,json,zipfile,stat;from xml.etree import ElementTree as ET;p=Path(${JSON.stringify(document)});s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==1000 and s.st_nlink==1 and 0<s.st_size<1048576;b=p.read_bytes();z=zipfile.ZipFile(p);assert z.getinfo('content.xml').file_size<2097152;print(json.dumps({'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'text':' '.join(ET.fromstring(z.read('content.xml')).itertext()),'base64':base64.b64encode(b).decode()}))`;
    const deadline=Date.now()+600000;let saved;
    while(Date.now()<deadline){
      await gpuHealth();const result=await run('python3 -c '+"'"+code.replaceAll("'","'\\''")+"'");
      if(result.exit===0){const candidate=JSON.parse(result.stdout);if(expectedText.every(text=>candidate.text.includes(text))){saved=candidate;break;}}
      await sleep(1500);
    }
    assert.ok(saved,'actual completed ODT contains the expected text');
    const bytes=Buffer.from(saved.base64,'base64');delete saved.base64;
    assert.equal(bytes.length,saved.bytes);assert.equal(sha(bytes),saved.sha256);
    await fs.writeFile(path.join(output,name+'-'+label+'.odt'),bytes);return saved;
  }
  try {
    report.initialBrowserInput=await inputObservation();await save();
    const canvas=page.locator('#ide-display-canvas');await canvas.focus({timeout:120000});
    if(await page.evaluate(()=>document.documentElement.dataset.keyboardCapture)!=='on'){
      await page.locator('#ide-keyboard-toggle').click();await canvas.focus({timeout:120000});
    }
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.keyboardCapture),'on');
    await page.evaluate(()=>{
      window.__appTrusted=[];window.__appTrustedListener=e=>window.__appTrusted.push({type:e.type,key:e.key,code:e.code,trusted:e.isTrusted,time:performance.now()});
      for(const type of ['keydown','keyup','pointerdown','pointerup'])document.addEventListener(type,window.__appTrustedListener,true);
    });
    report.beforeGpu=await shot('initial');
    // The retained Save chooser is intentionally still in true fullscreen.
    // Prove its bar after the authenticated normal maximize action below.
    if(!writerSaveResume)await waitReadableBar();
    let chromium;
    if(writerOnly){
      const windows=await clients();assert.ok(!windows.some(row=>/chromium/i.test(row.class)||row.title==='Chromium Additional Terms of Service'),
        'the controller completed its authenticated owned baseline cleanup');
      if(writerLaunchResume){
        assert.equal(report.beforeGpu.epoch,writerLaunchResume.epoch);assert.ok(windows.every(row=>/foot/i.test(row.class)),'no application has launched before this retry');
      }
      if(writerSaveResume){
        const prior=writerSaveResume.prior;assert.equal(report.beforeGpu.epoch,prior.beforeGpu.epoch);
        assert.ok(windows.every(row=>/foot/i.test(row.class)||row.pid===prior.writer.window.pid),'only the same Writer process and native Foot remain');
        const writer=windows.find(row=>row.address===prior.writer.window.address&&row.pid===prior.writer.window.pid);
        assert.ok(writer&&writer.class===prior.writer.window.class&&writer.title===prior.writer.window.title);
        report.writer=await identity(writer,'/usr/lib/libreoffice/program/soffice.bin');
        assert.equal(report.writer.before.data.starttime,prior.writer.before.data.starttime);
        for(const key of ['exeStat','pathStat','rootStat','rootBlock'])assert.deepEqual(report.writer.before.data[key],prior.writer.before.data[key]);
        report.saveDialog=await waitActive(row=>row.address===prior.saveDialog.address&&row.pid===writer.pid&&row.class==='soffice'&&row.title==='Save');
      }
      if(writerSavedResume){
        const prior=writerSavedResume.prior;assert.equal(report.beforeGpu.epoch,prior.beforeGpu.epoch);
        assert.ok(windows.every(row=>/foot/i.test(row.class)||row.pid===prior.writer.window.pid));
        const writer=windows.find(row=>row.address===prior.writer.window.address&&row.pid===prior.writer.window.pid);
        assert.ok(isWriterDocumentWindow(writer));assert.equal(writer.title,path.basename(document)+' — LibreOffice Writer');
        assert.ok(!windows.some(row=>row.pid===writer.pid&&/^Save(?: As)?$/i.test(row.title)));
        report.writer=await identity(writer,'/usr/lib/libreoffice/program/soffice.bin');
        assert.equal(report.writer.before.data.starttime,prior.writer.before.data.starttime);
        for(const key of ['exeStat','pathStat','rootStat','rootBlock'])assert.deepEqual(report.writer.before.data[key],prior.writer.before.data[key]);
      }
      if(writerReopenResume||writerOpenResume){
        const resumed=writerReopenResume||writerOpenResume;
        assert.equal(report.beforeGpu.epoch,resumed.prior.beforeGpu.epoch);
        if(writerReopenResume)assert.ok(windows.length>0&&windows.every(row=>/foot/i.test(row.class)),'the saved document is closed before a new normal Apps launch');
        else {
          const pending=writerOpenResume.pendingWriter;
          assert.ok(windows.every(row=>/foot/i.test(row.class)||row.pid===pending.pid));
          const current=windows.find(row=>row.address===pending.address&&row.pid===pending.pid);
          assert.ok(isWriterDocumentWindow(current));
          report.reopenLaunch=await identity(current,'/usr/lib/libreoffice/program/soffice.bin');
          const active=await waitActive(row=>isWriterTipWindow(row,pending.pid));
          assert.equal(active.address,writerOpenResume.tip.address);
        }
        const code=`from pathlib import Path;import hashlib,json;p=Path.home()/'.config/hypr/hyprland.lua';b=p.read_bytes();print(json.dumps(dict(path=str(p),sha256=hashlib.sha256(b).hexdigest())))`;
        const result=await run('python3 -c '+"'"+code.replaceAll("'","'\\''")+"'");assert.equal(result.exit,0);
        report.applicationShellConfig=JSON.parse(result.stdout);assert.equal(report.applicationShellConfig.sha256,
          writerReopenResume?writerReopenResume.reference.shellConfigSha256:writerOpenResume.prior.applicationShellConfig.sha256);
      }
      const prepareDirectory=(writerLaunchResume||writerSaveResume||writerSavedResume||writerReopenResume||writerOpenResume)?"assert p.is_dir() and not (p/'node').exists() and not (p/'npm').exists()":"assert not p.exists();p.mkdir(mode=0o700)";
      const documentGuard=(writerSavedResume||writerReopenResume||writerOpenResume)?`f=Path(${JSON.stringify(document)});d=f.lstat();assert stat.S_ISREG(d.st_mode) and d.st_uid==1000 and d.st_nlink==1 and 0<d.st_size<1048576`:`assert not Path(${JSON.stringify(document)}).exists()`;
      const code=`from pathlib import Path;import json,stat;p=Path('/tmp/omarchyapps');${documentGuard};${prepareDirectory};s=p.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==1000 and stat.S_IMODE(s.st_mode)==0o700;rows=[x.split() for x in Path('/proc/swaps').read_text().splitlines()[1:]];active=[x for x in rows if x[0]=='/var/lib/wasm-vm-applications/swapfile'];assert len(active)==1 and int(active[0][2])*1024==536866816 and int(active[0][4])==10;print(json.dumps(dict(scope='owned terminal-output directory and document state read only; no document, app-profile or browser-output writes',directory=str(p),activeSwap=active[0])))`;
      const prepared=await run('python3 -c '+"'"+code.replaceAll("'","'\\''")+"'");assert.equal(prepared.exit,0);report.writerPreparation=JSON.parse(prepared.stdout);
      if(writerLaunchResume){
        await press('Escape');const deadline=Date.now()+120000;let mapped;
        do{const observed=await run(hypr+'layers');assert.equal(observed.exit,0);
          mapped=Object.values(JSON.parse(observed.stdout)).flatMap(monitor=>Object.values(monitor.levels||{}).flat()).some(layer=>layer.namespace==='omarchy-menu'&&layer.alpha>0);
          if(mapped)await sleep(nativePollMs);
        }while(mapped&&Date.now()<deadline);
        assert.equal(mapped,false,'the previously opened Apps menu closed through normal Escape');
      }
    }else if(writerComponent){
      assert.equal(report.beforeGpu.epoch,writerComponent.prior.beforeGpu.epoch,'same live GPU epoch as original failed08');
      const code=`from pathlib import Path;import hashlib,json,stat,os;p=Path('/tmp/omarchyapps');s=p.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==1000 and stat.S_IMODE(s.st_mode)==0o700;f=p/'server.py';s=f.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==1000 and s.st_nlink==1;digest=hashlib.sha256(f.read_bytes()).hexdigest();assert digest==${JSON.stringify(report.fixtureServerSha256)};pid=int((p/'server.pid').read_text());q=Path('/proc')/str(pid);assert q.stat().st_uid==1000 and str(f).encode() in (q/'cmdline').read_bytes().split(bytes([0])) and (q/'exe').resolve()==Path('/usr/bin/python3').resolve();assert not Path(${JSON.stringify(document)}).exists() and not (p/'node').exists() and not (p/'npm').exists();print(json.dumps(dict(scope='read-only authentication of the untouched failed08 fixture, not a browser success',serverPid=pid,serverSha256=digest)))`;
      const guard=await run('python3 -c '+"'"+code.replaceAll("'","'\\''")+"'");assert.equal(guard.exit,0);report.retainedWriterFixture=JSON.parse(guard.stdout);
      const current=await waitWindow(row=>row.pid===writerComponent.prior.chromium.window.pid&&row.address===writerComponent.prior.chromium.window.address&&row.visible!==false);
      report.currentChromiumBeforeClose=await identity(current,'/usr/lib/chromium/chromium');
      assert.equal(report.currentChromiumBeforeClose.before.data.starttime,writerComponent.prior.chromium.before.data.starttime);
      await waitActive(row=>row.pid===current.pid);await press('Meta+w');await waitClosed(row=>/chromium/i.test(row.class));
      await shot('writer-component-browser-closed');
    }else if(browserPrefix||sandboxPrefix){
      const prior=(browserPrefix||sandboxPrefix.browser).prior;
      assert.equal(report.beforeGpu.epoch,prior.chromiumGpu.epoch,'same live GPU generation as the carried browser prefix');
      const expected={requested:fixtureSpec.route,ready:prior.browserReady,submission:prior.browserSubmission};
      const code=`from pathlib import Path;import hashlib,json,stat,os;p=Path('/tmp/omarchyapps');s=p.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==1000 and stat.S_IMODE(s.st_mode)==0o700;source=p/'server.py';f=source.lstat();assert stat.S_ISREG(f.st_mode) and f.st_uid==1000 and f.st_nlink==1 and f.st_size==${Buffer.byteLength(fixtureSpec.source)};digest=hashlib.sha256(source.read_bytes()).hexdigest();assert digest==${JSON.stringify(report.fixtureServerSha256)};pidfile=p/'server.pid';f=pidfile.lstat();assert stat.S_ISREG(f.st_mode) and f.st_uid==1000 and f.st_nlink==1 and 0<f.st_size<32;pid=int(pidfile.read_text());assert pid>1;q=Path('/proc')/str(pid);assert q.stat().st_uid==1000 and (q/'cmdline').read_bytes().split(bytes([0]))[-2]==str(source).encode() and (q/'exe').resolve()==Path('/usr/bin/python3').resolve();before=(q/'stat').read_text();expected=json.loads(${JSON.stringify(JSON.stringify(expected))});observed={}\nfor name,key in [('requested','requested'),('ready.json','ready'),('submission.json','submission')]:\n f=p/name;s=f.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==1000 and s.st_nlink==1 and 0<s.st_size<8192;value=f.read_text();observed[key]=value.strip() if key=='requested' else json.loads(value)\nassert observed==expected;assert not Path(${JSON.stringify(document)}).exists() and not (p/'node').exists() and not (p/'npm').exists();assert (Path.home()/'.config/chromium/EULA Accepted').is_file();after=(q/'stat').read_text();start=lambda s:s[s.rfind(')')+2:].split()[19];assert start(before)==start(after);print(json.dumps(dict(scope='read-only authentication of retained real guest browser output',serverPid=pid,serverStarttime=start(after),serverSha256=digest,observed=observed)))`;
      const guard=await run('python3 -c '+"'"+code.replaceAll("'","'\\''")+"'");assert.equal(guard.exit,0);report.retainedFixture=JSON.parse(guard.stdout);
      if(browserPrefix){
        chromium=await waitWindow(row=>row.pid===prior.chromium.window.pid&&row.address===prior.chromium.window.address&&row.visible!==false);
        report.chromium=await identity(chromium,'/usr/lib/chromium/chromium');
        assert.equal(report.chromium.before.data.starttime,prior.chromium.before.data.starttime);
        await waitActive(row=>row.pid===chromium.pid);await shot('chromium-carried-prefix');
      }else{
        assert.equal(report.beforeGpu.epoch,sandboxPrefix.prior.beforeGpu.epoch);
        const windows=await clients();assert.ok(!windows.some(row=>/chromium/i.test(row.class)),'Chrome remains normally closed after the carried concurrent SVG proof');
        report.afterSandboxWindows=windows;
        report.pendingWriterIdentity=await identity(sandboxPrefix.prior.writer.window,'/usr/lib/libreoffice/program/soffice.bin');
        assert.equal(report.pendingWriterIdentity.before.data.starttime,sandboxPrefix.prior.writer.before.data.starttime);await save();
      }
    }else{
    if(!continueExistingBrowser){
      // This is read-only: a test ping would itself start/warm the launcher and
      // conceal a missing desktop-startup dependency before the first shortcut.
      const launcherCode="from pathlib import Path;import hashlib,json,os,stat,subprocess;p=Path.home()/'.config/default/hypr/autostart.lua';s=p.lstat();body=p.read_bytes();assert stat.S_ISREG(s.st_mode) and s.st_uid==1000 and stat.S_IMODE(s.st_mode)==0o644 and s.st_nlink==1;assert hashlib.sha256(body).hexdigest()=='1985dd5d395766de48f8238c76c65d8f673a2fa12bf9097c1135108f780fff64';unit=subprocess.check_output(['systemctl','--user','--no-pager','show','wayland-wm-app-daemon.service','-p','ActiveState','-p','SubState','-p','MainPID'],text=True,env={**os.environ,'XDG_RUNTIME_DIR':'/run/user/1000'});properties=dict(line.split('=',1) for line in unit.splitlines());assert properties['ActiveState']=='active' and properties['SubState']=='running';pid=int(properties['MainPID']);assert pid>1;q=Path('/proc')/str(pid);assert q.stat().st_uid==1000 and (q/'exe').resolve()==Path('/usr/bin/python3').resolve();args=(q/'cmdline').read_bytes().split(bytes([0]))[:-1];assert args[1:]==[b'/usr/bin/uwsm',b'aux',b'app-daemon'];before=(q/'stat').read_text();pipes=[]\nfor name in ['uwsm-app-daemon-in','uwsm-app-daemon-out']:\n f=Path('/run/user/1000')/name;v=f.lstat();assert stat.S_ISFIFO(v.st_mode) and v.st_uid==1000;pipes.append(dict(path=str(f),device=v.st_dev,inode=v.st_ino,uid=v.st_uid))\nafter=(q/'stat').read_text();assert before[before.rfind(')')+2:].split()[19]==after[after.rfind(')')+2:].split()[19];client=Path('/usr/bin/uwsm-app').read_bytes();assert hashlib.sha256(client).hexdigest()=='098d1a401432fcb83f1cda748f633d70cc3cb63469cb3b34099c5bb667161bda';print(json.dumps(dict(scope='read-only daemon/config observation before the first application shortcut; no ping/start/restart',autostartSha256=hashlib.sha256(body).hexdigest(),unit=properties,pid=pid,processStat=after,args=[a.decode() for a in args],pipes=pipes,clientSha256=hashlib.sha256(client).hexdigest(),uptime=Path('/proc/uptime').read_text())))";
      const launcher=await run('python3 -c '+"'"+launcherCode.replaceAll("'","'\\''")+"'");
      assert.equal(launcher.exit,0,'desktop startup prepared the unchanged native application daemon before the first shortcut');
      report.applicationLauncher=JSON.parse(launcher.stdout);await save();
    }
    const memoryCode="from pathlib import Path;import json,stat;p=Path('/var/lib/wasm-vm-applications/swapfile');s=p.lstat();assert stat.S_ISREG(s.st_mode) and stat.S_IMODE(s.st_mode)==0o600 and s.st_uid==s.st_gid==0 and s.st_nlink==1 and s.st_size==536870912;rows=[x.split() for x in Path('/proc/swaps').read_text().splitlines()[1:]];matches=[x for x in rows if x[0]==str(p)];assert len(matches)==1 and matches[0][1]=='file' and int(matches[0][2])*1024==536866816 and int(matches[0][4])==10;print(json.dumps({'activeSwap':matches[0],'stat':{'uid':s.st_uid,'gid':s.st_gid,'mode':oct(stat.S_IMODE(s.st_mode)),'bytes':s.st_size,'blocks':s.st_blocks},'meminfo':Path('/proc/meminfo').read_text(),'profile':json.loads(Path('/etc/wasm-vm/application-memory.json').read_text())}))";
    const memory=await run('python3 -c '+"'"+memoryCode.replaceAll("'","'\\''")+"'");assert.equal(memory.exit,0,'the real kernel activated the bounded root-owned swap file');
    report.memory=JSON.parse(memory.stdout);
    // Linux MADV_PAGEOUT is ABI value21; the packaged Python mmap build omits
    // that named export. Both installed native UAPI/glibc headers confirm21.
    const pagingCode="import mmap,hashlib,json,re,time;from pathlib import Path;size=4194304;data=bytes(range(256))*(size//256);status=lambda:int(re.search(r'^VmSwap:\\s+(\\d+)',Path('/proc/self/status').read_text(),re.M)[1])*1024;m=mmap.mmap(-1,size,flags=mmap.MAP_PRIVATE|mmap.MAP_ANONYMOUS,prot=mmap.PROT_READ|mmap.PROT_WRITE);m[:]=data;before=status();pageout=getattr(mmap,'MADV_PAGEOUT',21);m.madvise(pageout);paged=status();assert paged-before>=size-65536,(before,paged);observed=m[:];assert observed==data;after=status();assert after<=before+65536,(before,after);print(json.dumps({'bytes':size,'pageoutAdvice':pageout,'pattern':'repeated literal bytes0..255','beforeSwapBytes':before,'pagedSwapBytes':paged,'afterRefaultSwapBytes':after,'sha256':hashlib.sha256(observed).hexdigest(),'blockStats':Path('/sys/block/vda/stat').read_text()}),flush=True);m.close()";
    const paging=await run('timeout -k 1s 10s python3 -c '+"'"+pagingCode.replaceAll("'","'\\''")+"'");assert.equal(paging.exit,0,'actual anonymous pageout and byte-preserving refault');
    report.paging=JSON.parse(paging.stdout);
    const pagingExpected=Buffer.alloc(4194304);
    for(let i=0;i<pagingExpected.length;i++)pagingExpected[i]=i&255;
    assert.equal(report.paging.sha256,sha(pagingExpected),'independently generated complete refault bytes');
    report.wallpaper=await run('readlink -f "$HOME/.local/state/omarchy/current/background"; sha256sum "$HOME/.local/state/omarchy/current/background" /usr/share/omarchy/shell/plugins/background/Background.qml; '+hypr+'monitors');
    assert.equal(report.wallpaper.exit,0);
    if(continueExistingBrowser){
      const code=`from pathlib import Path;import hashlib,json,stat,os,signal,time;p=Path('/tmp/omarchyapps');s=p.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==1000 and stat.S_IMODE(s.st_mode)==0o700;source=p/'server.py';f=source.lstat();assert stat.S_ISREG(f.st_mode) and f.st_uid==1000 and f.st_nlink==1 and f.st_size==${Buffer.byteLength(server)};digest=hashlib.sha256(source.read_bytes()).hexdigest();assert digest==${JSON.stringify(sha(Buffer.from(server)))};pidfile=p/'server.pid';f=pidfile.lstat();assert stat.S_ISREG(f.st_mode) and f.st_uid==1000 and f.st_nlink==1 and 0<f.st_size<32;pid=int(pidfile.read_text());assert pid>1;q=Path('/proc')/str(pid);assert q.stat().st_uid==1000 and (q/'cmdline').read_bytes().split(bytes([0]))[-2]==str(source).encode() and (q/'exe').resolve()==Path('/usr/bin/python3').resolve();assert not (p/'submission.json').exists() and not Path(${JSON.stringify(document)}).exists();os.kill(pid,signal.SIGTERM);deadline=time.monotonic()+10\ndef stopped():\n try:return (q/'stat').read_text().split(')')[-1].split()[0]=='Z'\n except FileNotFoundError:return True\nwhile not stopped() and time.monotonic()<deadline:time.sleep(0.01)\nassert stopped();retained=p.with_name('omarchyapps-before-'+${JSON.stringify(fixtureSpec.token)});assert not retained.exists();p.rename(retained);p.mkdir(mode=0o700);print(json.dumps({'scope':'authenticated owned fixture retained before generation change','serverPid':pid,'serverSha256':digest,'retainedFixture':str(retained)}))`;
      const fixture=await run('python3 -c '+"'"+code.replaceAll("'","'\\''")+"'");assert.equal(fixture.exit,0);report.existingFixture=readFixtureTransition(fixture.stdout,fixtureSpec.token);
    }else{
      const setup=await run('test "$(id -u)" = 1000 && test ! -e /tmp/omarchyapps && test ! -e '+document+' && mkdir -m 700 /tmp/omarchyapps');assert.equal(setup.exit,0);
    }
    const payload=Buffer.from(fixtureSpec.source).toString('base64');
    const fixture=await run(`printf '%s' '${payload}' | base64 -d > /tmp/omarchyapps/server.py; python3 /tmp/omarchyapps/server.py > /tmp/omarchyapps/server.log 2>&1 < /dev/null & echo $! > /tmp/omarchyapps/server.pid`);assert.equal(fixture.exit,0);
    report.defaults=await run('env XDG_CURRENT_DESKTOP=Hyprland xdg-settings get default-web-browser; '+hypr+'binds; free -m; uname -m');assert.equal(report.defaults.exit,0);assert.match(report.defaults.stdout,/chromium.desktop/);
    const initialEula=await run('test -f "$HOME/.config/chromium/EULA Accepted"');assert.ok([0,1].includes(initialEula.exit));
    if(continueExistingBrowser)assert.equal(initialEula.exit,0,'continuation requires the already accepted native first-run dialog');
    else await press('Meta+Shift+b');
    // The native Arch first-run dialog has no Wayland app ID. Its exact title
    // selects a candidate only; identity() still checks the running signed ELF.
    chromium=await waitWindow(row=>row.visible!==false&&(/chromium/i.test(row.class)||
      (initialEula.exit===1&&row.class===''&&row.title==='Chromium Additional Terms of Service')),600000);
    if(initialEula.exit===1){
      report.firstRunWindow=await identity(chromium,'/usr/lib/chromium/chromium');
      await waitActive(row=>row.pid===chromium.pid);
      await shot('chromium-first-run');await press('Enter');
      let accepted;
      for(let n=0;n<100;n++){accepted=await run('test -f "$HOME/.config/chromium/EULA Accepted" && test -f "$HOME/.config/chromium/First Run"');if(accepted.exit===0)break;await sleep(1500);}
      assert.equal(accepted.exit,0,'native Chromium completed its first-run dialog through trusted input');
      const dialogAddress=chromium.address;
      chromium=await waitWindow(row=>/chromium/i.test(row.class)&&row.visible!==false&&row.address!==dialogAddress,600000);
    }
    report.chromium=await identity(chromium,'/usr/lib/chromium/chromium');
    await cancelTestKeyringPrompt(chromium);
    await waitActive(row=>row.pid===chromium.pid);
    assert.match(report.chromium.process.stdout,/\/usr\/lib\/chromium\/chromium/);
    await shot('chromium-open');
    const navigationStarted=await navigateBrowser(chromium);
    let ready,diagnostic=0,nextDiagnostic=0,nextPromptProbe=0;
    do {
      if(Date.now()>=nextPromptProbe){
        nextPromptProbe=Date.now()+15000;
        if(await cancelTestKeyringPrompt(chromium)){
          await navigateBrowser(chromium);
        }
      }
      await gpuHealth();ready=await run('cat /tmp/omarchyapps/ready.json');if(ready.exit===0)break;
      if(Date.now()>=nextDiagnostic){
        nextDiagnostic=Date.now()+120000;
        await run('ps -u 1000 -o pid,ppid,stat,time,wchan:24,comm,args | tail -n 35; free -m; cat /proc/uptime; '+hypr+'activewindow; '+hypr+'clients; tail -n 12 /tmp/omarchyapps/server.log; journalctl --user --no-pager -n 18',60000);
        const clock=await page.evaluate(()=>__linuxCtl.guestClockState());
        report.phases.push({kind:'navigation-diagnostic',clock,elapsedMs:Date.now()-navigationStarted,time:Date.now()});
        await shot('chromium-navigation-wait-'+diagnostic++);
      }
      await sleep(1500);
    } while(Date.now()-navigationStarted<600000);
    assert.equal(ready.exit,0,'native Chromium loaded and focused the guest loopback page');
    report.browserNavigationMs=Date.now()-navigationStarted;
    assert.ok(report.browserNavigationMs<=600000,'native Chromium navigation finished within the measured 600-second deadline');
    report.browserReady=JSON.parse(ready.stdout);assert.deepEqual(report.browserReady,{readyState:'complete',hasFocus:true,activeElement:'note',location:fixtureSpec.url});
    const requested=await run('cat /tmp/omarchyapps/requested');assert.equal(requested.exit,0);assert.equal(requested.stdout.trim(),fixtureSpec.route);report.browserRequest=requested;
    await shot('chromium-fixture');
    const controls=await fixtureControls(chromium,'before-input');
    await clickFixtureControl(controls,'input');
    const note='omarchy chromium riscv 42';await type(note);await shot('chromium-note-typed');
    await clickFixtureControl(await fixtureControls(chromium,'before-save'),'save');
    let submitted;
    for(let n=0;n<30;n++){submitted=await run('cat /tmp/omarchyapps/submission.json');if(submitted.exit===0)break;await sleep(1000);}
    assert.equal(submitted.exit,0);report.browserSubmission=JSON.parse(submitted.stdout);
    assert.equal(report.browserSubmission.message,note);assert.equal(report.browserSubmission.clickTrusted,true);
    assert.ok(report.browserSubmission.inputTrusted.length>=note.length);assert.ok(report.browserSubmission.inputTrusted.every(value=>value===true));
    report.chromiumGpu=await shot('chromium-submitted');
    }
    if(!sandboxPrefix&&!writerComponent&&!writerOnly){
      await verifySandboxedImage(chromium);
      await press('Meta+w');await waitClosed(row=>/chromium/i.test(row.class));
    }

    if(!writerSaveResume&&!writerSavedResume&&!writerReopenResume&&!writerOpenResume)report.writer=await identity(await launchWriter(sandboxPrefix?.prior.writer.window.pid),'/usr/lib/libreoffice/program/soffice.bin');
    if(!writerReopenResume&&!writerOpenResume)assert.match(report.writer.process.stdout,/\/usr\/lib\/libreoffice\/program\/soffice.bin/);
    const first='Omarchy riscv document 42';
    if(!writerSavedResume&&!writerReopenResume&&!writerOpenResume){
      if(!writerSaveResume)report.saveDialog=await saveWriterText(report.writer.window,first);
      report.fittedSaveDialog=await focusFileDialog(report.saveDialog);
      if(writerSaveResume)await waitReadableBar();
      await shot('writer-save-dialog');
      await saveFileDialog(report.fittedSaveDialog);await waitClosed(row=>row.address===report.saveDialog.address);
    }
    report.firstSave=await readDocument('first-save',[first]);assert.ok(report.firstSave.text.includes(first));
    if(writerSavedResume){assert.equal(report.firstSave.sha256,writerSavedResume.reference.documentSha256);assert.equal(report.firstSave.bytes,writerSavedResume.reference.documentBytes);}
    if(writerReopenResume)assert.deepEqual(report.firstSave,writerReopenResume.prior.firstSave);
    if(writerOpenResume)assert.deepEqual(report.firstSave,writerOpenResume.prior.firstSave);
    if(!writerReopenResume&&!writerOpenResume){
      if(writerSavedResume)await focusWriterContent(report.writer.window);
      await shot('writer-saved');await press('Control+q');await waitClosed(row=>/libreoffice|soffice/i.test(row.class),600000);
    }
    const launched=writerOpenResume?report.reopenLaunch.window:await launchWriter();
    if(!writerOpenResume)report.reopenLaunch=await identity(launched,'/usr/lib/libreoffice/program/soffice.bin');
    report.openDialog=await openWriterFile(launched);report.fittedOpenDialog=await focusFileDialog(report.openDialog);await shot('writer-open-dialog');
    await press('Control+l');await press('Control+a');await type(document);await press('Enter');await waitClosed(row=>row.address===report.openDialog.address,600000);
    report.reopenedWindow=await waitWindow(row=>/omarchy-native-applications-42/i.test(row.title));
    assert.ok(isWriterDocumentWindow(report.reopenedWindow));report.reopenedWriter=await identity(report.reopenedWindow,'/usr/lib/libreoffice/program/soffice.bin');
    await focusWriterContent(report.reopenedWindow);await shot('writer-reopened');await press('Control+End');await press('Enter');await type('Reopened and saved');await press('Control+s');await sleep(2000);
    report.secondSave=await readDocument('second-save',[first,'Reopened and saved']);assert.ok(report.secondSave.text.includes(first));assert.ok(report.secondSave.text.includes('Reopened and saved'));
    assert.notEqual(report.firstSave.sha256,report.secondSave.sha256);report.writerGpu=await shot('writer-resaved');
    await press('Control+q');await waitClosed(row=>/libreoffice|soffice/i.test(row.class),600000);

    const existingFoot=new Set((await clients()).filter(row=>/foot/i.test(row.class)).map(row=>row.pid));
    await press('Meta+Enter');report.terminal=await waitActive(row=>/foot/i.test(row.class)&&!existingFoot.has(row.pid));
    const absent=await run('test ! -e /tmp/omarchyapps/node && test ! -e /tmp/omarchyapps/npm');assert.equal(absent.exit,0);
    await type('node -p process.arch > /tmp/omarchyapps/node; npm --version > /tmp/omarchyapps/npm');await press('Enter');
    let tools;
    for(let n=0;n<40;n++){tools=await run('test -s /tmp/omarchyapps/npm && cat /tmp/omarchyapps/node /tmp/omarchyapps/npm');if(tools.exit===0)break;await sleep(1500);}
    assert.equal(tools.exit,0);assert.match(tools.stdout,/^riscv64\s+12\.2\.0\s*$/);report.nodeNpm=tools;
    report.nodeExecutable=await identityProof.file('/usr/bin/node',name+'-node-identity');
    report.afterGpu=await shot('node-npm');
    await wallpaperTransition();
    let previousGpu=report.beforeGpu;
    for(const phase of ((browserPrefix||sandboxPrefix||writerComponent||writerOnly)?[report.writerGpu,report.afterGpu]:[report.chromiumGpu,report.writerGpu,report.afterGpu])){
      assert.equal(phase.qualified,true);assert.equal(phase.lost,false);assert.equal(phase.counters.failed,0);
      assert.equal(phase.epoch,previousGpu.epoch);assert.equal(phase.poisoned,false);assert.equal(phase.disposed,false);
      assert.ok(phase.counters.draws>previousGpu.counters.draws);assert.ok(phase.counters.completed>previousGpu.counters.completed);
      previousGpu=phase;
    }
    report.trusted=await page.evaluate(()=>window.__appTrusted);assert.ok(report.trusted.length>100);assert.ok(report.trusted.every(row=>row.trusted));
    if(name.startsWith('control-applications-')){
      // The original cold wrapper deliberately remains failed. This explicitly
      // recorded component retry also earns the stock post-app desktop proof.
      report.publicDesktopInput=await verifyPublicDesktopInput(page,command,output,{name:name+'-public-desktop-input',initialClockMode:'paced-icount'});
      report.publicDesktopFinal=await page.evaluate(async()=>({serial:__fastBootCritic.serial,workerErrors:__fastBootCritic.errors,
        workers:__fastBootCritic.workerBoots,events:__fastBootCritic.events,wireTotals:__fastBootCritic.wireTotals,
        gpu:await window.wvmDemo.gpuStats(),display:window.__presentation?.state?.(),cursor:window.__cursor?.state?.()}));
      report.publicDesktopFinal.pageErrors=[...pageErrors];assertPublicDesktopFinal(report.publicDesktopFinal);
    }
    assert.deepEqual(pageErrors,[]);report.pageErrors=pageErrors;
    report.status='passed';await save();return report;
  } catch(error) {
    report.status='failed';report.error=error.stack||String(error);
    report.inputFailure=await inputObservation().catch(error=>({error:String(error)}));
    report.pageErrors=[...pageErrors];
    report.trusted=await page.evaluate(()=>window.__appTrusted).catch(()=>null);
    await shot('failed').catch(()=>{});await save();throw error;
  } finally {
    page.off('pageerror',onError);page.off('console',onConsole);
    await page.evaluate(()=>{if(window.__appTrustedListener)for(const type of ['keydown','keyup','pointerdown','pointerup'])document.removeEventListener(type,window.__appTrustedListener,true);}).catch(()=>{});
  }
}
