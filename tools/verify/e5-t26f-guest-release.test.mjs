// Exercise the runner's observation oracle, not a browser or a simulated guest implementation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");
function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing production boundary: ${startMarker}`);
  return source.slice(start, end);
}
const helpers = between("function readRestoredHoverState(", "async function auditFrozenSnapshot(");
const wait = between("async function waitFor(predicate", "async function sha256File");
const mapping = between("function guestPoint(", "async function clickGuest(");
const boundary = between("  const postRestoreStart = firstRestore.completedAt;", "  assert.ok(Number.isFinite(postRestoreStart)");
const cap = source.match(/assert\.ok\(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds"\);/)?.[0];
assert.ok(cap, "the original two-second cap remains literal");
const saved = { left: 637, right: 1280, top: 32, bottom: 58 };

function fixture({ hover = value => value, titlebar = () => ({ ...saved }), ackDelay = 0 } = {}) {
  let now = 5_000, moved = false, current, reads = 0;
  const events = [], sleeps = [], cursorRequests = [];
  const sandbox = {
    assert, firstRestore: { completedAt: 1_000 },
    milestones: { postRestoreEnd: 3_500, dragMovement: { paused: { titlebar: { ...saved } } },
      dragMapping: { guestEnd: { x: 737, y: 36 } } },
    Date: { now: () => now }, performance: { now: () => current ? current.at : now },
    sleep: async ms => {
      assert.equal(ms, 250, "execute the production poll cadence");
      assert.ok(sleeps.length < 61, "test must not spin beyond the production deadline");
      sleeps.push(ms); now += ms;
    },
    phaseProgress: (phase, event = "start") => events.push({ phase, event, at: now }),
    desktopBox: async () => ({ x: 80, y: 85, width: 640, height: 400 }),
    readTopmostDragTitlebar: () => ({ at: now, titlebar: titlebar({ elapsed: now - 5_000, moved }) }),
    window: {
      __desktopTerminal: {
        state: () => ({ pointerFrames: current.pointerFrames, pointerFrameSample: current.frames }),
        pointerState: () => ({ heldButtons: current.heldButtons }),
      },
      __desktopCursor: { renderedCursor: point => { cursorRequests.push(point); return current.rendered; } },
      __desktopController: new Proxy({}, { get: (_target, key) => assert.fail(`unexpected guest mutation/RPC: ${String(key)}`) }),
    },
  };
  const context = vm.createContext(sandbox);
  const emptyButtons = vm.runInContext("[]", context);
  sandbox.page = {
    evaluate: async (fn, point) => {
      if (fn === sandbox.readRestoredHoverState) {
        reads += 1;
        const ready = moved && now - 5_000 >= ackDelay;
        current = hover({ at: now, heldButtons: emptyButtons, pointerFrames: moved ? 11 : 10,
          frames: moved ? [{ device: "tablet", source: "pointermove", coordinates: {
            x: Math.round(point.x / 1280 * 32767), y: Math.round(point.y / 800 * 32767),
          } }] : [], rendered: ready ? { ...point } : null,
        }, { elapsed: now - 5_000, moved, reads });
      }
      return fn(point);
    },
    // No down/up/click/keyboard methods: even an accidental release injection must fail.
    mouse: { move: async (x, y) => { events.push({ move: { x, y }, at: now }); moved = true; } },
  };
  const api = vm.runInContext(`${helpers}\n${wait}\n${mapping}\n${boundary}\n({
    readRestoredHoverState, assertStationaryTitlebar, proveRestoredGuestRelease,
    assertCap: () => { const postRestoreEnd = milestones.postRestoreEnd; ${cap} },
    boundary: () => postRestoreStart,
  })`, context);
  return { api, sandbox, events, sleeps, cursorRequests,
    now: () => now, reads: () => reads, evidence: () => sandbox.milestones.dragGuestRelease };
}

async function refuses(f, reason) {
  await assert.rejects(f.api.proveRestoredGuestRelease(), reason);
  assert.equal(f.evidence().status, "failed");
  assert.match(f.evidence().error, reason);
  assert.equal(f.evidence().observed, undefined);
  assert.equal(f.events.some(event => event.event === "done"), false);
}

test("hover reader selects the latest coordinate-bearing tablet move without modifying the frame ledger", async () => {
  const good = { device: "tablet", source: "pointermove", coordinates: { x: 17, y: 29 } };
  const frames = [
    { ...good, coordinates: { x: 1, y: 2 } }, good,
    { ...good, device: "mouse" }, { ...good, source: "pointerdown" },
    { device: "tablet", source: "pointermove" },
  ];
  const original = frames.slice();
  const f = fixture({ hover: value => ({ ...value, frames, rendered: { x: 30, y: 40 } }) });
  const point = { x: 30, y: 40 };
  const state = await f.sandbox.page.evaluate(f.api.readRestoredHoverState, point);
  assert.equal(state.frame, good);
  assert.deepEqual(frames, original);
  assert.equal(f.cursorRequests[0], point);
  assert.equal(state.at, 5_000);
  assert.equal(state.pointerFrames, 10);
  assert.equal(state.rendered.x, 30);
  delete f.sandbox.window.__desktopCursor;
  assert.equal((await f.sandbox.page.evaluate(f.api.readRestoredHoverState, point)).rendered, null);
});

test("a no-click mapped move requires cursor acknowledgment followed by one full second of stationary observations", async () => {
  const f = fixture({ ackDelay: 500 });
  await f.api.proveRestoredGuestRelease();
  const e = f.evidence();
  assert.equal(e.status, "passed");
  assert.deepEqual(Object.keys(f.sandbox.page.mouse), ["move"]);
  assert.deepEqual(f.events.filter(event => event.move), [{ move: { x: 414.5, y: 112.5 }, at: 5_000 }]);
  assert.deepEqual({ ...e.point }, { x: 669, y: 55 });
  assert.equal(e.acknowledgedAt, 5_500);
  assert.equal(e.observed.at, 6_500);
  assert.deepEqual([...e.samples].map(sample => sample.at), [5_000, 5_250, 5_500, 5_750, 6_000, 6_250, 6_500]);
  for (const sample of e.samples) {
    assert.equal(sample.frame.coordinates.x, Math.round(669 / 1280 * 32767));
    assert.equal(sample.frame.coordinates.y, Math.round(55 / 800 * 32767));
    assert.deepEqual(sample.titlebar, saved);
    assert.equal(sample.heldButtons.length, 0);
  }
  assert.equal(f.api.boundary(), 1_000);
  assert.equal(f.sandbox.milestones.postRestoreStart, 1_000);
  assert.equal(f.sandbox.milestones.postRestoreEnd, 3_500);
  assert.throws(f.api.assertCap, /post-restore interaction exceeded 2 seconds/);
});

test("one-pixel titlebar rounding and normalized-frame rounding are accepted, not treated as drag", async () => {
  const f = fixture({ titlebar: ({ moved }) => ({ ...saved, left: saved.left + (moved ? 1 : 0),
    right: saved.right - (moved ? 1 : 0), top: saved.top + (moved ? 1 : 0), bottom: saved.bottom - (moved ? 1 : 0) }),
  hover: (value, { moved }) => {
    if (moved) { value.frames[0].coordinates.x += 1; value.frames[0].coordinates.y -= 1; }
    return value;
  } });
  await f.api.proveRestoredGuestRelease();
  assert.equal(f.evidence().status, "passed");
  assert.equal(f.evidence().observed.at - f.evidence().acknowledgedAt, 1_000);
});

test("the restored rectangle must identify the actual paused saved window before any hover move", async () => {
  for (const titlebar of [null, undefined, [], [saved, saved], { ...saved, left: 115 },
    { ...saved, right: NaN }, { ...saved, top: Infinity }, { left: saved.left }]) {
    const f = fixture({ titlebar: () => titlebar });
    await refuses(f, /unambiguous titlebar|window moved/);
    assert.equal(f.events.some(event => event.move), false);
    assert.equal(f.reads(), 0);
  }
  const f = fixture({ titlebar: () => ({ ...saved, left: saved.left + 1 }) });
  await f.api.proveRestoredGuestRelease();
  assert.equal(f.evidence().status, "passed", "saved identity permits only rounding tolerance");
});

test("missing/ambiguous observed titlebars and two-pixel motion on every edge refuse", async () => {
  for (const after of [null, [saved, saved], ...Object.keys(saved).flatMap(key => [
    { ...saved, [key]: saved[key] + 2 }, { ...saved, [key]: saved[key] - 2 },
  ])]) {
    const f = fixture({ titlebar: ({ moved }) => moved ? after : { ...saved } });
    await refuses(f, /unambiguous titlebar|window moved/);
    assert.equal(f.evidence().samples.length, 1);
    assert.equal(f.evidence().samples[0].titlebar, after);
  }
});

test("a delayed compositor movement after initial cursor acknowledgment still fails", async () => {
  const f = fixture({ titlebar: ({ elapsed }) => ({ ...saved, left: saved.left + (elapsed >= 750 ? 2 : 0) }) });
  await refuses(f, /window moved/);
  assert.equal(f.evidence().acknowledgedAt, 5_000);
  assert.deepEqual([...f.evidence().samples].map(sample => sample.at), [5_000, 5_250, 5_500, 5_750]);
  assert.equal(f.evidence().samples.at(-1).titlebar.left, 639);
});

test("frame coordinates, device/source, fresh frame count and actual guest cursor are all required", async () => {
  const corruptions = [
    value => { value.frames[0].coordinates.x += 2; },
    value => { value.frames[0].coordinates.y -= 2; },
    value => { value.frames[0].device = "mouse"; },
    value => { value.frames[0].source = "pointerdown"; },
    value => { delete value.frames[0].coordinates; },
    value => { value.frames = []; },
    value => { value.pointerFrames = 10; },
    value => { value.rendered.x -= 1; },
    value => { value.rendered.y += 1; },
    value => { value.rendered = null; },
  ];
  for (const corrupt of corruptions) {
    const f = fixture({ hover: (value, { moved }) => { if (moved) corrupt(value); return value; } });
    await refuses(f, /bounded wait expired: restored guest did not acknowledge a stationary hover/);
    assert.equal(f.evidence().acknowledgedAt, undefined);
    assert.equal(f.evidence().samples.length, 60);
    assert.equal(f.reads(), 61);
    assert.equal(f.now(), 20_000);
    assert.equal(f.sleeps.length, 60);
  }
});

test("held buttons at either boundary and a missing pointer baseline cannot stand in for guest release", async () => {
  for (const atInitial of [true, false]) {
    const f = fixture({ hover: (value, { moved }) => ({ ...value,
      heldButtons: moved === !atInitial ? [0] : value.heldButtons }) });
    await refuses(f, /host button/);
    assert.equal(f.events.some(event => event.move), !atInitial);
  }
  const f = fixture({ hover: (value, { moved }) => ({ ...value, pointerFrames: moved ? 11 : undefined }) });
  await refuses(f, /pointer-frame baseline/);
  assert.equal(f.events.some(event => event.move), false);
});

test("the no-click target must stay below the panel and visibly separated from the saved endpoint", async () => {
  const close = fixture();
  close.sandbox.milestones.dragMapping.guestEnd.x = saved.left + 32;
  await refuses(close, /move visibly over the saved titlebar/);
  const panel = fixture({ titlebar: () => ({ ...saved, top: 0, bottom: 31 }) });
  panel.sandbox.milestones.dragMovement.paused.titlebar = { ...saved, top: 0, bottom: 31 };
  await refuses(panel, /move visibly over the saved titlebar/);
  for (const f of [close, panel]) assert.equal(f.events.some(event => event.move), false);
});

test("invalid initial timestamps refuse before input and NaN/infinite/regressing samples cannot satisfy the interval", async () => {
  for (const at of [NaN, Infinity, undefined]) {
    const f = fixture({ hover: value => ({ ...value, at }) });
    await refuses(f, /observation timestamp/);
    assert.equal(f.events.some(event => event.move), false);
  }
  for (const at of [NaN, Infinity, -Infinity, 5_249]) {
    const f = fixture({ hover: (value, { elapsed }) => elapsed >= 500 ? { ...value, at } : value });
    await refuses(f, /timestamp is invalid or regressed/);
    assert.equal(f.evidence().acknowledgedAt, 5_000);
    assert.equal(f.evidence().samples.length, 3);
    assert.ok(Object.is(f.evidence().samples.at(-1).at, at), "retain the invalid raw observation");
  }
});

test("even a nonadvancing observation clock remains bounded by the real 15-second polling deadline", async () => {
  const f = fixture({ hover: value => ({ ...value, at: 5_000 }) });
  await refuses(f, /bounded wait expired/);
  assert.equal(f.evidence().acknowledgedAt, 5_000);
  assert.equal(f.evidence().samples.length, 60);
  assert.equal(f.now(), 20_000);
});

test("the independent 64-sample guard refuses before a 65th browser observation", async () => {
  const f = fixture({ hover: value => ({ ...value, at: 5_000 }) });
  // A deliberately over-eager wait double attacks the helper's independent hard bound.
  f.sandbox.waitFor = async predicate => {
    for (let i = 0; i < 65; i += 1) assert.equal(await predicate(), false);
    assert.fail("the source helper must refuse before exhausting this bounded test loop");
  };
  await refuses(f, /exceeded its sample bound/);
  assert.equal(f.evidence().samples.length, 64);
  assert.equal(f.reads(), 65, "one baseline plus exactly 64 samples, no extra read on refusal");
  assert.equal(f.sleeps.length, 0);
});
