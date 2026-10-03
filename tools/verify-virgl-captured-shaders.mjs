#!/usr/bin/env node
// T10d remains distinct from the nine-draw literal T10a baseline.
import assert from "node:assert/strict";
import { browserDocument, browserOptions, runVirglBrowser } from "./lib/virgl-browser-runner.mjs";
import { CAPTURED_INPUTS } from "../renderer/virgl-shader/tests/captured-textured-scene.mjs";

const options = browserOptions(["--sabotage"]);
assert.ok(options.sabotage === undefined || options.sabotage === "texture-texel", "--sabotage accepts only texture-texel");
await runVirglBrowser({
  options, task: "E6-T10d", boundary: "two unmodified captured TGSI bodies -> bounded converter -> hardware WebGL2; explicit original workload bindings",
  reportFields: { currentGuest3dAdvertisement: false, commandStreamReplay: false },
  modulePath: "/renderer/virgl-shader/tests/captured-textured-scene.mjs", windowReportKey: "__virglCapturedShaderReport",
  browserArguments: { sabotage: options.sabotage ?? null },
  servedFiles: CAPTURED_INPUTS.map((input) => input.path),
  pinnedFiles: [...CAPTURED_INPUTS, { path: "tools/virgl-capture/workloads/textured-scene.c", sha256: "067d289393bc8671e971e9b93912042580446d3e5492598eb229904039a9e9ea" }],
  html: browserDocument({ title: "E6-T10d captured shader proof", heading: "Captured textured-scene shader execution",
    description: "Two unchanged captured TGSI bodies. Original geometry, texture and three phases. No VM guest or VirGL command executor is running." }),
  validate(acceptance) {
    assert.equal(acceptance.translations.length, 2);
    assert.equal(acceptance.draws.length, 3);
    assert.equal(acceptance.checkedPixels, 768);
    assert.equal(acceptance.sabotage, null, "a sabotage run must fail independent pixel acceptance");
  },
  successMessage: (acceptance) => `E6-T10d: 2 unmodified captured shaders, 3 indexed hardware draws, 768 exact pixels; ${acceptance.grammarAttacks.cases.length} grammar attacks and ${acceptance.grammarAttacks.recoveries} valid recoveries passed. Guest 3D remains disabled.`,
});
