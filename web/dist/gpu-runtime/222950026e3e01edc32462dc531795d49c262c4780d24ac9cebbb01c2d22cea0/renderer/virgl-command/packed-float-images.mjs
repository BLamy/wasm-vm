/** Original unsigned packed floating image; dormant outside its selected owner. */
export const STANDARD_PACKED_FLOAT_COLOR_TRANSFER_PROFILE = 'virgl-standard-r11g11b10-color-transfers-v1';
const format = Object.freeze({format:124,name:'R11G11B10_FLOAT',components:3,pixelBytes:4,nativePixelBytes:4,readPixelBytes:16,upload:'RGB',type:'UNSIGNED_INT_10F_11F_11F_REV',lanes:Object.freeze([0,1,2,'1']),implicitAlpha:true,render:true,internal:'R11F_G11F_B10F',packedFloat:true});
export const packedFloatColorFormat = id => id === 124 ? format : null;
function unsignedFloatWord(word, mantissaBits) {
 const exponent = word >>> 23 & 255, fraction = word & 0x7fffff, maximum = (31 << mantissaBits) - 1;
 if (exponent === 255) return fraction ? 31 << mantissaBits | 1 << (mantissaBits - 1) : word >>> 31 ? 0 : 31 << mantissaBits;
 if (word >>> 31) return 0;
 if (exponent >= 143) return maximum;
 const drop = 23 - mantissaBits;
 if (exponent >= 113) return Math.min(maximum, ((exponent - 112) << mantissaBits) + ((fraction + (1 << (drop - 1)) - 1 + (fraction >>> drop & 1)) >>> drop));
 if (exponent < 112 - mantissaBits) return 0;
 const shift = 136 - mantissaBits - exponent, bits = 0x800000 | fraction, kept = bits >>> shift,
  low = bits & ((1 << shift) - 1), halfway = 1 << (shift - 1);
 return kept + Number(low > halfway || low === halfway && (kept & 1));
}
/** Repack actual native RGBA/FLOAT read words into original public RGB fields. */
export function r11g11b10FromFloatWords(red, green, blue) {
 return (unsignedFloatWord(red, 6) | unsignedFloatWord(green, 6) << 11 | unsignedFloatWord(blue, 5) << 22) >>> 0;
}
