// Narrow critic proof for updated retained wire clauses and fixture guards.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runWireAcceptance as integerWire} from '../../../renderer/virgl-command/tests/standard-integer-vertex-inputs.mjs';
import {runWireAcceptance as scalarWire} from '../../../renderer/virgl-command/tests/standard-scalar-vertex-fetch.mjs';
import {packedSpec} from '../../../renderer/virgl-command/tests/standard-packed-vertex-fetch.mjs';
const integer=integerWire(),scalar=scalarWire();assert.equal(integer.status,'passed');assert.equal(scalar.status,'passed');
for(const options of [{format:131},{format:8,overlapPosition:true},{format:8,attributeIndex:2}])assert.throws(()=>packedSpec(options));
assert.ok(packedSpec({format:8,ids:[]}));
const sources={};for(const name of ['standard-integer-vertex-inputs','standard-scalar-vertex-fetch','standard-packed-vertex-fetch']){
 const file='renderer/virgl-command/tests/'+name+'.mjs';sources[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
}
await fs.writeFile(new URL('narrow-admission.json',import.meta.url),JSON.stringify({status:'passed',integer,scalar,fixtureGuards:3,emptyIndices:true,sources},null,2)+'\n');
console.log(JSON.stringify({status:'passed',retainedWire:2,fixtureGuards:3,emptyIndices:true}));
