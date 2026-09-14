// Captured-real fixture: completed latency-boundary-r2 recording. Tests mutate only
// in-memory clones; mutation results are harness tests, not new guest/product proof.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateObservations } from "./omarchy-latency-receipt.mjs";
import { formatRpcCommand } from "../../web/guest-rpc.js";

const capturedReal = Object.fromEntries(["identities", "wire", "diagnostic"].map(name => [name,
  JSON.parse(readFileSync(new URL(`../../evidence/omarchy-profile/latency-boundary-r2/${name}.json`, import.meta.url), "utf8"))]));
const fixture = () => structuredClone(capturedReal);

test("captured-real R2: diagnostic observations and both raw process samples validate", () => {
  const result = validateObservations(fixture());
  assert.equal(result.kind, "diagnostic-only");
  assert.equal(result.desktopAcceptance, false);
  assert.equal(result.guestConsumptionProven, false);
  assert.equal(result.input.trueAcknowledgements, 4);
  assert.ok(result.input.observationMs >= 120000 && result.input.observationMs <= 180000);
  assert.equal(result.process.length, 2);
  assert.ok(result.process.every(sample => sample.status === "sampled"));
  assert.equal(result.process[1].deltas.available, true);
});

test("captured-real mutation: untrusted physical input is rejected", () => {
  const data = fixture(); data.wire.inputEvents[0].trusted = false;
  assert.throws(() => validateObservations(data));
});

test("captured-real mutation: changed actual clock is rejected", () => {
  const data = fixture(); data.identities.ready.clock.clockDiv = 1;
  assert.throws(() => validateObservations(data));
});

test("captured-real mutation: wrong R3 source hash is rejected", () => {
  const data = fixture();
  // Change all repeated claims together, so internal consistency cannot replace the pin.
  for (const row of data.diagnostic) {
    if (row.sourceReceipt) row.sourceReceipt.bootSnapshot.sha256 = "0".repeat(64);
  }
  assert.throws(() => validateObservations(data));
});

test("captured-real mutation: modified raw process output disagrees with the wire", () => {
  const data = fixture();
  const sample = data.diagnostic.find(row => row.request?.op === "process-sample" && row.result?.rpc?.raw);
  assert.ok(sample);
  assert.match(sample.result.rpc.raw.stdout, /Hyprland/u);
  sample.result.rpc.raw.stdout = sample.result.rpc.raw.stdout.replace("Hyprland", "imposter");
  assert.throws(() => validateObservations(data), /raw process|process raw|wire/iu);
});

test("captured-real mutation: extra explicit serial command is rejected", () => {
  const data = fixture(), last = data.wire.workerTraffic.at(-1);
  const ms = last.ms + 1;
  data.wire.workerTraffic.push({ type: "serial-input", worker: last.worker, sent: true, ms,
    timestamp: new Date(data.wire.timeOrigin + ms).toISOString(),
    bytes: [...Buffer.from(formatRpcCommand("touch /tmp/receipt-mutation", "receiptattack1"))] });
  assert.throws(() => validateObservations(data), /unapproved serial command/iu);
});
