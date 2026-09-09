// Test runner scheduling only, without importing its side-effectful browser entry point.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");
function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing runner boundary: ${startMarker}`);
  return source.slice(start, end);
}
const typing = between("const shiftedPhysicalKey =", "async function waitForDesktopReady");
const marker = between("function commandMarkerReady()", "async function startInteractionLatencyProbe");
const budget = between("function remainingInteractionMs(", "async function waitForRestoredCursor");
const boundary = between("  const postRestoreStart = firstRestore.completedAt;", "  assert.ok(Number.isFinite(postRestoreStart)");
const cap = source.match(/assert\.ok\(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds"\);/)?.[0];
assert.ok(cap, "retain the original final cap assertion");
const postCommand = between("  const postAudioCommand = await typeCommand(", "  const postFocusState =");
const shifted = [
  ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", (character) => [character, character.toLowerCase()]),
  ...Array.from('!@#$%^&*()_+{}|:"<>?', (character, index) => [character, '1234567890-=[]\\;\',./'[index]]),
];

function fixture({ offset = 0, latency = false, typingSource = typing } = {}) {
  const clock = { now: 1_000 + offset };
  const transitions = [], calls = [], events = [], markers = [];
  let active = null;
  const transition = (kind, key) => transitions.push({ kind, key, at: clock.now });
  // Mirrors pinned Playwright server/input.js: press delays between down/up; type
  // delegates layout characters to press, otherwise delays before sendText. No tail gap.
  const press = async (key, delay = 0) => {
    transition("down", key);
    clock.now += delay;
    transition("up", key);
    if (key === "Enter" && active) active.terminalMarkerSeen = true;
  };
  const sandbox = {
    assert, performance: { now: () => clock.now }, firstRestore: { completedAt: 1_000 }, milestones: {},
    postRestoreCommand: "sh /tmp/a", postRestoreKeyDelayMs: 5, interactionLatencyActive: latency,
    phaseProgress: (phase, event = "start") => events.push({ phase, event, at: clock.now }),
    captureFailure: async () => assert.fail("unexpected command failure"),
    stopInteractionLatencyProbe: async (reason) => { events.push({ reason, at: clock.now }); },
    window: {
      __desktopTerminal: {
        beginCommand: (command, expected) => { active = { command, marker: expected, terminalMarkerSeen: false }; },
        focus: () => events.push({ focus: true, at: clock.now }),
        state: () => ({ active: { command: active } }),
        finishCommand: (expected) => {
          assert.equal(expected, active.marker);
          assert.equal(active.terminalMarkerSeen, true);
          return { commands: [{ ...active, accepted: true }] };
        },
      },
      __e5t26fLatencyProbe: latency ? { active: () => true,
        recordMarker: (start, end, state) => markers.push({ start, end, marker: state.active.command.marker }) } : null,
    },
    page: {
      keyboard: {
        down: async (key) => { calls.push({ method: "down", key }); transition("down", key); },
        up: async (key) => { calls.push({ method: "up", key }); transition("up", key); },
        press: async (key, options = {}) => { calls.push({ method: "press", key, delay: options.delay }); await press(key, options.delay); },
        type: async (text, options = {}) => {
          calls.push({ method: "type", text, delay: options.delay });
          for (const character of text) {
            if (/^[\x20-\x7e\n\r]$/u.test(character)) await press(character, options.delay);
            else { clock.now += options.delay || 0; transition("insertText", character); }
          }
        },
      },
      waitForTimeout: async (ms) => { calls.push({ method: "wait", ms, at: clock.now }); clock.now += ms; },
      evaluate: async (fn, argument) => fn(argument),
      waitForFunction: async (fn, argument, options) => {
        calls.push({ method: "marker", timeout: options.timeout, at: clock.now });
        assert.equal(fn(argument), true);
      },
    },
  };
  const context = vm.createContext(sandbox);
  const api = vm.runInContext(`${typingSource}\n${marker}\n${budget}\n${boundary}\n({
    typePhysicalText, typeCommand, shiftedPhysicalKey, remainingInteractionMs,
    boundary: () => postRestoreStart,
    assertCap: () => { const postRestoreEnd = performance.now(); ${cap} },
    postCommand: async () => { ${postCommand} return postAudioCommand; },
  })`, context);
  return { api, sandbox, clock, transitions, calls, events, markers };
}

function assertGaps(transitions, delay) {
  for (let i = 1; i < transitions.length; i += 1) {
    assert.ok(transitions[i].at - transitions[i - 1].at >= delay,
      `transition ${i}: ${transitions[i - 1].kind}/${transitions[i - 1].key} -> ${transitions[i].kind}/${transitions[i].key} lacks ${delay}ms`);
  }
}

test("the existing uppercase and shifted-symbol map retains every base key and physical transition order", async () => {
  const f = fixture();
  assert.deepEqual([...f.api.shiftedPhysicalKey].map(([key, base]) => [key, base]), shifted);
  const text = shifted.map(([key]) => key).join("");
  await f.api.typePhysicalText(text, 5);
  assert.deepEqual(f.transitions.map(({ kind, key }) => [kind, key]), shifted.flatMap(([, base]) => [
    ["down", "Shift"], ["down", base], ["up", base], ["up", "Shift"],
  ]));
  assertGaps(f.transitions, 5);
  assert.equal(f.clock.now - 1_000, shifted.length * 20);
  assert.ok(f.calls.filter(({ method }) => method === "press").every(({ delay }) => delay === 5));
});

test("default 100ms setup pacing separates lowercase, modifier and shifted-symbol edges at exact times", async () => {
  const f = fixture();
  await f.api.typePhysicalText("aA?z");
  assert.deepEqual(f.transitions, [
    ["down", "a", 0], ["up", "a", 100],
    ["down", "Shift", 200], ["down", "a", 300], ["up", "a", 400], ["up", "Shift", 500],
    ["down", "Shift", 600], ["down", "/", 700], ["up", "/", 800], ["up", "Shift", 900],
    ["down", "z", 1_000], ["up", "z", 1_100],
  ].map(([kind, key, at]) => ({ kind, key, at: at + 1_000 })));
  assertGaps(f.transitions, 100);
  assert.equal(f.clock.now, 2_200);
  assert.deepEqual(f.calls.filter(({ method }) => method === "wait").map(({ at }) => at - 1_000),
    [100, 200, 400, 500, 600, 800, 900, 1_100]);
});

test("explicit zero keeps the identical key sequence with no additional waits", async () => {
  const zero = fixture(), paced = fixture();
  await zero.api.typePhysicalText('aA?"\\\'z', 0);
  await paced.api.typePhysicalText('aA?"\\\'z', 5);
  assert.deepEqual(zero.transitions.map(({ kind, key }) => [kind, key]), paced.transitions.map(({ kind, key }) => [kind, key]));
  assert.equal(zero.clock.now, 1_000);
  assert.ok(zero.transitions.every(({ at }) => at === 1_000));
  assert.equal(zero.calls.some(({ method }) => method === "wait"), false);
  assertGaps(paced.transitions, 5);
});

test("unmapped controls and high characters retain type passthrough without fabricated Shift transitions", async () => {
  const f = fixture();
  const text = "\n\r\t\u0001é🙂";
  await f.api.typePhysicalText(text, 5);
  assert.deepEqual(f.calls.filter(({ method }) => method === "type").map(({ text }) => text), [...text]);
  assert.equal(f.calls.some(({ method }) => method === "down" || method === "up" || method === "press"), false);
  assert.deepEqual(f.transitions.map(({ kind, key }) => [kind, key]), [
    ["down", "\n"], ["up", "\n"], ["down", "\r"], ["up", "\r"],
    ["insertText", "\t"], ["insertText", "\u0001"], ["insertText", "é"], ["insertText", "🙂"],
  ]);
  assertGaps(f.transitions, 5);
  assert.equal(f.clock.now - 1_000, 60);
});

test("typeCommand preserves command/marker and holds Enter for the selected delay with no extra trailing wait", async () => {
  for (const delay of [undefined, 0, 5]) {
    const f = fixture();
    const command = 'A"a';
    const record = await f.api.typeCommand(command, "unchanged-marker", 321, delay);
    const actualDelay = delay ?? 100;
    assert.equal(record.command, command);
    assert.equal(record.marker, "unchanged-marker");
    assert.equal(record.accepted, true);
    const enter = f.calls.find(({ method, key }) => method === "press" && key === "Enter");
    assert.equal(enter.delay, actualDelay);
    assert.deepEqual(f.transitions.slice(-2), [
      { kind: "down", key: "Enter", at: 1_000 + 10 * actualDelay },
      { kind: "up", key: "Enter", at: 1_000 + 11 * actualDelay },
    ]);
    assert.equal(f.clock.now, f.transitions.at(-1).at, "no artificial post-Enter interval");
    assert.equal(f.calls.at(-1).method, "marker");
    assert.equal(f.calls.at(-1).timeout, 321);
    assertGaps(f.transitions, actualDelay);
  }
});

test("the actual 5ms post-restore command charges all 95ms to the original T0 and keeps the two-second cap", async () => {
  for (const offset of [350, 1_950]) {
    const f = fixture({ offset, latency: true });
    const record = await f.api.postCommand();
    assert.equal(record.command, "sh /tmp/a");
    assert.equal(record.marker, "e5t26f-post-aplay");
    assert.equal(f.clock.now - 1_000, offset + 95);
    assert.equal(f.api.boundary(), 1_000);
    assert.equal(f.sandbox.milestones.postRestoreStart, 1_000);
    assert.equal(f.markers.length, 1);
    assert.equal(f.markers[0].start, f.clock.now);
    assert.equal(f.markers[0].end, f.clock.now);
    assert.equal(f.markers[0].marker, record.marker);
    assertGaps(f.transitions, 5);
    if (offset === 350) {
      f.api.assertCap();
      assert.equal(f.api.remainingInteractionMs(f.api.boundary(), f.clock.now), 1_555);
    } else {
      assert.throws(f.api.assertCap, /post-restore interaction exceeded 2 seconds/);
      assert.throws(() => f.api.remainingInteractionMs(f.api.boundary(), f.clock.now), /original 2-second budget/);
    }
  }
});

test("the transition oracle kills the former burst helper even if its final elapsed time is padded to match", async () => {
  const oldHelper = `async function typePhysicalText(text, keyDelay = 100) {
    for (const character of text) {
      const baseKey = shiftedPhysicalKey.get(character);
      if (baseKey) {
        await page.keyboard.down("Shift");
        await page.keyboard.press(baseKey);
        await page.keyboard.up("Shift");
        if (keyDelay > 0) await page.waitForTimeout(keyDelay);
      } else await page.keyboard.type(character, { delay: keyDelay });
    }
  }\n\n`;
  const currentHelper = between("async function typePhysicalText(", "async function typeCommand(");
  const f = fixture({ typingSource: typing.replace(currentHelper, oldHelper) });
  await f.api.typePhysicalText("aA?z");
  f.clock.now = 2_200; // An endpoint-only test would incorrectly accept this apparent 1200ms run.
  assert.equal(f.clock.now - 1_000, 1_200);
  assert.throws(() => assertGaps(f.transitions, 100), /lacks 100ms/);
});
