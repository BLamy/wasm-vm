// Local sessions can share physical chunks across many distinct checkpoint
// objects. Their logical closure therefore needs a separate bound from a
// portable archive, which must contain every object's bytes in full.
import {BUNDLE_MAX_BYTES, BUNDLE_MAX_OBJECTS, bundleNeed} from './session-bundle-format.js';

export const LOCAL_WITNESS_GRAPH_MAX_BYTES = 64 * 1024 ** 3;
export const LOCAL_WITNESS_GRAPH_MAX_OBJECTS = 262144;

export function checkWitnessGraphLimit(scope, bytes, objects) {
  bundleNeed(scope === 'local' || scope === 'archive', 'witness graph scope', 'BundleCompatibility');
  const local = scope === 'local';
  const maxBytes = local ? LOCAL_WITNESS_GRAPH_MAX_BYTES : BUNDLE_MAX_BYTES;
  const maxObjects = local ? LOCAL_WITNESS_GRAPH_MAX_OBJECTS : BUNDLE_MAX_OBJECTS;
  bundleNeed(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= maxBytes
    && Number.isSafeInteger(objects) && objects >= 0 && objects < maxObjects,
  local ? 'local byte/object bound' : 'archive byte/object bound',
  local ? 'LocalGraphBound' : 'BundleBound');
}
