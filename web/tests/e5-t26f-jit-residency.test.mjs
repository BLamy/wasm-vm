import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../desktop-terminal.js", import.meta.url), "utf8");
const queryBindings = [...source.matchAll(/^const query = .+;$/gm)];
const bootCalls = [...source.matchAll(/^const bootPromise = startLinuxBootWorker\(\{[\s\S]*?^\}\);/gm)];
assert.equal(queryBindings.length, 1, "execute the actual desktop query binding");
assert.equal(bootCalls.length, 1, "execute the actual desktop worker boot options");

function desktopBootOptions(search) {
  let captured;
  let calls = 0;
  // Execute the production query declaration and full boot call, not a reconstructed options
  // object. Only intercept the worker boundary; DOM setup and guest execution are out of scope.
  vm.runInNewContext(`${queryBindings[0][0]}\n${bootCalls[0][0]}`, {
    URLSearchParams,
    location: { search },
    desktopAudioSink: null,
    onOutput() {},
    onAgentOutput() {},
    onDisplayFrame() {},
    startLinuxBootWorker(options) {
      calls += 1;
      captured = options;
    },
  }, { filename: "desktop-terminal-boot-options.js" });
  assert.equal(calls, 1);
  return captured;
}

test("absent desktop residency stays undefined so the loader retains its default", () => {
  for (const search of ["", "?jit=1&guestClock=wall"]) {
    const options = desktopBootOptions(search);
    assert.equal(options.jitResidency, undefined);
    assert.equal(options.jit, true);
  }
});

for (const label of ["repack-off", "cap-256", "cap-1024"]) {
  test(`desktop forwards existing ${label} policy unchanged to the worker boundary`, () => {
    const options = desktopBootOptions(`?jitResidency=${encodeURIComponent(label)}`);
    assert.equal(options.jitResidency, label);
  });
}

test("desktop does not normalize empty or unsupported labels into a default", () => {
  for (const label of ["", "CAP-256", "cap-256 ", "unknown"]) {
    assert.equal(
      desktopBootOptions(`?jitResidency=${encodeURIComponent(label)}`).jitResidency,
      label,
      "existing downstream validation remains authoritative",
    );
  }
});
