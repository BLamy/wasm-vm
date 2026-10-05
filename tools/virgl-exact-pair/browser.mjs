#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS} from './fixtures.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'interface','metadata'].includes(fault));
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=['renderer/virgl-command/tests/exact-pair.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-exact-pair/fixtures.mjs','tools/virgl-exact-pair/fixtures.json'];
let faultSources=null;
if(fault){const directory='target/virgl-exact-pair-fault/'+fault;for(const name of ['raw_bits.c','bridge.c','virgl-shader.wasm'])files.push(directory+'/'+name);faultSources=JSON.parse(fs.readFileSync(directory+'/manifest.json'));files.push(directory+'/manifest.json');}
const completed=await runVirglBrowser({options,task:'E6-T12g6m3c',boundary:'private owned exact-bank paired interface',reportFields:{productionNegotiation:false,trustedHostWrapper:false,faultSources},modulePath:'/renderer/virgl-command/tests/exact-pair.mjs',windowReportKey:'__virglExactPairReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,pinnedFiles:files.map(path=>({path,sha256:hash(fs.readFileSync(path))})),coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-command/tests/exact-pair.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs'],
  html:browserDocument({title:'Compiler-derived paired exact banks',heading:'Paired interfaces on physical WebGL2',description:'Actual native/Wasm compiler preconditions, original decoded SET/DRAW and independent full-frame predictions.'}),
  validate(a){assert.equal(a.rigs.length,JSON.parse(fs.readFileSync('tools/virgl-exact-pair/fixtures.json')).filter(c=>c.physical).length*2+1);assert.equal(a.trustedHostWrapper,false);for(const rig of a.rigs){assert.equal(rig.glObjects.live,0);assert.ok(Object.values(rig.finalBudgets).every(x=>x===0)&&Object.values(rig.finalResourceBudgets).every(x=>x===0));assert.ok(rig.draws.length>0);}},
  successMessage:a=>`${a.rigs.reduce((n,r)=>n+r.draws.length,0)} compiler-generated whole frames; ${a.rigs.reduce((n,r)=>n+r.attacks.length,0)} rejected banks; ${a.rigs.length} disposed sync/async rigs.`});
// The shared browser runner has completed capture, coverage, report persistence,
// browser shutdown and server shutdown at this point. Its imported test modules
// can leave Node handles alive; this standalone acceptance command must finish.
process.exit(completed.status==='passed'?0:1);
