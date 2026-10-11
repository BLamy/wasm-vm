/** Explicit original UN16 depth storage; historical depth admission stays closed. */
export const STANDARD_UNORM_DEPTH_TRANSFER_PROFILE = "virgl-standard-unorm-depth-transfers-v1";
const format = Object.freeze({
  format: 16, name: "Z16_UNORM", unormDepth: true, stencil: false,
  pixelBytes: 2, nativePixelBytes: 2, allocationPixelBytes: 2,
  readPixelBytes: 4, conversionPixelBytes: 4,
  internal: "DEPTH_COMPONENT16", upload: "DEPTH_COMPONENT", type: "UNSIGNED_SHORT",
});
export const unormDepthFormat = value => value === 16 ? format : null;
