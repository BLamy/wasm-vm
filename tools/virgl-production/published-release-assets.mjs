import assert from 'node:assert/strict';
import {expectedPublishedSource} from './published-source.mjs';

// Deployment stages small boot blobs separately from the committed web bundle.
// Authenticate these by their manifest pins, never by an absent dist copy.
export function indexPublishedReleaseAssets(descriptors, base) {
  const origin = new URL(base).origin;
  const pins = new Map();
  for (const {name, bytes} of descriptors) {
    const manifest = JSON.parse(expectedPublishedSource(name, bytes));
    for (const [role, artifact] of Object.entries(manifest.artifacts ?? {})) {
      if (typeof artifact?.url !== 'string') continue;
      const url = new URL(artifact.url, base);
      if (url.origin !== origin || !url.pathname.startsWith('/releases/')) continue;
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(artifact.size) && artifact.size > 0);
      const prior = pins.get(url.href);
      if (prior) {
        assert.equal(artifact.sha256, prior.sha256, 'conflicting release digest');
        assert.equal(artifact.size, prior.size, 'conflicting release size');
      }
      pins.set(url.href, {descriptor: name, role, size: artifact.size, sha256: artifact.sha256});
    }
  }
  return pins;
}
