export const LIMITS = Object.freeze({
  textBytes: 16384,
  tokens: 8192,
  glslBytes: 65536,
  instructions: 128,
  registerIndex: 7,
});

const failure = (code, message) => ({ ok: false, error: { code, message } });

/** Create an isolated compiler instance. Each translate result owns its JS
 * strings/metadata; no views into Wasm memory escape. The Wasm API is synchronous
 * and calls are serialized by the JavaScript event loop. */
export async function createVirglShaderBridge(options = {}) {
  const { default: createModule } = await import("./build/wasm/virgl-shader.mjs");
  const module = await createModule(options);
  return Object.freeze({
    translate(request) {
      if (!request || typeof request !== "object" || typeof request.text !== "string") {
        return failure("invalid-input", "Provide a stage and TGSI text string.");
      }
      const { stage, text } = request;
      if (stage !== "vertex" && stage !== "fragment") {
        return failure("unsupported-stage", "Only vertex and fragment stages are supported.");
      }
      if (Object.keys(request).some((key) => key !== "stage" && key !== "text")) {
        return failure("unsupported-feature", "This profile does not accept shader-key overrides.");
      }
      if (text.length > LIMITS.textBytes) return failure("input-too-large", "TGSI text exceeds 16384 bytes.");
      if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) {
        return failure("invalid-input", "TGSI must be printable ASCII without NUL bytes.");
      }
      const ptr = module._malloc(text.length + 1);
      if (!ptr) return failure("allocation-failed", "Wasm input allocation failed.");
      try {
        for (let i = 0; i < text.length; ++i) module.HEAPU8[ptr + i] = text.charCodeAt(i);
        module.HEAPU8[ptr + text.length] = 0;
        const result = module._bridge_translate(stage === "vertex" ? 0 : 1, ptr, text.length);
        return JSON.parse(module.UTF8ToString(result));
      } finally {
        module._free(ptr);
      }
    },
  });
}
