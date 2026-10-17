/** Explicit original UN16 depth storage; historical depth admission stays closed. */
export const STANDARD_UNORM_DEPTH_TRANSFER_PROFILE = "virgl-standard-unorm-depth-transfers-v1";
const format = Object.freeze({
  format: 16, name: "Z16_UNORM", unormDepth: true, stencil: false,
  pixelBytes: 2, nativePixelBytes: 2, allocationPixelBytes: 2,
  readPixelBytes: 4, conversionPixelBytes: 4,
  internal: "DEPTH_COMPONENT16", upload: "DEPTH_COMPONENT", type: "UNSIGNED_SHORT",
});
export const unormDepthFormat = value => value === 16 ? format : null;

/** Original packed fixed depth has a separately selected storage boundary. */
export const STANDARD_PACKED_DEPTH_TRANSFER_PROFILE = "virgl-standard-packed-depth-transfers-v1";
const packedFormats = Object.freeze(Object.fromEntries([
  [20, "S8_UINT_Z24_UNORM", true], [21, "Z24X8_UNORM", false],
].map(([format, name, stencil]) => [format, Object.freeze({
  format, name, packedDepth: true, stencil,
  pixelBytes: 4, nativePixelBytes: 4, allocationPixelBytes: 4,
  readPixelBytes: stencil ? 8 : 4, conversionPixelBytes: stencil ? 12 : 4,
  internal: stencil ? "DEPTH24_STENCIL8" : "DEPTH_COMPONENT24",
  upload: stencil ? "DEPTH_STENCIL" : "DEPTH_COMPONENT",
  type: stencil ? "UNSIGNED_INT_24_8" : "UNSIGNED_INT",
})])));
export const packedDepthFormat = value => Number.isInteger(value) && Object.hasOwn(packedFormats, value) ? packedFormats[value] : null;
