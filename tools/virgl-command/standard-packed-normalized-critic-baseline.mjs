// Fresh refusal probe loads only byte-authenticated D34 source copies.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [directory,inputFile,outputFile]=process.argv.slice(2);
assert.ok(directory&&inputFile&&outputFile);
const resources=await import(pathToFileURL(path.resolve(directory,'renderer/virgl-command/resources.mjs')));
const original=JSON.parse(await fs.readFile(inputFile,'utf8'));
let allocations=0;
const backend={maxTextureSize:16384,colorProfile:'virgl-standard-byte-color-transfers-v1',floatProfile:'virgl-standard-float-color-transfers-v1',packedFloatProfile:'virgl-standard-r11g11b10-color-transfers-v1',sharedExponentProfile:'virgl-standard-rgb9e5-transfers-v1',integerProfile:'virgl-standard-integer-color-transfers-v1',allocate(){allocations++;return{};},destroy(){},upload(){},readback(){},dispose(){},copyTextureRange(){}};
const owner=resources.createStandardIntegerColorResourceStore({backend});assert.equal(owner.ok,true);
const records=[];
for(const input of original.records){
 const create=owner.store.createResource(input.metadata),layout=resources.computeStandardIntegerColorTransferLayout(input.metadata,input.fields,input.backingByteLength);
 for(const result of[create,layout]){assert.equal(result.ok,false);assert.equal(result.error.code,'unsupported-resource');}
 assert.equal(allocations,0);records.push({metadata:input.metadata,fields:input.fields,create,layout,allocations});
}
assert.equal(records.length,78);assert.equal(owner.store.dispose().ok,true);
await fs.writeFile(outputFile,JSON.stringify({schema:'d35-critic-authenticated-D34-refusal-replay-v1',status:'passed',records,allocations,final:owner.store.inspect()},null,2)+'\n');
console.log('Replayed78 original D34 refusal inputs with zero allocations.');
