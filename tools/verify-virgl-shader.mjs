#!/usr/bin/env node
// E6-T10a: preserve the nine-draw literal baseline and its report/interface.
import assert from "node:assert/strict";
import { browserDocument, browserOptions, runVirglBrowser } from "./lib/virgl-browser-runner.mjs";

await runVirglBrowser({
  options: browserOptions(), task: "E6-T10a",
  boundary: "literal TGSI -> pinned upstream converter -> GLSL ES300 -> hardware WebGL2",
  modulePath: "/renderer/virgl-shader/tests/browser.mjs", windowReportKey: "__virglShaderReport",
  html: browserDocument({ title: "E6-T10a shader boundary proof", heading: "VirGL shader translation boundary",
    description: "No VM guest is running. Every tile is a real WebGL2 draw of translated literal TGSI." }),
  validate(acceptance) {
    assert.equal(acceptance.draws.length, 9);
    assert.ok(acceptance.checkedPixels > 3000, "bounded literal pixel corpus must actually execute");
  },
  successMessage: (acceptance) => `E6-T10a: ${acceptance.draws.length} hardware WebGL2 draws, ${acceptance.checkedPixels} exact pixels; ${acceptance.errors.length} rejection cases and ${acceptance.recovery.successes} recoveries passed.`,
});
