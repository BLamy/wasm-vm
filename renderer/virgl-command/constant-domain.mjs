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
export const PRECISE_WORD_KIND = "tgsi-precise-word-local-v1";
export const CONSTANT_DOMAIN_KIND = "constant-bank-finite-f32-v1";
export const CONSTANT_ACCESS_KIND = "constant-bank-static-indirect-v1";
export const CONSTANT_CONSTRAINT_KIND = "constant-bank-counted-table-i32-v1";
export const RASTER_PROFILE = "virgl-webgl2-raw-bits-v27";
export const RASTER_DOMAIN_KIND = "constant-bank-raster-copy-f32-v1";
export const ARITHMETIC_PROFILE = "virgl-webgl2-raw-bits-v28";
export const ARITHMETIC_KIND = "tgsi-precise-binary32-rne-v1";
export const CONVERSION_PROFILE = "virgl-webgl2-raw-bits-v29";
export const CONVERSION_BANK_PROFILE = "virgl-webgl2-raw-bits-v30";
export const CONVERSION_KIND = "tgsi-signed32-binary32-v1";
export const CONVERSION_DOMAIN_KIND = "constant-bank-f2i-range-v1";
export const SCALAR_PROFILE = "virgl-webgl2-raw-bits-v31";
export const SCALAR_KIND = "tgsi-finite-scalar-binary32-v1";
export const MINIMUM_PROFILE = "virgl-webgl2-raw-bits-v32";
export const MINIMUM_KIND = "tgsi-minimum-word-local-v1";
export const FRACTION_PROFILE = "virgl-webgl2-raw-bits-v33";
export const FRACTION_KIND = "tgsi-fraction-binary32-rne-v1";
export const SATURATION_PROFILE = "virgl-webgl2-raw-bits-v34";
export const SATURATION_KIND = "tgsi-numeric-saturation-local-v1";
const rawProfiles = (...versions) => versions.map((version) => `virgl-webgl2-raw-bits-v${version}`);
const ARITHMETIC_BASES = new Set(rawProfiles(...Array.from({ length: 27 }, (_, i) => i + 1)));
const CONVERSION_BASES = new Set(rawProfiles(...Array.from({ length: 28 }, (_, i) => i + 1)));
const SCALAR_BASES = new Set(rawProfiles(...Array.from({ length: 30 }, (_, i) => i + 1)));
const MINIMUM_BASES = new Set(rawProfiles(...Array.from({ length: 31 }, (_, i) => i + 1)));
const FRACTION_BASES = new Set(rawProfiles(...Array.from({ length: 32 }, (_, i) => i + 1)));
const SATURATION_BASES = new Set(rawProfiles(...Array.from({ length: 33 }, (_, i) => i + 1)));
const PRECISE_PROFILES = new Set(rawProfiles(17, 18, 19, 20, 21, 22, 23, 24, 25, 26));
const RADIAL_PROFILES = new Set([RADIAL_PROFILE, RADIAL_INDIRECT_PROFILE, RADIAL_LOOP_PROFILE, ...rawProfiles(24, 25, 26)]);
const LOOP_PROFILES = new Set([LOOP_PROFILE, RADIAL_LOOP_PROFILE, ...rawProfiles(23, 26)]);
const INDIRECT_PROFILES = new Set([INDIRECT_PROFILE, INDIRECT_CONDITIONAL_PROFILE, LOOP_PROFILE, RADIAL_INDIRECT_PROFILE, RADIAL_LOOP_PROFILE,
  ...rawProfiles(21, 22, 23, 25, 26)]);
const CONDITIONAL_PROFILES = new Set([CONDITIONAL_PROFILE, STRUCTURED_CONDITIONAL_PROFILE, INDIRECT_CONDITIONAL_PROFILE, LOOP_PROFILE,
  ...RADIAL_PROFILES, ...rawProfiles(18, 20, 22, 23)]);
const UNCONDITIONAL_PROFILES = new Set(["virgl-webgl2-straight-line-v5",
  ...rawProfiles(1, 2, 3, 4, 5, 6, 13, 17, 19, 21), STRUCTURED_PROFILE]);
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

function rasterContract(value) {
  const domain = record(value, [...DOMAIN_KEYS, "components"]);
  require(domain.kind === RASTER_DOMAIN_KIND && (domain.stage === "vertex" || domain.stage === "fragment") &&
    domain.slot === 0 && domain.name === (domain.stage === "vertex" ? "vsconst0" : "fsconst0"),
  "Unknown or inconsistent copied-bank raster domain.");
  require(Number.isInteger(domain.count) && domain.count >= 1 && domain.count <= 47,
    "Raster bank extent exceeds its declared bound.");
  const components = array(domain.components, 46).map(value => record(value, ["register", "mask"]));
  require(components.length > 0 && components.every((entry, position) =>
    Number.isInteger(entry.register) && entry.register >= 0 && entry.register < Math.min(domain.count, 46) &&
    Number.isInteger(entry.mask) && entry.mask >= 1 && entry.mask <= 15 &&
    (position === 0 || components[position - 1].register < entry.register)),
  "Raster components must be nonempty, bounded, sorted and unique.");
  return Object.freeze({ ...domain, components: Object.freeze(components.map(Object.freeze)) });
}

function conversionBankContract(value) {
  const domain = record(value, [...DOMAIN_KEYS, "components"]);
  require(domain.kind === CONVERSION_DOMAIN_KIND && (domain.stage === "vertex" || domain.stage === "fragment") &&
    domain.slot === 0 && domain.name === (domain.stage === "vertex" ? "vsconst0" : "fsconst0"),
  "Unknown or inconsistent signed conversion bank.");
  require(Number.isInteger(domain.count) && domain.count >= 1 && domain.count <= 47, "Conversion bank extent exceeds its bound.");
  const components = array(domain.components, 46).map(value => record(value, ["register", "mask"]));
  require(components.length > 0 && components.every((entry, position) => Number.isInteger(entry.register) &&
    entry.register >= 0 && entry.register < Math.min(domain.count, 46) && Number.isInteger(entry.mask) &&
    entry.mask >= 1 && entry.mask <= 15 && (position === 0 || components[position - 1].register < entry.register)),
  "Conversion components must be nonempty, bounded, sorted and unique.");
  return Object.freeze({ ...domain, components: Object.freeze(components.map(Object.freeze)) });
}

/** Recognize a trusted compiler result without changing any of its metadata. */
export function parseConstantDomain(metadata, expectedStage) {
  try {
    require(expectedStage === "vertex" || expectedStage === "fragment", "Unknown shader stage.");
    const value = record(metadata, [...METADATA_KEYS, "constantDomains", "constantAccesses", "constantConstraints", "constantRadialDomains", "preciseWordContract", "rasterBaseProfile", "constantRasterDomains", "arithmeticBaseProfile", "preciseArithmeticContract", "conversionBaseProfile", "signedConversionContract", "constantConversionDomains", "scalarBaseProfile", "scalarWordContract", "minimumBaseProfile", "minimumWordContract", "fractionBaseProfile", "fractionWordContract", "saturationBaseProfile", "saturationContract"], METADATA_KEYS);
    require(value.stage === expectedStage, "Constant domain stage disagrees with the shader stage.");
    const saturation = value.profile === SATURATION_PROFILE;
    require(saturation === Object.hasOwn(value, "saturationBaseProfile") && saturation === Object.hasOwn(value, "saturationContract"),
      "Saturation contract disagrees with its profile.");
    if (saturation) {
      require(SATURATION_BASES.has(value.saturationBaseProfile), "Saturation requires an existing raw base profile.");
      const policy = record(value.saturationContract, ["kind", "stage", "operations", "equation", "authority", "divisionDomain", "division", "modifiers", "zero"]);
      require(policy.kind === SATURATION_KIND && policy.stage === expectedStage &&
        policy.equation === "post-operation-ternary-zero-one" && policy.authority === "existing-numeric-authority" &&
        policy.divisionDomain === "static-normal-divisor-unit-or-known-bounded-quotient" && policy.division === "positive-denominator-highp-2.5-ulp" &&
        policy.modifiers === "negation-before-operation" && policy.zero === "underlying-numeric-result",
      "Unknown instruction-local saturation policy.");
      const operations = array(policy.operations, 2);
      require(operations.length > 0 && operations.every((op, i) => ["DIV_SAT", "MOV_SAT"].includes(op) &&
        (i === 0 || operations[i - 1] < op)), "Saturation operations must be nonempty, sorted and unique.");
      const base = { ...value, profile: value.saturationBaseProfile };
      delete base.saturationBaseProfile; delete base.saturationContract;
      // Whole prior obligations descend strictly; v34 cannot wrap itself.
      const checked = parseConstantDomain(base, expectedStage);
      return checked.ok ? Object.freeze({ ...checked, saturation: Object.freeze({ ...policy, operations: Object.freeze(operations) }) }) : checked;
    }
    const fraction = value.profile === FRACTION_PROFILE;
    require(fraction === Object.hasOwn(value, "fractionBaseProfile") && fraction === Object.hasOwn(value, "fractionWordContract"),
      "Fraction contract disagrees with its profile.");
    if (fraction) {
      require(FRACTION_BASES.has(value.fractionBaseProfile), "Fraction requires an existing raw base profile.");
      const policy = record(value.fractionWordContract, ["kind", "stage", "operations", "equation", "rounding", "specials", "subnormals", "zero", "modifiers", "authority"]);
      require(policy.kind === FRACTION_KIND && policy.stage === expectedStage && policy.equation === "x-minus-floor" &&
        policy.rounding === "nearest-even" && policy.specials === "canonical-quiet-0x7fc00000" &&
        policy.subnormals === "gradual" && policy.zero === "canonical-positive" &&
        policy.modifiers === "negation-before-evaluation" && policy.authority === "existing-numeric-or-static-word-authority",
      "Unknown instruction-local fraction policy.");
      const operations = array(policy.operations, 1);
      require(operations.length === 1 && operations[0] === "FRC_PRECISE", "Fraction operations must contain exactly FRC_PRECISE.");
      const base = { ...value, profile: value.fractionBaseProfile };
      delete base.fractionBaseProfile; delete base.fractionWordContract;
      // v33 cannot wrap itself. Each whole prior policy descends to a lower
      // profile, bounding the complete chain to six wrappers.
      const checked = parseConstantDomain(base, expectedStage);
      return checked.ok ? Object.freeze({ ...checked, fraction: Object.freeze({ ...policy, operations: Object.freeze(operations) }) }) : checked;
    }
    const minimum = value.profile === MINIMUM_PROFILE;
    require(minimum === Object.hasOwn(value, "minimumBaseProfile") && minimum === Object.hasOwn(value, "minimumWordContract"),
      "Minimum contract disagrees with its profile.");
    if (minimum) {
      require(MINIMUM_BASES.has(value.minimumBaseProfile), "Minimum requires an existing raw base profile.");
      const policy = record(value.minimumWordContract, ["kind", "stage", "operations", "ordinary", "precise", "modifiers", "output"]);
      require(policy.kind === MINIMUM_KIND && policy.stage === expectedStage &&
        policy.ordinary === "existing-finite-numeric-authority" && policy.precise === "ordered-less-first-otherwise-second-original-word" &&
        policy.modifiers === "negation-before-selection" && policy.output === "existing-numeric-or-selected-raw-authority",
      "Unknown instruction-local minimum policy.");
      const operations = array(policy.operations, 2), names = ["MIN", "MIN_PRECISE"];
      require(operations.length > 0 && operations.every((op, position) => names.includes(op) &&
        (position === 0 || names.indexOf(operations[position - 1]) < names.indexOf(op))),
      "Minimum operations must be nonempty, sorted and unique.");
      const base = { ...value, profile: value.minimumBaseProfile };
      delete base.minimumBaseProfile; delete base.minimumWordContract;
      // v32 cannot wrap itself. Every descending prior wrapper preserves its
      // whole contract, so the chain is bounded to five wrappers.
      const checked = parseConstantDomain(base, expectedStage);
      return checked.ok ? Object.freeze({ ...checked, minimum: Object.freeze({ ...policy, operations: Object.freeze(operations) }) }) : checked;
    }
    const scalar = value.profile === SCALAR_PROFILE;
    require(scalar === Object.hasOwn(value, "scalarBaseProfile") && scalar === Object.hasOwn(value, "scalarWordContract"),
      "Scalar contract disagrees with its profile.");
    if (scalar) {
      require(SCALAR_BASES.has(value.scalarBaseProfile), "Scalar operations require an existing raw base profile.");
      const policy = record(value.scalarWordContract, ["kind", "stage", "operations", "domain", "truncation", "sign", "result"]);
      require(policy.kind === SCALAR_KIND && policy.stage === expectedStage &&
        policy.domain === "existing-finite-numeric-authority" && policy.truncation === "toward-zero-preserve-zero-sign" &&
        policy.sign === "negative-one-positive-one-canonical-zero" && policy.result === "normal-or-signed-zero",
      "Unknown finite scalar policy.");
      const operations = array(policy.operations, 2), names = ["TRUNC", "SSG"];
      require(operations.length > 0 && operations.every((op, position) => names.includes(op) &&
        (position === 0 || names.indexOf(operations[position - 1]) < names.indexOf(op))),
      "Scalar operations must be nonempty, sorted and unique.");
      const base = { ...value, profile: value.scalarBaseProfile };
      delete base.scalarBaseProfile; delete base.scalarWordContract;
      // v31 cannot wrap itself. The prior conversion/arithmetic/raster gates
      // retain all obligations and bound the complete chain to four wrappers.
      const checked = parseConstantDomain(base, expectedStage);
      return checked.ok ? Object.freeze({ ...checked, scalar: Object.freeze({ ...policy, operations: Object.freeze(operations) }) }) : checked;
    }
    const conversionBank = value.profile === CONVERSION_BANK_PROFILE;
    const conversion = conversionBank || value.profile === CONVERSION_PROFILE;
    require(conversion === Object.hasOwn(value, "conversionBaseProfile") &&
      conversion === Object.hasOwn(value, "signedConversionContract") &&
      conversionBank === Object.hasOwn(value, "constantConversionDomains"), "Signed conversion contract disagrees with its profile.");
    if (conversion) {
      require(CONVERSION_BASES.has(value.conversionBaseProfile), "Conversion requires an existing raw base profile.");
      const policy = record(value.signedConversionContract, ["kind", "stage", "operations", "integerToFloat", "floatToInteger", "domain"]);
      require(policy.kind === CONVERSION_KIND && policy.stage === expectedStage && policy.integerToFloat === "nearest-even" &&
        policy.floatToInteger === "toward-zero" && policy.domain === "finite-negative-le-2^31-positive-lt-2^31",
      "Unknown signed conversion policy.");
      const operations = array(policy.operations, 2), names = ["I2F", "F2I"];
      require(operations.length > 0 && operations.every((op, position) => names.includes(op) &&
        (position === 0 || names.indexOf(operations[position - 1]) < names.indexOf(op))) &&
        (!conversionBank || operations.includes("F2I")), "Conversion operations must be nonempty, sorted and unique.");
      const base = { ...value, profile: value.conversionBaseProfile };
      delete base.conversionBaseProfile; delete base.signedConversionContract; delete base.constantConversionDomains;
      // Only v1..v28 bases are admitted: conversion cannot recursively wrap
      // itself, and arithmetic/raster each retain their own bounded base check.
      const checked = parseConstantDomain(base, expectedStage);
      if (!checked.ok) return checked;
      let conversionDomain = null;
      if (conversionBank) {
        const domains = array(value.constantConversionDomains, 1), uniforms = array(value.uniforms, 1);
        require(domains.length === 1 && uniforms.length === 1, "Conversion requires one range domain and one bank.");
        conversionDomain = conversionBankContract(domains[0]);
        const uniform = record(uniforms[0], ["name", "type", "count", "encoding"]);
        require(conversionDomain.stage === expectedStage && uniform.name === conversionDomain.name &&
          uniform.count === conversionDomain.count && uniform.type === "uvec4[]" && uniform.encoding === "float32-bits",
        "Conversion range domain disagrees with the complete declared bank.");
      }
      return Object.freeze({ ...checked, conversion: Object.freeze({ ...policy, operations: Object.freeze(operations) }), conversionDomain });
    }
    const arithmetic = value.profile === ARITHMETIC_PROFILE;
    require(arithmetic === Object.hasOwn(value, "arithmeticBaseProfile") &&
      arithmetic === Object.hasOwn(value, "preciseArithmeticContract"),
    "Binary32 arithmetic contract disagrees with its outer profile.");
    if (arithmetic) {
      require(ARITHMETIC_BASES.has(value.arithmeticBaseProfile), "Arithmetic requires an existing raw base profile.");
      let precision = record(value.preciseArithmeticContract, ["kind", "stage", "operations", "rounding", "nan", "subnormals"]);
      require(precision.kind === ARITHMETIC_KIND && precision.stage === expectedStage &&
        precision.rounding === "nearest-even" && precision.nan === "canonical-quiet-0x7fc00000" &&
        precision.subnormals === "gradual", "Unknown binary32 arithmetic policy.");
      const operations = array(precision.operations, 2), names = ["ADD", "MUL"];
      require(operations.length > 0 && operations.every((op, position) => names.includes(op) &&
        (position === 0 || names.indexOf(operations[position - 1]) < names.indexOf(op))),
      "Arithmetic operations must be nonempty, sorted and unique.");
      precision = Object.freeze({ ...precision, operations: Object.freeze(operations) });
      const base = { ...value, profile: value.arithmeticBaseProfile };
      delete base.arithmeticBaseProfile; delete base.preciseArithmeticContract;
      // v28 cannot be a base; v27 has only preexisting finite bases. Thus the
      // complete combined contract is checked in at most two nested calls.
      const checked = parseConstantDomain(base, expectedStage);
      return checked.ok ? Object.freeze({ ...checked, arithmetic: precision }) : checked;
    }
    const raster = value.profile === RASTER_PROFILE;
    require(raster === Object.hasOwn(value, "rasterBaseProfile") && raster === Object.hasOwn(value, "constantRasterDomains"),
      "Copied-bank raster contract disagrees with its outer profile.");
    if (raster) {
      require(CONDITIONAL_PROFILES.has(value.rasterBaseProfile), "Raster profile requires an existing finite-bank base profile.");
      const base = { ...value, profile: value.rasterBaseProfile };
      delete base.rasterBaseProfile; delete base.constantRasterDomains;
      // Only existing base profiles pass this gate, so recursion is exactly one
      // level. Every simultaneous base obligation is parsed without alteration.
      const checked = parseConstantDomain(base, expectedStage);
      if (!checked.ok) return checked;
      const domains = array(value.constantRasterDomains, 1);
      require(domains.length === 1 && checked.domain !== null, "Raster profile requires one copied-word and one finite-bank domain.");
      const rasterDomain = rasterContract(domains[0]);
      require(rasterDomain.stage === expectedStage && rasterDomain.count === checked.domain.count &&
        rasterDomain.name === checked.domain.name, "Raster domain disagrees with its complete finite bank.");
      require(!checked.constraint || rasterDomain.components.every(entry => entry.register !== 9 || !(entry.mask & 1)),
        "Integer loop count cannot acquire copied raster authority.");
      return Object.freeze({ ...checked, rasterDomain });
    }
    require(CONDITIONAL_PROFILES.has(value.profile) || UNCONDITIONAL_PROFILES.has(value.profile) || INDIRECT_PROFILES.has(value.profile), "Unknown shader profile.");
    const precise = PRECISE_PROFILES.has(value.profile);
    require(precise === Object.hasOwn(value, "preciseWordContract"), "Shader precision contract disagrees with its profile.");
    let precision = null;
    if (precise) {
      precision = record(value.preciseWordContract, ["kind", "stage", "operations"]);
      require(precision.kind === PRECISE_WORD_KIND && precision.stage === expectedStage, "Unknown or inconsistent word precision contract.");
      const operations = array(precision.operations, 4), names = ["FSEQ", "FSNE", "MAX", "MOV"];
      require(operations.length > 0 && operations.every((op, position) => names.includes(op) &&
        (position === 0 || names.indexOf(operations[position - 1]) < names.indexOf(op))),
      "Word precision operations must be nonempty, sorted, unique and instruction-local.");
      precision = Object.freeze({ ...precision, operations: Object.freeze(operations) });
    }
    const loop = LOOP_PROFILES.has(value.profile);
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
      return Object.freeze({ ok: true, domain: null, ...(indirect ? { access } : {}), ...(precise ? { precision } : {}) });
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
      ...(loop ? { constraint } : {}), ...(radial ? { radialDomain } : {}), ...(precise ? { precision } : {}) });
  } catch (error) {
    if (!(error instanceof DomainFault)) throw error;
    return failure("shader-domain-error", error.message);
  }
}

/** Finite binary32 encodings include both zero signs and every subnormal. */
export function finiteBinary32Word(word) {
  return Number.isInteger(word) && word >= 0 && word <= 0xffffffff && (word & 0x7f800000) !== 0x7f800000;
}

/** The copied raster domain permits both zero signs and finite normals. */
export function rasterBinary32Word(word) {
  if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) return false;
  const magnitude = word & 0x7fffffff, exponent = word & 0x7f800000;
  return magnitude === 0 || (exponent !== 0 && exponent !== 0x7f800000);
}

/** TGSI's defined F2I input range, including subnormals and both zero signs. */
export function signedConversionBinary32Word(word) {
  if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) return false;
  const magnitude = word & 0x7fffffff;
  return magnitude < 0x4f000000 || (word >= 0x80000000 && magnitude === 0x4f000000);
}

/** Every base approval and F2I component check uses one owned complete prefix. */
export function checkConversionBank(words, domain, base) {
  try {
    const contract = conversionBankContract(domain);
    base = record(base, ["ok", "domain", "access", "constraint", "radialDomain", "rasterDomain", "precision", "arithmetic", "conversion", "conversionDomain", "scalar", "minimum", "fraction", "saturation"], ["ok", "domain"]);
    require(base.ok === true, "Conversion requires an approved base contract.");
    for (const [key, kind, extra] of [["domain", CONSTANT_DOMAIN_KIND, []], ["access", CONSTANT_ACCESS_KIND, ["indices"]],
      ["constraint", CONSTANT_CONSTRAINT_KIND, ["register", "component", "maximum"]],
      ["radialDomain", RADIAL_DOMAIN_KIND, ["register", "component", "minimumMagnitude"]],
      ["rasterDomain", RASTER_DOMAIN_KIND, ["components"]]]) if (base[key] != null) {
      const obligation = record(base[key], [...DOMAIN_KEYS, ...extra]);
      require(obligation.kind === kind && obligation.slot === 0 && obligation.count === contract.count &&
        obligation.stage === contract.stage && obligation.name === contract.name,
      "Conversion and base obligations disagree on their bank.");
      base[key] = obligation;
    }
    const checked = base.rasterDomain ? checkRasterBank(words, base.rasterDomain, !!base.constraint, !!base.radialDomain) :
      base.radialDomain ? checkRadialBank(words, contract.count, !!base.constraint) : base.constraint ?
        checkLoopBank(words, contract.count) : checkIndirectBank(words, contract.count, base.domain !== null);
    if (!checked.ok) return checked;
    for (const entry of contract.components) for (let lane = 0; lane < 4; lane++)
      if ((entry.mask & (1 << lane)) && !signedConversionBinary32Word(checked.words[entry.register * 4 + lane]))
        return failure("constant-conversion-domain-error", "F2I bank word is outside the defined signed32 conversion range.");
    return checked;
  } catch (error) {
    if (!(error instanceof DomainFault)) throw error;
    return failure("constant-conversion-domain-error", error.message);
  }
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

/** All base and copied-word approvals refer to the same owned full prefix. */
export function checkRasterBank(words, domain, counted = false, radial = false) {
  try {
    require(typeof counted === "boolean" && typeof radial === "boolean", "Invalid combined raster obligations.");
    const contract = rasterContract(domain);
    require(!counted || ((contract.count === 46 || contract.count === 47) &&
      contract.components.every(entry => entry.register !== 9 || !(entry.mask & 1))),
    "Integer loop count cannot supply ordinary raster data.");
    require(!radial || contract.count >= 5, "Radial raster bank requires the coefficient register.");
    const checked = checkIndirectBank(words, contract.count, true);
    if (!checked.ok) return checked;
    if (counted) {
      const count = checked.words[36];
      if (!(count >= 0x80000000 || count <= 18))
        return failure("constant-constraint-error", "Raw signed constant count exceeds the proved maximum of 18.");
    }
    if (radial && (checked.words[16] & 0x7fffffff) < 0x3727c5ac)
      return failure("constant-radial-domain-error", "Radial coefficient permits an undefined linear predecessor.");
    for (const entry of contract.components)
      for (let lane = 0; lane < 4; lane++)
        if ((entry.mask & (1 << lane)) && !rasterBinary32Word(checked.words[entry.register * 4 + lane]))
          return failure("constant-raster-domain-error", "Copied bank word is outside the normal-or-signed-zero raster domain.");
    return checked;
  } catch (error) {
    if (!(error instanceof DomainFault)) throw error;
    return failure("constant-raster-domain-error", error.message);
  }
}
