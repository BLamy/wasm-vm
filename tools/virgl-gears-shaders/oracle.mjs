// Hand-written equations for the four additional G1 bodies. The compiler,
// emitted GLSL and decoder are never inputs to these numerical predictions.
const view = new DataView(new ArrayBuffer(4));
export const f = Math.fround;
export function word(value) { view.setFloat32(0, value, true); return view.getUint32(0, true); }
export function number(bits) { view.setUint32(0, bits, true); return view.getFloat32(0, true); }
const add = (a, b) => f(a + b), mul = (a, b) => f(a * b);
const dot = (a, b) => add(add(mul(a[0], b[0]), mul(a[1], b[1])), mul(a[2], b[2]));
const normalize = (a) => {
  const length = dot(a, a);
  if (!(Number.isFinite(length) && length > 0)) throw new Error('Oracle requires nonzero finite vectors');
  const reciprocal = f(1 / Math.sqrt(length));
  return a.map(x => mul(x, reciprocal));
};
export function ulp(actual, expected) {
  if (number(actual) === number(expected)) return 0;
  const ordered = x => x >>> 31 ? 0x80000000 - (x & 0x7fffffff) : 0x80000000 + x;
  return Math.abs(ordered(actual) - ordered(expected));
}
function random(seed) {
  let state = seed >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
}
const identity = () => [[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,1]];
const normalIdentity = () => [[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,0]];

export function gearsEquation(vector) {
  const [position, normal] = vector.inputs, c = vector.constants;
  const clip = Array.from({length: 4}, (_, lane) =>
    add(add(add(mul(c[0][lane], position[0]), mul(c[1][lane], position[1])), mul(c[2][lane], position[2])), c[3][lane]));
  const transformed = Array.from({length: 3}, (_, lane) =>
    add(add(add(mul(c[4][lane], normal[0]), mul(c[5][lane], normal[1])), mul(c[6][lane], normal[2])), c[7][lane]));
  const normalizedNormal = normalize(transformed), normalizedLight = normalize(c[8].slice(0, 3));
  const diffuse = Math.max(dot(normalizedNormal, normalizedLight), 0);
  // Original literal IMM bits 1045220557 represent binary32 ambient 0.2.
  const lit = add(number(1045220557), diffuse);
  const color = [...c[9].slice(0, 3).map(x => mul(lit, x)), c[9][3]];
  return {position: clip.map(word), generic: [color.map(word)], masks: [15],
    budgets: [0, 12], transformed, normalizedNormal, normalizedLight, diffuse, color};
}
export function compositorEquation(vector) {
  const [position, uv] = vector.inputs, c = vector.constants;
  const clip = [...Array.from({length: 3}, (_, lane) =>
    add(add(mul(c[0][lane], position[0]), c[2][lane]), mul(c[1][lane], position[1]))), 1];
  // Separate rounded MUL_PRECISE then ADD_PRECISE; signed zero is significant.
  const auxiliary = c[3].slice(2, 4).map(x => add(mul(x, 0), x));
  return {position: clip.map(word), generic: [[uv[0], uv[1], c[3][0], c[3][1]].map(word), auxiliary.map(word)],
    masks: [15, 3], budgets: [0, 0, 0]};
}
export function gearsVectors(seed) {
  const next = random(seed), pick = () => ((next() % 17) - 8) / 16;
  const axes = [[1,0,0,0], [-1,0,0,0], [0,1,0,0], [0,-1,0,0], [0,0,1,0], [0,0,-1,0], [1,1,1,0], [-1,-1,-1,0]];
  return Array.from({length: 48}, (_, index) => {
    const position = [pick(), pick(), pick(), 1], normal = index < 8 ? axes[index] : [1 + pick(), pick(), pick(), 0];
    const matrix = index < 8 ? identity() : [[.5,pick(),pick(),0], [pick(),.75,pick(),0], [pick(),pick(),.25,0], [pick(),pick(),pick(),1]];
    const normalMatrix = index < 8 ? normalIdentity() : [[1,pick()/4,0,0], [0,.75,pick()/4,0], [pick()/4,0,.5,0], [pick()/8,pick()/8,pick()/8,0]];
    const light = index < 8 ? [1,0,0,0] : [1 + pick(), pick(), pick(), 0];
    const material = [[.125,.25,.5,1], [.5,.25,.125,.5], [.25,.375,.125,0], [0,.125,.25,.75]][index % 4];
    return {name: 'gears-' + index, inputs: [position, normal].map(r => r.map(f)),
      constants: [...matrix, ...normalMatrix, light, material].map(r => r.map(f))};
  });
}
export function compositorVectors(seed) {
  const next = random(seed ^ 0x75a928bd), pick = () => ((next() % 17) - 8) / 8;
  // These lanes are precise arithmetic outputs; only c3.xy is a copied raster
  // domain. Include both zero signs and finite subnormal arithmetic encodings.
  const precise = [0x00000000, 0x80000000, 0x00000001, 0x80000001,
    0x007fffff, 0x807fffff, 0x3eaaaaab, 0xbeaaaaab];
  return Array.from({length: 48}, (_, index) => ({name: 'compositor-' + index,
    inputs: [[pick(),pick(),pick(),1], [pick(),pick(),0,1]].map(r => r.map(f)),
    constants: [[.5,pick(),pick(),0], [pick(),.75,pick(),0], [pick(),pick(),pick(),0],
      [index%2 ? -0 : .25, index%3 ? .5 : -0, number(precise[index%8]), number(precise[(index+3)%8])]].map(r => r.map(f))}));
}
const byte = value => Math.min(255, Math.max(0, Math.round(value * 255)));
export const TEXELS = [17,85,221,0, 231,41,79,64, 62,193,11,128, 109,7,153,255];
export function gearsDraws(seed) {
  return gearsVectors(seed).slice(0, 16).map((vector, index) => {
    const constants = vector.constants.map(r => r.slice()); constants.splice(0, 4, ...identity());
    const input = {...vector, inputs: [[0,0,0,1], vector.inputs[1]], constants};
    const equation = gearsEquation(input);
    return {name: 'gears-pixels-' + index, inputs: input.inputs, vertexConstants: constants,
      fragmentConstants: [], equation, expected: equation.color.map(byte), pixelBudget: 1};
  });
}
export function compositorDraws() {
  return [0, .25, .5, .75, 1].flatMap((coefficient, group) => [0,1,2,3].map(quadrant => {
    const uv = [quadrant%2 ? .75 : .25, quadrant>=2 ? .75 : .25], texel = TEXELS.slice(quadrant*4, quadrant*4+4);
    const constants = [[1,0,0,0], [0,1,0,0], [0,0,0,0], [.25,.5,0,0]];
    const expected = [...texel.slice(0,3).map(x => byte(mul(f(x/255), coefficient))), byte(coefficient)];
    return {name: `compositor-pixels-${group}-${quadrant}`, inputs: [[0,0,0,1], [...uv,0,1]],
      vertexConstants: constants, fragmentConstants: [[coefficient,0,0,0]], uv, texel, coefficient,
      expected, pixelBudget: 1};
  }));
}
