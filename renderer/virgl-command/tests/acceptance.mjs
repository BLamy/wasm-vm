// The same synchronous acceptance suite runs in Node and the headed browser.
// Wire constants below are independently transcribed from the pinned protocol;
// do not import the decoder's dispatch tables, bounds, or parsing helpers.
import { decodeSubmission } from "../decoder.mjs";

const NAMES = {
  1: "CREATE_OBJECT", 2: "BIND_OBJECT", 3: "DESTROY_OBJECT",
  4: "SET_VIEWPORT_STATE", 5: "SET_FRAMEBUFFER_STATE", 6: "SET_VERTEX_BUFFERS",
  7: "CLEAR", 8: "DRAW_VBO", 10: "SET_SAMPLER_VIEWS", 11: "SET_INDEX_BUFFER",
  12: "SET_CONSTANT_BUFFER", 13: "SET_STENCIL_REF", 14: "SET_BLEND_COLOR",
  18: "BIND_SAMPLER_STATES", 22: "SET_POLYGON_STIPPLE", 24: "SET_SAMPLE_MASK",
  25: "SET_STREAMOUT_TARGETS", 28: "SET_SUB_CTX", 29: "CREATE_SUB_CTX",
  30: "DESTROY_SUB_CTX", 31: "BIND_SHADER", 32: "SET_TESS_STATE",
  33: "SET_MIN_SAMPLES", 34: "SET_SHADER_BUFFERS", 35: "SET_SHADER_IMAGES",
  38: "SET_FRAMEBUFFER_STATE_NO_ATTACH", 40: "SET_ATOMIC_BUFFERS",
  43: "TRANSFER3D", 44: "END_TRANSFERS", 45: "COPY_TRANSFER3D",
  46: "SET_TWEAKS", 52: "LINK_SHADER",
};
const OBJECTS = ["NULL", "BLEND", "RASTERIZER", "DSA", "SHADER",
  "VERTEX_ELEMENTS", "SAMPLER_VIEW", "SAMPLER_STATE", "SURFACE"];
const EXPECTED = [
  [161, 5736, 39, "364452bac8463817df9b95ae07be7203ec8411bd6be08ab43029f7c69be028cc"],
  [173, 4164, 3, "11d7a8a13799e2c6a35a34ce40afd121e0d2e62370b9f0ca6b18002d4257470c"],
  [185, 4236, 6, "a30bdebf440d44f28e95bcb4f28a33f1a51db5350239acd50c8ec73bb9192396"],
  [197, 4164, 3, "21b0c51152d709ad80365dd8ea0ea209a50bd2451dee23f77de6a4ed088ed4b0"],
  [209, 4292, 8, "4850440acce5f52b247b9d04192c5fb757dec723b05f3dabe7a1ca53478b81b6"],
  [221, 4164, 3, "c3e72f8d3b61dcae9cfd7aacd6a2c817686fa695a318d861139ce12bb504ec17"],
  [233, 4144, 6, "077179667c9698bec4e54db75a1d8a458514ddf87a220ce05ff20eeed532a3da"],
  [249, 11480, 142, "ae7a34f64af64e7bcfa324f1f70aec362ca207197a5e085727644aca793c351e"],
];
const DEFAULT_SEEDS = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a];

function packet(opcode, objectType, words) {
  const bytes = new Uint8Array((words.length + 1) * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, opcode + objectType * 256 + words.length * 65536, true);
  words.forEach((word, index) => view.setUint32((index + 1) * 4, word, true));
  return bytes;
}
function join(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function setWord(bytes, word, value) {
  const result = bytes.slice();
  new DataView(result.buffer).setUint32(word * 4, value, true);
  return result;
}
function floatWord(value) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}
function shader(text, stage = 0, tokenCount = 32) {
  const textBytes = text.length + 1;
  const result = packet(1, 4, [0x1001, stage, textBytes, tokenCount, 0,
    ...Array(Math.ceil(textBytes / 4)).fill(0)]);
  for (let index = 0; index < text.length; index++) result[24 + index] = text.charCodeAt(index);
  return result;
}

// Read the outer framing directly as bytes, independently of decoder dispatch.
function walk(bytes) {
  if (bytes.length % 4 !== 0) return null;
  const frames = [];
  for (let offset = 0; offset < bytes.length;) {
    const opcode = bytes[offset], objectType = bytes[offset + 1];
    const payloadDwords = bytes[offset + 2] + 256 * bytes[offset + 3];
    const byteLength = 4 + 4 * payloadDwords;
    if (byteLength > bytes.length - offset) return null;
    frames.push({ opcode, objectType, payloadDwords, byteOffset: offset, byteLength });
    offset += byteLength;
  }
  return frames;
}

export function runAcceptance(fixtures, options = {}) {
  let assertions = 0;
  const equal = (actual, expected, label) => {
    assertions++;
    if (!Object.is(actual, expected)) {
      throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };
  const truth = (value, label) => equal(Boolean(value), true, label);
  const same = (actual, expected, label) => equal(JSON.stringify(actual), JSON.stringify(expected), label);
  const frozen = (value, label) => {
    if (value === null || typeof value !== "object") return;
    truth(Object.isFrozen(value), `${label} frozen`);
    truth(!ArrayBuffer.isView(value), `${label} detached plain data`);
    for (const [key, child] of Object.entries(value)) frozen(child, `${label}.${key}`);
  };
  const provenance = { sourceSha256: "f".repeat(64), event: 987654, contextId: 7654 };
  const goodBytes = packet(28, 0, [0x10203040]);
  const goodExpected = JSON.stringify(decodeSubmission(goodBytes, provenance));
  const attacks = { named: [], prefixCases: 0, boundaryPrefixes: 0,
    mutations: 0, acceptedMutations: 0, rejectedMutations: 0, recoveryChecks: 0,
    sharedArrayBuffer: "unavailable" };

  const errorShape = (result, label, code, offset, opcode) => {
    equal(result.ok, false, `${label} rejected`);
    same(Object.keys(result).sort(), ["error", "ok"], `${label} no partial commands`);
    truth(result.error && typeof result.error === "object", `${label} structured error`);
    truth(typeof result.error.code === "string" && result.error.code.length > 0, `${label} error code`);
    truth(typeof result.error.message === "string" && result.error.message.length > 0, `${label} message`);
    truth(Number.isInteger(result.error.byteOffset) && result.error.byteOffset >= 0 &&
      result.error.byteOffset % 4 === 0, `${label} error byteOffset`);
    truth(result.error.opcode === null || (Number.isInteger(result.error.opcode) &&
      result.error.opcode >= 0 && result.error.opcode <= 255), `${label} error opcode`);
    if (code !== undefined) equal(result.error.code, code, `${label} error category`);
    if (offset !== undefined) equal(result.error.byteOffset, offset, `${label} error location`);
    if (opcode !== undefined) equal(result.error.opcode, opcode, `${label} error opcode value`);
  };
  const framing = (bytes, result, labels, label) => {
    equal(result.ok, true, `${label} accepted (${result.error?.message ?? ""})`);
    const frames = walk(bytes);
    truth(frames !== null, `${label} independent framing`);
    equal(result.profile, "virgl-tiny-commands-v1", `${label} profile`);
    equal(result.byteLength, bytes.length, `${label} submission byteLength`);
    equal(result.commands.length, frames.length, `${label} command count`);
    for (const key of ["sourceSha256", "event", "contextId"]) {
      equal(result[key], labels[key] ?? null, `${label} provenance ${key}`);
    }
    for (const [index, frame] of frames.entries()) {
      const actual = result.commands[index];
      for (const key of ["byteOffset", "byteLength", "payloadDwords", "opcode", "objectType"]) {
        equal(actual[key], frame[key], `${label} command ${index} packet ${key}`);
      }
      equal(actual.name, NAMES[frame.opcode], `${label} command ${index} name`);
      equal(actual.objectName, OBJECTS[frame.objectType], `${label} command ${index} objectName`);
    }
  };
  const accept = (bytes, label, labels = provenance) => {
    const before = bytes.slice();
    const result = decodeSubmission(bytes, labels);
    framing(bytes, result, labels, label);
    same([...bytes], [...before], `${label} input unchanged`);
    frozen(result, label);
    attacks.named.push({ name: label, outcome: "accepted" });
    return result;
  };
  const reject = (bytes, label, code, offset, opcode, labels = provenance) => {
    const before = bytes instanceof Uint8Array ? bytes.slice() : null;
    const result = decodeSubmission(bytes, labels);
    errorShape(result, label, code, offset, opcode);
    frozen(result, label);
    if (before !== null) same([...bytes], [...before], `${label} input unchanged`);
    // Malformed submissions must not retain partial parser state between calls.
    for (let repeat = 0; repeat < 3; repeat++) {
      same(decodeSubmission(bytes, labels), result, `${label} deterministic rejection ${repeat}`);
      equal(JSON.stringify(decodeSubmission(goodBytes, provenance)), goodExpected,
        `${label} bad then good recovery ${repeat}`);
      attacks.recoveryChecks++;
    }
    attacks.named.push({ name: label, outcome: "rejected", code: result.error.code });
    return result;
  };

  equal(fixtures.submissions.length, 8, "all original submissions");
  const decodedSubmissions = [], originals = [], families = new Set(), objectTypes = new Set();
  let totalBytes = 0, totalPackets = 0;
  for (const [index, submission] of fixtures.submissions.entries()) {
    const [event, byteLength, count, sha] = EXPECTED[index];
    equal(submission.event, event, `fixture ${index} event`);
    equal(submission.contextId, 2, `fixture ${index} context`);
    equal(submission.sourceSha256, sha, `fixture ${index} source SHA256`);
    const bytes = Uint8Array.from(submission.data);
    equal(bytes.length, byteLength, `fixture ${index} bytes`);
    const labels = { sourceSha256: submission.sourceSha256, event, contextId: 2 };
    const result = accept(bytes, `capture event ${event}`, labels);
    equal(result.commands.length, count, `event ${event} literal packet count`);
    same(decodeSubmission(bytes, labels), result, `event ${event} repeat equality`);
    originals.push({ bytes, labels, frames: walk(bytes) });
    decodedSubmissions.push(result);
    totalBytes += bytes.length;
    totalPackets += result.commands.length;
    for (const command of result.commands) {
      families.add(command.opcode);
      if (command.opcode === 1) objectTypes.add(command.objectType);
    }
  }
  equal(totalBytes, 42380, "literal corpus bytes");
  equal(totalPackets, 210, "literal corpus packet count");
  equal(families.size, 32, "literal opcode families");
  same([...objectTypes].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], "all eight creation types");

  // Every family gets assertions on its typed wire fields, not just its header.
  for (const [submissionIndex, decoded] of decodedSubmissions.entries()) {
    const bytes = originals[submissionIndex].bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const command of decoded.commands) {
      const f = command.fields, base = command.byteOffset;
      const w = (index) => view.getUint32(base + 4 * index, true);
      const fl = (index) => view.getFloat32(base + 4 * index, true);
      const ws = (start, count) => Array.from({ length: count }, (_, i) => w(start + i));
      const fs = (start, count) => Array.from({ length: count }, (_, i) => fl(start + i));
      const eq = (key, expected) => same(f[key], expected, `event ${decoded.event} offset ${base} ${key}`);
      switch (command.opcode) {
        case 1: {
          eq("handle", w(1));
          switch (command.objectType) {
            case 1:
              eq("dither", Boolean(w(2) & 4));
              eq("logicopEnable", false);
              eq("independentBlendEnable", false);
              equal(f.renderTargets.length, 8, "blend eight render targets");
              for (let target = 0; target < 8; target++) {
                const word = w(4 + target);
                same(f.renderTargets[target], {
                  blendEnable: Boolean(word & 1), rgbFunction: (word >>> 1) & 7,
                  rgbSourceFactor: (word >>> 4) & 31, rgbDestinationFactor: (word >>> 9) & 31,
                  alphaFunction: (word >>> 14) & 7, alphaSourceFactor: (word >>> 17) & 31,
                  alphaDestinationFactor: (word >>> 22) & 31, colorMask: (word >>> 27) & 15,
                }, `blend target ${target} bit fields`);
              }
              break;
            case 2:
              eq("depthClip", true); eq("halfPixelCenter", true);
              eq("pointSize", fl(3)); eq("lineWidth", fl(6));
              eq("cullFace", (w(2) >>> 8) & 3);
              eq("frontCcw", Boolean(w(2) & 32768));
              eq("scissor", Boolean(w(2) & 16384));
              eq("offsetUnits", fl(7)); eq("offsetScale", fl(8)); eq("offsetClamp", fl(9));
              break;
            case 3:
              eq("depthEnable", false); eq("depthWriteMask", false); eq("alphaEnable", false);
              eq("alphaReference", fl(5));
              truth(f.stencil.every((stencil) => Object.values(stencil).every((value) => !value)), "inactive DSA stencil fields");
              break;
            case 4:
              eq("stage", w(2)); eq("stageName", w(2) === 0 ? "vertex" : "fragment");
              eq("declaredTextBytes", w(3)); eq("tokenCount", w(4)); eq("streamOutputCount", 0);
              eq("text", fixtures.shaders[w(2) === 0 ? "VERT" : "FRAG"]);
              equal(f.text.length + 1, w(3), "shader original text terminal length");
              break;
            case 5:
              eq("elements", Array.from({ length: (command.payloadDwords - 1) / 4 }, (_, i) => ({
                sourceOffset: w(2 + i * 4), instanceDivisor: w(3 + i * 4),
                vertexBufferIndex: w(4 + i * 4), sourceFormat: w(5 + i * 4),
              })));
              break;
            case 6:
              eq("resourceHandle", w(2)); eq("format", w(3) & 0xffffff); eq("target", w(3) >>> 24);
              eq("swizzle", [0, 3, 6, 9].map((shift) => (w(6) >>> shift) & 7));
              eq("firstLevel", 0); eq("lastLevel", 0); eq("firstLayer", 0); eq("lastLayer", 0);
              break;
            case 7:
              eq("wrapS", w(2) & 7); eq("wrapT", (w(2) >>> 3) & 7); eq("wrapR", (w(2) >>> 6) & 7);
              eq("minImageFilter", (w(2) >>> 9) & 1); eq("minMipFilter", (w(2) >>> 11) & 3);
              eq("magImageFilter", (w(2) >>> 13) & 1); eq("lodBias", fl(3));
              eq("minLod", fl(4)); eq("maxLod", fl(5)); eq("borderColor", ws(6, 4));
              break;
            case 8:
              eq("resourceHandle", w(2)); eq("format", w(3)); eq("level", w(4));
              eq("firstLayer", 0); eq("lastLayer", 0); break;
            default: throw new Error("Unasserted create object type");
          }
          break;
        }
        case 2: case 3: eq("handle", w(1)); break;
        case 4:
          eq("startSlot", w(1)); eq("viewports", [{ scale: fs(2, 3), translate: fs(5, 3) }]); break;
        case 5:
          eq("colorBufferCount", w(1)); eq("depthStencilSurface", w(2)); eq("colorSurfaces", ws(3, w(1))); break;
        case 6:
          eq("buffers", Array.from({ length: command.payloadDwords / 3 }, (_, i) => ({
            stride: w(1 + i * 3), offset: w(2 + i * 3), resourceHandle: w(3 + i * 3),
          }))); break;
        case 7:
          eq("buffers", w(1)); eq("colorWords", ws(2, 4)); eq("color", fs(2, 4));
          eq("depth", view.getFloat64(base + 24, true)); eq("stencil", w(8)); break;
        case 8:
          for (const [key, index] of Object.entries({ start: 1, count: 2, mode: 3, instanceCount: 5,
            startInstance: 7, restartIndex: 9, minIndex: 10, maxIndex: 11, countFromStreamOutput: 12 })) eq(key, w(index));
          eq("indexed", w(4) === 1); eq("indexBias", view.getInt32(base + 24, true));
          eq("primitiveRestart", w(8) === 1); break;
        case 10: case 18:
          eq("stage", w(1)); eq("startSlot", w(2)); eq("handles", ws(3, command.payloadDwords - 2)); break;
        case 11: eq("resourceHandle", w(1)); eq("indexSize", w(2)); eq("offset", w(3)); break;
        case 12:
          eq("stage", w(1)); eq("index", w(2)); eq("words", ws(3, command.payloadDwords - 2));
          eq("values", fs(3, command.payloadDwords - 2)); break;
        case 13: eq("front", w(1) & 255); eq("back", w(1) >>> 8); break;
        case 14: eq("color", fs(1, 4)); break;
        case 22: eq("pattern", ws(1, 32)); break;
        case 24: eq("mask", 0xffffffff); break;
        case 25: eq("appendBitmask", 0); eq("handles", []); break;
        case 28: case 29: case 30: eq("subContextId", w(1)); break;
        case 31: eq("handle", w(1)); eq("stage", w(2)); break;
        case 32: eq("outer", fs(1, 4)); eq("inner", fs(5, 2)); break;
        case 33: eq("minSamples", w(1)); break;
        case 34: case 40: {
          const prefix = command.opcode === 40 ? 1 : 2;
          if (prefix === 2) eq("stage", w(1));
          eq("startSlot", w(prefix));
          eq("buffers", Array.from({ length: (command.payloadDwords - prefix) / 3 }, (_, i) => ({
            offset: w(prefix + 1 + i * 3), length: w(prefix + 2 + i * 3), resourceHandle: w(prefix + 3 + i * 3),
          }))); break;
        }
        case 35:
          eq("stage", w(1)); eq("startSlot", w(2));
          eq("images", Array.from({ length: (command.payloadDwords - 2) / 5 }, (_, i) => ({
            format: w(3 + i * 5), access: w(4 + i * 5), layerOffset: w(5 + i * 5),
            levelSize: w(6 + i * 5), resourceHandle: w(7 + i * 5),
          }))); break;
        case 38:
          eq("width", w(1) & 65535); eq("height", w(1) >>> 16); eq("layers", 0); eq("samples", 0); break;
        case 43: case 45:
          for (const [key, index] of Object.entries({ resourceHandle: 1, level: 2, usage: 3, stride: 4, layerStride: 5 })) eq(key, w(index));
          eq("box", { x: w(6), y: w(7), z: w(8), width: w(9), height: w(10), depth: w(11) });
          if (command.opcode === 43) { eq("dataOffset", w(12)); eq("direction", w(13)); }
          else {
            eq("stagingResourceHandle", w(12)); eq("stagingOffset", w(13)); eq("flags", w(14));
            eq("synchronized", Boolean(w(14) & 1)); eq("readFromHost", Boolean(w(14) & 2));
          }
          break;
        case 44: eq("paddingDwords", command.payloadDwords); same(Object.keys(f), ["paddingDwords"], "opaque transfer padding has no nested commands"); break;
        case 46: eq("id", w(1)); eq("value", w(2)); break;
        case 52:
          for (const [key, index] of Object.entries({ vertexHandle: 1, fragmentHandle: 2, geometryHandle: 3,
            tessControlHandle: 4, tessEvaluationHandle: 5, computeHandle: 6 })) eq(key, w(index));
          break;
        default: throw new Error(`Unasserted command family ${command.opcode}`);
      }
    }
  }

  // Literal scene anchors supplement the independent wire extraction above.
  const at = (event, offset) => decodedSubmissions.find((s) => s.event === event).commands.find((c) => c.byteOffset === offset).fields;
  same(at(161, 0).box, { x: 0, y: 0, z: 0, width: 64, height: 1, depth: 1 }, "vertex upload box");
  equal(at(161, 56).box.width, 12, "six u16 indices upload bytes");
  equal(at(161, 0).direction, 1, "upload transfer direction");
  equal(at(161, 4736).readFromHost, false, "texture staging upload direction");
  same([173, 197, 221].map((event) => at(event, 4104).stagingOffset), [64, 4160, 8256], "three staging readback offsets");
  truth([173, 197, 221].every((event) => at(event, 4104).readFromHost), "all three readbacks from host");
  same(at(161, 5304).viewports, [{ scale: [16, 16, 0.5], translate: [16, 16, 0.5] }], "32 square viewport");
  same(at(161, 5656).buffers, [{ stride: 16, offset: 0, resourceHandle: 3 }, { stride: 16, offset: 8, resourceHandle: 3 }], "interleaved position and texcoord buffers");
  same(at(161, 5640), { resourceHandle: 4, indexSize: 2, offset: 0 }, "u16 index buffer");
  same(at(185, 4140).values, [1, 0.5, 0, 1], "orange modulation uniform");
  same(at(209, 4196).values, [1, 1, 1, 0.25], "alpha modulation uniform");
  equal(at(209, 4140).renderTargets[0].rgbSourceFactor, 3, "SRC_ALPHA blend factor");
  equal(at(209, 4140).renderTargets[0].rgbDestinationFactor, 19, "INV_SRC_ALPHA blend factor");
  equal(at(161, 5684).count, 6, "indexed triangles count");

  // Every byte prefix, including inside the opaque END_TRANSFERS payload.
  for (const { bytes, labels, frames } of originals) {
    const boundaries = new Map([[0, 0]]);
    frames.forEach((frame, index) => boundaries.set(frame.byteOffset + frame.byteLength, index + 1));
    for (let length = 0; length < bytes.length; length++) {
      const result = decodeSubmission(bytes.subarray(0, length), labels);
      attacks.prefixCases++;
      if (boundaries.has(length)) {
        equal(result.ok, true, `event ${labels.event} packet-boundary prefix ${length}`);
        equal(result.commands.length, boundaries.get(length), `event ${labels.event} prefix command count ${length}`);
        equal(result.byteLength, length, `event ${labels.event} prefix byteLength ${length}`);
        attacks.boundaryPrefixes++;
      } else {
        errorShape(result, `event ${labels.event} truncated byte prefix ${length}`,
          length % 4 ? "unaligned-submission" : "truncated-payload");
        if (length % 4 === 0) {
          const partial = frames.find((frame) => frame.byteOffset < length && frame.byteOffset + frame.byteLength > length);
          equal(result.error.byteOffset, partial.byteOffset, "truncation reports outer packet location");
        }
      }
    }
  }

  const capturePacket = (event, offset) => {
    const original = originals.find((s) => s.labels.event === event);
    const frame = original.frames.find((f) => f.byteOffset === offset);
    return original.bytes.slice(offset, offset + frame.byteLength);
  };
  // Unknown dispatch, object bytes, exact arities and atomic whole-submission failure.
  reject(packet(255, 0, []), "unknown opcode", "unsupported-command", 0, 255);
  reject(packet(15, 0, [0]), "out-of-profile scissor opcode", "unsupported-command");
  reject(packet(1, 255, [1]), "unknown create object", "unsupported-object");
  reject(packet(1, 9, [1]), "unsupported query object", "unsupported-object");
  reject(packet(2, 4, [1]), "shader through generic bind object", "unsupported-object");
  reject(packet(28, 1, [1]), "non-object command reserved object byte", "invalid-object-type");
  reject(packet(28, 0, []), "short fixed packet", "payload-length");
  reject(packet(28, 0, [1, 2]), "long fixed packet", "payload-length");
  reject(join(goodBytes, packet(255, 0, [])), "invalid tail discards complete prefix", "unsupported-command", 8, 255);
  reject(join(goodBytes, packet(7, 0, [4])), "invalid semantic tail discards complete prefix", "payload-length", 8, 7);
  reject(new Uint8Array([28, 0, 1]), "incomplete header", "unaligned-submission");
  reject(packet(1, 1, Array(11).fill(0)), "zero creation handle", "invalid-value");
  reject(packet(3, 4, [0]), "zero destruction handle", "invalid-value");
  const fixedOpcodes = new Set([2, 3, 7, 8, 13, 14, 22, 24, 25, 28, 29, 30, 31, 32, 33, 38, 43, 45, 46, 52]);
  const fixedObjects = new Set([1, 2, 3, 6, 7, 8]);
  const seenArities = new Set();
  for (const original of originals) {
    const view = new DataView(original.bytes.buffer);
    for (const frame of original.frames) {
      if (!fixedOpcodes.has(frame.opcode) && !(frame.opcode === 1 && fixedObjects.has(frame.objectType))) continue;
      const key = `${frame.opcode}/${frame.objectType}`;
      if (seenArities.has(key)) continue;
      seenArities.add(key);
      const words = Array.from({ length: frame.payloadDwords }, (_, i) => view.getUint32(frame.byteOffset + 4 + i * 4, true));
      reject(packet(frame.opcode, frame.objectType, words.slice(0, -1)), `fixed shape ${key} missing final word`, "payload-length");
      reject(packet(frame.opcode, frame.objectType, [...words, 0]), `fixed shape ${key} extra final word`, "payload-length");
    }
  }

  // Supported finite, nonliteral parameters and handles must not become a hash allowlist.
  const changedDraw = setWord(setWord(capturePacket(161, 5684), 1, 3), 2, 9);
  equal(accept(changedDraw, "valid nonliteral draw range").commands[0].fields.count, 9, "changed draw count decoded");
  const changedTransfer = setWord(setWord(capturePacket(161, 0), 1, 0xfedcba98), 13, 2);
  const transferFields = accept(changedTransfer, "valid different handle and transfer direction").commands[0].fields;
  equal(transferFields.resourceHandle, 0xfedcba98, "unsigned wire handle retained");
  equal(transferFields.direction, 2, "from-host transfer direction decoded");
  same(accept(packet(14, 0, [-1, 0.25, 0.5, 2].map(floatWord)), "valid different finite blend color").commands[0].fields.color,
    [-1, 0.25, 0.5, 2], "nonliteral floats decoded");
  accept(shader("VERT\nEND\n"), "valid independently constructed shader text");
  accept(packet(11, 0, [0]), "index buffer unbind");
  accept(packet(10, 0, [0, 31, 0xfedcba98]), "last sampler slot and arbitrary handle");
  accept(packet(12, 0, [0, 0, ...Array(32).fill(floatWord(0.25))]), "maximum inline constant words");
  equal(accept(setWord(capturePacket(161, 5248), 2, 536871106 | 512),
    "valid back-face rasterizer culling").commands[0].fields.cullFace, 2, "back-face culling decoded");
  const floatBoundary = accept(packet(12, 0, [0, 0, 0x3f800000, 0xbf800000, 0x80000000, 1]),
    "finite constant sign and subnormal bits").commands[0].fields;
  same(floatBoundary.words, [0x3f800000, 0xbf800000, 0x80000000, 1], "constant bit patterns retained");
  equal(floatBoundary.values[0], 1, "positive constant"); equal(floatBoundary.values[1], -1, "negative constant");
  equal(floatBoundary.values[2], -0, "negative zero preserved");
  equal(floatBoundary.values[3], 2 ** -149, "minimum positive float32 subnormal preserved");
  for (const text of ["A", "AB", "ABC", "ABCD", "A\t\n\r"]) {
    equal(accept(shader(text, 0, 1), `shader byte-length residue ${text.length}:${JSON.stringify(text)}`)
      .commands[0].fields.text, text, "short text and permitted whitespace preserved");
  }

  const shaderPacket = capturePacket(161, 4136);
  reject(setWord(shaderPacket, 2, 6), "unknown shader stage", "invalid-enum");
  reject(setWord(shaderPacket, 2, 5), "active compute shader unsupported", "unsupported-feature");
  reject(setWord(shaderPacket, 3, 0x80000101), "shader continuation bit", "unsupported-feature");
  reject(setWord(shaderPacket, 5, 1), "shader stream output declaration", "unsupported-feature");
  reject(setWord(shaderPacket, 4, 0), "shader zero token count", "limit-exceeded");
  reject(setWord(shaderPacket, 4, 8193), "shader over token budget", "limit-exceeded");
  reject(setWord(shaderPacket, 3, 16386), "shader declared text over budget", "limit-exceeded");
  reject(setWord(shaderPacket, 3, 1), "empty shader declaration", "invalid-value");
  const embeddedNul = shaderPacket.slice(); embeddedNul[28] = 0;
  reject(embeddedNul, "shader embedded NUL", "invalid-value");
  const missingNul = shaderPacket.slice(); missingNul[24 + 256] = 65;
  reject(missingNul, "shader missing terminal NUL", "invalid-value");
  const badPadding = shaderPacket.slice(); badPadding[badPadding.length - 1] = 1;
  reject(badPadding, "shader nonzero alignment padding", "invalid-value");
  const nonAscii = shaderPacket.slice(); nonAscii[24] = 128;
  reject(nonAscii, "shader non-ASCII byte", "invalid-value");
  const maxShader = accept(shader("x".repeat(16384), 1, 8192), "maximum shader text and token budgets");
  equal(maxShader.commands[0].fields.text.length, 16384, "maximum text preserved");
  reject(shader("x".repeat(16385)), "actual shader text above budget", "limit-exceeded");

  for (const [event, offset, word, name] of [
    [161, 5304, 2, "viewport"], [161, 5072, 1, "blend color"], [161, 5336, 3, "inline constant"],
    [161, 5248, 3, "rasterizer"], [161, 5136, 3, "sampler LOD"], [161, 4884, 5, "alpha reference"],
    [161, 4848, 2, "clear color"], [161, 5364, 1, "tessellation factor"],
  ]) {
    for (const [bits, kind] of [[0x7fc00001, "NaN"], [0x7f800000, "+Infinity"], [0xff800000, "-Infinity"]]) {
      reject(setWord(capturePacket(event, offset), word, bits), `${name} ${kind}`, "invalid-value");
    }
  }
  reject(setWord(capturePacket(161, 4848), 7, 0x7ff00000), "clear depth Infinity", "invalid-value");
  reject(setWord(capturePacket(161, 5192), 2, 0x80000000), "blend reserved flags", "invalid-value");
  reject(setWord(capturePacket(161, 5192), 4, 0x80000000), "blend target reserved bit", "invalid-value");
  reject(setWord(capturePacket(161, 5136), 2, 725010 | 1024), "sampler reserved filter bit", "invalid-value");
  reject(setWord(capturePacket(161, 5092), 6, 7), "sampler view unknown swizzle", "invalid-enum");
  reject(setWord(capturePacket(161, 5092), 6, 0x1000), "sampler view reserved swizzle bits", "invalid-value");
  reject(packet(13, 0, [0x10000]), "stencil reference reserved bits", "invalid-value");
  reject(packet(38, 0, [0, 0x1000000]), "framebuffer reserved sample bits", "invalid-value");
  equal(accept(setWord(capturePacket(161, 0), 3, 0xffffffff), "opaque transfer usage bits").commands[0].fields.usage,
    0xffffffff, "uninterpreted transfer usage preserved");
  reject(setWord(capturePacket(161, 0), 13, 0), "transfer unknown direction", "invalid-enum");
  reject(setWord(capturePacket(173, 4104), 14, 7), "copy transfer reserved flags", "invalid-value");
  reject(setWord(capturePacket(173, 4104), 14, 2), "copy transfer unsynchronized read", "unsupported-feature");
  reject(setWord(capturePacket(161, 0), 9, 0), "empty transfer box", "invalid-value");
  reject(setWord(capturePacket(161, 0), 6, 0x7fffffff), "transfer coordinate overflow", "invalid-value");
  reject(setWord(capturePacket(173, 4104), 4, 0xffffffff), "transfer row-span overflow", "invalid-value");
  reject(setWord(capturePacket(173, 4104), 13, 0xffffffff), "staging offset overflow", "invalid-value");
  reject(setWord(capturePacket(161, 5684), 1, 0xffffffff), "draw range overflow", "invalid-value");
  reject(setWord(capturePacket(161, 5684), 4, 2), "draw indexed non-boolean", "invalid-value");
  reject(setWord(setWord(capturePacket(161, 5684), 10, 2), 11, 1), "draw inverted index range", "invalid-value");

  // Array width, count and slot bounds; zero reset entries do not enable features.
  for (const [op, prefix, width, limit, name] of [
    [4, [0], 6, 1, "viewport"], [6, [], 3, 16, "vertex buffer"],
    [34, [5, 0], 3, 16, "shader buffer"], [35, [5, 0], 5, 32, "shader image"],
    [40, [0], 3, 16, "atomic buffer"],
  ]) {
    reject(packet(op, 0, [...prefix, ...Array(width - 1).fill(0)]), `${name} partial element`, "payload-length");
    reject(packet(op, 0, [...prefix, ...Array(width * (limit + 1)).fill(0)]), `${name} over count budget`, "limit-exceeded");
    if (op !== 6) {
      const words = [...prefix, ...Array(width).fill(0)]; words[prefix.length - 1] = limit;
      reject(packet(op, 0, words), `${name} slot plus count overflow`, "limit-exceeded");
    }
  }
  reject(packet(1, 5, [1, 0, 0, 0]), "vertex elements partial element", "payload-length");
  reject(packet(1, 5, [1, ...Array(17).fill([0, 0, 0, 29]).flat()]), "vertex elements over count budget", "limit-exceeded");
  reject(packet(1, 5, [1, 0, 0, 16, 29]), "vertex element buffer index budget", "limit-exceeded");
  reject(packet(1, 5, [1, 0xffffffff, 0, 0, 29]), "vertex element address overflow", "invalid-value");
  accept(packet(1, 5, [0xffffffff, 0xfffffff7, 0, 15, 29]), "vertex element final valid source and buffer index");
  accept(packet(1, 5, [1, ...Array(16).fill([0, 0, 0, 29]).flat()]), "maximum vertex elements");
  accept(packet(6, 0, []), "empty vertex buffers");
  accept(packet(6, 0, Array(16).fill([16, 8, 0xffffffff]).flat()), "maximum vertex buffers");
  for (const [op, width, limit, name] of [[34, 3, 16, "shader buffer"], [35, 5, 32, "shader image"], [40, 3, 16, "atomic buffer"]]) {
    const prefix = (start) => op === 40 ? [start] : [5, start];
    accept(packet(op, 0, [...prefix(0), ...Array(width * limit).fill(0)]), `${name} maximum reset count`);
    accept(packet(op, 0, [...prefix(limit - 1), ...Array(width).fill(0)]), `${name} last legal slot`);
    accept(packet(op, 0, prefix(limit)), `${name} empty at end of slot range`);
    reject(packet(op, 0, prefix(0xffffffff)), `${name} start slot wrap attempt`, "limit-exceeded");
  }
  for (const op of [10, 18]) {
    reject(packet(op, 0, [0]), `sampler opcode ${op} missing prefix`, "payload-length");
    reject(packet(op, 0, [0, 0, ...Array(33).fill(0)]), `sampler opcode ${op} too many slots`, "limit-exceeded");
    reject(packet(op, 0, [0, 32, 1]), `sampler opcode ${op} slot overflow`, "limit-exceeded");
    reject(packet(op, 0, [6, 0]), `sampler opcode ${op} unknown stage`, "invalid-enum");
    accept(packet(op, 0, [5, 0, 0]), `sampler opcode ${op} inactive compute reset`);
    reject(packet(op, 0, [5, 0, 1]), `sampler opcode ${op} active compute binding`, "unsupported-feature");
    accept(packet(op, 0, [0, 0, ...Array(32).fill(0)]), `sampler opcode ${op} maximum slot count`);
    accept(packet(op, 0, [0, 32]), `sampler opcode ${op} empty at end of slot range`);
  }
  reject(packet(12, 0, [0, 0, 0]), "inline constants incomplete vec4", "payload-length");
  reject(packet(12, 0, [0, 0, ...Array(36).fill(0)]), "inline constants over word budget", "limit-exceeded");
  reject(packet(12, 0, [0, 15]), "constant slot budget", "limit-exceeded");
  reject(packet(12, 0, [0, 1, 0, 0, 0, 0]), "active nonzero constant slot", "unsupported-feature");
  for (let stage = 2; stage <= 5; stage++) {
    accept(packet(31, 0, [0, stage]), `inactive stage ${stage} shader unbind`);
    reject(packet(31, 0, [1, stage]), `active stage ${stage} shader bind`, "unsupported-feature");
    accept(packet(12, 0, [stage, 14]), `inactive stage ${stage} constant reset`);
    reject(packet(12, 0, [stage, 0, 0, 0, 0, 0]), `active stage ${stage} constant data`, "unsupported-feature");
  }
  for (const [op, prefix, width, name] of [[34, [0, 0], 3, "shader buffer"], [35, [1, 0], 5, "shader image"], [40, [0], 3, "atomic buffer"]]) {
    accept(packet(op, 0, [...prefix, ...Array(width).fill(0)]), `${name} complete zero reset`);
    for (let field = 0; field < width; field++) {
      const entry = Array(width).fill(0); entry[field] = 1;
      reject(packet(op, 0, [...prefix, ...entry]), `${name} active entry field ${field}`, "unsupported-feature");
    }
  }
  reject(packet(25, 0, [1]), "active stream-output append mask", "unsupported-feature");
  reject(packet(25, 0, [0, 1]), "active stream-output target", "payload-length");
  reject(packet(52, 0, [1, 2, 0, 0, 0, 1]), "active compute shader linkage", "unsupported-feature");
  reject(packet(24, 0, [1]), "active partial sample mask", "unsupported-feature");
  reject(packet(33, 0, [2]), "active multisample minimum", "unsupported-feature");
  reject(packet(32, 0, [floatWord(2), ...Array(5).fill(floatWord(1))]), "active tessellation factors", "unsupported-feature");

  // Padding remains opaque even if it contains plausible, invalid or huge headers.
  const paddingBase = originals[1].bytes;
  for (const [offset, value] of [[4, 0xffff00ff], [256, 0x0001011c], [2048, 0x00030008], [4092, 0xffffffff]]) {
    const modified = setWord(paddingBase, offset / 4, value);
    const decoded = accept(modified, `opaque padding fake header at ${offset}`);
    equal(decoded.commands.length, 3, "opaque padding keeps three outer packets");
    same(decoded.commands, decodedSubmissions[1].commands, "opaque bytes do not create typed commands");
  }
  reject(setWord(paddingBase, 0, 44 + 65535 * 65536), "opaque outer payload overrun", "truncated-payload", 0, 44);
  const corruptOuter = paddingBase.slice(); corruptOuter[4096] = 255;
  reject(corruptOuter, "invalid header immediately outside opaque payload", "unsupported-command", 4096, 255);

  // Input type/ownership and hard allocation/loop limits.
  for (const [value, name] of [[null, "null"], [[], "plain array"], [new ArrayBuffer(8), "ArrayBuffer"],
    [new DataView(new ArrayBuffer(8)), "DataView"], [new Uint32Array(2), "Uint32Array"]]) {
    reject(value, `invalid input ${name}`, "invalid-input");
  }
  const host = new Uint8Array(originals[0].bytes.length + 9); host.fill(0xff);
  host.set(originals[0].bytes, 3);
  const shifted = host.subarray(3, host.length - 6);
  const offsetResult = accept(shifted, "unaligned nonzero Uint8Array host offset", originals[0].labels);
  same(offsetResult, decodedSubmissions[0], "nonzero byteOffset whole decoded parity");
  const stable = JSON.stringify(offsetResult); host.fill(0);
  equal(JSON.stringify(offsetResult), stable, "post-decode input mutation cannot change output");
  truth(typeof structuredClone === "function", "structuredClone available for detached input attack");
  const detached = goodBytes.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  const detachedResult = decodeSubmission(detached, provenance);
  errorShape(detachedResult, "detached Uint8Array", "invalid-input"); frozen(detachedResult, "detached rejection");
  equal(JSON.stringify(decodeSubmission(goodBytes, provenance)), goodExpected, "detached then good recovery");
  attacks.named.push({ name: "detached Uint8Array", outcome: "rejected", code: detachedResult.error.code });
  if (typeof SharedArrayBuffer === "function") {
    reject(new Uint8Array(new SharedArrayBuffer(8)), "shared mutable input", "invalid-input");
    attacks.sharedArrayBuffer = "rejected";
  }
  const maximum = packet(44, 0, Array(65535).fill(0));
  const maximumBytesResult = accept(maximum, "maximum submission bytes");
  equal(maximumBytesResult.byteLength, 262144, "exact byte bound");
  reject(new Uint8Array(262148), "submission above byte bound", "limit-exceeded");
  const maxCommands = join(...Array(4096).fill(goodBytes));
  const maximumCommandsResult = accept(maxCommands, "maximum command count");
  equal(maximumCommandsResult.commands.length, 4096, "exact command bound");
  reject(join(maxCommands, goodBytes), "submission above command bound", "limit-exceeded", 32768, 28);
  accept(new Uint8Array(0), "empty submission");
  accept(goodBytes, "absent optional provenance", {});
  accept(goodBytes, "explicit null provenance labels", { sourceSha256: null, event: null, contextId: null });
  accept(goodBytes, "explicit undefined provenance labels", { sourceSha256: undefined, event: undefined, contextId: undefined });
  for (const [labels, name] of [[null, "null"], [1, "number"], ["event", "string"], [[], "array"]]) {
    reject(goodBytes, `invalid provenance container ${name}`, "invalid-provenance", 0, null, labels);
  }
  reject(goodBytes, "invalid provenance hash", "invalid-provenance", 0, null, { sourceSha256: "bad" });
  reject(goodBytes, "invalid provenance event", "invalid-provenance", 0, null, { event: -1 });
  reject(goodBytes, "unknown provenance symbol", "invalid-provenance", 0, null, { [Symbol("unknown")]: 1 });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  reject(goodBytes, "revoked provenance proxy", "invalid-provenance", 0, null, revoked.proxy);
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, "event", { get() { getterCalls++; return 1; }, enumerable: true });
  reject(goodBytes, "provenance accessor rejected without callback", "invalid-provenance", 0, null, accessor);
  equal(getterCalls, 0, "provenance callback never executed");

  const seeds = options.seeds === undefined ? DEFAULT_SEEDS : options.seeds;
  const mutationCount = options.count === undefined ? 4096 : options.count;
  truth(Array.isArray(seeds) && seeds.length > 0 && seeds.length <= 64 &&
    seeds.every((seed) => Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff), "bounded mutation seeds");
  truth(Number.isInteger(mutationCount) && mutationCount >= 0 && mutationCount <= 100000, "bounded mutation count");
  const states = seeds.map((seed) => seed >>> 0);
  const random = (index) => {
    let x = states[index];
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    states[index] = x >>> 0;
    return states[index];
  };
  for (let iteration = 0; iteration < mutationCount; iteration++) {
    const seedIndex = iteration % seeds.length;
    const original = originals[random(seedIndex) % originals.length];
    let bytes = original.bytes.slice();
    const mode = Math.floor(iteration / seeds.length) % 4;
    if (mode === 0) bytes[random(seedIndex) % bytes.length] ^= 1 << (random(seedIndex) % 8);
    if (mode === 1) {
      const frame = original.frames[random(seedIndex) % original.frames.length];
      const atByte = frame.byteOffset + 4 * (random(seedIndex) % (frame.payloadDwords + 1));
      new DataView(bytes.buffer).setUint32(atByte, random(seedIndex), true);
    }
    if (mode === 2) {
      const frame = original.frames[random(seedIndex) % original.frames.length]; bytes[frame.byteOffset] = 255;
    }
    if (mode === 3) bytes = bytes.subarray(0, random(seedIndex) % (bytes.length + 1));
    const before = bytes.slice();
    const result = decodeSubmission(bytes, original.labels);
    const label = `seed ${seeds[seedIndex]} mutation ${iteration}`;
    if (result.ok) {
      framing(bytes, result, original.labels, label); attacks.acceptedMutations++;
      truth(mode !== 2, `${label} injected unknown outer opcode rejected`);
    } else {
      errorShape(result, label); attacks.rejectedMutations++;
    }
    // Compare bytes directly to avoid allocating large JSON strings in fuzz loops.
    equal(bytes.length, before.length, `${label} input length unchanged`);
    truth(bytes.every((byte, index) => byte === before[index]), `${label} input bytes unchanged`);
    same(decodeSubmission(bytes, original.labels), result, `${label} deterministic result`);
    if (iteration % 32 === 0) {
      equal(JSON.stringify(decodeSubmission(goodBytes, provenance)), goodExpected, `${label} recovery`);
      attacks.recoveryChecks++;
    }
    attacks.mutations++;
  }
  attacks.seeds = seeds.slice();
  equal(attacks.prefixCases, 42380, "exhaustive byte-prefix case count");
  equal(attacks.boundaryPrefixes, 210, "complete packet-prefix count including empty submissions");
  return { ok: true, status: "passed", profile: "virgl-tiny-commands-v1", counts: { submissions: 8, bytes: totalBytes,
    packets: totalPackets, families: families.size, createObjectTypes: objectTypes.size },
  maximumCases: { acceptedSubmissionBytes: maximumBytesResult.byteLength,
    acceptedSubmissionCommands: maximumBytesResult.commands.length,
    acceptedSubmissionResultJsonBytes: JSON.stringify(maximumBytesResult).length,
    acceptedCommandCount: 4096, commandCountSubmissionBytes: 32768,
    acceptedCommandCountResultJsonBytes: JSON.stringify(maximumCommandsResult).length,
    maximumShaderTextBytes: 16384, maximumShaderTokens: 8192,
    oversizedSubmissionBytes: 262148, oversizedCommandCount: 4097 },
  assertions, attacks, decodedSubmissions };
}
