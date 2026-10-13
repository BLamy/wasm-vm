export const STANDARD_LIMITS = Object.freeze({
  textBytes: 49152, tokens: 8192, glslBytes: 262144, instructions: 768,
  temporaryRegisters: 512, constantVectors: 512, immediateVectors: 32,
  ioRegisters: 32, vertexAttributes: 16, genericSemantics: 16,
  samplers: 16, colorOutputs: 4, flowDepth: 32, lines: 1536, lineBytes: 512,
});
export const STANDARD_UNIFORM_LIMITS = Object.freeze({
  ...STANDARD_LIMITS, uniformSlots: 12, uniformVectors: 1024, sanityScratchBytes: 2097152,
});
export const STANDARD_STREAM_OUTPUT_LIMITS = Object.freeze({
  outputs: 128, buffers: 4, componentsPerBuffer: 64, layoutWords: 261,
  strideWords: 65535, streams: 1,
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
  return createStandardBridge(options, false);
}
/** Explicit host-selected dimensional constant-bank compiler. Its distinct
 * profile carries raw-word native block layouts, never resource authority. */
export async function createVirglStandardUniformShaderBridge(options = {}) {
  return createStandardBridge(options, true);
}
/** Explicit original 2D texture operations, including checked host query metadata. */
export async function createVirglStandardTextureShaderBridge(options = {}) {
  return createStandardBridge(options, true, true);
}
/** Original typed samplers and host-format color outputs. This isolated facet
 * retains words; it carries no resource, decoder, execution or capset authority. */
export async function createVirglStandardIntegerImageShaderBridge(options = {}) {
  return createStandardBridge(options, true, true, true);
}
/** Host-owned offset for original INSTANCEID reads during split native draws. */
export async function createVirglStandardInstanceBaseShaderBridge(options = {}) {
  return createStandardBridge(options, true, true, true, true);
}
/** Original floating 2D comparisons with separately owned stage/view controls. */
export async function createVirglStandardShadowTextureShaderBridge(options = {}) {
  return createStandardBridge(options, true, true, true, true, true);
}
/** Original typed volume, cube and array shaders; resource admission is separate. */
export async function createVirglStandardDimensionalTextureShaderBridge(options = {}) {
  return createStandardBridge(options, true, true, true, true, true, true);
}
/** Original cube/array comparisons with distinct reference and cube bias lanes. */
export async function createVirglStandardDimensionalShadowTextureShaderBridge(options = {}) {
  return createStandardBridge(options, true, true, true, true, true, true, true);
}
/** Original packed stream-output layout; capture-buffer selection belongs to
 * the host. This compiler grants no resource, draw or capability authority. */
export async function createVirglStandardStreamOutputShaderBridge(options = {}) {
  return createStandardBridge(options, true, true, true, true, true, true, true, true);
}
async function createStandardBridge(options, uniformBuffers, textureOperations = false, integerImages = false, instanceBase = false, shadowTextures = false, dimensionalTextures = false, dimensionalShadows = false, streamOutput = false) {
  const { default: createModule } = await import("./build/wasm/virgl-shader.mjs");
  const module = await createModule(options);
  if (streamOutput && (typeof module._bridge_translate_standard_stream_output !== "function" ||
      typeof module._bridge_translate_standard_stream_output_pair !== "function"))
    throw new Error("The selected stream-output compiler artifact is missing its C entries.");
  const integerStage = streamOutput ? (...args) => module._bridge_translate_standard_stream_output(...args, 0, 0, 0) : dimensionalShadows ? module._bridge_translate_standard_dimensional_shadow_texture : dimensionalTextures ? module._bridge_translate_standard_dimensional_texture : shadowTextures ? module._bridge_translate_standard_shadow_texture : instanceBase ? module._bridge_translate_standard_instance_base : module._bridge_translate_standard_integer_image;
  const integerPair = streamOutput ? (...args) => module._bridge_translate_standard_stream_output_pair(...args, 0, 0, 0) : dimensionalShadows ? module._bridge_translate_standard_dimensional_shadow_texture_pair : dimensionalTextures ? module._bridge_translate_standard_dimensional_texture_pair : shadowTextures ? module._bridge_translate_standard_shadow_texture_pair : instanceBase ? module._bridge_translate_standard_instance_base_pair : module._bridge_translate_standard_integer_image_pair;
  const uniformPair = integerImages ? (...args) => integerPair(...args, 0, 0) :
    textureOperations ? module._bridge_translate_standard_texture_pair : module._bridge_translate_standard_uniform_pair;
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
  const bridge = {
    translate(request) {
      let input;
      try { input = fields(request, ["stage", "text"]); }
      catch { return fail("invalid-input", "Standard request reflection failed."); }
      if (!input) return fail("invalid-input", "Provide only own stage and text data fields.");
      const [stage, text] = input;
      if (stage !== "vertex" && stage !== "fragment") return fail("unsupported-stage", "Only vertex and fragment stages are supported.");
      const error = textError(text);
      if (error) return error;
      return run([text], ([pointer]) => integerImages ?
        integerStage(stage === "vertex" ? 0 : 1, pointer, text.length, 0, 0) :
        (textureOperations ? module._bridge_translate_standard_texture : uniformBuffers ? module._bridge_translate_standard_uniform :
        module._bridge_translate_standard)(stage === "vertex" ? 0 : 1, pointer, text.length));
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
      return run(input, ([vertex, fragment]) => uniformBuffers ?
        uniformPair(vertex, vertexText.length, fragment, fragmentText.length, 0, 0, 0, 0, 0) :
        module._bridge_translate_standard_pair(vertex, vertexText.length, fragment, fragmentText.length));
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
      return run([vertexText, fragmentText], ([vertex, fragment]) => uniformBuffers ?
        uniformPair(vertex, vertexText.length, fragment, fragmentText.length, signedMask, unsignedMask, 0, 0, 0) :
        module._bridge_translate_standard_pair_typed(vertex, vertexText.length, fragment, fragmentText.length, signedMask, unsignedMask));
    },
    translatePairVertexFormats(request) {
      let input;
      try { input = fields(request, ["vertexText", "fragmentText", "signedMask", "unsignedMask", "packedSignedMask", "packedNormalizedMask"]); }
      catch { return fail("invalid-input", "Vertex format pair reflection failed."); }
      if (!input) return fail("invalid-input", "Provide only own texts and vertex format mask data fields.");
      const [vertexText, fragmentText, signedMask, unsignedMask, packedSignedMask, packedNormalizedMask] = input;
      if (![signedMask, unsignedMask, packedSignedMask, packedNormalizedMask].every(mask => Number.isInteger(mask) && mask >= 0 && mask <= 0xffff) ||
          (signedMask & unsignedMask) !== 0 || ((signedMask | unsignedMask) & packedSignedMask) !== 0 ||
          (packedNormalizedMask & ~packedSignedMask) !== 0) return fail("invalid-input", "Vertex format masks must be compatible 16-bit integers.");
      for (const text of [vertexText, fragmentText]) {
        const error = textError(text);
        if (error) return error;
      }
      return run([vertexText, fragmentText], ([vertex, fragment]) => uniformBuffers ?
        uniformPair(vertex, vertexText.length, fragment, fragmentText.length, signedMask, unsignedMask, packedSignedMask, packedNormalizedMask, 0) :
        module._bridge_translate_standard_pair_vertex_formats(vertex, vertexText.length, fragment, fragmentText.length, signedMask, unsignedMask, packedSignedMask, packedNormalizedMask));
    },
  };
  if (uniformBuffers) bridge.translatePairUniforms = request => {
    let input;
    try { input = fields(request, ["vertexText", "fragmentText", "signedMask", "unsignedMask", "packedSignedMask", "packedNormalizedMask", "bufferZeroMask"]); }
    catch { return fail("invalid-input", "Uniform pair reflection failed."); }
    if (!input) return fail("invalid-input", "Provide only own texts, vertex format masks and buffered slot zero mask.");
    const [vertexText, fragmentText, signedMask, unsignedMask, packedSignedMask, packedNormalizedMask, bufferZeroMask] = input;
    if (![signedMask, unsignedMask, packedSignedMask, packedNormalizedMask].every(mask => Number.isInteger(mask) && mask >= 0 && mask <= 0xffff) ||
        (signedMask & unsignedMask) !== 0 || ((signedMask | unsignedMask) & packedSignedMask) !== 0 ||
        (packedNormalizedMask & ~packedSignedMask) !== 0 || !Number.isInteger(bufferZeroMask) || bufferZeroMask < 0 || bufferZeroMask > 3)
      return fail("invalid-input", "Uniform and vertex format masks have incompatible extents.");
    for (const text of [vertexText, fragmentText]) {
      const error = textError(text);
      if (error) return error;
    }
    return run([vertexText, fragmentText], ([vertex, fragment]) => uniformPair(
      vertex, vertexText.length, fragment, fragmentText.length, signedMask, unsignedMask, packedSignedMask, packedNormalizedMask, bufferZeroMask));
  };
  if (integerImages) {
    bridge.translateImages = request => {
      let input;
      try { input = fields(request, ["stage", "text", "signedColorMask", "unsignedColorMask"]); }
      catch { return fail("invalid-input", "Integer image request reflection failed."); }
      if (!input) return fail("invalid-input", "Provide only own stage, text and color format mask fields.");
      const [stage, text, signedColorMask, unsignedColorMask] = input;
      if (stage !== "vertex" && stage !== "fragment") return fail("unsupported-stage", "Only vertex and fragment stages are supported.");
      if (![signedColorMask, unsignedColorMask].every(mask => Number.isInteger(mask) && mask >= 0 && mask <= 15) ||
          (signedColorMask & unsignedColorMask) !== 0 || (stage === "vertex" && (signedColorMask | unsignedColorMask)))
        return fail("invalid-input", "Color format masks must be disjoint 4-bit fragment masks.");
      const error = textError(text);
      if (error) return error;
      return run([text], ([pointer]) => integerStage(
        stage === "vertex" ? 0 : 1, pointer, text.length, signedColorMask, unsignedColorMask));
    };
    bridge.translatePairImages = request => {
      let input;
      try { input = fields(request, ["vertexText", "fragmentText", "signedMask", "unsignedMask", "packedSignedMask", "packedNormalizedMask", "bufferZeroMask", "signedColorMask", "unsignedColorMask"]); }
      catch { return fail("invalid-input", "Integer image pair reflection failed."); }
      if (!input) return fail("invalid-input", "Provide only own texts, vertex, uniform and color format masks.");
      const [vertexText, fragmentText, signedMask, unsignedMask, packedSignedMask, packedNormalizedMask, bufferZeroMask, signedColorMask, unsignedColorMask] = input;
      if (![signedMask, unsignedMask, packedSignedMask, packedNormalizedMask].every(mask => Number.isInteger(mask) && mask >= 0 && mask <= 0xffff) ||
          (signedMask & unsignedMask) !== 0 || ((signedMask | unsignedMask) & packedSignedMask) !== 0 ||
          (packedNormalizedMask & ~packedSignedMask) !== 0 || !Number.isInteger(bufferZeroMask) || bufferZeroMask < 0 || bufferZeroMask > 3 ||
          ![signedColorMask, unsignedColorMask].every(mask => Number.isInteger(mask) && mask >= 0 && mask <= 15) || (signedColorMask & unsignedColorMask) !== 0)
        return fail("invalid-input", "Integer image format masks have incompatible extents.");
      for (const text of [vertexText, fragmentText]) {
        const error = textError(text);
        if (error) return error;
      }
      return run([vertexText, fragmentText], ([vertex, fragment]) => integerPair(
        vertex, vertexText.length, fragment, fragmentText.length, signedMask, unsignedMask, packedSignedMask, packedNormalizedMask, bufferZeroMask, signedColorMask, unsignedColorMask));
    };
  }
  if (streamOutput) {
    function layoutInput(words, captureBuffer) {
      if (!Number.isInteger(captureBuffer) || captureBuffer < 0 || captureBuffer >= 4 || !Array.isArray(words))
        return { error: fail("invalid-input", "Provide an original word array and capture buffer0..3.") };
      const length = Object.getOwnPropertyDescriptor(words, "length");
      if (!length || !("value" in length) || !Number.isInteger(length.value) || length.value < 1 ||
          length.value > STANDARD_STREAM_OUTPUT_LIMITS.layoutWords)
        return { error: fail("invalid-input", "Original layout length must be bounded own data.") };
      const count = length.value, names = Array.from({ length: count }, (_, i) => String(i)).concat("length");
      const keys = Reflect.ownKeys(words);
      if (keys.length !== names.length || keys.some(key => !names.includes(key)))
        return { error: fail("invalid-input", "Original layout words require dense own data elements.") };
      const owned = [];
      for (let i = 0; i < count; i++) {
        const entry = Object.getOwnPropertyDescriptor(words, String(i));
        if (!entry || !("value" in entry) || !Number.isInteger(entry.value) || entry.value < 0 || entry.value > 0xffffffff)
          return { error: fail("invalid-input", "Original layout words require own u32 data elements.") };
        owned.push(entry.value);
      }
      return { words: owned };
    }
    function runLayout(texts, words, call) {
      const pointer = module._malloc(words.length * 4);
      if (!pointer) return fail("allocation-failed", "Wasm stream-output layout allocation failed.");
      try {
        const view = new DataView(module.HEAPU8.buffer, module.HEAPU8.byteOffset + pointer, words.length * 4);
        for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i], true);
        return run(texts, pointers => call(pointers, pointer));
      } finally { module._free(pointer); }
    }
    bridge.translateStreamOutput = request => {
      let input;
      try {
        input = fields(request, ["stage", "text", "signedColorMask", "unsignedColorMask", "streamOutputWords", "captureBuffer"]);
        if (!input) return fail("invalid-input", "Provide only own stage, text, color masks and original layout data fields.");
        const layout = layoutInput(input[4], input[5]); if (layout.error) return layout.error; input[4] = layout.words;
      } catch { return fail("invalid-input", "Stream-output request reflection failed."); }
      const [stage, text, signedMask, unsignedMask, words, captureBuffer] = input;
      if (stage !== "vertex" && stage !== "fragment") return fail("unsupported-stage", "Only vertex and fragment stages are supported.");
      if (![signedMask, unsignedMask].every(mask => Number.isInteger(mask) && mask >= 0 && mask <= 15) ||
          (signedMask & unsignedMask) || stage === "vertex" && (signedMask | unsignedMask))
        return fail("invalid-input", "Color format masks must be disjoint 4-bit fragment masks.");
      const error = textError(text); if (error) return error;
      return runLayout([text], words, ([textPointer], layoutPointer) => module._bridge_translate_standard_stream_output(
        stage === "vertex" ? 0 : 1, textPointer, text.length, signedMask, unsignedMask, layoutPointer, words.length, captureBuffer));
    };
    bridge.translatePairStreamOutput = request => {
      let input;
      try {
        input = fields(request, ["vertexText", "fragmentText", "signedMask", "unsignedMask", "packedSignedMask", "packedNormalizedMask", "bufferZeroMask", "signedColorMask", "unsignedColorMask", "streamOutputWords", "captureBuffer"]);
        if (!input) return fail("invalid-input", "Provide only own texts, format masks and original layout data fields.");
        const layout = layoutInput(input[9], input[10]); if (layout.error) return layout.error; input[9] = layout.words;
      } catch { return fail("invalid-input", "Stream-output pair reflection failed."); }
      const [vertex, fragment, signedMask, unsignedMask, packedSignedMask, packedNormalizedMask, bufferZeroMask, signedColorMask, unsignedColorMask, words, captureBuffer] = input;
      if (![signedMask, unsignedMask, packedSignedMask, packedNormalizedMask].every(mask => Number.isInteger(mask) && mask >= 0 && mask <= 0xffff) ||
          (signedMask & unsignedMask) || ((signedMask | unsignedMask) & packedSignedMask) || (packedNormalizedMask & ~packedSignedMask) ||
          !Number.isInteger(bufferZeroMask) || bufferZeroMask < 0 || bufferZeroMask > 3 ||
          ![signedColorMask, unsignedColorMask].every(mask => Number.isInteger(mask) && mask >= 0 && mask <= 15) || (signedColorMask & unsignedColorMask))
        return fail("invalid-input", "Stream-output format masks have incompatible extents.");
      for (const text of [vertex, fragment]) { const error = textError(text); if (error) return error; }
      return runLayout([vertex, fragment], words, ([v, f], layoutPointer) => module._bridge_translate_standard_stream_output_pair(
        v, vertex.length, f, fragment.length, signedMask, unsignedMask, packedSignedMask, packedNormalizedMask,
        bufferZeroMask, signedColorMask, unsignedColorMask, layoutPointer, words.length, captureBuffer));
    };
  }
  return Object.freeze(bridge);
}
