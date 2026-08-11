import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const E4T32_NODE_COMMAND = "node -e 'console.log(3)'";
export const E4T32_NODE_ORACLE_SCHEMA = "e4-t32-node-byte-frame-v1";
export const E4T32_NODE_ORACLE_FRAME_MAX_BYTES = 512;

const SEQUENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;

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

const sequenceToken = (sequence) => (
  createHash("sha256").update(sequence, "utf8").digest("hex").slice(0, 24)
);

const asBytes = (value, label = "terminal capture") => {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  fail("invalid-terminal", `${label} must be a string or Uint8Array`);
};

const byteRange = (start, length) => Object.freeze({ start, end: start + length });

const outputPattern = (spec) => (
  `^(__E4T32_NODE_BEGIN_${escapeRegExp(spec.token)}_([1-9][0-9]*))` +
  `(\\r?\\n)(3)\\3`
);

const framePattern = (spec, anchoredEnd) => (
  outputPattern(spec) +
  `(__E4T32_NODE_DONE_${escapeRegExp(spec.token)}_\\2_([0-9]+))\\3` +
  (anchoredEnd ? "$" : "")
);

export function createNodeProcessOracleSpec(sequenceValue) {
  const sequence = assertSequence(sequenceValue);
  const token = sequenceToken(sequence);
  // The asynchronous item is the exact external Node command. BusyBox therefore records the PID
  // of the child that directly execs Node. BEGIN is emitted only after `$!` is captured so any
  // interactive-shell launch notice remains outside the authoritative byte frame.
  const shellCommand =
    `${E4T32_NODE_COMMAND} & node_pid=$!; ` +
    `printf '\\n__E4T32_NODE_BEGIN_%s_%s\\n' '${token}' "$node_pid"; ` +
    `wait "$node_pid"; rc=$?; ` +
    `printf '__E4T32_NODE_DONE_%s_%s_%s\\n' '${token}' "$node_pid" "$rc"`;
  if (/[\r\n]/.test(shellCommand)) {
    fail("invalid-command", "Node oracle shell command contains an embedded line terminator");
  }
  const spec = {
    sequence,
    token,
    nodeCommand: E4T32_NODE_COMMAND,
    shellCommand,
    beginPrefix: `__E4T32_NODE_BEGIN_${token}_`,
    completionPrefix: `__E4T32_NODE_DONE_${token}_`,
    maxFrameBytes: E4T32_NODE_ORACLE_FRAME_MAX_BYTES,
  };
  return Object.freeze({
    ...spec,
    outputPatternSource: outputPattern(spec),
    completeFramePrefixPatternSource: framePattern(spec, false),
    completeFramePatternSource: framePattern(spec, true),
  });
}

// Deliberately self-contained: the wall-time harness serializes this factory into page.evaluate,
// while pure tests drive the identical byte-state machine across every callback split.
export function createNodeOracleFrameCollector(spec) {
  const outputPattern = new RegExp(spec.outputPatternSource);
  const completionPattern = new RegExp(spec.completeFramePrefixPatternSource);
  const appendBytes = (left, right) => {
    const joined = new Uint8Array(left.length + right.length);
    joined.set(left);
    joined.set(right, left.length);
    return joined;
  };
  const byteText = (bytes) => {
    let value = "";
    for (let offset = 0; offset < bytes.length; offset += 128) {
      value += String.fromCharCode(...bytes.subarray(offset, offset + 128));
    }
    return value;
  };
  const beginAt = (bytes, allowStreamStart) => {
    const value = byteText(bytes);
    if (allowStreamStart && value.startsWith(spec.beginPrefix)) return 0;
    const index = value.indexOf(`\n${spec.beginPrefix}`);
    return index < 0 ? -1 : index + 1;
  };

  let scan = new Uint8Array();
  let scanStartsAtStreamStart = true;
  let frame = null;
  let outputSeen = false;
  let terminal = false;
  return Object.freeze({
    push(value) {
      if (terminal) return { status: "invalid", reason: "bytes-after-terminal-event" };
      const invalid = (reason, outputCompletedNow = false) => {
        terminal = true;
        return { status: "invalid", reason, outputCompletedNow };
      };
      const chunk = Uint8Array.from(value);
      if (frame == null) {
        scan = appendBytes(scan, chunk);
        const start = beginAt(scan, scanStartsAtStreamStart);
        if (start < 0) {
          // Before BEGIN, only preserve the bounded suffix needed to recognize a split marker.
          const keep = Math.min(scan.length, spec.beginPrefix.length + 33);
          if (keep < scan.length) scanStartsAtStreamStart = false;
          scan = scan.slice(scan.length - keep);
          return { status: "seeking", outputCompletedNow: false };
        }
        frame = scan.slice(start);
        scan = new Uint8Array();
      } else {
        frame = appendBytes(frame, chunk);
      }

      const raw = byteText(frame);
      const outputMatch = raw.match(outputPattern);
      const outputCompletedNow = !outputSeen && outputMatch != null;
      outputSeen ||= outputMatch != null;
      const match = raw.match(completionPattern);
      if (match) {
        const frameEnd = match[0].length;
        if (frameEnd > spec.maxFrameBytes) {
          return invalid(`overflow:${frameEnd}`, outputCompletedNow);
        }
        terminal = true;
        return {
          status: "complete",
          outputCompletedNow,
          frame: frame.slice(0, frameEnd),
          nodePid: Number(match[2]),
          exit: Number(match[6]),
        };
      }
      const completionStart = raw.indexOf(spec.completionPrefix);
      if (completionStart >= 0 && raw.indexOf("\n", completionStart) >= 0) {
        return invalid("done-without-exact-frame", outputCompletedNow);
      }
      if (frame.length > spec.maxFrameBytes) {
        return invalid(`overflow:${frame.length}`, outputCompletedNow);
      }
      return { status: "collecting", outputCompletedNow };
    },
    diagnosticTail(maxBytes = 128) {
      const bytes = frame ?? scan;
      return bytes.slice(Math.max(0, bytes.length - maxBytes));
    },
  });
}

function parseStrictFrame(frameValue, specValue) {
  const spec = createNodeProcessOracleSpec(specValue?.sequence);
  if (specValue?.nodeCommand !== spec.nodeCommand || specValue?.shellCommand !== spec.shellCommand ||
      specValue?.token !== spec.token) {
    fail("invalid-spec", "Node oracle spec does not match its sequence");
  }
  const bytes = asBytes(frameValue, "Node terminal frame");
  if (bytes.byteLength === 0 || bytes.byteLength > spec.maxFrameBytes) {
    fail(
      "oracle-too-large",
      `Node terminal frame is ${bytes.byteLength} bytes, limit ${spec.maxFrameBytes}`,
    );
  }
  // latin1 is an exact one-byte-to-one-code-unit view. It performs no UTF-8 replacement, ANSI
  // removal, CR normalization, or trimming; the anchored grammar rejects every non-frame byte.
  const raw = bytes.toString("latin1");
  const match = raw.match(new RegExp(spec.completeFramePatternSource));
  if (!match || match[0].length !== raw.length) {
    fail("invalid-frame", "Node terminal frame is not exactly BEGIN, output 3, and DONE");
  }

  const beginMarker = match[1];
  const nodePid = Number(match[2]);
  const newlineBytes = Buffer.from(match[3], "latin1");
  const outputLine = match[4];
  const completionMarker = match[5];
  const exit = Number(match[6]);
  if (!Number.isSafeInteger(nodePid) || nodePid <= 0) {
    fail("invalid-node-pid", `Node oracle PID is not a positive safe integer: ${match[2]}`);
  }
  if (!Number.isSafeInteger(exit) || exit < 0 || exit > 255) {
    fail("invalid-exit", `Node oracle exit status is invalid: ${match[6]}`);
  }
  if (spec.shellCommand.includes(beginMarker) || spec.shellCommand.includes(completionMarker)) {
    fail("echo-spoofable", "concrete PID-bearing Node marker appears in submitted source");
  }

  let cursor = 0;
  const offsets = {};
  offsets.beginMarker = byteRange(cursor, Buffer.byteLength(beginMarker, "ascii"));
  cursor = offsets.beginMarker.end;
  offsets.beginLineEnding = byteRange(cursor, newlineBytes.byteLength);
  cursor = offsets.beginLineEnding.end;
  offsets.outputLine = byteRange(cursor, Buffer.byteLength(outputLine, "ascii"));
  cursor = offsets.outputLine.end;
  offsets.outputLineEnding = byteRange(cursor, newlineBytes.byteLength);
  cursor = offsets.outputLineEnding.end;
  offsets.completionMarker = byteRange(cursor, Buffer.byteLength(completionMarker, "ascii"));
  cursor = offsets.completionMarker.end;
  offsets.completionLineEnding = byteRange(cursor, newlineBytes.byteLength);
  cursor = offsets.completionLineEnding.end;
  if (cursor !== bytes.byteLength) fail("invalid-frame", "Node terminal frame offsets do not cover its bytes");

  return {
    spec,
    bytes,
    nodePid,
    outputLine,
    beginMarker,
    completionMarker,
    exit,
    newline: newlineBytes.byteLength === 2 ? "crlf" : "lf",
    offsets: Object.freeze(offsets),
  };
}

function evidenceFromStrictFrame(frameValue, specValue) {
  const parsed = parseStrictFrame(frameValue, specValue);
  const base64 = parsed.bytes.toString("base64");
  return {
    oracleSchema: E4T32_NODE_ORACLE_SCHEMA,
    nodeSequence: parsed.spec.sequence,
    nodeToken: parsed.spec.token,
    nodeCommand: parsed.spec.nodeCommand,
    nodePid: parsed.nodePid,
    outputLine: parsed.outputLine,
    beginMarker: parsed.beginMarker,
    completionMarker: parsed.completionMarker,
    exit: parsed.exit,
    terminalFrame: {
      encoding: "base64",
      base64,
      byteLength: parsed.bytes.byteLength,
      sha256: createHash("sha256").update(parsed.bytes).digest("hex"),
      newline: parsed.newline,
      offsets: parsed.offsets,
    },
  };
}

export function createNodeProcessOracleEvidence(frameValue, specValue) {
  return evidenceFromStrictFrame(frameValue, specValue);
}

export function parseNodeProcessOracle(captureValue, specValue) {
  const spec = createNodeProcessOracleSpec(specValue?.sequence);
  if (specValue?.nodeCommand !== spec.nodeCommand || specValue?.shellCommand !== spec.shellCommand ||
      specValue?.token !== spec.token) {
    fail("invalid-spec", "Node oracle spec does not match its sequence");
  }
  const capture = asBytes(captureValue);
  const prefix = Buffer.from(spec.beginPrefix, "ascii");
  let begin = capture.indexOf(prefix);
  while (begin > 0 && capture[begin - 1] !== 0x0a) {
    begin = capture.indexOf(prefix, begin + 1);
  }
  if (begin < 0) return null;
  const remainder = capture.subarray(begin);
  const raw = remainder.toString("latin1");
  const match = raw.match(new RegExp(spec.completeFramePrefixPatternSource));
  if (!match) {
    if (raw.includes(spec.completionPrefix)) {
      fail("invalid-frame", "Node terminal output contains DONE without the exact framed output");
    }
    return null;
  }
  const frame = remainder.subarray(0, Buffer.byteLength(match[0], "latin1"));
  return evidenceFromStrictFrame(frame, spec);
}

export function requireNodeProcessOracle(captureValue, specValue) {
  const oracle = parseNodeProcessOracle(captureValue, specValue);
  if (!oracle) {
    fail("incomplete-oracle", `terminal capture lacks the exact byte frame for ${specValue?.sequence}`);
  }
  return oracle;
}

export function validateNodeProcessOracleEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-evidence", "Node process oracle evidence must be an object");
  }
  if (value.oracleSchema !== E4T32_NODE_ORACLE_SCHEMA) {
    fail("invalid-schema", `Node oracle schema must be ${E4T32_NODE_ORACLE_SCHEMA}`);
  }
  if (Object.hasOwn(value, "oracleTranscript")) {
    fail("invalid-evidence", "synthesized oracleTranscript is not authoritative raw evidence");
  }
  if (value.nodeCommand !== E4T32_NODE_COMMAND) {
    fail("invalid-command", `Node oracle command must be ${E4T32_NODE_COMMAND}`);
  }
  const spec = createNodeProcessOracleSpec(assertSequence(value.nodeSequence));
  if (!value.terminalFrame || typeof value.terminalFrame !== "object" ||
      Array.isArray(value.terminalFrame)) {
    fail("invalid-frame", "Node oracle terminalFrame must be an object");
  }
  if (value.terminalFrame.encoding !== "base64" || typeof value.terminalFrame.base64 !== "string") {
    fail("invalid-base64", "Node oracle terminal frame must use canonical base64");
  }
  const decoded = Buffer.from(value.terminalFrame.base64, "base64");
  if (decoded.toString("base64") !== value.terminalFrame.base64) {
    fail("invalid-base64", "Node oracle terminal frame base64 is not canonical");
  }
  const expected = evidenceFromStrictFrame(decoded, spec);
  for (const field of [
    "oracleSchema",
    "nodeSequence",
    "nodeToken",
    "nodeCommand",
    "nodePid",
    "outputLine",
    "beginMarker",
    "completionMarker",
    "exit",
  ]) {
    if (value[field] !== expected[field]) {
      fail("invalid-evidence", `Node oracle ${field} does not match its raw terminal frame`);
    }
  }
  if (!isDeepStrictEqual(value.terminalFrame, expected.terminalFrame)) {
    fail("invalid-frame-metadata", "Node oracle terminal frame metadata does not match its raw bytes");
  }
  return value;
}
