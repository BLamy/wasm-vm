#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sha256} from './fixtures.mjs';
import {criticModel,criticCompare} from './standard-compact-adversarial-oracle.mjs';
const directory=path.resolve(process.argv[2]),report=JSON.parse(await fs.readFile(path.join(directory,'critic-hardware/report.json'))),result=report.browserResult.result;
assert.equal(report.status,'passed');assert.equal(result.frames.length,44);assert.equal(result.wire.length,297);
const blobs=new Map(result.blobs.map(row=>[row.key,row]));
async function raw(ref){const row=blobs.get(ref.key);assert.equal(row.sha256,ref.sha256);const packed=await fs.readFile(path.join(directory,'critic-hardware',row.path));assert.equal(sha256(packed),row.gzipSha256);const bytes=gunzipSync(packed);assert.equal(bytes.length,row.bytes);assert.equal(sha256(bytes),row.sha256);return new Uint8Array(bytes);}
let pixels=0;
for(const frame of result.frames){
 const original=new Map(),native=new Map();for(const row of frame.native.buffers){const data=await raw(row.blob);native.set(row.resourceId,data);original.set(row.resourceId,new Uint8Array(data.length));}
 for(const row of frame.inputs){const data=await raw(row.blob);assert.equal(row.layout.rowCount,1);assert.equal(row.layout.rowBytes,data.length);original.get(row.resource.id).set(data,row.layout.offset);}
 for(const [id,data]of original)assert.deepEqual(native.get(id),data,'retained original compact GPU upload/storage');
 const model=criticModel(frame.history,original,frame.range),comparison=criticCompare(await raw(frame.pixels),model,frame.width,frame.height);
 assert.equal(comparison.held,true,frame.label);assert.equal(frame.history.at(-1).result.gpuComplete,true);assert.ok(frame.native.calls.length>0);
 assert.deepEqual(frame.prediction.ids,model.ids);assert.deepEqual(frame.prediction.fetches,JSON.parse(JSON.stringify(model.fetches)));assert.deepEqual(frame.prediction.vertices,JSON.parse(JSON.stringify(model.vertices)));pixels+=comparison.pixels;
}
for(const row of result.wire){assert.equal(row.standard.ok,row.expected);assert.equal(row.legacy.ok,row.legacyExpected);}
await fs.writeFile(path.join(directory,'critic-audit.json'),JSON.stringify({schema:'scalar-retained-compact-critic-v1',status:'passed',frames:44,pixels,wire:297,guestExecution:false,productionNegotiation:false},null,2)+'\n');
console.log(JSON.stringify({status:'passed',frames:44,pixels,wire:297}));
