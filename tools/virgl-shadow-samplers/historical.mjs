#!/usr/bin/env node
// Compare existing public results against actual authenticated predecessor modules.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as decoder from '../../renderer/virgl-command/decoder.mjs';
import * as metadata from '../../renderer/virgl-command/constant-domain.mjs';
import * as state from '../../renderer/virgl-command/state.mjs';
import {createVirglStandardInstanceBaseShaderBridge,createVirglStandardShadowTextureShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
import {cases,fixture,setup,view,draw} from './fixtures.mjs';

const output=path.resolve(process.argv[2]),hash=raw=>createHash('sha256').update(raw).digest('hex');
const authentication=JSON.parse(await fs.readFile(path.join(output,'authentication.json'))),rows=[];
assert.equal(authentication.status,'passed');for(const [name,digest]of Object.entries(authentication.historical))assert.equal(hash(await fs.readFile(path.join(output,'historical',name))),digest);
const old={};for(const name of ['decoder','constant-domain','state'])old[name]=await import(pathToFileURL(path.join(output,'historical/renderer/virgl-command',name+'.mjs')));
const inputs=[null,{},new Uint8Array(0),new Uint8Array(3)];for(const spec of cases({smoke:true})){const f=fixture(spec);inputs.push(setup(f),view(f),view(f,{mode:0}),draw(f));}
for(const [name,invoke]of Object.entries(old.decoder).filter(([name,v])=>name.startsWith('decode')&&typeof v==='function'))for(const [i,bytes]of inputs.entries()){
 const original=invoke(bytes),observed=decoder[name](bytes);assert.deepEqual(observed,original);rows.push({kind:'historical-decoder',name,input:i,original,observed});
}
const bridge=await createVirglStandardInstanceBaseShaderBridge(),shadow=await createVirglStandardShadowTextureShaderBridge();
const functions=['parseStandardInstanceBaseShaderMetadata','normalizeStandardInstanceBaseShaderResult','normalizeStandardInstanceBaseShaderPair','deriveStandardInstanceBaseShaderInterface'];
for(const owner of ['vertex','fragment']){
 const f=fixture(cases({smoke:true}).find(f=>f.stage===owner));
 const simple=owner==='vertex'?'VERT\nDCL OUT[0], POSITION\n0: END\n':'FRAG\nDCL OUT[0], COLOR\n0: END\n';
 for(const response of [bridge.translate({stage:owner,text:simple}),shadow.translate({stage:owner,text:owner==='vertex'?f.vertexText:f.fragmentText})])for(const name of functions){
  const args=name.startsWith('parse')?[response.metadata,owner]:name.endsWith('Result')?[response,owner]:name.endsWith('Pair')?[response]:[response.metadata,response.metadata];
  const original=old['constant-domain'][name](...args),observed=metadata[name](...args);assert.deepEqual(observed,original);rows.push({kind:'historical-metadata',name,owner,args,original,observed});
 }
}
for(const [name,invoke]of Object.entries(old.state).filter(([name,v])=>name.startsWith('createVirgl')&&typeof v==='function')){
 const original=invoke({}),observed=state[name]({});assert.deepEqual(observed,original);rows.push({kind:'historical-factory-invalid-options',name,original,observed});
}
const result={status:'passed',predecessor:authentication.predecessor,historicalSourceSha256:authentication.historical,rows,byteIdenticalHistoricalPublicResults:true,validFactoryRuntimeCarriedByUnchangedFalseSelectorOperands:true};await fs.writeFile(path.join(output,'historical-audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({historicalRows:rows.length}));
