// Read the actual frozen browser record and execute only the orchestrator's pure assertions.
// Never import the whole orchestrator: its top level spawns browser runs and writes evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./e5-t26f-residency-comparison.mjs", import.meta.url), "utf8");
const recorded = JSON.parse(readFileSync(new URL(
  "../../evidence/e5-t26f/residency/1-repack-off/failure-post-restore-interaction-checks.json", import.meta.url), "utf8"));

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing orchestration boundary: ${startMarker}`);
  return source.slice(start, end);
}

const counterScript = new vm.Script(`(() => {
  ${extract("  const deltas = {};", "  assert.equal(m.postRestoreStart,")}
  return deltas;
})()`);
const admissionScript = new vm.Script(`(() => {
  ${extract("  if (child.code !== 0) {", "  assert.equal(m.run.acceptance,")}
  return true;
})()`);

function samples() {
  return structuredClone({ before: recorded.milestones.jitBefore, after: recorded.milestones.jitAfter });
}

function counterDeltas(input = samples()) {
  return { ...counterScript.runInNewContext({ assert, ...input }, { timeout: 100 }) };
}

// Independent arithmetic from the frozen record, not generated from the extracted loop.
const expected = {
  guestRetired: 46_479_799,
  retiredViaJit: 16_829_172,
  "entryCost.hostEntries": 1_154_427,
  directChainEntries: 2_967_618,
  blockEntryHits: 5_110_768,
  blockBuilds: 658_331,
  jitCacheInstalls: 476,
  jitCacheRetranslations: 128,
  jitCacheEvictions: 84,
  decodedBlocksDiscarded: 0,
  decodedCacheFlushes: 0,
};

function setCounter(sample, key, value) {
  if (key === "entryCost.hostEntries") sample.state.entryCost.hostEntries = value;
  else sample.state[key] = value;
}

test("actual frozen browser counters produce exact within-run deltas, including nested host entries", () => {
  assert.equal(recorded.head, "de9c9feae6e20dd906145fb5fab3913666b18f8a");
  assert.equal(recorded.milestones.jitBefore.state.entryCost.hostEntries, 159_470);
  assert.equal(recorded.milestones.jitAfter.state.entryCost.hostEntries, 1_313_897);
  assert.equal(Object.hasOwn(recorded.milestones.jitBefore.state, "hostEntries"), false);
  assert.equal(Object.hasOwn(recorded.milestones.jitAfter.state, "hostEntries"), false);
  assert.deepEqual(counterDeltas(), expected);
});

test("nested host entries are authoritative and missing nested data cannot fall back to fabricated flat values", () => {
  const valid = samples();
  for (const sample of [valid.before, valid.after]) {
    for (const key of ["hostEntries", "entryCost.hostEntries"]) {
      Object.defineProperty(sample.state, key, { get() { throw Error("fabricated flat counter read"); } });
    }
  }
  assert.deepEqual(counterDeltas(valid), expected);
  for (const endpoint of ["before", "after"]) for (const missing of ["member", "parent"]) {
    const input = samples();
    for (const [index, sample] of [input.before, input.after].entries()) {
      sample.state.hostEntries = 10 + index;
      sample.state["entryCost.hostEntries"] = 10 + index;
    }
    if (missing === "parent") delete input[endpoint].state.entryCost;
    else delete input[endpoint].state.entryCost.hostEntries;
    assert.throws(() => counterDeltas(input), /entryCost.hostEntries/);
  }
});

test("every counter rejects missing, nonnumeric, fractional, negative or unsafe endpoint values", () => {
  for (const key of Object.keys(expected)) for (const endpoint of ["before", "after"]) {
    for (const value of [undefined, null, "1", false, {}, 1n, NaN, Infinity, -Infinity, 0.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const input = samples();
      setCounter(input[endpoint], key, value);
      assert.throws(() => counterDeltas(input), (error) => error.code === "ERR_ASSERTION" && error.message.includes(key),
        `${endpoint}.${key} must reject ${String(value)}`);
    }
  }
});

test("every counter rejects decreasing safe nonnegative values", () => {
  for (const key of Object.keys(expected)) {
    const input = samples();
    setCounter(input.before, key, 17);
    setCounter(input.after, key, 16);
    assert.throws(() => counterDeltas(input), (error) => error.message.includes(`${key} regressed`));
  }
});

test("zero deltas are valid except guestRetired and retiredViaJit, which must each advance", () => {
  const input = samples();
  for (const key of Object.keys(expected)) {
    setCounter(input.before, key, 0);
    setCounter(input.after, key, key === "guestRetired" || key === "retiredViaJit" ? 1 : 0);
  }
  const deltas = counterDeltas(input);
  assert.deepEqual(deltas, Object.fromEntries(Object.keys(expected).map(key =>
    [key, key === "guestRetired" || key === "retiredViaJit" ? 1 : 0])));
  for (const key of ["guestRetired", "retiredViaJit"]) {
    const stale = samples();
    setCounter(stale.after, key, stale.before.state[key]);
    assert.throws(() => counterDeltas(stale), (error) => error.code === "ERR_ASSERTION");
  }
});

test("child-failure admission allows only exit 1 with the exact F timing-cap message", () => {
  const admit = (code, record) => admissionScript.runInNewContext({ assert, child: { code }, record }, { timeout: 100 });
  assert.equal(admit(1, recorded), true);
  // Exit 0 skips this failure-only block; downstream functional assertions still apply.
  assert.equal(admit(0, {}), true);
  for (const code of [2, -1, null, undefined, "1", "0", NaN]) {
    assert.throws(() => admit(code, recorded), (error) => error.code === "ERR_ASSERTION");
  }
  const exact = "post-restore interaction exceeded 2 seconds";
  for (const record of [{}, { error: null }, { error: {} },
    ...["", "cursor missing", "post-restore aplay wrote no guest PCM", exact + " ", "prefix " + exact,
      exact.replace("2", "3")].map(message => ({ error: { message } }))]) {
    assert.throws(() => admit(1, record), /a different failure is not a completed residency comparison/);
  }
});
