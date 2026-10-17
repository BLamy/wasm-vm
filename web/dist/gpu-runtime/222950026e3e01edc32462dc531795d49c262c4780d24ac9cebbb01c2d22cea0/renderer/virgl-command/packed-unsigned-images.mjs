/** Original packed UINT fields; selected storage authority only. */
export const STANDARD_PACKED_UNSIGNED_TRANSFER_PROFILE = "virgl-standard-packed-unsigned-transfers-v1";
const formats = Object.freeze(Object.fromEntries([
  [225, "B10G10R10A2_UINT", [20, 10, 0, 30]],
  [253, "R10G10B10A2_UINT", [0, 10, 20, 30]],
].map(([format, name, offsets]) => [format, Object.freeze({
  format, name, packedUnsigned: true, integerBits: 32, signed: false, components: 4,
  pixelBytes: 4, nativePixelBytes: 4, readPixelBytes: 16, implicitAlpha: false,
  internal: "RGB10_A2UI", upload: "RGBA_INTEGER", type: "UNSIGNED_INT_2_10_10_10_REV",
  readType: "UNSIGNED_INT", readFormat: "RGBA_INTEGER",
  fields: Object.freeze([10, 10, 10, 2].map((bits, lane) => Object.freeze({bits,
    offset: offsets[lane], nativeOffset: [0, 10, 20, 30][lane]}))), render: true,
})])));
export const packedUnsignedColorFormat = format => Number.isInteger(format) && Object.hasOwn(formats, format) ? formats[format] : null;
