/** Original packed UNORM fields; selected storage authority only. */
export const STANDARD_PACKED_NORMALIZED_TRANSFER_PROFILE = "virgl-standard-packed-normalized-transfers-v1";
const formats = Object.freeze(Object.fromEntries([
  [5, "B5G5R5A1_UNORM", [5, 5, 5, 1], [10, 5, 0, 15]],
  [6, "B4G4R4A4_UNORM", [4, 4, 4, 4], [8, 4, 0, 12]],
  [7, "B5G6R5_UNORM", [5, 6, 5, 0], [11, 5, 0, 0]],
  [8, "R10G10B10A2_UNORM", [10, 10, 10, 2], [0, 10, 20, 30]],
  [122, "B5G5R5X1_UNORM", [5, 5, 5, 1], [10, 5, 0, 15], true],
  [131, "B10G10R10A2_UNORM", [10, 10, 10, 2], [20, 10, 0, 30]],
  [135, "B4G4R4X4_UNORM", [4, 4, 4, 4], [8, 4, 0, 12], true],
  [308, "R10G10B10X2_UNORM", [10, 10, 10, 2], [0, 10, 20, 30], true],
  [319, "R4G4B4A4_UNORM", [4, 4, 4, 4], [0, 4, 8, 12]],
  [320, "R5G5B5A1_UNORM", [5, 5, 5, 1], [0, 5, 10, 15]],
  [321, "R5G6B5_UNORM", [5, 6, 5, 0], [0, 5, 11, 0]],
  [407, "R4G4B4X4_UNORM", [4, 4, 4, 4], [0, 4, 8, 12], true],
  [409, "R5G5B5X1_UNORM", [5, 5, 5, 1], [0, 5, 10, 15], true],
].map(([format, name, bits, offsets, opaque = false]) => {
  const family = bits[0] === 10 ? 3 : bits[0] === 4 ? 1 : bits[1] === 6 ? 0 : 2;
  const pixelBytes = family === 3 ? 4 : 2;
  return [format, Object.freeze({format, name, packedNormalized: true, pixelBytes,
    nativePixelBytes: pixelBytes, readPixelBytes: 4, implicitAlpha: opaque || bits[3] === 0,
    internal: ["RGB565", "RGBA4", "RGB5_A1", "RGB10_A2"][family],
    upload: family === 0 ? "RGB" : "RGBA",
    type: ["UNSIGNED_SHORT_5_6_5", "UNSIGNED_SHORT_4_4_4_4", "UNSIGNED_SHORT_5_5_5_1", "UNSIGNED_INT_2_10_10_10_REV"][family],
    readType: family === 3 ? "UNSIGNED_INT_2_10_10_10_REV" : "UNSIGNED_BYTE",
    fields: Object.freeze(bits.map((width, lane) => Object.freeze({bits: width,
      offset: offsets[lane], nativeOffset: [[11, 5, 0, 0], [12, 8, 4, 0], [11, 6, 1, 0], [0, 10, 20, 30]][family][lane]}))),
    render: true})];
})));
export const packedNormalizedColorFormat = format => Number.isInteger(format) && Object.hasOwn(formats, format) ? formats[format] : null;
