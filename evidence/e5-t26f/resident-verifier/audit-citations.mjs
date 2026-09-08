// Mechanical report citation check; never reads the pending browser run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(out, '../../..');
const report = await fs.readFile(path.join(out, 'results.md'), 'utf8');
const rows = [...report.matchAll(/^\| `([^`]+)`[^\n]*\| `([0-9a-f]{64})` \|$/gm)];
assert.equal(rows.length, 9);
const checked = [];
for (const [, file, expected] of rows) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path.join(repo, file))) hash.update(bytes);
  const actual = hash.digest('hex'); assert.equal(actual, expected, file);
  checked.push({ file, sha256: actual });
}
const all = [...report.matchAll(/\b[0-9a-f]{64}\b/g)].map(m => m[0]);
assert.deepEqual(all.sort(), checked.map(x => x.sha256).sort(), 'uncatalogued report digest');
const result = { checked, reportSha256: createHash('sha256').update(report).digest('hex'), allReportDigestsChecked: true };
await fs.writeFile(path.join(out, 'citation-audit.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
