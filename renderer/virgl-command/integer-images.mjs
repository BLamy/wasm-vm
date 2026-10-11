/** Original integer image words; dormant outside the selected integer owner. */
export const STANDARD_INTEGER_COLOR_TRANSFER_PROFILE = "virgl-standard-integer-color-transfers-v1";
const formats = Object.freeze(Object.fromEntries([8, 16, 32].flatMap((integerBits, widthIndex) =>
  [false, true].flatMap(signed => [1, 2, 3, 4].map(components => {
    const format = 177 + widthIndex * 8 + Number(signed) * 4 + components - 1;
    const nativeComponents = components === 3 ? 4 : components;
    const prefix = ["R", "RG", "RGB", "RGBA"][nativeComponents - 1];
    const name = ["R", "G", "B", "A"].slice(0, components).map(lane => lane + integerBits).join("") + (signed ? "_SINT" : "_UINT");
    return [format, Object.freeze({format, name, integerBits, signed, components,
      pixelBytes: components * integerBits / 8, nativePixelBytes: nativeComponents * integerBits / 8,
      readPixelBytes: 16, internal: prefix + integerBits + (signed ? "I" : "UI"),
      upload: ["RED_INTEGER", "RG_INTEGER", "RGB_INTEGER", "RGBA_INTEGER"][nativeComponents - 1],
      type: (signed ? ["BYTE", "SHORT", "INT"] : ["UNSIGNED_BYTE", "UNSIGNED_SHORT", "UNSIGNED_INT"])[widthIndex],
      readType: signed ? "INT" : "UNSIGNED_INT", readFormat: "RGBA_INTEGER",
      lanes: Object.freeze(Array.from({length: 4}, (_, lane) => lane < components ? lane : lane === 3 ? "1" : "0")),
      implicitAlpha: components < 4, render: true})];
  }))
)));
export const integerColorFormat = format => Number.isInteger(format) && Object.hasOwn(formats, format) ? formats[format] : null;
