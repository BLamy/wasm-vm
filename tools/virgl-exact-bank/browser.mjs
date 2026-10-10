#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
import {SEEDS} from './fixtures.mjs';
const options=browserOptions(['--seed','--fault']),seed=options.seed===undefined?SEEDS[0]:Number(options.seed),fault=options.fault??null;
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff);assert.ok([null,'exact-equality'].includes(fault));
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=['renderer/virgl-command/tests/exact-bank.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/constant-domain.mjs','tools/virgl-exact-bank/fixtures.mjs','tools/virgl-exact-bank/fixtures.json'];
let faultSources=null;
if(fault){
  const directory='target/virgl-exact-bank-fault';fs.mkdirSync(directory,{recursive:true});
  const original=fs.readFileSync('renderer/virgl-command/constant-domain.mjs','utf8'),needle='checked.words[entry.register * 4 + entry.component] !== entry.word';assert.equal(original.split(needle).length,2);
  const altered=original.replace(needle,needle+' && false');fs.writeFileSync(directory+'/constant-domain.mjs',altered);
  const state=fs.readFileSync('renderer/virgl-command/state.mjs','utf8').replace('"./decoder.mjs"','"/renderer/virgl-command/decoder.mjs"').replace('"../virgl-shader/index.mjs"','"/renderer/virgl-shader/index.mjs"').replace('"./constant-domain.mjs"',`"/${directory}/constant-domain.mjs"`);fs.writeFileSync(directory+'/state.mjs',state);
  files.push(directory+'/constant-domain.mjs',directory+'/state.mjs');faultSources={originalSha256:hash(original),alteredSha256:hash(altered),needle,change:'disable only exact-word inequality failure',stateSha256:hash(state)};
}
const coverage=['renderer/virgl-command/tests/exact-bank.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs',...(fault?['target/virgl-exact-bank-fault/state.mjs','target/virgl-exact-bank-fault/constant-domain.mjs']:[])];
await runVirglBrowser({options,task:'E6-T12g6m3a',boundary:'private owned exact-word bank consumer',reportFields:{productionNegotiation:false,trustedHostWrapper:true,faultSources},modulePath:'/renderer/virgl-command/tests/exact-bank.mjs',windowReportKey:'__virglExactBankReport',browserArguments:{seed,fault},serializedAcceptance:true,servedFiles:files,pinnedFiles:files.map(path=>({path,sha256:hash(fs.readFileSync(path))})),coveragePaths:coverage,
  html:browserDocument({title:'Exact owned constant banks',heading:'Exact owned banks on physical WebGL2',description:'Trusted host metadata over unchanged real shader results. Literal framebuffers, real decoded SET/DRAW and owned async plans.'}),
  validate(a){assert.equal(a.rigs.length,JSON.parse(fs.readFileSync('tools/virgl-exact-bank/fixtures.json')).filter(c=>c.role==='physical').length*2+1);assert.equal(a.trustedHostWrapper,true);for(const rig of a.rigs){assert.equal(rig.glObjects.live,0);assert.ok(Object.values(rig.finalBudgets).every(x=>x===0)&&Object.values(rig.finalResourceBudgets).every(x=>x===0));assert.ok(rig.draws.length>0);}},
  successMessage:a=>`${a.rigs.reduce((n,r)=>n+r.draws.length,0)} exact whole frames; ${a.rigs.reduce((n,r)=>n+r.attacks.length,0)} rejected inputs; ${a.rigs.length} disposed real sync/async rigs.`});
