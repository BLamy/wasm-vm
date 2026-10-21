import assert from 'node:assert/strict';
import test from 'node:test';
import {branchOrigin,validateBranchOrigin,branchConsolePrefix} from '../../web/session-branch-format.js';
const origin=()=>branchOrigin({parentId:'parent',parentManifestSha256:'12'.repeat(32),sourceDigestSha256:'34'.repeat(32),
  position:{transition:'9007199254740993',retired:'7',sequence:'2',phase:'before',ordinal:1},consolePrefix:new TextEncoder().encode('original console\n')});
test('wide coordinates and explicit offline policy survive an owned JSON round trip',()=>{
  const value=origin(),copy=validateBranchOrigin(value);value.sourcePosition.transition='0';
  assert.equal(copy.sourcePosition.transition,'9007199254740993');
  assert.equal(copy.networkPolicy,'offline-refuse-historical-v1');
  assert.equal(new TextDecoder().decode(Uint8Array.from(copy.consolePrefix)),'original console\n');
});
test('invalid or ambiguous origins are refused before publication',()=>{
  for(const mutate of [v=>v.version=2,v=>v.extra=1,v=>v.parentManifestSha256='00',v=>v.sourceDigestSha256='A'.repeat(64),
    v=>v.parentId='x'.repeat(65),v=>v.sourcePosition.sequence='18446744073709551615',v=>v.sourcePosition.transition='01',
    v=>v.sourcePosition.transition=9,v=>v.sourcePosition.phase='observe',v=>v.sourcePosition.ordinal=3,
    v=>v.sourcePosition.retired='18446744073709551614',v=>v.networkPolicy='reconnect',
    v=>v.consolePrefix=Array(65537).fill(0),v=>v.consolePrefix=[256],v=>v.consolePrefix=[1.5]]){
    const value=origin();mutate(value);assert.throws(()=>validateBranchOrigin(value));
  }
});
test('branch view retains past drains once and never imports the parent future',()=>{
  const encoder=new TextEncoder(),read={consolePrefix:encoder.encode('ancestor\n'),receipts:[
    {kind:'host',channel:21,sequence:'1',bytes:encoder.encode('past\n')},
    {kind:'host',channel:21,sequence:'3',bytes:encoder.encode('parent-future\n')}]};
  assert.equal(new TextDecoder().decode(branchConsolePrefix(read,{sequence:'2'})),'ancestor\npast\n');
  assert.equal(branchConsolePrefix({consolePrefix:new Uint8Array(65536),receipts:read.receipts},{sequence:'1'}).length,65536);
});
test('console prefix retains raw truncated UTF-8 without a second decode',()=>{
  const prefix=new Uint8Array(65536).fill(0x78);prefix.set([0x92,0xbe],0);
  const bytes=branchConsolePrefix({consolePrefix:prefix,receipts:[]},{sequence:'0'});
  assert.deepEqual(bytes,prefix);
  const value=branchOrigin({parentId:'p',parentManifestSha256:'12'.repeat(32),sourceDigestSha256:'34'.repeat(32),
    position:{transition:'0',retired:'0',sequence:'0',phase:'before',ordinal:0},consolePrefix:bytes});
  assert.deepEqual(Uint8Array.from(value.consolePrefix),prefix);
});
