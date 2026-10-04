#!/usr/bin/env node
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {vertexVectors,vertexExpected,fragmentVectors} from './oracle.mjs';
const manifest=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/original-corpus.json')),seed=Number(process.argv[2]??0x619eca43)>>>0;
const originals=manifest.originals.map(e=>{const raw=fs.readFileSync(e.path),original={...e,text:raw.toString('utf8')};if(createHash('sha256').update(raw).digest('hex')!==e.sha256)throw new Error('original hash');return{sha256:e.sha256,stage:e.stage,vectors:e.stage==='vertex'?vertexVectors(original,seed).map(vector=>({vector,expected:vertexExpected(original,vector)})):fragmentVectors(original)};});
const ledger=JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/captured-grammar-migrations.json')),migrations=ledger.migrations.map(e=>{const original={...e,sha256:e.inputSha256,probe:'legacy-identity'};return{inputSha256:e.inputSha256,vectors:vertexVectors(original,seed).map(vector=>({vector,expected:vertexExpected(original,vector)}))};});
console.log(JSON.stringify({schema:'original-corpus-reference-v1',seed,originals,migrations}));
