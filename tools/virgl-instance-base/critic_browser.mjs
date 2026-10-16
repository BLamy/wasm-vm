import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fixtures,selectorKeys} from './critic_fixtures.mjs';
import {runVirglBrowser,browserOptions,browserDocument} from '../lib/virgl-browser-runner.mjs';
const root=path.resolve(import.meta.dirname,'../..'),hash=b=>createHash('sha256').update(b).digest('hex');
if(process.argv[2]==='prepare'){
 const directory=path.resolve(process.argv[3]);fs.mkdirSync(directory,{recursive:true});
 const requests=[...new Map(fixtures(0x32a913f7).map(f=>{const request={vertexText:f.vertexText,fragmentText:f.fragmentText,...f.selectors};return [JSON.stringify(request),request];})).values()];
 const word=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},parts=[word(requests.length)];
 for(const r of requests){const a=Buffer.from(r.vertexText),b=Buffer.from(r.fragmentText);parts.push(word(24),...selectorKeys.map(k=>word(r[k])),word(a.length),a,word(b.length),b);}
 fs.writeFileSync(directory+'/cases.bin',Buffer.concat(parts));fs.writeFileSync(directory+'/requests.json',JSON.stringify(requests,null,2)+'\n');
 const env={...process.env,ASAN_OPTIONS:'abort_on_error=1',UBSAN_OPTIONS:'halt_on_error=1',LLVM_PROFILE_FILE:directory+'/critic-native.profraw'};
 const native=execFileSync(root+'/renderer/virgl-shader/build/standard-instance-base-native/standard-instance-base-test',[directory+'/cases.bin'],{env,maxBuffer:16*1024*1024});
 const sanitized=execFileSync(root+'/renderer/virgl-shader/build/standard-instance-base-sanitize/standard-instance-base-test',[directory+'/cases.bin'],{env,maxBuffer:16*1024*1024});assert.deepEqual(native,sanitized);
 fs.writeFileSync(directory+'/native.jsonl',native);fs.writeFileSync(directory+'/sanitize.jsonl',sanitized);
 const rows=native.toString().trim().split('\n').map(JSON.parse);assert.equal(rows.length,requests.length);assert.ok(rows.every(r=>r.result.ok));
 fs.writeFileSync(directory+'/rows.json',JSON.stringify(rows.map((r,i)=>({...r,request:requests[i]})),null,2)+'\n');
 console.log(JSON.stringify({status:'passed',originalNativeRequests:requests.length,nativeSanitizedEqual:true}));
}else{
 const options=browserOptions(['--inputs','--seed','--fault']);assert.ok(options.inputs);const seed=Number(options.seed);assert.ok(Number.isInteger(seed));assert.ok(!options.fault||options.fault==='completed-offset');
 const input=path.relative(root,path.resolve(options.inputs)).split(path.sep).join('/'),files=[input+'/rows.json','tools/virgl-instance-base/critic_fixtures.mjs'],pins=files.map(p=>{const b=fs.readFileSync(root+'/'+p);return {path:p,size:b.length,sha256:hash(b)};});
 const report=await runVirglBrowser({options,task:'E6-T11d46',boundary:'Independent original INSTANCEID/VERTEXID modifier words and completed offset sabotage',reportFields:{productionNegotiation:false},modulePath:'/renderer/virgl-shader/tests/standard-instance-base-critic.mjs',windowReportKey:'__instanceBaseCritic',serializedAcceptance:true,browserArguments:{seed,nativePath:'/'+input+'/rows.json',fault:options.fault??null},servedFiles:files,pinnedFiles:pins,coveragePaths:['renderer/virgl-shader/standard.mjs','renderer/virgl-shader/tests/standard-instance-base-critic.mjs'],html:browserDocument({title:'Independent original ID words',heading:'Original modifiers and physical native completion',description:'Original token words · independent sparse inputs · unsigned wrap · distinct second fence'}),validate(a){assert.equal(a.frames.length,6);assert.ok(a.frames.every(f=>f.gpuComplete?.fenced&&!f.differences.length));},successMessage:a=>a.frames.length+' independent original modifier planes passed.'});
 for(const b of report.acceptance?.blobs??[]){const raw=Buffer.from(b.gzipBase64,'base64');assert.equal(hash(raw),b.gzipSha256);const plain=gunzipSync(raw);assert.equal(plain.length,b.bytes);assert.equal(hash(plain),b.sha256);delete b.gzipBase64;b.path=b.key+'.bin.gz';fs.writeFileSync(path.resolve(options.output,b.path),raw);}
 fs.writeFileSync(path.resolve(options.output,'report.json'),JSON.stringify(report,null,2)+'\n');process.exit(report.status==='passed'?0:1);
}
