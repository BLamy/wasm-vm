// Retain raw CLI output and small artifacts; never copy the 1-GiB images into evidence.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256File, BASE, HELPER } from "../../../tools/verify/e5-t26f-resident-image.mjs";

const evidence = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidence, "../../..");
process.chdir(repo);
const label = process.argv[2];
assert.ok(["a", "b"].includes(label), "use a or b; records cannot be overwritten");
const output = `target/e5-t26f/resident-image-2ae65408-${label}`;
const capture = path.join(evidence, label);
await fs.mkdir(capture); // exclusive: refuse retries over a retained recording
const log = await fs.open(path.join(evidence, `${label}.log`), "wx");
const sourceState = async () => ({ head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  baseSha256: await sha256File(BASE), helperSha256: await sha256File(HELPER),
  builderSha256: await sha256File("tools/verify/e5-t26f-resident-image.mjs") });
const before = await sourceState();
const args = ["tools/verify/e5-t26f-resident-image.mjs", "--out", output, "--helper-sha256",
  "2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c"];
const startedAt = new Date().toISOString();
const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
let writes = Promise.resolve();
for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => {
  process.stdout.write(bytes);
  writes = writes.then(() => log.write(bytes));
});
const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
await writes;
await log.close();
const finishedAt = new Date().toISOString();
const after = await sourceState();
const artifacts = [];
for (const name of await fs.readdir(output).catch(error => { if (error.code === "ENOENT") return []; throw error; })) {
  if (name === "alpine-rootfs.ext4") continue;
  const source = path.join(output, name), stat = await fs.lstat(source);
  assert.ok(stat.isFile() && stat.size <= 1024 * 1024, `unexpected artifact: ${source}`);
  await fs.copyFile(source, path.join(capture, name), (await import("node:fs")).constants.COPYFILE_EXCL);
  artifacts.push({ name, size: stat.size, sha256: await sha256File(source) });
}
const record = { schema: "wasm-vm.e5-t26f.resident-image-build.v1", acceptance: false,
  command: [process.execPath, ...args], startedAt, finishedAt, ...result, before, after, artifacts };
await fs.writeFile(path.join(capture, "record.json"), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
assert.deepEqual(after, before, "source/head changed during build; inspect before accepting this recording");
process.exitCode = result.code ?? 1;
