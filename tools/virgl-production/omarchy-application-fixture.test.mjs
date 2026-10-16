// Native fixture regression only. Actual guest Chromium typing is recorded by
// omarchy-applications.mjs; HTTP requests here are not browser evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {createApplicationFixture,readFixtureTransition,authenticateBrowserPrefix,isWriterDocumentWindow,isWriterTipWindow} from './omarchy-applications.mjs';

test('the original Bash job notification cannot obscure or replace a fixture transition receipt',()=>{
  const token='8203261826a440b9bd4746d04943f145';
  const receipt={scope:'authenticated owned fixture retained before generation change',serverPid:5040,
    serverSha256:'0d72911b0f34a15405434cf265f6206cc81757964e6030a4d938e5a825cb5365',
    retainedFixture:'/tmp/omarchyapps-before-'+token};
  const literalNotification='[1]+  Terminated                 python3 /tmp/omarchyapps/server.py > /tmp/omarchyapps/server.log 2>&1 < /dev/null';
  assert.deepEqual(readFixtureTransition(JSON.stringify(receipt)+'\n'+literalNotification+'\n\n',token),receipt);
  assert.throws(()=>readFixtureTransition(literalNotification,token));
  assert.throws(()=>readFixtureTransition(JSON.stringify(receipt)+'\n'+JSON.stringify(receipt),token));
  assert.throws(()=>readFixtureTransition(JSON.stringify(receipt)+'\nunexpected native output',token));
  assert.throws(()=>readFixtureTransition(JSON.stringify(receipt),'0'.repeat(32)));
});

test('a previous fixture document cannot write the next navigation readiness or submission',async()=>{
  const previous=createApplicationFixture('0'.repeat(32)),current=createApplicationFixture('1'.repeat(32));
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'omarchy-fixture-generation-'));
  const source=current.source
    .replace("ROOT=Path('/tmp/omarchyapps')",'ROOT=Path('+JSON.stringify(root)+')')
    .replace("HTTPServer(('127.0.0.1',8765),Handler).serve_forever()",
      "server=HTTPServer(('127.0.0.1',0),Handler);print(server.server_port,flush=True);server.serve_forever()");
  const child=spawn('python3',['-u','-c',source],{stdio:['ignore','pipe','pipe']});
  child.stderr.resume();const lines=createInterface({input:child.stdout});let timer;
  try{
    const [line]=await Promise.race([once(lines,'line'),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('owned fixture server did not start')),10000);
    })]);clearTimeout(timer);assert.match(line,/^[0-9]+$/);
    const origin='http://127.0.0.1:'+line;
    assert.equal((await fetch(origin+previous.route)).status,404);
    const loaded=await fetch(origin+current.route);assert.equal(loaded.status,200);
    const body=await loaded.text();assert.ok(body.includes(current.readyPath));assert.ok(body.includes(current.submitPath));
    assert.ok(!body.includes(previous.readyPath));
    for(const route of ['/ready',previous.readyPath,'/submit',previous.submitPath]){
      assert.equal((await fetch(origin+route,{method:'POST',body:'{}'})).status,400,route);
    }
    await assert.rejects(fs.stat(path.join(root,'ready.json')),error=>error.code==='ENOENT');
    await assert.rejects(fs.stat(path.join(root,'submission.json')),error=>error.code==='ENOENT');
    const ready={readyState:'complete',hasFocus:true,activeElement:'note',location:current.url};
    assert.equal((await fetch(origin+current.readyPath,{method:'POST',body:JSON.stringify(ready)})).status,200);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'ready.json'),'utf8')),ready);
    assert.equal(await fs.readFile(path.join(root,'requested'),'utf8'),current.route);
  }finally{
    clearTimeout(timer);lines.close();
    if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}
    await fs.rm(root,{recursive:true});
  }
});

// The observed31 browser receipt is carried only as an authenticated prefix;
// this boundary test does not stand in for its native browser recording.
test('a retained browser prefix rejects altered identity, stale navigation and manufactured success',()=>{
  const token='21ecfcdf7f024fa4bf335cbeb074af12',fixture=createApplicationFixture(token);
  const original={status:'failed',continueExistingBrowser:true,
    error:'AssertionError: native GdkPixbuf decodes the packaged icon under the normal sandbox',
    fixtureToken:token,fixtureServerSha256:'e8e1e6e686a0ff93146084b7f3cc7747cb44ee4119f5a411792393eb5555911c',
    networking:{provider:'offline',fixture:fixture.url,externalBrowsingClaim:false},browserNavigationMs:95550,
    browserReady:{readyState:'complete',hasFocus:true,activeElement:'note',location:fixture.url},
    browserRequest:{exit:0,stdout:fixture.route},browserSubmission:{message:'omarchy chromium riscv 42',clickTrusted:true,inputTrusted:Array(25).fill(true)},
    phases:[{kind:'guest-command',command:'timeout -k 1s 10s env RUST_LOG=debug python3 -c original',result:{exit:124}}],
    trusted:Array.from({length:132},()=>({trusted:true})),chromium:{executable:'/usr/lib/chromium/chromium'},
    chromiumGpu:{qualified:true,counters:{failed:0}}};
  const encode=value=>Buffer.from(JSON.stringify(value)),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const bytes=encode(original);assert.equal(authenticateBrowserPrefix(bytes,digest(bytes)).fixture.url,fixture.url);
  assert.throws(()=>authenticateBrowserPrefix(bytes,'0'.repeat(64)));
  for(const mutate of [p=>p.status='passed',p=>p.fixtureToken='0'.repeat(32),p=>p.browserNavigationMs=600001,
    p=>p.browserReady.location='http://127.0.0.1:8765/',p=>p.browserRequest.stdout='/',
    p=>p.browserSubmission.clickTrusted=false,p=>p.browserSubmission.inputTrusted[0]=false,
    p=>p.browserSubmission.message='other',p=>p.phases[0].result.exit=0,p=>p.firstSave={},
    p=>p.trusted[0].trusted=false,p=>p.chromiumGpu.counters.failed=1]){
    const value=structuredClone(original);mutate(value);const altered=encode(value);
    assert.throws(()=>authenticateBrowserPrefix(altered,digest(altered)));
  }
});

test('LibreOffice native and Xwayland splash windows cannot accept document typing',()=>{
  const nativeSplash={mapped:true,visible:true,class:'soffice',title:'LibreOffice 26.8',size:[644,199]};
  const xwaylandSplash={mapped:true,visible:true,class:'',title:'LibreOffice',size:[644,199]};
  const editor={mapped:true,visible:true,class:'libreoffice-writer',title:'Untitled 1 - LibreOffice Writer',size:[621,750]};
  assert.equal(isWriterDocumentWindow(nativeSplash),false);assert.equal(isWriterDocumentWindow(xwaylandSplash),false);
  assert.equal(isWriterDocumentWindow(editor),true);
  assert.equal(isWriterDocumentWindow({...editor,size:[644,199]}),false);
  assert.equal(isWriterDocumentWindow({...editor,visible:false}),false);
  assert.equal(isWriterDocumentWindow({...editor,class:'foot',title:'omarchy@omarchy-demo:~'}),false);
});

test('only the visible native Writer process tip can be dismissed as Tip of the Day',()=>{
  const tip={pid:12830,mapped:true,visible:true,class:'soffice',title:'Tip of the Day: 1/224',size:[646,439]};
  assert.equal(isWriterTipWindow(tip,12830),true);
  assert.equal(isWriterTipWindow({...tip,title:'Tip of the Day: 224/224'},12830),true);
  for(const changes of [{pid:12831},{mapped:false},{visible:false},{class:'foot'},
    {title:'Untitled 1 — LibreOffice Writer'},{title:'Tip of the Day: 0/224'},
    {title:'Tip of the Day: 1/0'},{title:'Tip of the Day: 1/224 extra'},{size:[100,439]}]){
    assert.equal(isWriterTipWindow({...tip,...changes},12830),false);
  }
  assert.equal(isWriterTipWindow(null,12830),false);
  assert.equal(isWriterTipWindow(tip,undefined),false);
});
