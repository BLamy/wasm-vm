// Independent value-level oracle. Binary search brackets an exact rational
// between adjacent binary32 values; no alignment, limb product, jam or helper
// implementation is consulted. NaNs follow the explicitly admitted policy.
export function classify(word) {
  const sign = word >>> 31, exponent = (word >>> 23) & 255, fraction = word & 0x7fffff;
  if (exponent === 255) return { kind: fraction ? 'nan' : 'infinity', sign };
  const significand = BigInt(exponent ? fraction + 0x800000 : fraction);
  const power = exponent ? exponent - 150 : -149;
  return { kind: 'finite', sign,
    n: (sign ? -1n : 1n) * (power >= 0 ? significand << BigInt(power) : significand),
    d: power >= 0 ? 1n : 1n << BigInt(-power) };
}
const compare = (n, d, value) => n * value.d - value.n * d;
export function roundRational(n, d, zeroSign = 0) {
  if (d <= 0n) throw new Error('positive rational denominator');
  if (n === 0n) return zeroSign ? 0x80000000 : 0;
  const sign = n < 0n ? 0x80000000 : 0; if (n < 0n) n = -n;
  // The virtual successor of maximum finite is 2^128. Its even significand
  // wins the overflow midpoint; no infinity is treated as a rational value.
  const overflowMidpoint = (1n << 128n) - (1n << 103n);
  if (n >= overflowMidpoint * d) return (sign | 0x7f800000) >>> 0;
  let low = 0, high = 0x7f7fffff;
  while (low < high) {
    const mid = low + Math.ceil((high - low) / 2);
    if (compare(n, d, classify(mid)) >= 0n) low = mid; else high = mid - 1;
  }
  const below = classify(low), above = low === 0x7f7fffff ?
    { n: 1n << 128n, d: 1n } : classify(low + 1);
  const lowerDistance = (n * below.d - below.n * d) * above.d;
  const upperDistance = (above.n * d - n * above.d) * below.d;
  const selected = lowerDistance < upperDistance || (lowerDistance === upperDistance && !(low & 1)) ? low : low + 1;
  return (sign | selected) >>> 0;
}
export function operation(op, a, b) {
  const x = classify(a), y = classify(b), sign = (a ^ b) >>> 31;
  if (x.kind === 'nan' || y.kind === 'nan') return 0x7fc00000;
  if (op === 'ADD') {
    if (x.kind === 'infinity' || y.kind === 'infinity') {
      if (x.kind === y.kind && x.sign !== y.sign) return 0x7fc00000;
      return x.kind === 'infinity' ? a : b;
    }
    return roundRational(x.n * y.d + y.n * x.d, x.d * y.d,
      x.n === 0n && y.n === 0n && x.sign && y.sign ? 1 : 0);
  }
  if (op === 'MUL') {
    if (x.kind === 'infinity' || y.kind === 'infinity') {
      if ((x.kind === 'finite' && x.n === 0n) || (y.kind === 'finite' && y.n === 0n)) return 0x7fc00000;
      return (sign * 0x80000000 + 0x7f800000) >>> 0;
    }
    return roundRational(x.n * y.n, x.d * y.d, sign);
  }
  throw new Error('closed arithmetic operation ' + op);
}
export function modifier(word, absolute, negative) {
  if (absolute) word &= 0x7fffffff;
  return (negative ? word ^ 0x80000000 : word) >>> 0;
}
export function chain(a, b, c) { return operation('ADD', operation('MUL', a, b), c); }
export function fusedFinite(a, b, c) {
  const [x, y, z] = [a, b, c].map(classify);
  if ([x, y, z].some(v => v.kind !== 'finite')) throw new Error('finite contraction witness');
  return roundRational(x.n * y.n * z.d + z.n * x.d * y.d, x.d * y.d * z.d);
}
export function vectors(seed = 0x5e74bf09) {
  const entries = [], push = (name, a, b, c = [0, 0x80000000, 0xbf800000, 0x3f800000]) => {
    entries.push({ name, a: a.map(x => x >>> 0), b: b.map(x => x >>> 0), c: c.map(x => x >>> 0) });
  };
  push('zero-signs', [0, 0x80000000, 0, 0x80000000], [0, 0, 0x80000000, 0x80000000]);
  push('tiny-signs', [1, 0x80000001, 0x007fffff, 0x807fffff], [0x3f000000, 0x3f000000, 0x3f800001, 0x3f800001]);
  push('cancellation', [0x3f800000, 0x00800000, 0x7f7fffff, 0x007fffff], [0xbf800000, 0x80800000, 0xff7fffff, 0x807fffff]);
  push('halfway-even-odd', [0x3f800000, 0x3f800001, 0xbf800000, 0xbf800001], [0x33800000, 0x33800000, 0xb3800000, 0xb3800000]);
  push('sticky-neighbors', [0x3f800000, 0x3f800000, 0x3f800000, 0x3f800001], [0x33800001, 0x337fffff, 0xb3800001, 0xb3800000]);
  push('limb-carries', [0x3fffffff, 0x3fffffff, 0x3f80ffff, 0x3fff0001], [0x3fffffff, 0x3f80ffff, 0x3fff0001, 0x3f80ffff]);
  push('normal-boundary', [0x00800000, 0x00800000, 0x007fffff, 0x00800001], [0x80000001, 0x3f7fffff, 1, 0x3f000000]);
  push('overflow', [0x7f7fffff, 0xff7fffff, 0x7f000000, 0xff000000], [0x7f7fffff, 0xff7fffff, 0x40000000, 0x40000000]);
  push('infinities', [0x7f800000, 0x7f800000, 0xff800000, 0xff800000], [0xff800000, 0, 0x3f800000, 0x80000000]);
  push('nan-source0', [0x7f800001, 0x7fc01234, 0xff800001, 0xffc05678], [1, 0, 0x7f800000, 0xff800000]);
  push('nan-source1', [0, 0x80000000, 0x3f800000, 0xbf800000], [0x7f800001, 0x7fc01234, 0xff800001, 0xffc05678]);
  push('contraction', [0x3f800001, 0xbf800001, 0x7f7fffff, 1], [0x3f7ffffe, 0x3f7ffffe, 0x40000000, 0x3f000000], [0xbf800000, 0x3f800000, 0xff7fffff, 0x80000000]);
  // Every exponent gap, including 0/31/32+ shifts, both signs and swaps.
  for (let gap = 0; gap <= 254; gap++) {
    const small = ((254 - gap) << 23) | 1;
    push('gap-' + gap, [0x7f7fffff, 0xff7fffff, small, (small | 0x80000000) >>> 0],
      [small, small, 0x7f7fffff, 0x7f7fffff]);
  }
  // Every possible subnormal leading bit and both product orientations.
  for (let bit = 0; bit < 23; bit++) push('subnormal-leading-' + bit,
    [2 ** bit, (2 ** bit + 0x80000000) >>> 0, 0x3fc00001, 0xbfc00001],
    [0x3fc00001, 0x3fc00001, 2 ** bit, (2 ** bit + 0x80000000) >>> 0]);
  let state = seed >>> 0; const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  for (let i = 0; i < 96; i++) push('seed-' + i, Array.from({ length: 4 }, next), Array.from({ length: 4 }, next), Array.from({ length: 4 }, next));
  return entries;
}
export function proof(seed = 0x5e74bf09) {
  const actual = vectors(seed).map(vector => ({ vector,
    add: vector.a.map((a, i) => operation('ADD', a, vector.b[i])),
    mul: vector.a.map((a, i) => operation('MUL', a, vector.b[i])),
    chain: vector.a.map((a, i) => chain(a, vector.b[i], vector.c[i])) }));
  return { policy: 'binary32-nearest-even-canonical-nan-gradual', seed: seed >>> 0,
    contraction: { a: 0x3f800001, b: 0x3f7ffffe, c: 0xbf800000,
      separate: chain(0x3f800001, 0x3f7ffffe, 0xbf800000), fused: fusedFinite(0x3f800001, 0x3f7ffffe, 0xbf800000) },
    cases: actual };
}
export function kernelVectors(kernel, seed = 0x5e74bf09) {
  if (kernel.op === 'ORIGINAL' || kernel.op === 'RASTER') return [
    [0x3e800000,0x3f000000,0x3f400000,0x3f800000],
    [0x80000000,0,0x80000000,0], [0x3f800000,0x3e800000,0x3f000000,0x3f000000],
    [0,0x3f800000,0,0x3f800000], [0x3f000000,0x3f000000,0x3f000000,0x3f800000]
  ].map((color,i) => ({name:'original-'+i,color}));
  const entries = vectors(seed);
  return kernel.vectorSet === 'targeted' ? entries.filter((v,i) => i < 12 || v.name.startsWith('subnormal-leading-') || /^seed-[0-3]$/.test(v.name)) : entries;
}
export function bank(kernel, vector) {
  if (kernel.op === 'ORIGINAL') return [0x3f800000,0,0,0,0,0x3f800000,0,0,0,0,0,0,...vector.color];
  if (kernel.op === 'RASTER') return [...vector.color,0,0,0,0];
  return [vector.a,vector.b,vector.c].flatMap(words => [
    ...words.map(w => (0x3f800000 | (w >>> 16)) >>> 0),
    ...words.map(w => (0x3f800000 | (w & 65535)) >>> 0)]);
}
export function expected(kernel, vector) {
  if (kernel.op === 'ORIGINAL' || kernel.op === 'RASTER') return { words:null,color:(kernel.op === 'RASTER'?[0x3e800000,0x3f000000,...vector.color.slice(2)]:vector.color).map(w => {
    const value=classify(w);if(value.kind!=='finite')throw new Error('finite original output');
    return Math.round(Math.max(0,Math.min(1,Number(value.n)/Number(value.d)))*255);
  }) };
  let a=vector.a.slice(),b=vector.b.slice();
  if(kernel.variant==='swizzle'){a=[a[3],a[2],a[1],a[0]];b=[b[1],b[0],b[3],b[2]];}
  const absolute=kernel.variant.startsWith('absolute'),negative=kernel.variant==='negative'||kernel.variant==='absolute-negative';
  a=a.map(w=>modifier(w,absolute,negative));b=b.map(w=>modifier(w,absolute,negative));
  const words=kernel.variant==='alias-left'?vector.a.slice():kernel.variant==='alias-right'?vector.b.slice():[0,0,0,0];
  for(const component of kernel.mask){const lane='xyzw'.indexOf(component);words[lane]=kernel.op==='CHAIN'?
    chain(a[lane],b[lane],vector.c[lane]):operation(kernel.op,a[lane],b[lane]);}
  return {words,branch:kernel.variant==='branch'?vector.c[0]!==0:null};
}
