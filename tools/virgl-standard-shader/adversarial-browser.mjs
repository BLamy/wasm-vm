// Promoted hardware attack recorder, including real-operation/oracle sabotage.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
const options=browserOptions(['--inputs','--fault']);assert.ok(options.inputs);assert.ok(!options.fault||['sine','oracle'].includes(options.fault));
const root=await fs.realpath(path.resolve(import.meta.dirname,'../..')),inputs=path.relative(root,await fs.realpath(path.resolve(options.inputs))).split(path.sep).join('/');
assert.ok(!inputs.startsWith('../'),'physical inputs must be in the repository');
const modulePath='renderer/virgl-shader/tests/standard-adversarial.mjs';
const files=[modulePath,inputs+'/physical-plan.json','tools/virgl-original-programs/oracle.mjs'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const pins=[];for(const file of files){const raw=await fs.readFile(file);pins.push({path:file,size:raw.length,sha256:hash(raw)});}
const report=await runVirglBrowser({options,task:'E6-T11d4-fresh-verifier',boundary:'Independently seeded scalar, indirect, masked alias, integer source-negation and flow attack',reportFields:{productionNegotiation:false},modulePath:'/'+modulePath,windowReportKey:'__standardCriticReport',serializedAcceptance:true,browserArguments:{planPath:'/'+inputs+'/physical-plan.json',fault:options.fault??null},servedFiles:files,pinnedFiles:pins,coveragePaths:['renderer/virgl-shader/standard.mjs',modulePath],html:browserDocument({title:'Standard compiler critic',heading:'Independent dynamic shader attack',description:'Pre-recorded CPU predictions; no exact/private authority.'}),validate(r){assert.equal(r.frames.length,8);assert.ok(r.frames.every(f=>f.mismatches.length===0));},successMessage:r=>r.frames.length+' adversarial physical draws passed'});
const out=path.resolve(options.output);await fs.mkdir(path.join(out,'pixels'),{recursive:true});
for(const [i,f]of(report.acceptance?.frames??[]).entries())for(const o of f.outputs){const p=o.pixels;if(!p?.gzipBase64)continue;const b=Buffer.from(p.gzipBase64,'base64'),raw=gunzipSync(b);assert.equal(hash(b),p.gzipSha256);assert.equal(hash(raw),p.sha256);const name=`pixels/frame-${i}-${o.output}.f32.gz`;await fs.writeFile(path.join(out,name),b);delete p.gzipBase64;p.path=name;}
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');process.exit(report.status==='passed'?0:1);
