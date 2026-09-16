// Recheck the R1 protocol violation against the corrected guard, without a guest.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {auditWorkerCostInput} from '../../../tools/verify/omarchy-worker-cost-capture.mjs';
const out=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(out,'../../..');
const source=path.join(repo,'tools/verify/omarchy-worker-cost-capture.mjs');
const rawPath=path.join(repo,'evidence/omarchy-profile/worker-cost-r1/desktop/report.json');
const bytes=fs.readFileSync(rawPath),raw=JSON.parse(bytes),copy=structuredClone(raw);
const sha=data=>createHash('sha256').update(data).digest('hex');
// Grant the copy synthetic, valid-looking fence metadata so rejection must find
// the actual tablet traffic, rather than simply notice R1 has no fence receipt.
copy.workerCostInputFence={method:'Input.setIgnoreInputEvents',ignore:true,
  startedAt:copy.keyboard.typedAt,acknowledgedAt:new Date(copy.keyboard.enteredAtMs+1).toISOString()};
let rejection;
try{auditWorkerCostInput(copy);}catch(error){rejection=String(error);}
assert.match(rejection,/non-observational worker RPC after verdict: sendTabletEvent/);
assert.equal(sha(fs.readFileSync(rawPath)),sha(bytes));
const result={checkedAt:new Date().toISOString(),originalReportSha256:sha(bytes),guardSourceSha256:sha(fs.readFileSync(source)),
  syntheticMetadataOnly:true,actualRawTrafficPreserved:true,rejection,expectedRejection:'sendTabletEvent after fixed verdict',
  guestRerun:false,originalFileUnchanged:true};
fs.writeFileSync(path.join(out,'r1-input-replay-attack.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
