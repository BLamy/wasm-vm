// Independent read-only source/evidence binding for E5.5-T03t.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditSerial } from "../../../tools/verify/omarchy-latency-receipt.mjs";
import { evdevForCode } from "../../../web/src/input/keymap.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const root = path.join(repo, "evidence/omarchy-profile/fp-moves-r1");
const read = file => fs.readFileSync(file);
const json = file => JSON.parse(read(file));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const identity = file => ({ size: fs.statSync(file).size, sha256: sha(read(file)) });
const git = args => execFileSync("git", args, { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
const runtimeHead = "c7a3c38b84d462eba585c9f7081c70c88cdd2534";
const wasm = "55557d7a158bb274d214692a76a2a876bbe56ecd7798cbc9adfcbb4bfc9a0c40";
const runtime = ["crates/core/src/hart/fregs.rs", "crates/core/src/jit.rs", "crates/core/src/lib.rs",
  "crates/jit-translate/src/lib.rs", "crates/jit-runtime/src/lib.rs", "crates/wasm/src/jit_browser.rs"];
assert.equal(git(["diff", runtimeHead, "HEAD", "--", ...runtime]).length, 0);
assert.equal(git(["diff", "HEAD", "--", ...runtime]).length, 0);
const stripAdmissionTest = bytes => {
  const source = bytes.toString();
  const begin = source.indexOf("#[cfg(test)]\nmod admission_probe_tests {");
  const end = source.indexOf("\nfn jit_stats_object(", begin);
  assert.ok(begin > 0 && end > begin);
  return source.slice(0, begin) + source.slice(end);
};
assert.equal(stripAdmissionTest(read(path.join(repo, "crates/wasm/src/lib.rs"))),
  stripAdmissionTest(git(["show", `${runtimeHead}:crates/wasm/src/lib.rs`])));
assert.equal(sha(read(path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm"))), wasm);
const artifactFiles = [];
const browser = [];
for (const folder of ["browser", "browser-r2", "cold/browser"]) {
  const directory = path.join(root, folder), reportPath = path.join(directory, "report.json");
  const report = json(reportPath), [interpreted, compiled] = report.runs;
  assert.equal(report.wasmSha256, wasm);
  assert.deepEqual(report.errors, []);
  assert.equal(report.passed, true);
  assert.deepEqual(report.suite, { "metric-pass": "127", "metric-fail": "0", "metric-done": "127" });
  assert.equal(interpreted.stats.retired, 4000);
  assert.equal(compiled.stats.retired, 4000);
  assert.equal(compiled.jitStats.retiredViaJit, 3639);
  assert.equal(compiled.jitStats.directChainLinks, 884);
  assert.equal(compiled.digest, "2292761e0dadbc7ba225714d941fed3c585352ccd3b6912882818ae22b213661");
  assert.deepEqual(compiled.registers, interpreted.registers);
  assert.equal(compiled.digest, interpreted.digest);
  const files = [["fp-moves.elf", report.elfSha256], ["built-page.png", report.screenshotSha256]];
  if (report.suiteScreenshotSha256) files.push(["suite.png", report.suiteScreenshotSha256],
    ["capability-inspection.png", report.capabilityInspection.sha256]);
  for (const [filename, expected] of files) {
    const file = path.join(directory, filename);
    assert.equal(sha(read(file)), expected);
    artifactFiles.push({ path: path.relative(repo, file), ...identity(file) });
  }
  artifactFiles.push({ path: path.relative(repo, reportPath), ...identity(reportPath) });
  browser.push({ folder, head: report.head, retired: compiled.stats.retired,
    jitRetired: compiled.jitStats.retiredViaJit, directChainLinks: compiled.jitStats.directChainLinks,
    digest: compiled.digest, suite: report.suite, capability: report.capability });
}
const cold = json(path.join(root, "cold/report.json"));
assert.equal(cold.head, "b4b7c70da8b28a274cfd53860a6723480deee7ff");
assert.equal(cold.passed, true);
assert.equal(cold.pristineBeforeBuild, true);
assert.equal(cold.committedWasmSha256, wasm);
assert.equal(cold.rebuiltWasmSha256, wasm);
assert.ok(cold.commands.length === 4 && cold.commands.every(command => command.code === 0));
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {cwd: cold.clone, encoding: "utf8"}).trim(), cold.head);
for (const filename of runtime) {
  assert.equal(sha(read(path.join(cold.clone, filename))), sha(git(["show", `${runtimeHead}:${filename}`])));
}
assert.equal(sha(read(path.join(cold.clone, "web/dist/pkg/wasm_vm_wasm_bg.wasm"))), wasm);
const coldLog = read(path.join(root, "cold/acceptance.log")).toString();
assert.match(coldLog, /CRITIC_CASES cases=3840 disabled=960 state_fnv64=ba4ecacfdc4b9707/);
assert.match(coldLog, /FP_MOVES cases=1984 guest_state_fnv64=dc6031f4c37c7ec3/);
const published = json(path.join(root, "cloudflare-public.json"));
assert.equal(published.length, 5);
for (const entry of published) {
  assert.equal(entry.status, 200);
  const filename = path.join(repo, "web/dist", new URL(entry.url).pathname);
  assert.equal(entry.sha256, sha(read(filename)));
  assert.equal(entry.size, fs.statSync(filename).size);
}
for (const file of ["cold/report.json", "cold/runner.py", "cold/acceptance.log", "cold/build.log", "cloudflare-public.json", "cloudflare-deploy.log", "old-bundle-negative-control/report.json"]) {
  const filename = path.join(root, file);
  artifactFiles.push({path: path.relative(repo, filename), ...identity(filename)});
}
const negative = json(path.join(root, "old-bundle-negative-control/report.json"));
assert.equal(negative.head, "ecb958dc95a3800cd858bac0a09237a25ef536ba");
assert.equal(negative.passed, false);
assert.equal(negative.runs[1].jitStats.retiredViaJit, 441);
assert.deepEqual(negative.errors, []);
assert.equal(negative.runs[0].digest, negative.runs[1].digest);
assert.match(negative.failure, /mixed FP loop itself must compile/);
const performance = json(path.join(root, "perf-comparison.json"));
assert.deepEqual(performance.runs.map(run => run.label), ["baseline", "candidate", "candidate", "baseline"]);
assert.deepEqual(performance.runs.map(run => run.medianMips), [26, 25.7, 25.8, 25.4]);
const binaryDigests = new Map();
for (const run of performance.runs) {
  assert.equal(run.exitCode, 0);
  assert.ok(run.medianMips >= 15);
  if (!binaryDigests.has(run.binary)) binaryDigests.set(run.binary, sha(read(run.binary)));
  assert.equal(run.binarySha256, binaryDigests.get(run.binary));
  const log = path.join(root, run.log);
  assert.match(read(log).toString(), /test result: ok\. 1 passed; 0 failed/);
  artifactFiles.push({path: path.relative(repo, log), ...identity(log)});
}
const admissionLog = path.join(root, "admission-fixture.log");
assert.match(read(admissionLog).toString(), /admission_probe_real_translator_integer_fp_move_arithmetic_and_csr_contrasts \.\.\. ok/);
for (const file of ["perf-comparison.json", "perf-compare.py", "admission-fixture.log", "admission-fixture-format.log", "native-remaining.log"]) {
  const filename = path.join(root, file);
  artifactFiles.push({path: path.relative(repo, filename), ...identity(filename)});
}
const physicalDirectory = path.join(root, "physical-input-r2");
const report = json(path.join(physicalDirectory, "desktop/report.json"));
const run = json(path.join(physicalDirectory, "run.json"));
assert.equal(run.wasmSha256, wasm);
assert.equal(report.trial.head, run.head);
assert.equal(report.result, "failed");
assert.equal(report.trial.outcome, "nonce-readback-failed");
assert.equal(report.keyboard.verified, false);
assert.equal(report.keyboard.deadlineMs, 120000);
assert.equal(report.trial.readbackMs, 120000);
assert.equal(Date.parse(report.keyboard.deadlineAt) - report.keyboard.enteredAtMs, 120000);
assert.equal(report.keyboard.failedAt, report.keyboard.deadlineAt);
assert.equal(report.cleanup.closed, true);
assert.deepEqual(run.exit, { code: 1, signal: null, closed: true, watchdog: null });
assert.deepEqual(report.errors, []);
assert.equal(report.observations.find(row => row.layout)?.layout.e2eShowall, false);
assert.equal(report.trial.scopedStatus, "");
const helpers = [];
for (const [filename, expected] of Object.entries(report.trial.helpers)) {
  const bytes = git(["show", `${run.head}:${filename}`]);
  assert.equal(bytes.length, expected.size);
  assert.equal(sha(bytes), expected.sha256);
  helpers.push(filename);
}
for (const [filename, observed] of Object.entries(report.identities.files)) {
  if (filename === "artifacts-omarchy.json") continue; // Explicit local candidate manifest below.
  const bytes = git(["show", `${run.head}:web/dist/${filename}`]);
  assert.equal(bytes.length, observed.size);
  assert.equal(sha(bytes), observed.sha256);
}
const expectedManifest = "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44";
assert.equal(report.loaderIdentity.rawSha256, expectedManifest);
assert.equal(report.loaderIdentity.baseBinding, expectedManifest);
const sourceArtifacts = [];
for (const name of ["chunkManifest", "kernel", "bootSnapshot", "overlayDelta"]) {
  const source = report.candidate.source[name], actual = identity(source.filename);
  assert.equal(actual.size, source.size);
  assert.equal(actual.sha256, source.sha256);
  sourceArtifacts.push({ name, ...actual });
}
const events = report.inputEvents;
assert.equal(events.length, 128);
assert.ok(events.every(event => event.trusted && event.target === "ide-display-canvas" && !event.repeat));
const text = events.filter(event => event.type === "keydown").map(event =>
  event.key.length === 1 ? event.key : event.key === "Enter" ? "\n" : "").join("");
assert.equal(text, `printf '${report.keyboard.nonce}' > ${report.keyboard.guestFile}\n`);
const keyCalls = report.workerTraffic.filter(row => row.type === "worker-call" && row.method === "sendKeyboardEvent");
assert.equal(keyCalls.length, events.length);
for (let i = 0; i < events.length; i++) {
  assert.deepEqual(keyCalls[i].args, [1, evdevForCode(events[i].code), events[i].type === "keydown" ? 1 : 0]);
}
const acknowledgements = report.workerTraffic.filter(row => row.type === "input-result" &&
  ["sendKeyboardEvent", "syncKeyboard"].includes(row.method));
assert.equal(acknowledgements.length, 256);
assert.ok(acknowledgements.every(row => row.result === true && row.error === null));
const serialBytes = Buffer.concat(report.workerTraffic.filter(row => row.type === "serial-input").map(row => Buffer.from(row.bytes)));
assert.ok(!serialBytes.includes(report.keyboard.nonce), "nonce appeared on serial input");
const serial = auditSerial(report.workerTraffic, report.serialCommands.map(row => row.command));
assert.deepEqual(serial, run.audit.serial);
const readbacks = serial.filter(row => row.command.includes(report.keyboard.guestFile));
assert.equal(readbacks.length, 14);
assert.equal(readbacks.filter(row => row.response?.exit === 75).length, 13);
assert.equal(readbacks.filter(row => row.response === null).length, 1);
for (const file of ["run.json", "desktop/report.json", "desktop/serial.log", "desktop/failure.png"]) {
  const filename = path.join(physicalDirectory, file);
  artifactFiles.push({ path: path.relative(repo, filename), ...identity(filename) });
}
const receipt = { runtimeHead, auditHead: git(["rev-parse", "HEAD"]).toString().trim(), wasm,
  browser, cold: {head: cold.head, pristineBeforeBuild: true, rebuiltWasm: wasm, passed: true}, published,
  performance: {host: performance.host, order: performance.runs.map(run => run.label),
    mips: performance.runs.map(run => run.medianMips), floor: 15, allPassed: true},
  negativeControl: {head: negative.head, passed: false, jitRetired: 441, correctGuestState: true},
  helpersVerified: helpers, sourceArtifacts,
  physical: { head: run.head, trustedTransitions: events.length, acknowledgements: acknowledgements.length,
    typedText: text, serialNonceAbsent: true, readbacksCompletedAbsent: 13, readbacksIncomplete: 1,
    enteredAt: report.keyboard.typedAt, failedAt: report.keyboard.failedAt, deadlineMs: 120000,
    desktopAcceptance: false, manifestSha256: expectedManifest }, artifactFiles };
fs.writeFileSync(path.join(repo, "evidence/omarchy-profile/fp-moves-critic/artifact-audit.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ runtimeHead, wasm, browserRuns: browser.length, helpersVerified: helpers.length,
  physical: receipt.physical, artifactDigests: artifactFiles.length }, null, 2));
