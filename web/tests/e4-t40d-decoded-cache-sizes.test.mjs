// E4-T40d: 262144 joins the selectable decoded-cache sizes and becomes the Replay desktop's size.
// Host configuration only; the architectural equivalence across sizes is proven natively
// (tools/perf/turbo-equivalence.sh with CACHE_ENTRIES) and by the core/wasm capacity tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { applyDecodedCacheEntries, DECODED_CACHE_SIZES, validateDecodedCacheEntries } from "../decoded-cache.js";

const SIZES = [4096, 16384, 262144];
const invalid = [null, false, true, 0, -0, -1, 4095, 4097, 8192, 16383, 16385, 32768, 65536, 131072, 262143, 262145,
  262144.5, 524288, 1048576, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, 4096n, 262144n, [], [262144], {},
  new Number(262144), new String("262144"), "", " ", "65536", "0262144", "+262144", "262144.0", "2.62144e5",
  "0x40000", " 262144", "262144 ", "262144\n", "２６２１４４"];

function machineFixture(capacity) {
  const calls = [];
  let actual = capacity;
  const machine = {
    jitStats() { calls.push(["stats", actual]); return { decodedCacheEntries: actual }; },
    setDecodedCacheEntries(entries) { calls.push(["set", entries]); actual = entries; },
  };
  return { machine, calls, actual: () => actual, replace: (value) => { actual = value; } };
}

test("the selectable sizes are exactly 4096, 16384 and 262144, in core and in the loader", () => {
  assert.deepEqual([...DECODED_CACHE_SIZES], SIZES);
  assert.ok(Object.isFrozen(DECODED_CACHE_SIZES));
  const core = readFileSync(new URL("../../crates/core/src/lib.rs", import.meta.url), "utf8");
  const list = core.match(/^pub const DECODED_CACHE_SIZES: \[usize; 3\] = \[([0-9_, ]+)\];$/m)?.[1];
  assert.ok(list, "core DECODED_CACHE_SIZES not found");
  assert.deepEqual(list.split(",").map((item) => Number(item.trim().replaceAll("_", ""))), SIZES);
});

test("numbers and exact decimal strings of the three sizes validate; nothing else does", () => {
  assert.equal(validateDecodedCacheEntries(undefined), undefined);
  for (const size of SIZES) {
    assert.equal(validateDecodedCacheEntries(size), size);
    assert.equal(validateDecodedCacheEntries(String(size)), size);
  }
  const poison = { [Symbol.toPrimitive]() { assert.fail("must not coerce an option"); } };
  for (const value of [...invalid, poison, Symbol("262144")]) {
    assert.throws(() => validateDecodedCacheEntries(value), RangeError);
    assert.throws(() => applyDecodedCacheEntries(new Proxy({}, { get() { assert.fail("invalid option reached the machine"); } }), value), RangeError);
  }
});

test("every size pair: same size only reads, a change calls the setter once and verifies", () => {
  for (const before of SIZES) for (const after of SIZES) for (const request of [after, String(after)]) {
    const f = machineFixture(before);
    applyDecodedCacheEntries(f.machine, request);
    assert.deepEqual(f.calls, before === after ? [["stats", before]] : [["stats", before], ["set", after], ["stats", after]]);
    assert.equal(f.actual(), after);
    f.calls.length = 0;
    applyDecodedCacheEntries(f.machine, request);
    assert.deepEqual(f.calls, [["stats", after]], "a repeated selection must not resize");
  }
});

test("an unsupported actual capacity or a setter that did not take effect fails closed", () => {
  for (const value of [...invalid, undefined, "4096", "262144"]) {
    const f = machineFixture(4096); f.replace(value);
    assert.throws(() => applyDecodedCacheEntries(f.machine, 262144), /actual supported cache capacity/);
    assert.equal(f.calls.some(([kind]) => kind === "set"), false);
  }
  for (const after of [4096, 16384, "262144", undefined, null, NaN, 65536]) {
    const f = machineFixture(4096);
    f.machine.setDecodedCacheEntries = (value) => { f.calls.push(["set", value]); f.replace(after); };
    assert.throws(() => applyDecodedCacheEntries(f.machine, 262144), /did not reach the actual machine/);
    assert.equal(f.calls.filter(([kind]) => kind === "set").length, 1);
  }
});

test("the Replay desktop asks for 262144 and takes an explicit query value verbatim", () => {
  const main = readFileSync(new URL("../main.js", import.meta.url), "utf8");
  const body = main.slice(main.indexOf("function replayDesktopBootOptions("), main.indexOf("async function bootReplayDesktop("));
  assert.ok(body.length > 0, "replayDesktopBootOptions not found");
  const matches = [...body.matchAll(/^    decodedCacheEntries: (.+),$/gm)];
  assert.equal(matches.length, 1);
  const evaluate = (search) => vm.runInNewContext(matches[0][1], { URLSearchParams, location: { search } });
  assert.equal(evaluate(""), 262144);
  assert.equal(evaluate("?guest=replay-desktop&desktop=1"), 262144);
  assert.equal(validateDecodedCacheEntries(evaluate("")), 262144);
  for (const size of SIZES) {
    assert.equal(evaluate(`?decodedCacheEntries=${size}`), String(size));
    assert.equal(validateDecodedCacheEntries(evaluate(`?decodedCacheEntries=${size}`)), size);
  }
  // A malformed or unsupported query value is passed through untouched and then refused by
  // validation: the boot fails closed instead of silently running another size.
  for (const raw of ["65536", "", "262144.0", "0x40000"]) {
    assert.equal(evaluate(`?decodedCacheEntries=${encodeURIComponent(raw)}`), raw);
    assert.throws(() => validateDecodedCacheEntries(raw), RangeError);
  }
});
