/** Consumer contract only: no shader admission or guest transport is added here. */
export const CONDITIONAL_PROFILE = "virgl-webgl2-raw-bits-v7";
export const STRUCTURED_PROFILE = "virgl-webgl2-raw-bits-v8";
export const STRUCTURED_CONDITIONAL_PROFILE = "virgl-webgl2-raw-bits-v9";
export const INDIRECT_PROFILE = "virgl-webgl2-raw-bits-v10";
export const INDIRECT_CONDITIONAL_PROFILE = "virgl-webgl2-raw-bits-v11";
export const LOOP_PROFILE = "virgl-webgl2-raw-bits-v12";
export const RADIAL_PROFILE = "virgl-webgl2-raw-bits-v14";
export const RADIAL_INDIRECT_PROFILE = "virgl-webgl2-raw-bits-v15";
export const RADIAL_LOOP_PROFILE = "virgl-webgl2-raw-bits-v16";
export const RADIAL_DOMAIN_KIND = "constant-bank-radial-coefficient-f32-v1";
export const CONSTANT_DOMAIN_KIND = "constant-bank-finite-f32-v1";
export const CONSTANT_ACCESS_KIND = "constant-bank-static-indirect-v1";
export const CONSTANT_CONSTRAINT_KIND = "constant-bank-counted-table-i32-v1";
const RADIAL_PROFILES = new Set([RADIAL_PROFILE, RADIAL_INDIRECT_PROFILE, RADIAL_LOOP_PROFILE]);
const INDIRECT_PROFILES = new Set([INDIRECT_PROFILE, INDIRECT_CONDITIONAL_PROFILE, LOOP_PROFILE, RADIAL_INDIRECT_PROFILE, RADIAL_LOOP_PROFILE]);
const CONDITIONAL_PROFILES = new Set([CONDITIONAL_PROFILE, STRUCTURED_CONDITIONAL_PROFILE, INDIRECT_CONDITIONAL_PROFILE, LOOP_PROFILE, ...RADIAL_PROFILES]);
const UNCONDITIONAL_PROFILES = new Set(["virgl-webgl2-straight-line-v5",
  ...[1, 2, 3, 4, 5, 6, 13].map((version) => `virgl-webgl2-raw-bits-v${version}`), STRUCTURED_PROFILE]);
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
    const value = record(metadata, [...METADATA_KEYS, "constantDomains", "constantAccesses", "constantConstraints", "constantRadialDomains"], METADATA_KEYS);
    require(value.stage === expectedStage, "Constant domain stage disagrees with the shader stage.");
    require(CONDITIONAL_PROFILES.has(value.profile) || UNCONDITIONAL_PROFILES.has(value.profile) || INDIRECT_PROFILES.has(value.profile), "Unknown shader profile.");
    const loop = value.profile === LOOP_PROFILE || value.profile === RADIAL_LOOP_PROFILE;
    const radial = RADIAL_PROFILES.has(value.profile);
    require(radial || !Object.hasOwn(value, "constantRadialDomains"), "Shader profile forbids a radial coefficient domain.");
    require(loop || !Object.hasOwn(value, "constantConstraints"), "Shader profile forbids a constant count constraint.");
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
    let constraint = null;
    if (loop) {
      require(Object.hasOwn(value, "constantConstraints"), "Loop shader profile requires a constant count constraint.");
      const constraints = array(value.constantConstraints, 1);
      require(constraints.length === 1, "Loop shader requires one constant count constraint.");
      constraint = record(constraints[0], [...DOMAIN_KEYS, "register", "component", "maximum"]);
      require(constraint.kind === CONSTANT_CONSTRAINT_KIND && constraint.stage === expectedStage && constraint.slot === 0 &&
        constraint.name === name && constraint.register === 9 && constraint.component === 0 && constraint.maximum === 18,
      "Unknown or inconsistent constant count constraint.");
      require((constraint.count === 46 || constraint.count === 47) && constraint.count === domain.count && constraint.count === access.count,
        "Constant count constraint does not match the complete declared bank extent.");
      require(access.indices.filter((index) => index >= 10).length === 36,
        "Loop constant access must cover every certified index from 10 through 45.");
      constraint = Object.freeze(constraint);
    }
    let radialDomain = null;
    if (radial) {
      require(Object.hasOwn(value, "constantRadialDomains"), "Radial shader requires a coefficient domain.");
      const domains = array(value.constantRadialDomains, 1);
      require(domains.length === 1, "Radial shader requires exactly one coefficient domain.");
      radialDomain = record(domains[0], [...DOMAIN_KEYS, "register", "component", "minimumMagnitude"]);
      require(radialDomain.kind === RADIAL_DOMAIN_KIND && radialDomain.stage === expectedStage &&
        radialDomain.slot === 0 && radialDomain.name === name && radialDomain.count === domain.count &&
        radialDomain.count >= 5 && radialDomain.register === 4 && radialDomain.component === 0 &&
        radialDomain.minimumMagnitude === 0x3727c5ac,
      "Unknown or inconsistent radial coefficient domain.");
      radialDomain = Object.freeze(radialDomain);
    }
    return Object.freeze({ ok: true, domain: Object.freeze(domain), ...(indirect ? { access } : {}),
      ...(loop ? { constraint } : {}), ...(radial ? { radialDomain } : {}) });
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

/** The finite prefix and raw signed count are approved on one owned snapshot. */
export function checkLoopBank(words, declaredCount) {
  if (declaredCount !== 46 && declaredCount !== 47)
    return failure("constant-constraint-error", "Invalid counted-table bank extent.");
  const checked = checkIndirectBank(words, declaredCount, true);
  if (!checked.ok) return checked;
  const word = checked.words[36];
  if (!(word >= 0x80000000 || word <= 18))
    return failure("constant-constraint-error", "Raw signed constant count exceeds the proved maximum of 18.");
  return checked;
}

/** One owned full finite prefix proves the radial and any loop obligation. */
export function checkRadialBank(words, declaredCount, counted = false) {
  if (!Number.isInteger(declaredCount) || declaredCount < 5 || declaredCount > 47 ||
      typeof counted !== "boolean" || (counted && declaredCount !== 46 && declaredCount !== 47))
    return failure("constant-radial-domain-error", "Invalid radial constant-bank extent.");
  const checked = checkIndirectBank(words, declaredCount, true);
  if (!checked.ok) return checked;
  const magnitude = checked.words[16] & 0x7fffffff;
  if (magnitude < 0x3727c5ac)
    return failure("constant-radial-domain-error", "Radial coefficient permits an undefined linear predecessor.");
  if (counted) {
    const count = checked.words[36];
    if (!(count >= 0x80000000 || count <= 18))
      return failure("constant-constraint-error", "Raw signed constant count exceeds the proved maximum of 18.");
  }
  return checked;
}
