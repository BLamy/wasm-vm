// E4-T22 — deterministic node unit tests for the CPU-backend selection (no browser).
// Run: node --test web/tests/cpu-isolation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  selectCpuBackend,
  probeIsolation,
  chooseCpuBackend,
  BACKEND_WORKER_SHARED,
  BACKEND_SINGLE_THREAD,
} from "../cpu-isolation.js";

const isolated = {
  crossOriginIsolated: true,
  hasSharedArrayBuffer: true,
  hasAtomics: true,
  hasWorker: true,
};

test("isolated context selects the shared worker backend", () => {
  const r = selectCpuBackend(isolated);
  assert.equal(r.backend, BACKEND_WORKER_SHARED);
  assert.equal(r.shared, true);
  assert.equal(r.wasmVariant, "shared");
});

test("NOT cross-origin isolated → single-thread fallback (the COOP/COEP-missing case)", () => {
  const r = selectCpuBackend({ ...isolated, crossOriginIsolated: false });
  assert.equal(r.backend, BACKEND_SINGLE_THREAD);
  assert.equal(r.shared, false);
  assert.equal(r.wasmVariant, "fallback");
  assert.match(r.reason, /COOP\/COEP/);
});

test("isolated but SharedArrayBuffer absent → fallback (no half-init)", () => {
  const r = selectCpuBackend({ ...isolated, hasSharedArrayBuffer: false });
  assert.equal(r.backend, BACKEND_SINGLE_THREAD);
  assert.match(r.reason, /SharedArrayBuffer/);
});

test("isolated but no Atomics → fallback (cannot park on WFI)", () => {
  const r = selectCpuBackend({ ...isolated, hasAtomics: false });
  assert.equal(r.backend, BACKEND_SINGLE_THREAD);
  assert.match(r.reason, /Atomics/);
});

test("no Worker constructor (worker-less context) → fallback", () => {
  const r = selectCpuBackend({ ...isolated, hasWorker: false });
  assert.equal(r.backend, BACKEND_SINGLE_THREAD);
});

test("explicit forceSingleThread override wins even when fully isolated", () => {
  const r = selectCpuBackend({ ...isolated, forceSingleThread: true });
  assert.equal(r.backend, BACKEND_SINGLE_THREAD);
  assert.match(r.reason, /forced/);
});

test("empty/undefined env is safe → fallback, never throws", () => {
  assert.equal(selectCpuBackend(undefined).backend, BACKEND_SINGLE_THREAD);
  assert.equal(selectCpuBackend({}).backend, BACKEND_SINGLE_THREAD);
});

test("probeIsolation reads live globals (node: SAB+Atomics present, no Worker/isolation)", () => {
  const snap = probeIsolation();
  assert.equal(typeof snap.crossOriginIsolated, "boolean");
  assert.equal(snap.hasSharedArrayBuffer, typeof SharedArrayBuffer !== "undefined");
  assert.equal(snap.hasAtomics, typeof Atomics !== "undefined");
});

test("probeIsolation honours ?singlethread=1", () => {
  const g = { location: { search: "?foo=1&singlethread=1" }, SharedArrayBuffer, Atomics };
  assert.equal(probeIsolation(g).forceSingleThread, true);
  assert.equal(probeIsolation({ location: { search: "?x=2" } }).forceSingleThread, false);
});

test("chooseCpuBackend warns exactly once on fallback", () => {
  const warnings = [];
  const g = { console: { warn: (m) => warnings.push(m) } }; // no isolation, no SAB
  const r = chooseCpuBackend(g);
  assert.equal(r.backend, BACKEND_SINGLE_THREAD);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /single-threaded fallback/);
});

test("chooseCpuBackend does not warn when the shared backend is selected", () => {
  const warnings = [];
  const g = {
    crossOriginIsolated: true,
    SharedArrayBuffer,
    Atomics,
    Worker: function () {},
    console: { warn: (m) => warnings.push(m) },
  };
  const r = chooseCpuBackend(g);
  assert.equal(r.backend, BACKEND_WORKER_SHARED);
  assert.equal(warnings.length, 0);
});
