#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {browserDocument, browserOptions, runVirglBrowser} from '../lib/virgl-browser-runner.mjs';

const options = browserOptions(['--seed', '--fault', '--provenance']);
assert.ok(options.provenance, '--provenance requires the authenticated G1 report');
assert.ok(!options.fault || ['lighting', 'auxiliary', 'forced-alpha'].includes(options.fault));
const provenanceBytes = fs.readFileSync(options.provenance), provenance = JSON.parse(provenanceBytes);
assert.equal(provenance.status, 'passed');
const manifest = JSON.parse(fs.readFileSync('renderer/virgl-shader/tests/gears-originals.json'));
const files = ['renderer/virgl-command/constant-domain.mjs', 'tools/virgl-gears-shaders/oracle.mjs',
  'tools/virgl-gears-shaders/provenance.py', 'tools/virgl-gears-shaders/compiler.mjs',
  'tools/virgl-gears-shaders/receipt.py', 'tools/virgl-gears-shaders/cold.py',
  'tools/virgl-gears-shaders/README.md',
  'tools/verify-virgl-gears-shaders.sh', 'tools/virgl-capture/validate.py', 'Makefile',
  ...provenance.inputs.map(e => e.path)];
const sha = raw => createHash('sha256').update(raw).digest('hex');
const pinnedFiles = [...new Set(files)].map(file => {
  const raw = fs.readFileSync(file);
  const reference = provenance.inputs.find(e => e.path === file);
  if (reference) {assert.equal(sha(raw), reference.sha256); assert.equal(raw.length, reference.bytes);}
  return {path: file, size: raw.length, sha256: sha(raw)};
});
await runVirglBrowser({options, task: 'E6-T12g6a', serializedAcceptance: true,
  boundary: 'Four literal new G1 shader bodies; two captured programs and one vertex isolation probe. Larger original programs and production GPU stay disabled.',
  reportFields: {productionNegotiation: false,
    provenance: {path: path.relative(path.resolve(options.output), path.resolve(options.provenance)),
      sha256: sha(provenanceBytes), bytes: provenanceBytes.length, gitHead: provenance.gitHead}},
  modulePath: '/renderer/virgl-shader/tests/gears-originals.mjs', windowReportKey: '__virglGearsOriginalsReport',
  browserArguments: {seed: Number(options.seed ?? 0x6247bda3) >>> 0, fault: options.fault ?? null, capturedPairs: provenance.pairs},
  servedFiles: files, pinnedFiles,
  coveragePaths: ['renderer/virgl-shader/tests/gears-originals.mjs', 'tools/virgl-gears-shaders/oracle.mjs'],
  html: browserDocument({title: 'Original gears shaders', heading: 'Captured gears shader equations',
    description: 'Physical lighting, written outputs and texture alpha · isolated proof · guest GPU negotiation disabled'}),
  validate(result) {
    assert.equal(result.originals.length, 6); assert.equal(result.originals.filter(e => e.result.ok).length, 4);
    assert.equal(result.retainedPartners.length, 1); assert.equal(result.pairs.length, 3);
    assert.equal(result.rejectedPrograms.length, 2); assert.equal(result.vertices.length, 2);
    assert.equal(result.fragments.length, 2); assert.equal(result.checkedVertexWords, 864);
    assert.equal(result.checkedPixels, 9216); assert.equal(result.objects.live, 0);
    assert.deepEqual(result.originals.map(e => e.admitted), manifest.originals.map(e => e.admitted));
  },
  successMessage: r => `Four new bodies: ${r.checkedVertexWords} written words and ${r.checkedPixels} physical pixels; larger programs remain rejected.`,
});
