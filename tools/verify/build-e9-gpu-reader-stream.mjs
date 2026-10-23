#!/usr/bin/env node
// Original sealed production MMIO GPU/query/readback guest, used as a reader
// control. It is never substituted for the original Linux/Omarchy workload.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const write=process.argv.slice(2).join(' ')==='--write';assert(write||process.argv.length===2,'use --write or check with no arguments');
const root=new URL('../../',import.meta.url),bytes=await fs.readFile(new URL('guest/prebuilt/production-gpu-session.bin',root)),metadata=await fs.readFile(new URL('guest/prebuilt/production-gpu-session.json',root)),info=JSON.parse(metadata);
assert.equal(createHash('sha256').update(bytes).digest('hex'),info.sha256);assert.equal(bytes.length,info.bytes);
for(const [extension,data]of [['bin',bytes],['json',metadata]]){const file=new URL('web/assets/e9-gpu-reader-physical.'+extension,root);if(write)await fs.writeFile(file,data);else assert.deepEqual(await fs.readFile(file),data);}
console.log(JSON.stringify({status:'matched',sha256:info.sha256,bytes:bytes.length}));
