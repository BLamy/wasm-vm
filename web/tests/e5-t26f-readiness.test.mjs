// E5-T26f — source-level harness for the readiness pause ownership boundary.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const terminalSource = await readFile(new URL("../desktop-terminal.js", import.meta.url), "utf8");
const helperStart = terminalSource.indexOf("async function withReadinessPause");
const helperEnd = terminalSource.indexOf("\n}\n\nfunction storedDesktopSnapshot", helperStart) + 2;
assert.ok(helperStart >= 0 && helperEnd > helperStart, "readiness pause helper is not in desktop-terminal.js");
const withReadinessPause = new Function(
  `${terminalSource.slice(helperStart, helperEnd)}\nreturn withReadinessPause;`,
)();

function controllerFixture(initiallyPaused) {
  let paused = initiallyPaused;
  let resumes = 0;
  return {
    controller: {
      async isPaused() { return paused; },
      async pause() { paused = true; },
      async resume() { resumes += 1; paused = false; },
    },
    state: () => ({ paused, resumes }),
  };
}

test("transient non-ready inspection resumes a controller paused by readiness", async () => {
  const fixture = controllerFixture(false);
  const result = await withReadinessPause(fixture.controller, async () => false);
  assert.equal(result, false);
  assert.deepEqual(fixture.state(), { paused: false, resumes: 1 });
});

test("readiness inspection does not resume a controller already paused by its owner", async () => {
  const fixture = controllerFixture(true);
  const result = await withReadinessPause(fixture.controller, async () => false);
  assert.equal(result, false);
  assert.deepEqual(fixture.state(), { paused: true, resumes: 0 });
});
