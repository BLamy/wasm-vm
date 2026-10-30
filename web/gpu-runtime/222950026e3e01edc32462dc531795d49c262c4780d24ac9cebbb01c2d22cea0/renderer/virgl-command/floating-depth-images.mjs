/** Selected original floating depth fields and their owned native byte costs. */
export const STANDARD_FLOATING_DEPTH_TRANSFER_PROFILE = "virgl-standard-floating-depth-transfers-v1";
const formats = Object.freeze(Object.fromEntries([
  [18, "Z32_FLOAT", false], [126, "Z32_FLOAT_S8X24_UINT", true],
].map(([format, name, stencil]) => [format, Object.freeze({
  format, name, floatingDepth: true, stencil, pixelBytes: stencil ? 8 : 4,
  nativePixelBytes: stencil ? 8 : 4, allocationPixelBytes: stencil ? 16 : 4,
  uploadPixelBytes: stencil ? 8 : 0, readPixelBytes: stencil ? 8 : 4,
  conversionPixelBytes: stencil ? 16 : 4,
  internal: stencil ? "DEPTH32F_STENCIL8" : "DEPTH_COMPONENT32F",
  upload: stencil ? "DEPTH_STENCIL" : "DEPTH_COMPONENT",
  type: stencil ? "FLOAT_32_UNSIGNED_INT_24_8_REV" : "FLOAT",
})])));
export const floatingDepthFormat = format => Number.isInteger(format) && Object.hasOwn(formats, format) ? formats[format] : null;
