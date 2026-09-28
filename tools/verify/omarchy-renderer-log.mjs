import assert from "node:assert/strict";

const LOGGER_PREFIX = /^(?:DEBUG \]:\s+|(?:\[[0-9. ]+\]\s+)?(?:[A-Za-z0-9_.@/-]+\s+)*[A-Za-z0-9_.@/-]+\[\d+\]:\s+DEBUG \]:\s+)/u;

// Hyprland's file output keeps the logger's `DEBUG ]:` prefix. Only the exact
// suffix labels are records; prose such as "Requested Renderer" and error
// messages are deliberately not renderer/vendor observations.
export function parseHyprlandRendererLog(text, expectedRenderer) {
  assert.equal(typeof text, "string", "Hyprland renderer log must be text");
  assert.match(expectedRenderer, /^(?:softpipe|llvmpipe)$/u, "invalid expected renderer");
  const records = { renderer: [], vendor: [] };
  for (const line of text.split("\n")) {
    const prefix = line.match(LOGGER_PREFIX);
    if (!prefix) continue;
    const suffix = line.slice((prefix.index ?? 0) + prefix[0].length).trim();
    const record = suffix.match(/^(Renderer|Vendor):\s+(.+?)\s*$/u);
    if (!record) continue;
    records[record[1] === "Renderer" ? "renderer" : "vendor"].push(record[2]);
  }
  assert.equal(records.renderer.length, 1, "Renderer log line is absent or ambiguous");
  assert.equal(records.vendor.length, 1, "Vendor log line is absent or ambiguous");
  assert.match(records.renderer[0], new RegExp(`^${expectedRenderer}(?:\\s|\\(|$)`, "iu"),
    "Renderer log does not positively match requested driver");
  return {
    renderer: records.renderer[0],
    vendor: records.vendor[0],
    positivelyMatched: true,
  };
}

// The shipped baseline disables Hyprland's DEBUG logs before OpenGL starts.
// Its named Mesa worker is independent process evidence, but it is NOT a GL
// renderer-label observation. Never extend this fallback to softpipe or use it
// to hide a present but contradictory/ambiguous GL record.
export function observeHyprlandRenderer({ log, threads, expectedRenderer }) {
  assert.equal(typeof log, "string");
  assert.equal(typeof threads, "string");
  if (expectedRenderer === "llvmpipe" && log.trim() === "" &&
      threads.split("\n").some(line => /^llvmpipe-[0-9]+$/u.test(line.trim()))) {
    return {
      kind: "llvmpipe-worker-observed",
      glLabelAvailable: false,
      note: "GL label unavailable; current compositor PID has a named llvmpipe worker",
    };
  }
  return {
    kind: "gl-renderer-label-observed",
    glLabelAvailable: true,
    ...parseHyprlandRendererLog(log, expectedRenderer),
  };
}
