// Independent failed-publication fixtures; none are eligible guest checkpoints.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const warmUiDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const WARM_UI_FAILURES = Object.freeze({
  'missing-artifact': /accelerated warm artifact is not published/,
  'digest-mismatch': /boot asset SHA-256 mismatch/,
  'corrupt-envelope': /gpu_checkpoint: pair digest differs/,
  'stale-identity': /gpu_checkpoint: build, image or boot identity differs/,
  'stale-service-worker': /boot asset SHA-256 mismatch/,
  'stale-cache': /boot asset SHA-256 mismatch/,
});

export function staleWarmPair(original, codec) {
  const bytes = new Uint8Array(original);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 8)), 'WVGPAIR1');
  assert.equal(warmUiDigest(bytes.subarray(0, -32)), Buffer.from(bytes.subarray(-32)).toString('hex'));
  const payload = codec.decodeCheckpointData(bytes.subarray(16, -32));
  assert.equal(payload.schema, 'production-gpu-pair-v1');
  assert.match(payload.identity.buildId, /^[a-f0-9]{64}$/);
  const oldBuildId = payload.identity.buildId;
  payload.identity.buildId = oldBuildId === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
  const body = codec.encodeCheckpointData(payload);
  const changed = new Uint8Array(body.length + 48);
  changed.set(bytes.subarray(0, 16)); new DataView(changed.buffer).setUint32(12, body.length, true);
  changed.set(body, 16);
  changed.set(Buffer.from(warmUiDigest(changed.subarray(0, -32)), 'hex'), changed.length - 32);
  return {bytes: changed, oldBuildId, staleBuildId: payload.identity.buildId};
}

export function assertWarmFailureUi(state, mode, attempts = 1) {
  assert.ok(Object.hasOwn(WARM_UI_FAILURES, mode));
  assert.equal(state.isolated, true, 'actual app has production isolation headers');
  assert.equal(state.ready, false, 'a failed restore never publishes guest readiness');
  assert.equal(state.up, false, 'failed candidate does not leave an owned controller');
  assert.equal(state.restored, false, 'failed candidate is not labelled a warm success');
  assert.equal(state.graphics, 'gpu', 'failure does not silently select software');
  assert.equal(state.boots.length, attempts, 'one actual worker per explicit attempt');
  for (const boot of state.boots) {
    assert.equal(boot.virgl, true);
    assert.equal(boot.bootSnapshot, true, 'failure does not silently cold boot');
    assert.equal(boot.persist, false);
  }
  assert.ok(state.errors.length >= attempts, 'each explicit attempt reports its own failure');
  for (const error of state.errors) assert.match(error.message, WARM_UI_FAILURES[mode]);
  assert.equal(state.desktopReady.length, 0);
  assert.match(state.message, /GPU desktop could not start/);
  for (const name of ['software', 'cold', 'retry']) {
    assert.equal(state.actions[name].visible, true, 'visible ' + name + ' action');
    assert.equal(state.actions[name].hitTestable, true, 'unobstructed ' + name + ' action');
  }
  assert.equal(state.actions.retry.disabled, false);
  const software = new URL(state.actions.software.href);
  assert.equal(software.searchParams.get('guest'), 'omarchy');
  assert.equal(software.searchParams.get('desktop'), '1');
  assert.equal(software.searchParams.get('gpu'), '0');
  assert.equal(software.searchParams.has('noSnapshot'), false);
  const cold = new URL(state.actions.cold.href);
  assert.equal(cold.searchParams.get('guest'), 'omarchy');
  assert.equal(cold.searchParams.get('desktop'), '1');
  assert.equal(cold.searchParams.get('gpu'), '1');
  assert.equal(cold.searchParams.get('noSnapshot'), '1');
  assert.equal(software.hash, '#ide'); assert.equal(cold.hash, '#ide');
  assert.deepEqual(state.pageErrors, []);
}
