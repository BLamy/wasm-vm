#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createVirglShaderBridge} from '../../renderer/virgl-shader/index.mjs';
import {cases} from '../virgl-exact-reciprocal/cases.mjs';

const original=cases().find(entry=>entry.name==='full-original-92cb');
assert.ok(original);
assert.equal(createHash('sha256').update(original.fragmentText).digest('hex'),
 '92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba');
const bridge=await createVirglShaderBridge();
const result=bridge.translatePairExact({vertexText:original.vertexText,
 fragmentText:original.fragmentText,vertexComponents:original.vertexComponents,
 fragmentComponents:original.fragmentComponents});
assert.equal(result.ok,false,'the unchanged other original pair remains gated');
const report={schema:'virgl-zero-cap-other-original-v1',task:'E6-T12g6m4c',
 fragmentSha256:'92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba',
 pairAccepted:false,error:result.error,status:'passed'};
fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log('Unchanged original 92cb pair rejects');
