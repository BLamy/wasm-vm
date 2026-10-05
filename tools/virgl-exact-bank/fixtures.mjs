// Literal complete TGSI is unchanged. The new metadata is an explicit trusted-host test wrapper.
export const SEEDS = [0x6a09e667, 0xbb67ae85, 0x3c6ef372];
export const PROFILE = 'virgl-webgl2-raw-bits-v42';
export const KIND = 'constant-bank-exact-u32-v1';
export const VERTEX = 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nIMM[0] FLT32 {.25,.5,.5,1}\nMOV OUT[0], IN[0]\nMOV OUT[1], IMM[0]\nEND\n';
export const FRAGMENT = 'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nMOV OUT[0], IN[0]\nEND\n';
export const COMPOSITION_VERTEX = 'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL OUT[3], GENERIC[2]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[0]\nMOV OUT[2], IN[0]\nMOV OUT[3], IN[0]\nEND\n';
export const clone = value => JSON.parse(JSON.stringify(value));
export function wrapExact(original, stage, components) {
  if (!original.ok) throw new Error('The unchanged real compiler fixture must succeed.');
  const result = clone(original), uniforms = result.metadata.uniforms;
  if (uniforms.length !== 1) throw new Error('The trusted host wrapper requires one declared bank.');
  result.metadata.exactBaseProfile = result.metadata.profile;
  result.metadata.profile = PROFILE;
  result.metadata.constantExactDomains = [{kind: KIND, stage, slot: 0,
    name: stage === 'vertex' ? 'vsconst0' : 'fsconst0', count: uniforms[0].count, components: clone(components)}];
  return result;
}
export function literalBank(fixture, count, word = 1) {
  const words = Array(Math.min(count, 46) * 4).fill(0);
  for (const entry of fixture.components) words[entry.register * 4 + entry.component] = entry.word;
  words[fixture.components[0].register * 4 + fixture.components[0].component] = word;
  return words;
}
export function inheritedPlan(name, count) {
  const words = Array(Math.min(count, 46) * 4).fill(0);
  if (name.includes('radial')) words[16] = 0x3f800000;
  if (name.includes('count')) words[36] = 1;
  const components = [{register: Math.min(count, 46) - 1, component: 3, word: 0}];
  const attacks = name.includes('count') ? [{index: 36, word: 19, code: 'constant-constraint-error'}] : [];
  if (name.includes('radial')) attacks.push({index: 16, word: 0, code: 'constant-radial-domain-error'});
  if (name.includes('raster')) attacks.push({index: 3, word: 1, code: 'constant-raster-domain-error'});
  if (name.includes('conversion')) attacks.push({index: 0, word: 0x4f000000, code: 'constant-conversion-domain-error'});
  attacks.push({index: 1, word: 0x7f800000, code: name.includes('conversion') ? 'constant-conversion-domain-error' : 'constant-domain-error'});
  return {words, components, attacks};
}
