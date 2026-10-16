import assert from 'node:assert/strict';
import test from 'node:test';
import {encodeCheckpointData, decodeCheckpointData} from '../../web/renderer/virgl-command/checkpoint-codec.mjs';
import {staleWarmPair, warmUiDigest as sha, assertWarmFailureUi, WARM_UI_FAILURES} from './critic-warm-ui-fixtures.mjs';

test('stale envelope changes only its actual build identity and rehashes full framing', () => {
  const record = {schema: 'production-gpu-pair-v1', identity: {buildId: 'a'.repeat(64)}, epoch: '0000000000000003',
    profile: {hostWords: [1024]}, clockState: {mode: 'paced-icount', mtime: '123'},
    parts: {native: {bytes: Uint8Array.of(1, 2)}, disk: {bytes: Uint8Array.of(3, 4)}, renderer: {bytes: Uint8Array.of(5, 6)}}};
  const payload = encodeCheckpointData(record), original = new Uint8Array(payload.length + 48);
  original.set(new TextEncoder().encode('WVGPAIR1')); const view = new DataView(original.buffer);
  view.setUint32(8, 1, true); view.setUint32(12, payload.length, true); original.set(payload, 16);
  original.set(Buffer.from(sha(original.subarray(0, -32)), 'hex'), original.length - 32);
  const changed = staleWarmPair(original, {encodeCheckpointData, decodeCheckpointData});
  const decoded = decodeCheckpointData(changed.bytes.subarray(16, -32));
  assert.equal(decoded.identity.buildId, '0'.repeat(64)); decoded.identity.buildId = record.identity.buildId;
  assert.deepEqual(encodeCheckpointData(decoded), payload, 'all actual components and saved metadata stay unchanged');
  assert.equal(sha(changed.bytes.subarray(0, -32)), Buffer.from(changed.bytes.subarray(-32)).toString('hex'));
  assert.notEqual(sha(original), sha(changed.bytes));
});

function failed(mode) {
  const errors = {'missing-artifact': 'gpu_checkpoint: accelerated warm artifact is not published',
    'digest-mismatch': 'boot asset SHA-256 mismatch', 'corrupt-envelope': 'gpu_checkpoint: pair digest differs',
    'stale-identity': 'gpu_checkpoint: build, image or boot identity differs',
    'stale-service-worker': 'boot asset SHA-256 mismatch', 'stale-cache': 'boot asset SHA-256 mismatch'};
  return {isolated: true, ready: false, up: false, restored: false, graphics: 'gpu', boots: [{virgl: true, bootSnapshot: true, persist: false}],
    errors: [{message: errors[mode]}], desktopReady: [], message: 'The GPU desktop could not start.', pageErrors: [],
    actions: {retry: {visible: true, hitTestable: true, disabled: false},
      software: {visible: true, hitTestable: true, href: 'http://127.0.0.1/app?guest=omarchy&desktop=1&gpu=0#ide'},
      cold: {visible: true, hitTestable: true, href: 'http://127.0.0.1/app?guest=omarchy&desktop=1&gpu=1&noSnapshot=1#ide'}}};
}

test('visible failure oracle distinguishes explicit recovery from warm or automatic fallback', () => {
  for (const mode of Object.keys(WARM_UI_FAILURES)) {
    assertWarmFailureUi(failed(mode), mode);
    for (const key of ['ready', 'up', 'restored']) assert.throws(() => assertWarmFailureUi({...failed(mode), [key]: true}, mode));
    assert.throws(() => assertWarmFailureUi({...failed(mode), graphics: 'software'}, mode));
    for (const key of ['virgl', 'bootSnapshot']) {
      const state = failed(mode); state.boots[0][key] = false; assert.throws(() => assertWarmFailureUi(state, mode));
    }
    for (const action of ['retry', 'cold', 'software']) {
      const state = failed(mode); state.actions[action].visible = false; assert.throws(() => assertWarmFailureUi(state, mode));
      const obscured = failed(mode); obscured.actions[action].hitTestable = false; assert.throws(() => assertWarmFailureUi(obscured, mode));
    }
    const state = failed(mode); state.boots.push({virgl: false, bootSnapshot: true}); assert.throws(() => assertWarmFailureUi(state, mode));
  }
});
