export const STANDARD_LIMITS = Object.freeze({
  textBytes: 49152, tokens: 8192, glslBytes: 262144, instructions: 768,
  temporaryRegisters: 512, constantVectors: 512, immediateVectors: 32,
  ioRegisters: 32, vertexAttributes: 16, genericSemantics: 16,
  samplers: 16, colorOutputs: 4, flowDepth: 32, lines: 1536, lineBytes: 512,
});
const fail = (code, message) => ({ ok: false, error: { code, message } });
function fields(request, names) {
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const keys = Reflect.ownKeys(request);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) return null;
  const own = names.map(key => Object.getOwnPropertyDescriptor(request, key));
  if (own.some(field => !field || !("value" in field))) return null;
  return own.map(field => field.value);
}
function textError(text) {
  if (typeof text !== "string") return fail("invalid-input", "TGSI requires primitive text strings.");
  if (text.length > STANDARD_LIMITS.textBytes) return fail("input-too-large", "TGSI text exceeds 49152 bytes.");
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) return fail("invalid-input", "TGSI is outside the bounded standard GLES3 grammar.");
  return null;
}
/** Host-selected standard precision compiler. Each instance owns its fixed
 * Wasm memory; results own all strings and records. It exposes no exact facts,
 * keys, private source/geometry tuples, or implicit fallback to another facet. */
export async function createVirglStandardShaderBridge(options = {}) {
  const { default: createModule } = await import("./build/wasm/virgl-shader.mjs");
  const module = await createModule(options);
  function run(texts, call) {
    const pointers = [];
    try {
      for (const text of texts) {
        const pointer = module._malloc(text.length + 1);
        if (!pointer) return fail("allocation-failed", "Wasm standard input allocation failed.");
        pointers.push(pointer);
        for (let i = 0; i < text.length; ++i) module.HEAPU8[pointer + i] = text.charCodeAt(i);
        module.HEAPU8[pointer + text.length] = 0;
      }
      return JSON.parse(module.UTF8ToString(call(pointers)));
    } finally {
      for (const pointer of pointers.reverse()) module._free(pointer);
    }
  }
  return Object.freeze({
    translate(request) {
      let input;
      try { input = fields(request, ["stage", "text"]); }
      catch { return fail("invalid-input", "Standard request reflection failed."); }
      if (!input) return fail("invalid-input", "Provide only own stage and text data fields.");
      const [stage, text] = input;
      if (stage !== "vertex" && stage !== "fragment") return fail("unsupported-stage", "Only vertex and fragment stages are supported.");
      const error = textError(text);
      if (error) return error;
      return run([text], ([pointer]) => module._bridge_translate_standard(stage === "vertex" ? 0 : 1, pointer, text.length));
    },
    translatePair(request) {
      let input;
      try { input = fields(request, ["vertexText", "fragmentText"]); }
      catch { return fail("invalid-input", "Standard pair reflection failed."); }
      if (!input) return fail("invalid-input", "Provide only own vertexText and fragmentText data fields.");
      const [vertexText, fragmentText] = input;
      for (const text of input) {
        const error = textError(text);
        if (error) return error;
      }
      return run(input, ([vertex, fragment]) => module._bridge_translate_standard_pair(vertex, vertexText.length, fragment, fragmentText.length));
    },
    translatePairTyped(request) {
      let input;
      try { input = fields(request, ["vertexText", "fragmentText", "signedMask", "unsignedMask"]); }
      catch { return fail("invalid-input", "Typed standard pair reflection failed."); }
      if (!input) return fail("invalid-input", "Provide only own texts and signed/unsigned mask data fields.");
      const [vertexText, fragmentText, signedMask, unsignedMask] = input;
      if (![signedMask, unsignedMask].every(mask => Number.isInteger(mask) && mask >= 0 && mask <= 0xffff) ||
          (signedMask & unsignedMask) !== 0) return fail("invalid-input", "Vertex input masks must be disjoint 16-bit integers.");
      for (const text of [vertexText, fragmentText]) {
        const error = textError(text);
        if (error) return error;
      }
      return run([vertexText, fragmentText], ([vertex, fragment]) => module._bridge_translate_standard_pair_typed(
        vertex, vertexText.length, fragment, fragmentText.length, signedMask, unsignedMask));
    },
  });
}
