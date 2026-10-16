// Native fixture regression only. Actual guest Chromium typing is recorded by
// omarchy-applications.mjs; HTTP requests here are not browser evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {createApplicationFixture,readFixtureTransition} from './omarchy-applications.mjs';

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
