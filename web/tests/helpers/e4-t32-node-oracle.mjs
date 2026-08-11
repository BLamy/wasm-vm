export const E4T32_NODE_COMMAND = "node -e 'console.log(3)'";
export const E4T32_NODE_ORACLE_TRANSCRIPT_MAX_CHARS = 512;

const SEQUENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const STANDALONE_OUTPUT_PATTERN = /(?:^|\n)(3)\n/;

export class NodeProcessOracleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NodeProcessOracleError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new NodeProcessOracleError(code, message);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertSequence = (sequence) => {
  if (typeof sequence !== "string" || !SEQUENCE_PATTERN.test(sequence)) {
    fail("invalid-sequence", "Node oracle sequence must be 1-96 safe printable characters");
  }
  return sequence;
};

export function createNodeProcessOracleSpec(sequenceValue) {
  const sequence = assertSequence(sequenceValue);
  // `$!` is the PID of the asynchronous child that execs the exact Node argv below. The terminal
  // echoes this format string and shell variable names, never the concrete PID-bearing marker.
  const shellCommand =
    `${E4T32_NODE_COMMAND} & node_pid=$!; wait "$node_pid"; rc=$?; ` +
    `printf '\\n__E4T32_NODE_DONE_%s_%s_%s\\n' '${sequence}' "$node_pid" "$rc"`;
  if (/[\r\n]/.test(shellCommand)) {
    fail("invalid-command", "Node oracle shell command contains an embedded line terminator");
  }
  return Object.freeze({
    sequence,
    nodeCommand: E4T32_NODE_COMMAND,
    shellCommand,
    outputPatternSource: STANDALONE_OUTPUT_PATTERN.source,
    completionPatternSource:
      `(?:^|\\n)(__E4T32_NODE_DONE_${escapeRegExp(sequence)}_([1-9][0-9]*)_([0-9]+))\\n`,
    maxTranscriptChars: E4T32_NODE_ORACLE_TRANSCRIPT_MAX_CHARS,
  });
}

export function parseNodeProcessOracle(textValue, specValue) {
  if (typeof textValue !== "string") fail("invalid-terminal", "terminal capture must be a string");
  const spec = createNodeProcessOracleSpec(specValue?.sequence);
  if (specValue?.nodeCommand !== spec.nodeCommand || specValue?.shellCommand !== spec.shellCommand) {
    fail("invalid-spec", "Node oracle spec does not match its sequence");
  }
  const outputMatch = textValue.match(new RegExp(spec.outputPatternSource));
  const markerMatch = textValue.match(new RegExp(spec.completionPatternSource));
  if (!outputMatch || !markerMatch || outputMatch.index >= markerMatch.index) return null;

  const nodePid = Number(markerMatch[2]);
  const exit = Number(markerMatch[3]);
  if (!Number.isSafeInteger(nodePid) || nodePid <= 0) {
    fail("invalid-node-pid", `Node oracle PID is not a positive safe integer: ${markerMatch[2]}`);
  }
  if (!Number.isSafeInteger(exit) || exit < 0 || exit > 255) {
    fail("invalid-exit", `Node oracle exit status is invalid: ${markerMatch[3]}`);
  }
  const outputLine = outputMatch[1];
  const completionMarker = markerMatch[1];
  const oracleTranscript = `${outputLine}\n${completionMarker}\n`;
  if (oracleTranscript.length > spec.maxTranscriptChars) {
    fail(
      "oracle-too-large",
      `Node oracle transcript is ${oracleTranscript.length}, limit ${spec.maxTranscriptChars}`,
    );
  }
  if (spec.shellCommand.includes(completionMarker)) {
    fail("echo-spoofable", "concrete Node completion marker appears in submitted source");
  }
  return {
    nodeSequence: spec.sequence,
    nodeCommand: spec.nodeCommand,
    nodePid,
    outputLine,
    completionMarker,
    oracleTranscript,
    exit,
  };
}

export function requireNodeProcessOracle(textValue, specValue) {
  const oracle = parseNodeProcessOracle(textValue, specValue);
  if (!oracle) {
    fail(
      "incomplete-oracle",
      `terminal capture lacks standalone output and concrete marker for ${specValue?.sequence}`,
    );
  }
  return oracle;
}

export function validateNodeProcessOracleEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-evidence", "Node process oracle evidence must be an object");
  }
  if (value.nodeCommand !== E4T32_NODE_COMMAND) {
    fail("invalid-command", `Node oracle command must be ${E4T32_NODE_COMMAND}`);
  }
  const nodeSequence = assertSequence(value.nodeSequence);
  if (!Number.isSafeInteger(value.nodePid) || value.nodePid <= 0) {
    fail("invalid-node-pid", "Node oracle PID must be a positive safe integer");
  }
  if (!Number.isSafeInteger(value.exit) || value.exit < 0 || value.exit > 255) {
    fail("invalid-exit", "Node oracle exit status must be an integer from 0 through 255");
  }
  if (value.outputLine !== "3") fail("invalid-output", "Node oracle output must be standalone 3");
  if (typeof value.completionMarker !== "string") {
    fail("invalid-marker", "Node oracle completion marker must be a string");
  }
  const markerMatch = value.completionMarker.match(
    /^__E4T32_NODE_DONE_([A-Za-z0-9][A-Za-z0-9_.:-]{0,95})_([1-9][0-9]*)_([0-9]+)$/,
  );
  if (!markerMatch || markerMatch[1] !== nodeSequence || Number(markerMatch[2]) !== value.nodePid ||
      Number(markerMatch[3]) !== value.exit) {
    fail("invalid-marker", "Node oracle marker must bind its sequence, PID, and exit status");
  }
  const expectedTranscript = `${value.outputLine}\n${value.completionMarker}\n`;
  if (value.oracleTranscript !== expectedTranscript) {
    fail("invalid-transcript", "Node oracle transcript must contain only output and concrete marker");
  }
  if (value.oracleTranscript.length > E4T32_NODE_ORACLE_TRANSCRIPT_MAX_CHARS) {
    fail("oracle-too-large", "Node oracle transcript exceeds its strict evidence bound");
  }
  return value;
}
