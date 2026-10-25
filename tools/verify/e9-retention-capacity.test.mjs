import assert from 'node:assert/strict';
import test from 'node:test';
import {checkRetentionCapacity} from './e9-retention-capacity.mjs';

const gib = 1024 ** 3;
const accepted = {quota: 19 * gib, usage: 0, hostFreeBytes: 34 * gib,
  localBytes: 16 * gib, exportBytes: 16 * gib, reserveBytes: gib};

test('accepts exact browser and host headroom boundaries', () => {
  const result = checkRetentionCapacity({...accepted, quota: 17 * gib,
    hostFreeBytes: 33 * gib});
  assert.equal(result.browserAvailable, result.browserRequired);
  assert.equal(result.hostFreeBytes, result.hostRequired);
  const staged = checkRetentionCapacity({...accepted, quota: 10 * gib,
    localBytes: 8 * gib, hostLocalBytes: 16 * gib});
  assert.equal(staged.browserRequired, 9 * gib);
  assert.equal(staged.hostRequired, 33 * gib);
});

test('rejects current usage, host shortfall, and forged arithmetic', () => {
  assert.throws(() => checkRetentionCapacity({...accepted, usage: 2 * gib + 1}),
    {code: 'BrowserQuota'});
  assert.throws(() => checkRetentionCapacity({...accepted, hostFreeBytes: 33 * gib - 1}),
    {code: 'HostSpace'});
  assert.throws(() => checkRetentionCapacity({...accepted, quota: 10 * gib,
    localBytes: 8 * gib, hostLocalBytes: 16 * gib,
    hostFreeBytes: 22 * gib}), {code: 'HostSpace'});
  assert.throws(() => checkRetentionCapacity({...accepted, usage: -1}),
    {code: 'InvalidReceipt'});
  assert.throws(() => checkRetentionCapacity({...accepted, usage: 20 * gib}),
    {code: 'InvalidReceipt'});
  assert.throws(() => checkRetentionCapacity({...accepted, hostFreeBytes: Number.MAX_SAFE_INTEGER + 1}),
    {code: 'InvalidReceipt'});
});
