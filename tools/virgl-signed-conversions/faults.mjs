#!/usr/bin/env node
// Isolated real consumer fault: preserve every base obligation, omit only the
// component F2I range test. The independent GPU intercept must stop its effect.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const original=fs.readFileSync('renderer/virgl-command/constant-domain.mjs','utf8');
const needle='(entry.mask & (1 << lane)) && !signedConversionBinary32Word';
assert.equal(original.split(needle).length,2,'one real range check');
const served=original.replace(needle,'false && (entry.mask & (1 << lane)) && !signedConversionBinary32Word');
fs.mkdirSync('renderer/virgl-shader/build',{recursive:true});
const constant='renderer/virgl-shader/build/signed-conversions-range-constant.mjs',state='renderer/virgl-shader/build/signed-conversions-range-state.mjs';
fs.writeFileSync(constant,served);
const stateOriginal=fs.readFileSync('renderer/virgl-command/state.mjs','utf8');
const stateServed=stateOriginal.replace('"./decoder.mjs"','"/renderer/virgl-command/decoder.mjs"').replace('"../virgl-shader/index.mjs"','"/renderer/virgl-shader/index.mjs"').replace('"./constant-domain.mjs"',`"/${constant}"`);
assert.notEqual(stateServed,stateOriginal);fs.writeFileSync(state,stateServed);
const sha=s=>createHash('sha256').update(s).digest('hex');
fs.writeFileSync('renderer/virgl-shader/build/signed-conversions-range-fault.json',JSON.stringify({schema:'virgl-conversion-range-fault-v1',needle,originalSha256:sha(original),served:{path:constant,sha256:sha(served)},state:{path:state,sha256:sha(stateServed),originalSha256:sha(stateOriginal)}},null,2)+'\n');
