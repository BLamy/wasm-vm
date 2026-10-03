// Literal oracles are independent of generated GLSL and translator metadata.
// FBO coordinates and texture rows use WebGL's bottom-left convention.
export const shaders = Object.freeze([
  { name: "passthrough", stage: "vertex", file: "passthrough.vert.tgsi" },
  { name: "transform", stage: "vertex", file: "transform.vert.tgsi" },
  { name: "linkage", stage: "fragment", file: "linkage.frag.tgsi" },
  { name: "arithmetic", stage: "fragment", file: "arithmetic.frag.tgsi" },
  { name: "texture", stage: "fragment", file: "texture.frag.tgsi" },
  { name: "alpha", stage: "fragment", file: "alpha.frag.tgsi" },
]);

const solid = (rgba) => [{ rect: [4, 4, 24, 24], rgba }];
const quarters = (colors) => colors.map((rgba, i) => ({
  rect: [4 + (i % 2) * 16, 4 + Math.floor(i / 2) * 16, 8, 8], rgba,
}));

export const draws = Object.freeze([
  {
    name: "generic-linkage-red", vertex: "passthrough", fragment: "linkage",
    varying: [1, 0, 0, 1], expected: solid([255, 0, 0, 255]),
  },
  {
    name: "generic-linkage-cyan", vertex: "passthrough", fragment: "linkage",
    varying: [0, 1, 1, 1], expected: solid([0, 255, 255, 255]),
  },
  {
    name: "uniform-mul-add-alpha", vertex: "passthrough", fragment: "arithmetic",
    uniforms: { fragment: [[1, 1, 0, 1], [0, 0.25, 1, 0]] },
    expected: solid([128, 128, 255, 128]),
  },
  {
    name: "uniform-update", vertex: "passthrough", fragment: "arithmetic",
    uniforms: { fragment: [[0, 0, 1, 0], [0, 1, 0, 1]] },
    expected: solid([0, 255, 255, 255]),
  },
  {
    name: "vertex-uniform-transform", vertex: "transform", fragment: "linkage",
    varying: [0, 1, 0, 1], uniforms: { vertex: [[0.5, 0.5, 1, 1]] },
    clear: [0, 0, 1, 1], expected: [
      { rect: [10, 10, 12, 12], rgba: [0, 255, 0, 255] },
      { rect: [2, 2, 4, 28], rgba: [0, 0, 255, 255] },
      { rect: [26, 2, 4, 28], rgba: [0, 0, 255, 255] },
    ],
  },
  {
    name: "nearest-texture-rgba", vertex: "passthrough", fragment: "texture",
    texture: [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 64, 255, 255, 0, 0],
    uniforms: { fragment: [[1, 1, 1, 1]] },
    expected: quarters([[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 64], [255, 255, 0, 0]]),
  },
  {
    name: "texture-tint-uniform", vertex: "passthrough", fragment: "texture",
    texture: [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255],
    uniforms: { fragment: [[1, 0.5, 0, 1]] },
    expected: quarters([[255, 0, 0, 255], [0, 128, 0, 255], [0, 0, 0, 255], [255, 128, 0, 255]]),
  },
  {
    name: "mad-alpha-output", vertex: "passthrough", fragment: "alpha",
    varying: [1, 0, 0, 1], uniforms: { fragment: [[0.5, 0, 0, 0]] },
    expected: solid([255, 0, 0, 128]),
  },
  {
    name: "mad-source-over-blue", vertex: "passthrough", fragment: "alpha",
    varying: [1, 0, 0, 1], uniforms: { fragment: [[0.5, 0, 0, 0]] },
    clear: [0, 0, 1, 1], blend: true, expected: solid([128, 0, 128, 255]),
  },
]);

export function invalidCases(validVertex, limit) {
  return [
    { name: "empty", stage: "vertex", text: "", code: "parse-error" },
    { name: "garbage", stage: "vertex", text: "not a shader\n", code: "parse-error" },
    { name: "missing-end", stage: "vertex", text: validVertex.replace(/END\n?$/, ""), code: "parse-error" },
    { name: "unknown-property", stage: "vertex", text: validVertex.replace("VERT\n", "VERT\nPROPERTY WASM_VM_UNKNOWN_PROPERTY 1\n"), code: "unsupported-feature" },
    { name: "unknown-opcode", stage: "vertex", text: validVertex.replace("MOV OUT[0], IN[0]", "FAKEOP OUT[0], IN[0]"), code: "unsupported-feature" },
    { name: "overflow-register", stage: "vertex", text: validVertex.replaceAll("IN[0]", "IN[4294967296]"), code: "unsupported-feature" },
    { name: "register-outside-profile", stage: "vertex", text: validVertex.replaceAll("IN[1]", "IN[8]"), code: "unsupported-feature" },
    { name: "unsupported-geometry", stage: "geometry", text: "GEOM\nEND\n", code: "unsupported-stage" },
    { name: "stage-mismatch", stage: "fragment", text: validVertex, code: "unsupported-stage" },
    { name: "embedded-nul", stage: "vertex", text: validVertex + "\0MOV OUT[0], IN[0]\n", code: "invalid-input" },
    { name: "non-ascii", stage: "vertex", text: validVertex + "é", code: "invalid-input" },
    { name: "oversized", stage: "vertex", text: "x".repeat(limit + 1), code: "input-too-large" },
    { name: "non-string", stage: "vertex", text: 42, code: "invalid-input" },
  ];
}
