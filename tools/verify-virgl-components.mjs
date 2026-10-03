#!/usr/bin/env node
import assert from 'node:assert/strict';
import { browserDocument, browserOptions, runVirglBrowser } from './lib/virgl-browser-runner.mjs';
import { ORIGINAL_INPUTS, NEW_HASHES } from '../renderer/virgl-shader/tests/components.mjs';

const options = browserOptions(['--sabotage']);
assert.ok(options.sabotage === undefined || options.sabotage === 'masked-write', '--sabotage accepts masked-write');
await runVirglBrowser({
  options, task: 'E6-T12e1', boundary: 'unchanged captured TGSI declarations/component writes to actual WebGL2 pixels; no guest 3D activation',
  reportFields: { currentGuest3dAdvertisement: false, commandStreamReplay: false },
  modulePath: '/renderer/virgl-shader/tests/components.mjs', windowReportKey: '__virglComponentsReport',
  browserArguments: { sabotage: options.sabotage ?? null },
  servedFiles: ORIGINAL_INPUTS.map((input) => input.path), pinnedFiles: ORIGINAL_INPUTS,
  html: browserDocument({ title: 'E6-T12e1 component shader proof', heading: 'Bounded component shader execution',
    description: 'Four unchanged original shaders. Independent texture, affine, matrix and depth pixels. Production graphics negotiation remains disabled.' }),
  validate(acceptance) {
    assert.equal(acceptance.corpus.length, 19); assert.equal(acceptance.corpus.filter((entry) => entry.result.ok).length, 12);
    assert.deepEqual(acceptance.translations.map((entry) => entry.sha256).sort(), [...NEW_HASHES].sort());
    assert.equal(acceptance.draws.length, 10); assert.ok(acceptance.checkedPixels > 4000);
    assert.equal(acceptance.boundary.recovery.conversions, acceptance.boundary.cases.length * 4 * 2);
    assert.equal(acceptance.sabotage, null); assert.deepEqual(acceptance.omissions, []);
  },
  successMessage: (acceptance) => `E6-T12e1: 12/19 unchanged shaders, four original GPU bodies, ten draws, ${acceptance.checkedPixels} independent pixels; ${acceptance.boundary.cases.length} shared cases; production 3D disabled.`,
});
