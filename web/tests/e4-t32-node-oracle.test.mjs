import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  E4T32_NODE_COMMAND,
  E4T32_NODE_ORACLE_FRAME_MAX_BYTES,
  E4T32_NODE_ORACLE_GRAMMAR,
  E4T32_NODE_ORACLE_SCHEMA,
  createNodeOracleFrameCollector,
  createNodeProcessOracleEvidence,
  createNodeProcessOracleSpec,
  parseNodeProcessOracle,
  requireNodeProcessOracle,
  validateNodeProcessOracleEvidence,
} from "./helpers/e4-t32-node-oracle.mjs";

const beginMarker = (spec, pid) => `__E4T32_NODE_BEGIN_${spec.token}_${pid}`;
const completionMarker = (spec, pid, exit = 0) => (
  `__E4T32_NODE_DONE_${spec.token}_${pid}_${exit}`
);
const yellowOutput = "\x1b[33m3\x1b[39m";
const shellQuotedNodeCommand = E4T32_NODE_COMMAND.replaceAll("'", `'"'"'`);
const shellQuotedBeginPrintf = "printf '\\n__E4T32_NODE_BEGIN_%s_%s\\n'"
  .replaceAll("'", `'"'"'`);
const frame = (spec, pid, exit = 0, newline = "\n") => (
  `${beginMarker(spec, pid)}${newline}${yellowOutput}${newline}` +
  `${completionMarker(spec, pid, exit)}${newline}`
);
const evidence = (spec, pid = 731, exit = 0, newline = "\n") => (
  createNodeProcessOracleEvidence(Buffer.from(frame(spec, pid, exit, newline), "latin1"), spec)
);

const clone = (value) => structuredClone(value);

const setRawFrame = (value, bytes) => {
  const mutated = clone(value);
  mutated.terminalFrame.base64 = Buffer.from(bytes).toString("base64");
  mutated.terminalFrame.byteLength = bytes.length;
  mutated.terminalFrame.sha256 = createHash("sha256").update(bytes).digest("hex");
  return mutated;
};

test("the submitted source preserves exact Node argv/code and concrete markers remain runtime-only", () => {
  const spec = createNodeProcessOracleSpec("p0_worker_0");
  assert.equal(spec.nodeCommand, "node -e 'console.log(3)'");
  assert.equal(spec.nodeCommand, E4T32_NODE_COMMAND);
  assert.equal(spec.outputGrammar, E4T32_NODE_ORACLE_GRAMMAR);
  assert.match(spec.token, /^[0-9a-f]{24}$/);
  assert.ok(spec.shellCommand.startsWith("sh -c "));
  assert.equal(spec.shellCommand.split(shellQuotedNodeCommand).length - 1, 1);
  assert.ok(spec.shellCommand.includes(`exec ${shellQuotedNodeCommand}`));
  assert.ok(spec.shellCommand.includes(shellQuotedBeginPrintf));
  assert.ok(spec.shellCommand.includes('"$1" "$$"'));
  assert.ok(spec.shellCommand.includes("& node_pid=$!;"));
  assert.ok(spec.shellCommand.includes("wait \"$node_pid\""));
  assert.ok(spec.shellCommand.includes("__E4T32_NODE_DONE_%s_%s_%s"));
  assert.doesNotMatch(spec.shellCommand, /FORCE_COLOR|NO_COLOR|NODE_DISABLE_COLORS/);
  assert.equal(/[\r\n]/.test(spec.shellCommand), false);
  assert.equal(spec.shellCommand.includes(beginMarker(spec, 731)), false);
  assert.equal(spec.shellCommand.includes(completionMarker(spec, 731)), false);
  assert.equal(parseNodeProcessOracle(`${spec.shellCommand}\n`, spec), null);
});

test("a raw LF frame persists canonical bytes, hash, and exact half-open offsets", () => {
  const spec = createNodeProcessOracleSpec("p0_worker_0");
  const oracle = evidence(spec);
  assert.equal(oracle.oracleSchema, E4T32_NODE_ORACLE_SCHEMA);
  assert.equal(oracle.outputGrammar, E4T32_NODE_ORACLE_GRAMMAR);
  assert.equal(oracle.nodeSequence, spec.sequence);
  assert.equal(oracle.nodeToken, spec.token);
  assert.equal(oracle.nodeCommand, E4T32_NODE_COMMAND);
  assert.equal(oracle.nodePid, 731);
  assert.equal(oracle.outputLine, "3");
  assert.equal(oracle.beginMarker, beginMarker(spec, 731));
  assert.equal(oracle.completionMarker, completionMarker(spec, 731));
  assert.equal(oracle.exit, 0);
  assert.equal(Object.hasOwn(oracle, "oracleTranscript"), false);
  assert.equal(oracle.terminalFrame.encoding, "base64");
  assert.equal(oracle.terminalFrame.newline, "lf");
  const raw = Buffer.from(oracle.terminalFrame.base64, "base64");
  assert.equal(raw.toString("latin1"), frame(spec, 731));
  assert.equal(oracle.terminalFrame.byteLength, Buffer.byteLength(frame(spec, 731)));
  assert.equal(
    oracle.terminalFrame.sha256,
    createHash("sha256").update(frame(spec, 731), "latin1").digest("hex"),
  );
  const ranges = Object.values(oracle.terminalFrame.offsets);
  assert.equal(ranges[0].start, 0);
  for (let index = 1; index < ranges.length; index += 1) {
    assert.equal(ranges[index].start, ranges[index - 1].end);
  }
  assert.equal(ranges.at(-1).end, oracle.terminalFrame.byteLength);
  const slice = (name) => raw.subarray(
    oracle.terminalFrame.offsets[name].start,
    oracle.terminalFrame.offsets[name].end,
  );
  assert.equal(slice("outputAnsiOpen").toString("hex"), "1b5b33336d");
  assert.equal(slice("outputValue").toString("hex"), "33");
  assert.equal(slice("outputAnsiReset").toString("hex"), "1b5b33396d");
  assert.equal(validateNodeProcessOracleEvidence(oracle), oracle);
});

test("the real restored guest diagnostic is an exact CRLF yellow-TTY golden frame", () => {
  const spec = createNodeProcessOracleSpec("raw_diag_5b0f0bc_0");
  assert.equal(spec.token, "14d3da2a7ae8ea24b3a0db73");
  const observed = Buffer.from(frame(spec, 838, 0, "\r\n"), "latin1");
  assert.equal(observed.byteLength, 112);
  assert.equal(
    createHash("sha256").update(observed).digest("hex"),
    "aded09bffdcfb0d5a1a49d54f1ddbd46808a9ee041fd4a1569fd175f52dbf1fc",
  );
  const captured = Buffer.concat([
    Buffer.from("echoed command and job start\r\n", "latin1"),
    observed,
    Buffer.from("[1]+ Done node -e \"console.log(3)\"\r\nwasm-vm:~# \x1b[6n", "latin1"),
  ]);
  const oracle = requireNodeProcessOracle(captured, spec);
  assert.equal(oracle.nodePid, 838);
  assert.equal(oracle.exit, 0);
  assert.equal(oracle.outputGrammar, E4T32_NODE_ORACLE_GRAMMAR);
  assert.equal(oracle.terminalFrame.base64, observed.toString("base64"));
  assert.equal(oracle.terminalFrame.newline, "crlf");
});

test("a consistently CRLF-delimited byte frame is accepted without normalization", () => {
  const spec = createNodeProcessOracleSpec("p0_worker_crlf");
  const oracle = evidence(spec, 744, 0, "\r\n");
  assert.equal(oracle.terminalFrame.newline, "crlf");
  assert.equal(
    Buffer.from(oracle.terminalFrame.base64, "base64").toString("latin1"),
    frame(spec, 744, 0, "\r\n"),
  );
  assert.equal(oracle.terminalFrame.offsets.beginLineEnding.end -
    oracle.terminalFrame.offsets.beginLineEnding.start, 2);
  assert.equal(validateNodeProcessOracleEvidence(oracle), oracle);
});

test("the browser byte collector survives every split and scopes out pre-BEGIN and prompt bytes", () => {
  const spec = createNodeProcessOracleSpec("split_worker_0");
  const browserFactory = new Function(`return (${createNodeOracleFrameCollector.toString()})`)();
  const exact = Buffer.from(frame(spec, 812), "latin1");
  const capture = Buffer.concat([
    Buffer.from(`${spec.shellCommand}\r\n[1] 812\r\nstale 3\r\n`, "ascii"),
    exact,
    Buffer.from("wasm-vm:~# ", "ascii"),
  ]);
  for (let split = 0; split <= capture.length; split += 1) {
    const collector = browserFactory(spec);
    const first = collector.push(capture.subarray(0, split));
    assert.notEqual(first.status, "invalid", `split ${split} first callback`);
    const last = first.status === "complete" ? first : collector.push(capture.subarray(split));
    assert.equal(last.status, "complete", `split ${split}`);
    assert.deepEqual(Buffer.from(last.frame), exact, `split ${split} exact bytes`);
    assert.equal(last.nodePid, 812);
    assert.equal(last.exit, 0);
  }

  const bytewise = browserFactory(spec);
  let completed = null;
  let outputTransitions = 0;
  for (let offset = 0; offset < capture.length; offset += 1) {
    const event = bytewise.push(Uint8Array.of(capture[offset]));
    assert.notEqual(event.status, "invalid", `bytewise callback at offset ${offset}`);
    if (event.outputCompletedNow) outputTransitions += 1;
    if (event.status === "complete") {
      completed = event;
      break;
    }
  }
  assert.equal(outputTransitions, 1, "first-output timing has one exact framed transition");
  assert.deepEqual(Buffer.from(completed.frame), exact);
});

test("two real shells preserve inner $$ through exec as the outer $! Node PID", () => {
  const specs = [
    createNodeProcessOracleSpec("host_exact_0"),
    createNodeProcessOracleSpec("host_exact_1"),
  ];
  const runs = specs.map((spec) => {
    const output = execFileSync("/bin/sh", ["-c", spec.shellCommand], {
      encoding: "latin1",
      env: process.env,
    });
    const match = output.match(new RegExp(
      `^\\n?__E4T32_NODE_BEGIN_${spec.token}_([1-9][0-9]*)\\n3\\n` +
      `__E4T32_NODE_DONE_${spec.token}_([1-9][0-9]*)_([0-9]+)\\n$`,
    ));
    assert.ok(match, `host shell emitted exact plain-pipe trace: ${JSON.stringify(output)}`);
    assert.equal(match[1], match[2], "inner $$ must equal the outer $! after execing Node");
    assert.equal(Number(match[3]), 0);
    assert.equal(spec.shellCommand.split(shellQuotedNodeCommand).length - 1, 1);
    assert.doesNotMatch(spec.shellCommand, /FORCE_COLOR|NO_COLOR|NODE_DISABLE_COLORS/);
    return { nodePid: Number(match[1]), output };
  });
  assert.equal(runs.every((run) => run.nodePid > 0), true);
  assert.equal(new Set(runs.map((run) => run.nodePid)).size, 2);
});

test("stale output before BEGIN cannot satisfy the frame and valid framed output still can", () => {
  const spec = createNodeProcessOracleSpec("stale_before_begin");
  const valid = requireNodeProcessOracle(
    Buffer.from(`3\nnoise\n${frame(spec, 900)}`, "latin1"),
    spec,
  );
  assert.equal(valid.nodePid, 900);

  const raced = createNodeOracleFrameCollector(spec);
  const event = raced.push(Buffer.from(
    `3\n${beginMarker(spec, 900)}\n${completionMarker(spec, 900)}\n`,
    "ascii",
  ));
  assert.deepEqual(
    { status: event.status, reason: event.reason },
    { status: "invalid", reason: "done-without-exact-frame" },
    "child output racing before BEGIN fails closed",
  );
});

test("rolling pre-BEGIN capture never turns a glued marker into a line-aligned frame", () => {
  const spec = createNodeProcessOracleSpec("glued_boundary");
  const exact = Buffer.from(frame(spec, 901), "latin1");
  const glued = Buffer.concat([Buffer.from("x", "ascii"), exact]);
  const split = spec.beginPrefix.length + 33;
  const collector = createNodeOracleFrameCollector(spec);
  const first = collector.push(glued.subarray(0, split));
  const second = collector.push(glued.subarray(split));
  assert.equal(first.status, "seeking");
  assert.equal(second.status, "seeking");
  assert.equal(parseNodeProcessOracle(glued, spec), null);

  const followedByRealFrame = Buffer.concat([glued, Buffer.from("\n", "ascii"), exact]);
  const recovered = requireNodeProcessOracle(followedByRealFrame, spec);
  assert.equal(recovered.nodePid, 901, "only the later line-aligned frame is authoritative");
});

test("plain output, ANSI mutations, noise, mixed newlines, ordering, and duplicate markers fail", () => {
  const spec = createNodeProcessOracleSpec("strict_grammar");
  const invalidFrames = [
    `${beginMarker(spec, 731)}\n3\nnoise\n${completionMarker(spec, 731)}\n`,
    `${beginMarker(spec, 731)}\n3\n${completionMarker(spec, 731)}\n`,
    `${beginMarker(spec, 731)}\n\x1b[32m3\x1b[0m\n${completionMarker(spec, 731)}\n`,
    `${beginMarker(spec, 731)}\n\x1b[33m3\x1b[0m\n${completionMarker(spec, 731)}\n`,
    `${beginMarker(spec, 731)}\n3\x1b[39m\n${completionMarker(spec, 731)}\n`,
    `${beginMarker(spec, 731)}\n\x1b[33m3\n${completionMarker(spec, 731)}\n`,
    `${beginMarker(spec, 731)}\r\n${yellowOutput}\n${completionMarker(spec, 731)}\r\n`,
    `${beginMarker(spec, 731)}\r${yellowOutput}\r${completionMarker(spec, 731)}\r`,
    `${beginMarker(spec, 731)}\n${completionMarker(spec, 731)}\n${yellowOutput}\n`,
    `${beginMarker(spec, 731)}\n${yellowOutput}\n${beginMarker(spec, 731)}\n` +
      `${completionMarker(spec, 731)}\n`,
    `${beginMarker(spec, 731)}\n${yellowOutput}\n${completionMarker(spec, 732)}\n`,
    `${beginMarker(spec, 731)}\n${yellowOutput}\n${completionMarker(spec, 731, 1)}\n`,
    `${beginMarker(spec, 731)}\n${yellowOutput}\n${completionMarker(spec, 731)}\nnoise`,
  ];
  for (const [index, raw] of invalidFrames.entries()) {
    assert.throws(
      () => createNodeProcessOracleEvidence(Buffer.from(raw, "latin1"), spec),
      undefined,
      `invalid frame ${index}`,
    );
  }
});

test("the verifier stale-3/noise attack fails even with recomputed raw hash and length", () => {
  const spec = createNodeProcessOracleSpec("verifier_attack");
  const valid = evidence(spec, 731);
  const cleanBytes = Buffer.from(valid.terminalFrame.base64, "base64");
  const markerStart = valid.terminalFrame.offsets.completionMarker.start;
  const noisyBytes = Buffer.concat([
    cleanBytes.subarray(0, markerStart),
    Buffer.from("stale 3\nnoise\n", "ascii"),
    cleanBytes.subarray(markerStart),
  ]);
  const noisy = setRawFrame(valid, noisyBytes);
  // Simulate an attacker also shifting every completion-side offset coherently.
  const added = noisyBytes.length - cleanBytes.length;
  for (const key of ["completionMarker", "completionLineEnding"]) {
    noisy.terminalFrame.offsets[key].start += added;
    noisy.terminalFrame.offsets[key].end += added;
  }
  assert.throws(
    () => validateNodeProcessOracleEvidence(noisy),
    (error) => error.code === "invalid-frame",
  );
});

test("canonical base64, SHA, length, every offset, and all derived fields are recomputed", () => {
  const spec = createNodeProcessOracleSpec("metadata_attack");
  const valid = evidence(spec, 731);
  const mutations = [
    (value) => { value.oracleSchema = "old-schema"; },
    (value) => { value.outputGrammar = "plain-v0"; },
    (value) => { value.nodeSequence = "syntactically_valid_but_wrong"; },
    (value) => { value.nodeToken = "0".repeat(24); },
    (value) => { value.nodeCommand = "node -e 'console.log(4)'"; },
    (value) => { value.nodePid += 1; },
    (value) => { value.outputLine = "4"; },
    (value) => { value.beginMarker += "_other"; },
    (value) => { value.completionMarker += "_other"; },
    (value) => { value.exit = 1; },
    (value) => { value.oracleTranscript = `3\n${value.completionMarker}\n`; },
    (value) => { value.terminalFrame.base64 += "\n"; },
    (value) => { value.terminalFrame.byteLength += 1; },
    (value) => { value.terminalFrame.sha256 = "0".repeat(64); },
    (value) => { value.terminalFrame.newline = "crlf"; },
  ];
  for (const key of Object.keys(valid.terminalFrame.offsets)) {
    mutations.push((value) => { value.terminalFrame.offsets[key].start += 1; });
    mutations.push((value) => { value.terminalFrame.offsets[key].end += 1; });
  }
  for (const [index, mutate] of mutations.entries()) {
    const value = clone(valid);
    mutate(value);
    assert.throws(() => validateNodeProcessOracleEvidence(value), undefined, `mutation ${index}`);
  }
});

test("missing, truncated, echo-only, and oversized captures fail closed", () => {
  const spec = createNodeProcessOracleSpec("bounded_capture");
  assert.equal(parseNodeProcessOracle(Buffer.from(spec.shellCommand, "ascii"), spec), null);
  assert.throws(
    () => requireNodeProcessOracle(
      Buffer.from(`${beginMarker(spec, 731)}\n${yellowOutput}\n`, "latin1"),
      spec,
    ),
    (error) => error.code === "incomplete-oracle",
  );
  assert.throws(
    () => createNodeProcessOracleEvidence(
      Buffer.concat([
        Buffer.from(`${beginMarker(spec, 731)}\n${yellowOutput}\n`, "latin1"),
        Buffer.alloc(E4T32_NODE_ORACLE_FRAME_MAX_BYTES, 0x78),
        Buffer.from(`${completionMarker(spec, 731)}\n`, "ascii"),
      ]),
      spec,
    ),
    (error) => error.code === "oracle-too-large",
  );
  const collector = createNodeOracleFrameCollector(spec);
  const overflow = collector.push(Buffer.concat([
    Buffer.from(`${beginMarker(spec, 731)}\n${yellowOutput}\n`, "latin1"),
    Buffer.alloc(E4T32_NODE_ORACLE_FRAME_MAX_BYTES, 0x78),
  ]));
  assert.equal(overflow.status, "invalid");
  assert.match(overflow.reason, /^overflow:/);
});

test("the walltime source uses the shared byte collector and projects the raw frame into every leg", () => {
  const source = readFileSync(new URL("./e4-t32-node-walltime.spec.js", import.meta.url), "utf8");
  assert.match(source, /createNodeOracleFrameCollector,[\s\S]*createNodeProcessOracleEvidence/);
  assert.match(source, /collectorFactorySource = createNodeOracleFrameCollector\.toString\(\)/);
  assert.doesNotMatch(source, /oracleTranscript/);
  const processSource = source.slice(
    source.indexOf("async function runNodeProcess"),
    source.indexOf("async function runNodeResponsivenessProbe"),
  );
  assert.doesNotMatch(processSource, /TextDecoder|replace\(\/\\x1b|replace\(\/\\r/);
  assert.doesNotMatch(processSource, /FORCE_COLOR|NO_COLOR|NODE_DISABLE_COLORS/);
  for (const field of [
    "oracleSchema",
    "outputGrammar",
    "nodeSequence",
    "nodeToken",
    "nodeCommand",
    "nodePid",
    "outputLine",
    "beginMarker",
    "completionMarker",
    "terminalFrame",
  ]) {
    const occurrences = source.match(new RegExp(`\\b${field}\\b`, "g"))?.length ?? 0;
    assert.ok(occurrences >= 2, `${field} must survive process capture and leg serialization`);
  }
  assert.match(source, /E4T32_NODE_LEG=/);
});
