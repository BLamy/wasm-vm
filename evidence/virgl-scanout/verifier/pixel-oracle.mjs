// Independent literal oracle prepared before T11c evidence. No runtime imports.
// Six asymmetric pixels; native GPU row zero is the bottom row. Alpha channels
// use RGB endpoints so Canvas2D premultiply/unpremultiply preserves exact bytes.
export const WIDTH = 3;
export const HEIGHT = 2;
export const GPU_BOTTOM_UP_RGBA = Object.freeze([
  255,255,0,255, 255,0,255,170, 0,255,255,85,
  255,0,0,255,   0,255,0,170,  0,0,255,85,
]);
export const CANVAS_TOP_DOWN_RGBA = Object.freeze([
  255,0,0,255,   0,255,0,170,  0,0,255,85,
  255,255,0,255, 255,0,255,170,0,255,255,85,
]);
export const CANONICAL_BGRA_WORDS = Object.freeze([
  0xffff0000, 0xaa00ff00, 0x550000ff,
  0xffffff00, 0xaaff00ff, 0x5500ffff,
]);
export function assertLiteralCanvas(actual, label = 'actual canvas') {
  if (actual.length !== CANVAS_TOP_DOWN_RGBA.length) throw Error(`${label}: wrong pixel length`);
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== CANVAS_TOP_DOWN_RGBA[i]) throw Error(`${label}: literal pixel byte ${i} expected ${CANVAS_TOP_DOWN_RGBA[i]}, got ${actual[i]}`);
  }
}
export function assertCanonicalWords(actual) {
  if (actual.length !== CANONICAL_BGRA_WORDS.length) throw Error('canonical word length');
  for (let i = 0; i < actual.length; i++) {
    if ((actual[i] >>> 0) !== CANONICAL_BGRA_WORDS[i]) throw Error(`canonical word ${i} differs`);
  }
}
