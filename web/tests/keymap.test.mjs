// E5-T12a — deterministic W3C physical-code → Linux evdev table and coverage oracle.
// Run from the repository root with: node --test web/tests/keymap.test.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import {
  EDGE_CODES,
  EDGE_EVDEV,
  KEYMAP,
  KEYMAP_ENTRIES,
  PC105_CODES,
  assertPc105Coverage,
  evdevForCode,
} from "../src/input/keymap.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const inputDir = path.join(repoRoot, "web", "src", "input");
const fixture = JSON.parse(readFileSync(path.join(inputDir, "w3c-pc105-codes.json"), "utf8"));
const source = JSON.parse(readFileSync(path.join(inputDir, "keymap-source.json"), "utf8"));

test("generated table and both checked-in module projections match the source", () => {
  execFileSync(process.execPath, ["tools/gen-keymap.mjs", "--check"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  assert.deepEqual(PC105_CODES, fixture.codes);
  assert.deepEqual(KEYMAP_ENTRIES, source.entries);
  assert.equal(
    readFileSync(path.join(inputDir, "keymap.ts"), "utf8"),
    readFileSync(path.join(inputDir, "keymap.js"), "utf8"),
    "TypeScript and no-bundler projections must be generated from the same bytes",
  );
});

test("coverage oracle proves every W3C fixture identity is present exactly once", () => {
  assert.equal(assertPc105Coverage(), true);
  assert.equal(PC105_CODES.length, 119);
  assert.equal(KEYMAP_ENTRIES.length, PC105_CODES.length);
  assert.ok(KEYMAP_ENTRIES.every((entry) => Number.isInteger(entry.evdev)));
});

test("letters, punctuation, modifiers, functions, navigation, and numpad edges match evdev", () => {
  const expected = {
    KeyA: 30,
    KeyY: 21,
    Backquote: 41,
    IntlBackslash: 86,
    Minus: 12,
    Equal: 13,
    Quote: 40,
    Slash: 53,
    AltRight: 100,
    MetaLeft: 125,
    ControlRight: 97,
    F24: 194,
    ContextMenu: 127,
    NumpadEnter: 96,
    NumpadDecimal: 83,
    NumpadEqual: 117,
    ArrowUp: 103,
    PageDown: 109,
  };
  for (const [code, evdev] of Object.entries(expected)) {
    assert.equal(evdevForCode(code), evdev, `${code} must use its physical evdev identity`);
  }
  for (const [name, code] of Object.entries(EDGE_CODES)) {
    assert.equal(EDGE_EVDEV[name], expected[code] ?? evdevForCode(code), `${name} fixture is stable`);
  }
  assert.equal(evdevForCode("NotAKeyboardCode"), null, "unknown code is never assigned an arbitrary code");
});

test("oracle names a deleted identity and a duplicate identity", () => {
  const withoutContextMenu = KEYMAP_ENTRIES.filter((entry) => entry.code !== "ContextMenu");
  assert.throws(
    () => assertPc105Coverage(withoutContextMenu),
    /missing PC-105 code\(s\): ContextMenu/,
  );

  const duplicateKeyA = [...KEYMAP_ENTRIES, { ...KEYMAP_ENTRIES.find((entry) => entry.code === "KeyA") }];
  assert.throws(
    () => assertPc105Coverage(duplicateKeyA),
    /duplicate code identity: KeyA/,
  );
});

test("oracle rejects duplicate evdev assignments and undocumented unmapped rows", () => {
  const duplicateEvdev = KEYMAP_ENTRIES.map((entry) =>
    entry.code === "KeyA" ? { ...entry, evdev: 21 } : { ...entry },
  );
  assert.throws(
    () => assertPc105Coverage(duplicateEvdev),
    /duplicate evdev assignment: 21 \(KeyY and KeyA\)/,
  );

  const undocumentedUnmapped = KEYMAP_ENTRIES.map((entry) =>
    entry.code === "KeyA" ? { ...entry, evdev: null } : { ...entry },
  );
  assert.throws(
    () => assertPc105Coverage(undocumentedUnmapped),
    /unmapped code lacks explicit reason: KeyA/,
  );
});
