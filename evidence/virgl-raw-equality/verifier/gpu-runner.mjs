import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {browserOptions,browserDocument,runVirglBrowser} from '../../../tools/lib/virgl-browser-runner.mjs';
const module='evidence/virgl-raw-equality/verifier/gpu-attack.mjs',raw=fs.readFileSync(module);
const options=browserOptions();
await runVirglBrowser({options,task:'E6-T12f1',boundary:'Fresh independent seeded raw equality, unknown self comparisons and source aliases',modulePath:'/'+module,windowReportKey:'__freshRawEqualityReport',servedFiles:[module],pinnedFiles:[{path:module,sha256:crypto.createHash('sha256').update(raw).digest('hex'),size:raw.length}],coveragePaths:[module],html:browserDocument({title:'Fresh raw equality critic',heading:'Independent equality attack',description:'Raw encodings under four independent seeds and both source aliases'}),validate(result){assert.equal(result.checkedWords,2112);assert.equal(result.kernels.length,16);},successMessage:r=>`Fresh equality critic passed ${r.checkedWords} physical GPU words.`});
