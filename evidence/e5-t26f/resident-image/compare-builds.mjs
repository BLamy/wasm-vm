// Read-only checks of the actual images and retained artifacts; only the report/log are written.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { sha256File, BASE, BASE_SHA256, BASE_SIZE, HELPER, GUEST_PATH } from "../../../tools/verify/e5-t26f-resident-image.mjs";
const exec = promisify(execFile);
const evidence = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(evidence, "../../.."));
const expectedHelper = "2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c";
const builds = [];
for (const label of ["a", "b"]) {
  const recordPath = path.join(evidence, label, "record.json");
  const record = JSON.parse(await fs.readFile(recordPath));
  assert.equal(record.code, 0);
  assert.equal(record.signal, null);
  assert.deepEqual(record.before, record.after);
  assert.equal(record.before.baseSha256, BASE_SHA256);
  assert.equal(record.before.helperSha256, expectedHelper);
  const infoPath = `target/e5-t26f/resident-image-2ae65408-${label}/desktop-info.json`;
  const info = JSON.parse(await fs.readFile(infoPath));
  const sha256 = await sha256File(info.image.path), size = (await fs.stat(info.image.path)).size;
  assert.equal(sha256, info.image.sha256);
  assert.equal(size, BASE_SIZE);
  const helperReadback = await fs.readFile(path.join(evidence, label, "resident-readback.sh"));
  assert.deepEqual(helperReadback, await fs.readFile(HELPER));
  assert.equal(await sha256File(path.join(evidence, label, "resident-readback.sh")), expectedHelper);
  for (const artifact of record.artifacts) {
    const filename = path.join(evidence, label, artifact.name);
    assert.equal(await sha256File(filename), artifact.sha256);
    assert.equal((await fs.stat(filename)).size, artifact.size);
  }
  assert.deepEqual(await fs.readFile(info.packageManifest.path), await fs.readFile(path.join(path.dirname(BASE), "MANIFEST.txt")));
  assert.deepEqual(await fs.readFile(info.fileManifest.path), Buffer.concat([
    await fs.readFile(path.join(path.dirname(BASE), "FILE-MANIFEST.txt")), Buffer.from(`${expectedHelper} 0444 ${GUEST_PATH}\n`) ]));
  builds.push({ label, image: { ...info.image, sha256, size }, fixture: info.fixture,
    packageManifestSha256: info.packageManifest.sha256, fileManifestSha256: info.fileManifest.sha256,
    metadataSha256: await sha256File(infoPath), recordSha256: await sha256File(recordPath),
    logSha256: await sha256File(path.join(evidence, `${label}.log`)), exitCode: record.code });
}
assert.equal(builds[0].image.sha256, builds[1].image.sha256);
assert.deepEqual(builds[0].fixture, builds[1].fixture);
const cmp = await exec("cmp", builds.map(build => build.image.path));
assert.equal(cmp.stdout + cmp.stderr, "");
const baseAfterSha256 = await sha256File(BASE), helperAfterSha256 = await sha256File(HELPER);
assert.equal(baseAfterSha256, BASE_SHA256);
assert.equal(helperAfterSha256, expectedHelper);
const tests = await exec(process.execPath, ["--test", "tools/verify/e5-t26f-resident-image.test.mjs"]);
await fs.writeFile(path.join(evidence, "tests.log"), tests.stdout + tests.stderr, { flag: "wx" });
const comparison = { schema: "wasm-vm.e5-t26f.resident-image-comparison.v1", acceptance: false,
  checkedAt: new Date().toISOString(), claims: "Offline image construction/reproducibility only; no guest playback or browser claim.",
  builds, imageBytesEqual: true, cmpExitCode: 0, baseAfterSha256, helperAfterSha256,
  tests: { command: "node --test tools/verify/e5-t26f-resident-image.test.mjs", exitCode: 0,
    logSha256: await sha256File(path.join(evidence, "tests.log")) } };
await fs.writeFile(path.join(evidence, "comparison.json"), `${JSON.stringify(comparison, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(comparison, null, 2));
