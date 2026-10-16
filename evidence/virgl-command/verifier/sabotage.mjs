import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('./', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decoder = await fs.readFile(new URL('../../../renderer/virgl-command/decoder.mjs', root), 'utf8');
const needle = 'return { subContextId: p.u(1) };';
assert.equal(decoder.split(needle).length, 2);
const changed = decoder.replace(needle, 'return { subContextId: p.u(1) + 1 };');
const data = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const attacks = await fs.readFile(new URL('attacks.mjs', root), 'utf8');
const served = attacks.replace("'../../../renderer/virgl-command/decoder.mjs'", JSON.stringify(data(changed)));
let caught;
try { (await import(data(served))).runIndependent(); }
catch (error) { caught = error.message; }
assert.equal(caught, 'invalid-to-valid recovery', 'independent subcontext oracle must catch altered typed extraction');
const report = { status: 'passed', mode: 'typed-field-extraction', field: 'subContextId',
  mutation: '+1', originalSha256: sha(decoder), sabotagedSha256: sha(changed),
  observedFailure: caught, runtimeFilesModified: false };
await fs.writeFile(new URL('sabotage.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
