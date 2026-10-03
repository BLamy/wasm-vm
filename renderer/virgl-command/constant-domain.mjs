/** Consumer contract only: no shader admission or guest transport is added here. */
export const CONDITIONAL_PROFILE = "virgl-webgl2-raw-bits-v7";
export const STRUCTURED_PROFILE = "virgl-webgl2-raw-bits-v8";
export const STRUCTURED_CONDITIONAL_PROFILE = "virgl-webgl2-raw-bits-v9";
export const INDIRECT_PROFILE = "virgl-webgl2-raw-bits-v10";
export const INDIRECT_CONDITIONAL_PROFILE = "virgl-webgl2-raw-bits-v11";
export const CONSTANT_DOMAIN_KIND = "constant-bank-finite-f32-v1";
export const CONSTANT_ACCESS_KIND = "constant-bank-static-indirect-v1";
const INDIRECT_PROFILES = new Set([INDIRECT_PROFILE, INDIRECT_CONDITIONAL_PROFILE]);
const CONDITIONAL_PROFILES = new Set([CONDITIONAL_PROFILE, STRUCTURED_CONDITIONAL_PROFILE, INDIRECT_CONDITIONAL_PROFILE]);
const UNCONDITIONAL_PROFILES = new Set(["virgl-webgl2-straight-line-v5",
  ...[1, 2, 3, 4, 5, 6].map((version) => `virgl-webgl2-raw-bits-v${version}`), STRUCTURED_PROFILE]);
const METADATA_KEYS = ["profile", "stage", "inputs", "outputs", "attributes", "uniforms", "samplers", "uniformBlocks"];
const DOMAIN_KEYS = ["kind", "stage", "slot", "name", "count"];
class DomainFault extends Error {}
function require(value, message) { if (!value) throw new DomainFault(message); }
function descriptors(value) {
  try { return Object.getOwnPropertyDescriptors(value); }
  catch { throw new DomainFault("Unusable own data properties."); }
}
function isArray(value) {
  try { return Array.isArray(value); }
  catch { throw new DomainFault("Unusable array identity."); }
}
function record(value, allowed, required = allowed) {
  require(value !== null && typeof value === "object" && !isArray(value), "Expected an own data record.");
  const fields = descriptors(value), result = {};
  for (const key of Reflect.ownKeys(fields)) {
    require(allowed.includes(key) && Object.hasOwn(fields[key], "value"), "Unknown or accessor property.");
    result[key] = fields[key].value;
  }
  for (const key of required) require(Object.hasOwn(result, key), `Missing ${key}.`);
  return result;
}
function array(value, maximum) {
  require(isArray(value), "Expected an own data array.");
  const fields = descriptors(value), length = fields.length?.value;
  require(Number.isInteger(length) && length >= 0 && length <= maximum, "Array extent exceeds the bounded contract.");
  require(Reflect.ownKeys(fields).length === length + 1, "Array must be dense and contain no extra properties.");
  const result = [];
  for (let index = 0; index < length; index++) {
    require(fields[index] && Object.hasOwn(fields[index], "value"), "Array entries must be own data properties.");
    result.push(fields[index].value);
  }
  return result;
}
function failure(code, message) { return Object.freeze({ ok: false, error: Object.freeze({ code, message }) }); }

/** Recognize a trusted compiler result without changing any of its metadata. */
export function parseConstantDomain(metadata, expectedStage) {
  try {
    require(expectedStage === "vertex" || expectedStage === "fragment", "Unknown shader stage.");
    const value = record(metadata, [...METADATA_KEYS, "constantDomains", "constantAccesses"], METADATA_KEYS);
    require(value.stage === expectedStage, "Constant domain stage disagrees with the shader stage.");
    require(CONDITIONAL_PROFILES.has(value.profile) || UNCONDITIONAL_PROFILES.has(value.profile) || INDIRECT_PROFILES.has(value.profile), "Unknown shader profile.");
    const indirect = INDIRECT_PROFILES.has(value.profile);
    let access = null;
    if (indirect) {
      require(Object.hasOwn(value, "constantAccesses"), "Indirect shader profile requires a constant access contract.");
      const accesses = array(value.constantAccesses, 1), uniforms = array(value.uniforms, 1);
      require(accesses.length === 1 && uniforms.length === 1, "Indirect shader requires one access contract and one constant bank.");
      access = record(accesses[0], [...DOMAIN_KEYS, "indices"]);
      const uniform = record(uniforms[0], ["name", "type", "count", "encoding"]);
      const name = expectedStage === "vertex" ? "vsconst0" : "fsconst0";
      require(access.kind === CONSTANT_ACCESS_KIND && access.stage === expectedStage && access.slot === 0 && access.name === name,
        "Unknown or inconsistent constant-bank access.");
      require(Number.isInteger(access.count) && access.count >= 1 && access.count <= 47 &&
        uniform.name === name && uniform.type === "uvec4[]" && uniform.encoding === "float32-bits" && uniform.count === access.count,
      "Constant access does not match the declared bank extent and encoding.");
      const indices = array(access.indices, 46);
      require(indices.length > 0 && indices.every((index, position) => Number.isInteger(index) && index >= 0 &&
        index <= 45 && index < access.count && (position === 0 || indices[position - 1] < index)),
      "Constant access indices must be nonempty, sorted, unique and guest-addressable.");
      access = Object.freeze({ ...access, indices: Object.freeze(indices) });
    } else {
      require(!Object.hasOwn(value, "constantAccesses"), "Shader profile forbids a constant access contract.");
    }
    if (!CONDITIONAL_PROFILES.has(value.profile)) {
      require(!Object.hasOwn(value, "constantDomains"), "Unconditional shader profile carries a conditional contract.");
      return Object.freeze({ ok: true, domain: null, ...(indirect ? { access } : {}) });
    }
    require(Object.hasOwn(value, "constantDomains"), "Conditional shader profile requires a constant domain.");
    const domains = array(value.constantDomains, 1), uniforms = array(value.uniforms, 1);
    require(domains.length === 1 && uniforms.length === 1, "Conditional shader requires one domain and one constant bank.");
    const domain = record(domains[0], DOMAIN_KEYS);
    const uniform = record(uniforms[0], ["name", "type", "count", "encoding"]);
    const name = expectedStage === "vertex" ? "vsconst0" : "fsconst0";
    require(domain.kind === CONSTANT_DOMAIN_KIND && domain.stage === expectedStage && domain.slot === 0 && domain.name === name,
      "Unknown or inconsistent constant-bank domain.");
    require(Number.isInteger(domain.count) && domain.count >= 1 && domain.count <= 47 &&
      uniform.name === name && uniform.type === "uvec4[]" && uniform.encoding === "float32-bits" && uniform.count === domain.count,
    "Constant domain does not match the declared bank extent and encoding.");
    return Object.freeze({ ok: true, domain: Object.freeze(domain), ...(indirect ? { access } : {}) });
  } catch (error) {
    if (!(error instanceof DomainFault)) throw error;
    return failure("shader-domain-error", error.message);
  }
}

/** Finite binary32 encodings include both zero signs and every subnormal. */
export function finiteBinary32Word(word) {
  return Number.isInteger(word) && word >= 0 && word <= 0xffffffff && (word & 0x7f800000) !== 0x7f800000;
}

/** Validate and own exactly the reflected prefix; no absent word is synthesized. */
export function checkFiniteBank(words, uploadCount) {
  try {
    require(Number.isInteger(uploadCount) && uploadCount >= 0 && uploadCount <= 46, "Invalid reflected constant upload extent.");
    const bank = array(words, 184);
    require(bank.length % 4 === 0, "Constant bank must contain complete vec4 registers.");
    const count = uploadCount * 4;
    if (bank.length < count) return failure("incomplete-draw", "Drawing requires every active constant word.");
    const prefix = bank.slice(0, count);
    require(prefix.every(finiteBinary32Word), "Active constant word is outside the finite-binary32 domain.");
    return Object.freeze({ ok: true, words: Object.freeze(prefix) });
  } catch (error) {
    if (!(error instanceof DomainFault)) throw error;
    return failure("constant-domain-error", error.message);
  }
}

/** Own the entire declared guest-addressable bank, independent of reflection. */
export function checkIndirectBank(words, declaredCount, finite) {
  try {
    require(Number.isInteger(declaredCount) && declaredCount >= 1 && declaredCount <= 47 && typeof finite === "boolean",
      "Invalid indirect constant-bank contract.");
    const bank = array(words, 184);
    require(bank.length % 4 === 0, "Constant bank must contain complete vec4 registers.");
    const count = Math.min(declaredCount, 46) * 4;
    if (bank.length < count) return failure("incomplete-draw", "Drawing requires every declared indirect constant word.");
    const prefix = bank.slice(0, count);
    require(prefix.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffffffff),
      "Indirect constant word is not an exact u32.");
    require(!finite || prefix.every(finiteBinary32Word), "Indirect constant word is outside the finite-binary32 domain.");
    return Object.freeze({ ok: true, words: Object.freeze(prefix) });
  } catch (error) {
    if (!(error instanceof DomainFault)) throw error;
    return failure(finite === true ? "constant-domain-error" : "constant-access-error", error.message);
  }
}
