#!/usr/bin/env python3
"""Reuse recorded GL plumbing, add an independent unwrapped inherited-selector probe."""
from pathlib import Path
import hashlib
import json

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
source = (ROOT / 'renderer/virgl-command/tests/exact-bank.mjs').read_text()
prefix = source[:source.index('export async function runAcceptance')]
for old, new in {
    "'../../virgl-shader/index.mjs'": "'/renderer/virgl-shader/index.mjs'",
    "'../../virgl-shader/tests/browser.mjs'": "'/renderer/virgl-shader/tests/browser.mjs'",
    "'../resources.mjs'": "'/renderer/virgl-command/resources.mjs'",
    "'../state.mjs'": "'/renderer/virgl-command/state.mjs'",
    "'../../../tools/virgl-exact-bank/fixtures.mjs'": "'/tools/virgl-exact-bank/fixtures.mjs'"
}.items():
    prefix = prefix.replace(old, new)
probe = r'''
export async function runAcceptance({seed=324508640}={}) {
 const report={schema:1,task:'E6-T12g6m3a',status:'running',guestExecution:false,seed,unwrappedInherited:true,rigs:[]};window.__virglInheritedCriticReport=report;
 const canvas=document.querySelector('#gpu');canvas.width=canvas.height=8;const gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});require(gl instanceof WebGL2RenderingContext,'physical WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info');report.renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);document.querySelector('#renderer').textContent=report.renderer;
 try {
  const bridge=await createVirglShaderBridge(),all=await(await fetch('/tools/virgl-exact-bank/fixtures.json')).json();
  for(const asynchronous of [false,true])for(const kind of ['conversion','raster']) {
   const input=all.find(c=>c.name==='fragment-composed-'+kind),color=kind==='conversion'?[0,0,0,255]:[128,128,128,128],entry={name:'unwrapped '+kind+(asynchronous?' async':' sync'),width:8,getterInvocations:0,...(asynchronous?{schedule:{seed,commandsPerStep:3}}:{})};report.rigs.push(entry);
   const rig=makeRig(gl,bridge,entry,asynchronous);try {
    createResources(rig);createContext(rig,1);rig.plans={vertex:null,fragment:null};
    await rig.must(1,setupBytes(VERTEX,input.text,8),'unwrapped setup');
    await rig.must(1,constants(1,input.safeWords),'unwrapped safe prefix');await rig.must(1,link(),'unwrapped prelink');await rig.must(1,bind(2,1),'unwrapped fragment bind');
    for(const translation of entry.translations)if(translation.kind==='single')equal(translation.result,translation.original,'no exact wrapper in inherited replay');
    await phase(rig,1,'unwrapped '+kind+' baseline',color);
    const attack=input.inheritedAttacks[0],wrong=input.safeWords.slice();wrong[attack.index]=attack.word;
    await rejectDraw(rig,1,'unwrapped '+kind+' finite inherited rejection',1,constants(1,wrong),attack.code);
    await rig.must(1,constants(1,input.safeWords),'unwrapped recovery prefix');await phase(rig,1,'unwrapped '+kind+' recovery',color);
   } finally {rig.dispose();}
  }
  report.status='passed';document.querySelector('#status').textContent='Unwrapped inherited conversion/raster selectors held.';
 } catch(error) {report.status='failed';report.failure={message:error.message,stack:error.stack};document.querySelector('#status').textContent=error.message;}
 return report;
}
'''
(OUT / 'inherited.mjs').write_text(prefix + probe)
driver = r'''
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {runVirglBrowser,browserDocument} from '../../../tools/lib/virgl-browser-runner.mjs';
const files=['evidence/virgl-exact-bank/verifier/inherited.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/decoder.mjs','tools/virgl-exact-bank/fixtures.mjs','tools/virgl-exact-bank/fixtures.json'];
await runVirglBrowser({options:{output:'evidence/virgl-exact-bank/verifier/inherited-gpu'},task:'E6-T12g6m3a',boundary:'independent unwrapped inherited fallback replay',reportFields:{productionNegotiation:false},modulePath:'/evidence/virgl-exact-bank/verifier/inherited.mjs',windowReportKey:'__virglInheritedCriticReport',browserArguments:{seed:324508640},serializedAcceptance:true,servedFiles:files,pinnedFiles:files.map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')})),coveragePaths:['renderer/virgl-command/state.mjs','renderer/virgl-command/constant-domain.mjs'],html:browserDocument({title:'Independent inherited selector replay',heading:'Unwrapped inherited fallback on physical WebGL2',description:'Existing F2I/raster domains, literal framebuffers and real sync/async draw rejection.'}),validate(a){assert.equal(a.unwrappedInherited,true);assert.equal(a.rigs.length,4);for(const rig of a.rigs){assert.equal(rig.draws.length,2);assert.equal(rig.attacks.length,1);assert.equal(rig.glObjects.live,0);}},successMessage:a=>'Eight unwrapped inherited full frames and four inherited rejections passed.'});
'''
(OUT / 'inherited-browser.mjs').write_text(driver)
prediction = {'task':'E6-T12g6m3a','predictedBeforeExecution':True,'seed':324508640,'commandsPerStep':3,
              'expectedFrames':8,'expectedRejections':4,'colors':{'conversion':[0,0,0,255],'raster':[128,128,128,128]},
              'expected':'original complete compiler results stay unwrapped; finite inherited failures apply one CPU SET, no unsafe upload/index/link/staging/DRAW; same complete pixels and all budgets/native objects zero',
              'sourceSha256':hashlib.sha256((prefix+probe).encode()).hexdigest()}
(OUT / 'inherited-predictions.json').write_text(json.dumps(prediction,indent=2)+'\n')
print(json.dumps(prediction))
