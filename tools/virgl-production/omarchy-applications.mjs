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

export async function verifyOmarchyApplications(page, command, output, options = {}) {
  // Re-read at each invocation: a retry can update only this helper's dependency
  // while Node retains the application module from the previous recording.
  const identityModule=new URL('./application-identity.mjs',import.meta.url);
  const identityModuleSha256=sha(await fs.readFile(identityModule));
  identityModule.searchParams.set('recording',identityModuleSha256);
  const {createApplicationIdentityProof}=await import(identityModule.href);
  const name = options.name || 'native-applications';
  let continueExistingBrowser=options.continueExistingBrowser===true,continuationRequest,processWitness;
  if(name.startsWith('control-applications-')){
    // The original failed controller predates this option. Its retained, owned
    // control request binds the incremental helper without mutating that loaded
    // controller or restarting the live guest.
    const id=name.slice('control-applications-'.length);assert.match(id,/^[a-z0-9-]+$/);
    const bytes=await fs.readFile(path.join(output,'control-request-'+id+'.json')),request=JSON.parse(bytes);
    assert.equal(request.id,id);assert.equal(request.kind,'retry-applications');
    continueExistingBrowser ||= request.continueExistingBrowser===true;
    if(continueExistingBrowser){
      assert.equal(request.continueExistingBrowser,true);
      const original=JSON.parse(await fs.readFile(path.join(output,'report.json')));
      assert.equal(original.status,'failed');assert.equal(original.warmGpu,true);
      assert.equal(original.applicationContinuation,true);assert.ok(!original.remoteUrl);
      assert.ok(original.errors.some(error=>error.includes('native Chromium loaded and focused the guest loopback page')));
      continuationRequest={id,sha256:sha(bytes),scope:'owned failed local warm application run; original navigation failure remains retained'};
      if(request.processWitness){
        assert.equal(request.processWitness.path,'omarchy-initial-native-applications-identity-0-filesystem/receipt.json');
        assert.match(request.processWitness.sha256,/^[a-f0-9]{64}$/);processWitness=request.processWitness;
      }
    }
  }
  if(continueExistingBrowser)assert.ok(continuationRequest,'existing browser continuation requires the retained owned failure and request');
  const fixtureSpec=createApplicationFixture(randomUUID().replaceAll('-',''));
  const report = {status:'running',identityModuleSha256,continueExistingBrowser,fixtureToken:fixtureSpec.token,fixtureServerSha256:sha(Buffer.from(fixtureSpec.source)),networking:{provider:'offline',fixture:fixtureSpec.url,externalBrowsingClaim:false},phases:[]};
  if(continuationRequest)report.continuationRequest=continuationRequest;
  if(processWitness)report.processWitness=processWitness;
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
  async function waitWindow(predicate, timeout=300000) {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){await gpuHealth();const rows=await clients();const found=rows.find(predicate);if(found)return found;await sleep(1500);}
    throw Error('Actual guest application window did not appear');
  }
  async function waitActive(predicate, timeout=300000) {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){await gpuHealth();const result=await run(hypr+'activewindow');assert.equal(result.exit,0);const active=JSON.parse(result.stdout);if(predicate(active))return active;await sleep(1500);}
    throw Error('Actual guest application did not acquire focus');
  }
  async function waitClosed(predicate, timeout=120000) {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){await gpuHealth();if(!(await clients()).some(predicate))return;await sleep(1500);}
    throw Error('Actual guest application window did not close');
  }
  async function shot(label) {
    await page.locator('#ide-display-canvas').screenshot({path:path.join(output,name+'-'+label+'.png')});
    const gpu=await page.evaluate(()=>window.wvmDemo.gpuStats());
    report.phases.push({kind:'screenshot',label,gpu,time:Date.now()});await save();return gpu;
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
    const canvas=page.locator('#ide-display-canvas');await canvas.focus();
    if(await page.evaluate(()=>document.documentElement.dataset.keyboardCapture)!=='on'){
      await page.locator('#ide-keyboard-toggle').click();await canvas.focus();
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
  async function launchWriter() {
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
    const window=await waitWindow(row=>/libreoffice|soffice/i.test(row.class)&&row.visible!==false&&row.size?.[0]>300,600000);
    await waitActive(row=>row.pid===window.pid);await shot('writer-open');return window;
  }
  async function verifySandboxedImage(chromium) {
    const expected={pid:chromium.pid,starttime:report.chromium.before.data.starttime,exe:'/usr/lib/chromium/chromium'};
    const code=`import gi,hashlib,json,os,base64;from pathlib import Path;expected=json.loads(${JSON.stringify(JSON.stringify(expected))})\ndef process():\n p=Path('/proc')/str(expected['pid']);s=(p/'stat').read_text();value=dict(pid=expected['pid'],starttime=s[s.rfind(')')+2:].split()[19],exe=os.readlink(p/'exe'));assert value==expected;return value\nbefore=process();gi.require_version('GdkPixbuf','2.0');from gi.repository import GdkPixbuf;assert 'GLYCIN_DISABLE_SANDBOX' not in os.environ;p='/usr/share/icons/Adwaita/scalable/status/image-missing.svg';source=open(p,'rb').read();b=GdkPixbuf.Pixbuf.new_from_file_at_scale(p,48,48,True);pixels=b.get_pixels();after=process();assert before==after;print(json.dumps({'chromiumBefore':before,'chromiumAfter':after,'width':b.get_width(),'height':b.get_height(),'channels':b.get_n_channels(),'stride':b.get_rowstride(),'pixelSha256':hashlib.sha256(pixels).hexdigest(),'sourceSha256':hashlib.sha256(source).hexdigest(),'pixels':base64.b64encode(pixels).decode(),'source':base64.b64encode(source).decode()}),flush=True)`;
    const result=await run('timeout -k 1s 10s env RUST_LOG=debug python3 -c '+"'"+code.replaceAll("'","'\\''")+"'");
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
    const code=`from pathlib import Path;import base64,hashlib,json,zipfile;from xml.etree import ElementTree as ET;p=Path(${JSON.stringify(document)});assert p.stat().st_size<1048576;b=p.read_bytes();z=zipfile.ZipFile(p);assert z.getinfo('content.xml').file_size<2097152;print(json.dumps({'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'text':' '.join(ET.fromstring(z.read('content.xml')).itertext()),'base64':base64.b64encode(b).decode()}))`;
    const deadline=Date.now()+120000;let saved;
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
    const canvas=page.locator('#ide-display-canvas');await canvas.focus();
    if(await page.evaluate(()=>document.documentElement.dataset.keyboardCapture)!=='on'){
      await page.locator('#ide-keyboard-toggle').click();await canvas.focus();
    }
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.keyboardCapture),'on');
    await page.evaluate(()=>{
      window.__appTrusted=[];window.__appTrustedListener=e=>window.__appTrusted.push({type:e.type,key:e.key,code:e.code,trusted:e.isTrusted,time:performance.now()});
      for(const type of ['keydown','keyup','pointerdown','pointerup'])document.addEventListener(type,window.__appTrustedListener,true);
    });
    report.beforeGpu=await shot('initial');
    await waitReadableBar();
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
    let chromium=await waitWindow(row=>row.visible!==false&&(/chromium/i.test(row.class)||
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
    const note='omarchy chromium riscv 42';await type(note);await press('Tab');await press('Space');
    let submitted;
    for(let n=0;n<30;n++){submitted=await run('cat /tmp/omarchyapps/submission.json');if(submitted.exit===0)break;await sleep(1000);}
    assert.equal(submitted.exit,0);report.browserSubmission=JSON.parse(submitted.stdout);
    assert.equal(report.browserSubmission.message,note);assert.equal(report.browserSubmission.clickTrusted,true);
    assert.ok(report.browserSubmission.inputTrusted.length>=note.length);assert.ok(report.browserSubmission.inputTrusted.every(value=>value===true));
    report.chromiumGpu=await shot('chromium-submitted');
    await verifySandboxedImage(chromium);
    await press('Meta+w');await waitClosed(row=>/chromium/i.test(row.class));

    report.writer=await identity(await launchWriter(),'/usr/lib/libreoffice/program/soffice.bin');assert.match(report.writer.process.stdout,/\/usr\/lib\/libreoffice\/program\/soffice.bin/);
    const first='omarchy riscv document 42';await type(first);await press('Control+s');await sleep(2000);await shot('writer-save-dialog');
    await press('Control+l');await type(document);await press('Enter');
    report.firstSave=await readDocument('first-save',[first]);assert.ok(report.firstSave.text.includes(first));
    await shot('writer-saved');await press('Control+q');await waitClosed(row=>/libreoffice|soffice/i.test(row.class));
    await launchWriter();await press('Control+o');await sleep(1500);await press('Control+l');await type(document);await press('Enter');
    report.reopenedWindow=await waitWindow(row=>/omarchy-native-applications-42/i.test(row.title));
    await shot('writer-reopened');await press('Control+End');await press('Enter');await type('reopened and saved');await press('Control+s');await sleep(2000);
    report.secondSave=await readDocument('second-save',[first,'reopened and saved']);assert.ok(report.secondSave.text.includes(first));assert.ok(report.secondSave.text.includes('reopened and saved'));
    assert.notEqual(report.firstSave.sha256,report.secondSave.sha256);report.writerGpu=await shot('writer-resaved');
    await press('Control+q');await waitClosed(row=>/libreoffice|soffice/i.test(row.class));

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
    for(const phase of [report.chromiumGpu,report.writerGpu,report.afterGpu]){
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
