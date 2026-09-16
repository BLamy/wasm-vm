// Independent CLI preflight attacks; every case must fail before output/browser setup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(out,'../../..');
const results=[];
for (const [name,mode,overrides] of [
  ['cost-outside-input-trial','capture',{OMARCHY_WORKER_COST:'1'}],
  ['cost-control-arm','input-trial',{OMARCHY_WORKER_COST:'1',OMARCHY_INPUT_TRIAL_ARM:'control',OMARCHY_INPUT_TRIAL_EXPERIMENT:'residency',OMARCHY_CANDIDATE_PAIR_DIR:'pinned',OMARCHY_CANDIDATE_CHUNKS:'pinned'}],
  ['cost-recycling-arm','input-trial',{OMARCHY_WORKER_COST:'1',OMARCHY_INPUT_TRIAL_ARM:'candidate',OMARCHY_CANDIDATE_PAIR_DIR:'pinned',OMARCHY_CANDIDATE_CHUNKS:'pinned'}],
]) {
  const target=path.join(out,`never-created-${name}`);
  assert.equal(fs.existsSync(target),false);
  const env={...process.env,DEVELOPER_DIR:'/Library/Developer/CommandLineTools'};
  for (const k of Object.keys(env)) if(k.startsWith('OMARCHY_')) delete env[k];
  Object.assign(env,overrides);
  const r=spawnSync(process.execPath,['tools/verify/omarchy-desktop-live.mjs','local',target,mode],{cwd:repo,env,encoding:'utf8',timeout:10000});
  assert.notEqual(r.status,0);assert.equal(r.signal,null);assert.equal(r.error,undefined);
  assert.match(r.stderr,/worker cost requires the fixed residency candidate input trial/);
  assert.equal(fs.existsSync(target),false);
  results.push({name,status:r.status,assertion:'worker cost requires the fixed residency candidate input trial',outputCreated:false,browserStarted:false});
}
fs.writeFileSync(path.join(out,'preflight-checks.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
