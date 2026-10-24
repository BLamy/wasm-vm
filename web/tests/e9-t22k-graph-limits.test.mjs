import test from 'node:test';
import assert from 'node:assert/strict';
import {BUNDLE_MAX_BYTES, BUNDLE_MAX_OBJECTS} from '../session-bundle-format.js';
import {LOCAL_WITNESS_GRAPH_MAX_BYTES, LOCAL_WITNESS_GRAPH_MAX_OBJECTS,
  checkWitnessGraphLimit} from '../session-witness-graph-limits.js';

const rejected = (scope, bytes, objects, code) => assert.throws(
  () => checkWitnessGraphLimit(scope, bytes, objects),
  error => error.code === code,
);

test('the exact cold-127 graph fits local storage but cannot become a portable archive', () => {
  assert.equal(BUNDLE_MAX_BYTES, 4 * 1024 ** 3);
  assert.equal(BUNDLE_MAX_OBJECTS, 65536);
  assert.equal(LOCAL_WITNESS_GRAPH_MAX_BYTES, 64 * 1024 ** 3);
  assert.equal(LOCAL_WITNESS_GRAPH_MAX_OBJECTS, 262144);
  const committed = 4_281_733_856;
  const candidate = 4_311_983_484;
  checkWitnessGraphLimit('archive', committed, 1166);
  checkWitnessGraphLimit('local', candidate, 1172);
  rejected('archive', candidate, 1172, 'BundleBound');
});

test('both scopes reject their own byte and object limits without integer overflow', () => {
  checkWitnessGraphLimit('archive', BUNDLE_MAX_BYTES, BUNDLE_MAX_OBJECTS - 1);
  rejected('archive', BUNDLE_MAX_BYTES + 1, 1, 'BundleBound');
  rejected('archive', 1, BUNDLE_MAX_OBJECTS, 'BundleBound');
  checkWitnessGraphLimit('local', LOCAL_WITNESS_GRAPH_MAX_BYTES, LOCAL_WITNESS_GRAPH_MAX_OBJECTS - 1);
  rejected('local', LOCAL_WITNESS_GRAPH_MAX_BYTES + 1, 1, 'LocalGraphBound');
  rejected('local', 1, LOCAL_WITNESS_GRAPH_MAX_OBJECTS, 'LocalGraphBound');
  rejected('local', Number.MAX_SAFE_INTEGER + 1, 1, 'LocalGraphBound');
  rejected('local', 1, -1, 'LocalGraphBound');
  rejected('untrusted', 1, 1, 'BundleCompatibility');
});
