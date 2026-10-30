export const LIMITS = Object.freeze({
  textBytes: 49152,
  tokens: 8192,
  glslBytes: 262144,
  instructions: 768,
  registerIndex: 7,
  temporaryRegisterIndex: 511,
  constantRegisterIndex: 45,
  ordinaryVertexConstantRegisterIndex: 127,
  immediateRegisterIndex: 31,
  conditionalDepth: 16,
  lines: 1536,
  lineBytes: 512,
});

const failure = (code, message) => ({ ok: false, error: { code, message } });

// This helper belongs only to the private paired facet. Every primitive is
// copied once; no caller-owned tuple or array reaches a native allocation.
function pairExactComponents(input) {
  if (!Array.isArray(input)) return null;
  const length = Object.getOwnPropertyDescriptor(input, "length");
  if (!length || !("value" in length) || !Number.isInteger(length.value) || length.value < 0 || length.value > 184) return null;
  const count = length.value, own = Reflect.ownKeys(input);
  if (own.length !== count + 1 || own.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= count))) return null;
  const components = [];
  let previous = -1;
  for (let i = 0; i < count; ++i) {
    const entry = Object.getOwnPropertyDescriptor(input, String(i));
    if (!entry || !("value" in entry) || !entry.value || typeof entry.value !== "object" || Array.isArray(entry.value)) return null;
    const record = entry.value, names = Reflect.ownKeys(record);
    if (names.length !== 3 || names.some((key) => !["register", "component", "word"].includes(key))) return null;
    const fields = ["register", "component", "word"].map((key) => Object.getOwnPropertyDescriptor(record, key));
    if (fields.some((field) => !field || !("value" in field))) return null;
    const [register, component, word] = fields.map((field) => field.value);
    if (!Number.isInteger(register) || register < 0 || register > 45 ||
        !Number.isInteger(component) || component < 0 || component > 3 ||
        !Number.isInteger(word) || word < 0 || word > 0xffffffff) return null;
    const key = register * 4 + component;
    if (key <= previous) return null;
    previous = key;
    components.push({ register, component, word });
  }
  return components;
}

/** Create an isolated compiler instance. Each translate result owns its JS
 * strings/metadata; no views into Wasm memory escape. The Wasm API is synchronous
 * and calls are serialized by the JavaScript event loop. */
export async function createVirglShaderBridge(options = {}) {
  const { default: createModule } = await import("./build/wasm/virgl-shader.mjs");
  const module = await createModule(options);
  return Object.freeze({
    translateOriginal92cbFirstPower(request) {
      let vertexText, fragmentText, geometry, bank, state;
      try {
        const names = ["vertexText", "fragmentText", "geometry", "bank", "drawState"];
        if (!request || typeof request !== "object" || Array.isArray(request) ||
            Reflect.ownKeys(request).length !== names.length ||
            Reflect.ownKeys(request).some(key => !names.includes(key)))
          return failure("invalid-input", "Provide the complete original sources, geometry, bank and draw state.");
        const fields = names.map(key => Object.getOwnPropertyDescriptor(request, key));
        if (fields.some(field => !field || !("value" in field)))
          return failure("invalid-input", "Private inputs must be own data properties.");
        [vertexText, fragmentText] = fields.map(field => field.value);
        geometry = fields[2].value;
        bank = fields[3].value;
        const suppliedState = fields[4].value;
        if (typeof vertexText !== "string" || typeof fragmentText !== "string" ||
            vertexText.length > LIMITS.textBytes || fragmentText.length > LIMITS.textBytes ||
            /[^\x09\x0a\x0d\x20-\x7e]/.test(vertexText) ||
            /[^\x09\x0a\x0d\x20-\x7e]/.test(fragmentText) ||
            !(geometry instanceof Uint8Array) || geometry.length !== 2040 ||
            !Number.isInteger(bank) || bank < 0 || bank > 2 ||
            !suppliedState || typeof suppliedState !== "object" || Array.isArray(suppliedState))
          return failure("invalid-input", "Private inputs have invalid types or extents.");
        geometry = new Uint8Array(geometry);
        const keys = ["viewportX", "viewportY", "viewportWidth", "viewportHeight",
          "samples", "colorFormat", "mode", "first", "count"];
        if (Reflect.ownKeys(suppliedState).length !== keys.length ||
            Reflect.ownKeys(suppliedState).some(key => !keys.includes(key)))
          return failure("invalid-input", "Private draw state requires nine exact fields.");
        state = keys.map(key => {
          const field = Object.getOwnPropertyDescriptor(suppliedState, key);
          if (!field || !("value" in field) || !Number.isInteger(field.value) ||
              field.value < 0 || field.value > 0xffffffff) throw new Error("invalid state");
          return field.value;
        });
      } catch {
        return failure("invalid-input", "Private request reflection failed.");
      }
      const pointers = [];
      try {
        for (const data of [vertexText, fragmentText, geometry, state]) {
          const size = typeof data === "string" ? data.length + 1 :
            data === geometry ? geometry.length : state.length * 4;
          const pointer = module._malloc(size);
          if (!pointer) return failure("allocation-failed", "Private Wasm input allocation failed.");
          pointers.push(pointer);
          if (typeof data === "string") {
            for (let i = 0; i < data.length; ++i) module.HEAPU8[pointer + i] = data.charCodeAt(i);
            module.HEAPU8[pointer + data.length] = 0;
          } else if (data === geometry) module.HEAPU8.set(geometry, pointer);
          else {
            const view = new DataView(module.HEAPU8.buffer);
            state.forEach((word, index) => view.setUint32(pointer + index * 4, word, true));
          }
        }
        const output = module._bridge_translate_original_92cb_first_power(
          pointers[0], vertexText.length, pointers[1], fragmentText.length,
          pointers[2], geometry.length, bank, pointers[3]);
        return JSON.parse(module.UTF8ToString(output));
      } finally {
        for (const pointer of pointers.reverse()) module._free(pointer);
      }
    },
    translateOriginal92cbComplete(request) {
      let vertexText, fragmentText, geometry, bank, state;
      try {
        const names = ["vertexText", "fragmentText", "geometry", "bank", "drawState"];
        if (!request || typeof request !== "object" || Array.isArray(request) ||
            Reflect.ownKeys(request).length !== names.length ||
            Reflect.ownKeys(request).some(key => !names.includes(key)))
          return failure("invalid-input", "Provide the complete original sources, geometry, bank and draw state.");
        const fields = names.map(key => Object.getOwnPropertyDescriptor(request, key));
        if (fields.some(field => !field || !("value" in field)))
          return failure("invalid-input", "Private inputs must be own data properties.");
        [vertexText, fragmentText] = fields.map(field => field.value);
        geometry = fields[2].value;
        bank = fields[3].value;
        const suppliedState = fields[4].value;
        if (typeof vertexText !== "string" || typeof fragmentText !== "string" ||
            vertexText.length > LIMITS.textBytes || fragmentText.length > LIMITS.textBytes ||
            /[^\x09\x0a\x0d\x20-\x7e]/.test(vertexText) ||
            /[^\x09\x0a\x0d\x20-\x7e]/.test(fragmentText) ||
            !(geometry instanceof Uint8Array) || geometry.length !== 2040 ||
            !Number.isInteger(bank) || bank < 0 || bank > 2 ||
            !suppliedState || typeof suppliedState !== "object" || Array.isArray(suppliedState))
          return failure("invalid-input", "Private inputs have invalid types or extents.");
        geometry = new Uint8Array(geometry);
        const keys = ["viewportX", "viewportY", "viewportWidth", "viewportHeight",
          "samples", "colorFormat", "mode", "first", "count"];
        if (Reflect.ownKeys(suppliedState).length !== keys.length ||
            Reflect.ownKeys(suppliedState).some(key => !keys.includes(key)))
          return failure("invalid-input", "Private draw state requires nine exact fields.");
        state = keys.map(key => {
          const field = Object.getOwnPropertyDescriptor(suppliedState, key);
          if (!field || !("value" in field) || !Number.isInteger(field.value) ||
              field.value < 0 || field.value > 0xffffffff) throw new Error("invalid state");
          return field.value;
        });
      } catch {
        return failure("invalid-input", "Private request reflection failed.");
      }
      const pointers = [];
      try {
        for (const data of [vertexText, fragmentText, geometry, state]) {
          const size = typeof data === "string" ? data.length + 1 :
            data === geometry ? geometry.length : state.length * 4;
          const pointer = module._malloc(size);
          if (!pointer) return failure("allocation-failed", "Private Wasm input allocation failed.");
          pointers.push(pointer);
          if (typeof data === "string") {
            for (let i = 0; i < data.length; ++i) module.HEAPU8[pointer + i] = data.charCodeAt(i);
            module.HEAPU8[pointer + data.length] = 0;
          } else if (data === geometry) module.HEAPU8.set(geometry, pointer);
          else {
            const view = new DataView(module.HEAPU8.buffer);
            state.forEach((word, index) => view.setUint32(pointer + index * 4, word, true));
          }
        }
        const output = module._bridge_translate_original_92cb_complete(
          pointers[0], vertexText.length, pointers[1], fragmentText.length,
          pointers[2], geometry.length, bank, pointers[3]);
        return JSON.parse(module.UTF8ToString(output));
      } finally {
        for (const pointer of pointers.reverse()) module._free(pointer);
      }
    },
    translatePairExact(request) {
      let vertexText, fragmentText, vertexComponents, fragmentComponents;
      try {
        if (!request || typeof request !== "object" || Array.isArray(request)) {
          return failure("invalid-input", "Provide both stage texts and canonical component arrays.");
        }
        const names = ["vertexText", "fragmentText", "vertexComponents", "fragmentComponents"], keys = Reflect.ownKeys(request);
        if (keys.length !== 4 || keys.some((key) => !names.includes(key))) {
          return failure("invalid-input", "Provide only the four paired exact fields.");
        }
        const fields = names.map((key) => Object.getOwnPropertyDescriptor(request, key));
        if (fields.some((field) => !field || !("value" in field))) {
          return failure("invalid-input", "Paired exact fields must be own data properties.");
        }
        const values = fields.map((field) => field.value);
        [vertexText, fragmentText] = values;
        if (typeof vertexText !== "string" || typeof fragmentText !== "string") {
          return failure("invalid-input", "Provide two primitive stage text strings.");
        }
        vertexComponents = pairExactComponents(values[2]);
        fragmentComponents = pairExactComponents(values[3]);
        if (!vertexComponents || !fragmentComponents || !(vertexComponents.length || fragmentComponents.length)) {
          return failure("invalid-input", "Provide canonical 0..184 stage-local components with a nonempty paired union.");
        }
      } catch {
        return failure("invalid-input", "Paired exact request reflection failed.");
      }
      for (const text of [vertexText, fragmentText]) {
        if (text.length > LIMITS.textBytes) return failure("input-too-large", "TGSI text exceeds 49152 bytes.");
        if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) return failure("invalid-input", "TGSI must be printable ASCII without NUL bytes.");
      }
      const texts = [vertexText, fragmentText], components = [vertexComponents, fragmentComponents];
      const textPointers = [0, 0], tuplePointers = [0, 0];
      try {
        for (let stage = 0; stage < 2; ++stage) {
          const text = texts[stage], words = components[stage];
          const ptr = textPointers[stage] = module._malloc(text.length + 1);
          if (!ptr) return failure("allocation-failed", "Wasm paired input allocation failed.");
          for (let i = 0; i < text.length; ++i) module.HEAPU8[ptr + i] = text.charCodeAt(i);
          module.HEAPU8[ptr + text.length] = 0;
          if (!words.length) continue;
          const tuples = tuplePointers[stage] = module._malloc(words.length * 12);
          if (!tuples) return failure("allocation-failed", "Wasm paired component allocation failed.");
          const view = new DataView(module.HEAPU8.buffer);
          for (let i = 0; i < words.length; ++i) {
            const at = tuples + i * 12, word = words[i];
            view.setUint32(at, word.register, true); view.setUint32(at + 4, word.component, true); view.setUint32(at + 8, word.word, true);
          }
        }
        const result = module._bridge_translate_pair_exact(textPointers[0], vertexText.length,
          tuplePointers[0], vertexComponents.length, textPointers[1], fragmentText.length,
          tuplePointers[1], fragmentComponents.length);
        return JSON.parse(module.UTF8ToString(result));
      } finally {
        for (let stage = 1; stage >= 0; --stage) {
          if (tuplePointers[stage]) module._free(tuplePointers[stage]);
          if (textPointers[stage]) module._free(textPointers[stage]);
        }
      }
    },
    translateExact(request) {
      let stage, text, components;
      try {
        if (!request || typeof request !== "object" || Array.isArray(request)) {
          return failure("invalid-input", "Provide own stage, text and canonical exact components.");
        }
        const keys = Reflect.ownKeys(request);
        if (keys.length !== 3 || keys.some((key) => !["stage", "text", "components"].includes(key))) {
          return failure("invalid-input", "Provide only own stage, text and canonical exact components.");
        }
        const fields = ["stage", "text", "components"].map((key) => Object.getOwnPropertyDescriptor(request, key));
        if (fields.some((field) => !field || !("value" in field))) {
          return failure("invalid-input", "Exact request fields must be own data properties.");
        }
        [stage, text] = fields.map((field) => field.value);
        const input = fields[2].value;
        if (typeof text !== "string" || !Array.isArray(input)) {
          return failure("invalid-input", "Provide text and a dense canonical component array.");
        }
        const length = Object.getOwnPropertyDescriptor(input, "length");
        if (!length || !("value" in length) || !Number.isInteger(length.value) || length.value < 1 || length.value > 184) {
          return failure("invalid-input", "Provide 1..184 canonical exact components.");
        }
        const count = length.value, own = Reflect.ownKeys(input);
        if (own.length !== count + 1 || own.some((key) => key !== "length" &&
            (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= count))) {
          return failure("invalid-input", "Exact components must be a dense own array without extra fields.");
        }
        components = [];
        let previous = -1;
        for (let i = 0; i < count; ++i) {
          const entry = Object.getOwnPropertyDescriptor(input, String(i));
          if (!entry || !("value" in entry) || !entry.value || typeof entry.value !== "object" || Array.isArray(entry.value)) {
            return failure("invalid-input", "Each exact component must be an own data record.");
          }
          const record = entry.value, names = Reflect.ownKeys(record);
          if (names.length !== 3 || names.some((key) => !["register", "component", "word"].includes(key))) {
            return failure("invalid-input", "Each exact component requires register, component and word only.");
          }
          const fields = ["register", "component", "word"].map((key) => Object.getOwnPropertyDescriptor(record, key));
          if (fields.some((field) => !field || !("value" in field))) {
            return failure("invalid-input", "Exact component fields must be own data properties.");
          }
          const [register, component, word] = fields.map((field) => field.value);
          if (!Number.isInteger(register) || register < 0 || register > 45 ||
              !Number.isInteger(component) || component < 0 || component > 3 ||
              !Number.isInteger(word) || word < 0 || word > 0xffffffff) {
            return failure("invalid-input", "Exact components require bounded integer raw u32 fields.");
          }
          const key = register * 4 + component;
          if (key <= previous) return failure("invalid-input", "Exact components must be unique and canonically ordered.");
          previous = key;
          components.push({ register, component, word });
        }
      } catch {
        return failure("invalid-input", "Exact request reflection failed.");
      }
      if (stage !== "vertex" && stage !== "fragment") {
        return failure("unsupported-stage", "Only vertex and fragment stages are supported.");
      }
      if (text.length > LIMITS.textBytes) return failure("input-too-large", "TGSI text exceeds 49152 bytes.");
      if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) {
        return failure("invalid-input", "TGSI must be printable ASCII without NUL bytes.");
      }
      const ptr = module._malloc(text.length + 1);
      if (!ptr) return failure("allocation-failed", "Wasm input allocation failed.");
      let tuples = 0;
      try {
        tuples = module._malloc(components.length * 12);
        if (!tuples) return failure("allocation-failed", "Wasm exact-component allocation failed.");
        for (let i = 0; i < text.length; ++i) module.HEAPU8[ptr + i] = text.charCodeAt(i);
        module.HEAPU8[ptr + text.length] = 0;
        const tupleBytes = new DataView(module.HEAPU8.buffer);
        for (let i = 0; i < components.length; ++i) {
          const index = tuples + i * 12, entry = components[i];
          tupleBytes.setUint32(index, entry.register, true);
          tupleBytes.setUint32(index + 4, entry.component, true);
          tupleBytes.setUint32(index + 8, entry.word, true);
        }
        const result = module._bridge_translate_exact(stage === "vertex" ? 0 : 1, ptr, text.length, tuples, components.length);
        return JSON.parse(module.UTF8ToString(result));
      } finally {
        if (tuples) module._free(tuples);
        module._free(ptr);
      }
    },
    translatePair(request) {
      let vertexText, fragmentText;
      try {
        if (!request || typeof request !== "object" || Array.isArray(request)) {
          return failure("invalid-input", "Provide vertexText and fragmentText own string fields.");
        }
        const keys = Reflect.ownKeys(request);
        if (keys.some((key) => key !== "vertexText" && key !== "fragmentText")) {
          return failure("unsupported-feature", "This profile does not accept shader-key overrides.");
        }
        const vertex = Object.getOwnPropertyDescriptor(request, "vertexText");
        const fragment = Object.getOwnPropertyDescriptor(request, "fragmentText");
        if (keys.length !== 2 || !vertex || !fragment || !("value" in vertex) || !("value" in fragment) ||
            typeof vertex.value !== "string" || typeof fragment.value !== "string") {
          return failure("invalid-input", "Provide vertexText and fragmentText own string fields.");
        }
        vertexText = vertex.value; fragmentText = fragment.value;
      } catch {
        return failure("invalid-input", "Pair request reflection failed.");
      }
      for (const text of [vertexText, fragmentText]) {
        if (text.length > LIMITS.textBytes) return failure("input-too-large", "TGSI text exceeds 49152 bytes.");
        if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) {
          return failure("invalid-input", "TGSI must be printable ASCII without NUL bytes.");
        }
      }
      const vertex = module._malloc(vertexText.length + 1);
      if (!vertex) return failure("allocation-failed", "Wasm input allocation failed.");
      let fragment = 0;
      try {
        fragment = module._malloc(fragmentText.length + 1);
        if (!fragment) return failure("allocation-failed", "Wasm input allocation failed.");
        for (const [ptr, text] of [[vertex, vertexText], [fragment, fragmentText]]) {
          for (let i = 0; i < text.length; ++i) module.HEAPU8[ptr + i] = text.charCodeAt(i);
          module.HEAPU8[ptr + text.length] = 0;
        }
        const result = module._bridge_translate_pair(vertex, vertexText.length, fragment, fragmentText.length);
        return JSON.parse(module.UTF8ToString(result));
      } finally {
        if (fragment) module._free(fragment);
        module._free(vertex);
      }
    },
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
      if (text.length > LIMITS.textBytes) return failure("input-too-large", "TGSI text exceeds 49152 bytes.");
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
