/** Original F16/F32 color layouts; dormant outside an explicit float owner. */
export const STANDARD_FLOAT_COLOR_TRANSFER_PROFILE = "virgl-standard-float-color-transfers-v1";
const formats = Object.freeze(Object.fromEntries([
 [91, {"format":91,"name":"R16_FLOAT","precision":16,"components":1,"pixelBytes":2,"nativePixelBytes":2,"readPixelBytes":16,"upload":"RED","type":"HALF_FLOAT","lanes":[0,"0","0","1"],"implicitAlpha":true,"render":true,"internal":"R16F"}],
 [92, {"format":92,"name":"R16G16_FLOAT","precision":16,"components":2,"pixelBytes":4,"nativePixelBytes":4,"readPixelBytes":16,"upload":"RG","type":"HALF_FLOAT","lanes":[0,1,"0","1"],"implicitAlpha":true,"render":true,"internal":"RG16F"}],
 [93, {"format":93,"name":"R16G16B16_FLOAT","precision":16,"components":3,"pixelBytes":6,"nativePixelBytes":8,"readPixelBytes":16,"upload":"RGBA","type":"HALF_FLOAT","lanes":[0,1,2,"1"],"implicitAlpha":true,"render":true,"internal":"RGBA16F"}],
 [94, {"format":94,"name":"R16G16B16A16_FLOAT","precision":16,"components":4,"pixelBytes":8,"nativePixelBytes":8,"readPixelBytes":16,"upload":"RGBA","type":"HALF_FLOAT","lanes":[0,1,2,3],"implicitAlpha":false,"render":true,"internal":"RGBA16F"}],
 [28, {"format":28,"name":"R32_FLOAT","precision":32,"components":1,"pixelBytes":4,"nativePixelBytes":4,"readPixelBytes":16,"upload":"RED","type":"FLOAT","lanes":[0,"0","0","1"],"implicitAlpha":true,"render":true,"internal":"R32F"}],
 [29, {"format":29,"name":"R32G32_FLOAT","precision":32,"components":2,"pixelBytes":8,"nativePixelBytes":8,"readPixelBytes":16,"upload":"RG","type":"FLOAT","lanes":[0,1,"0","1"],"implicitAlpha":true,"render":true,"internal":"RG32F"}],
 [30, {"format":30,"name":"R32G32B32_FLOAT","precision":32,"components":3,"pixelBytes":12,"nativePixelBytes":16,"readPixelBytes":16,"upload":"RGBA","type":"FLOAT","lanes":[0,1,2,"1"],"implicitAlpha":true,"render":true,"internal":"RGBA32F"}],
 [31, {"format":31,"name":"R32G32B32A32_FLOAT","precision":32,"components":4,"pixelBytes":16,"nativePixelBytes":16,"readPixelBytes":16,"upload":"RGBA","type":"FLOAT","lanes":[0,1,2,3],"implicitAlpha":false,"render":true,"internal":"RGBA32F"}],
].map(([id, row]) => [id, Object.freeze({...row, lanes: Object.freeze(row.lanes)})])));
export const floatColorFormat = format => Number.isInteger(format) && Object.hasOwn(formats, format) ? formats[format] : null;

/** Binary32 to binary16, nearest-even; native NaNs retain only classification. */
export function halfFromFloatWord(input) {
  const sign = (input >>> 16) & 0x8000, exponent = (input >>> 23) & 255, fraction = input & 0x7fffff;
  if (exponent === 255) return sign | 0x7c00 | (fraction ? 0x200 : 0);
  if (exponent >= 143) return sign | 0x7c00;
  if (exponent < 102) return sign;
  if (exponent >= 113) return sign | (((exponent - 112) << 10) + ((fraction + 0xfff + ((fraction >>> 13) & 1)) >>> 13));
  const mantissa = 0x800000 | fraction, shift = 126 - exponent, result = mantissa >>> shift, remainder = mantissa & ((1 << shift) - 1), halfway = 1 << (shift - 1);
  return sign | (result + Number(remainder > halfway || remainder === halfway && (result & 1)));
}
