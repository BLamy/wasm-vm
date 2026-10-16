import assert from 'node:assert/strict';
import {direct as oldDirect} from '../virgl-dimensional-shaders/abi.mjs';
import {selectorKeys} from './fixtures.mjs';
export function direct(module, c) {
  if (c.kind < 43) return oldDirect(module, c);
  const pointers = [];
  try {
    for (const text of [c.a, c.b]) {
      const bytes = Buffer.from(text), p = module._malloc(bytes.length + 1); assert.ok(p);
      module.HEAPU8.set(bytes, p); module.HEAPU8[p + bytes.length] = 0; pointers.push(p);
    }
    const [a, b] = pointers, masks = selectorKeys.map(k => c.selectors[k]);
    const stage = module._bridge_translate_standard_dimensional_shadow_texture;
    const pair = module._bridge_translate_standard_dimensional_shadow_texture_pair;
    const output = c.kind < 45 ? stage(c.kind - 43, a, Buffer.byteLength(c.a), masks[5], masks[6])
      : c.kind < 48 ? pair(c.kind === 46 ? 0 : a, Buffer.byteLength(c.a), c.kind === 47 ? 0 : b, Buffer.byteLength(c.b), ...masks)
      : stage(c.kind === 49 ? -1 : 0, c.kind === 48 ? 0 : a, Buffer.byteLength(c.a), masks[5], masks[6]);
    return module.UTF8ToString(output);
  } finally { pointers.reverse().forEach(p => module._free(p)); }
}
