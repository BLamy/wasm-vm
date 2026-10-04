#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {PARTNER_VERTEX,PARTNER_FRAGMENT} from './cases.mjs';
const nativeFile=process.argv[2],output=path.resolve(process.argv[3]);assert.ok(nativeFile);fs.mkdirSync(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),native=JSON.parse(fs.readFileSync(nativeFile));assert.equal(native.status,'passed');
const bridge=await createVirglShaderBridge(),cases=[],pairs=[];
for(const c of native.cases){const result=bridge.translate({stage:c.stage,text:c.text});assert.deepEqual(result,c.result,c.name);
  cases.push({index:c.index,name:c.name,textSha256:c.textSha256,result});
  const fragmentPartner=c.base&&!c.result.metadata.outputs.some(o=>o.semantic==='GENERIC'&&o.semanticIndex===1)?PARTNER_FRAGMENT.replace('DCL IN[1], GENERIC[1], PERSPECTIVE\n',''):PARTNER_FRAGMENT;
  const request=c.stage==='vertex'?{vertexText:c.text,fragmentText:fragmentPartner}:{vertexText:PARTNER_VERTEX,fragmentText:c.text};
  const pair=bridge.translatePair(request);assert.equal(pair.ok,c.ok,'pair admission '+c.name);
  if(!c.ok)for(const key of ['vertex','fragment','metadata'])assert.ok(!Object.hasOwn(pair,key));
  pairs.push({index:c.index,name:c.name,result:pair});
}
const report={schema:'virgl-minimum-selection-wasm-v1',task:'E6-T12g6g1',status:'passed',gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),nativeSha256:hash(fs.readFileSync(nativeFile)),cases,pairs};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`${cases.length} minimum selection Wasm results match native; ${pairs.length} closed pairs.`);
