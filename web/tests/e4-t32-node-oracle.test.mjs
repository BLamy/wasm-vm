import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  E4T32_NODE_COMMAND,
  E4T32_NODE_ORACLE_TRANSCRIPT_MAX_CHARS,
  createNodeProcessOracleSpec,
  parseNodeProcessOracle,
  requireNodeProcessOracle,
  validateNodeProcessOracleEvidence,
} from "./helpers/e4-t32-node-oracle.mjs";

const marker = (sequence, pid, exit = 0) => `__E4T32_NODE_DONE_${sequence}_${pid}_${exit}`;
const capture = (spec, pid, exit = 0) => (
  `${spec.shellCommand}\n3\n${marker(spec.sequence, pid, exit)}\n`
);

test("the submitted source preserves exact Node argv/code without embedding its concrete marker", () => {
  const spec = createNodeProcessOracleSpec("p0_worker_0");
  assert.equal(spec.nodeCommand, "node -e 'console.log(3)'");
  assert.equal(spec.nodeCommand, E4T32_NODE_COMMAND);
  assert.ok(spec.shellCommand.startsWith(`${E4T32_NODE_COMMAND} & node_pid=$!;`));
  assert.ok(spec.shellCommand.includes("wait \"$node_pid\""));
  assert.ok(spec.shellCommand.includes("__E4T32_NODE_DONE_%s_%s_%s"));
  assert.equal(/[\r\n]/.test(spec.shellCommand), false);
  assert.equal(spec.shellCommand.includes(marker(spec.sequence, 731, 0)), false);
  assert.equal(parseNodeProcessOracle(`${spec.shellCommand}\n`, spec), null);
});

test("a runtime standalone output and concrete PID marker produce a bounded interrogable oracle", () => {
  const spec = createNodeProcessOracleSpec("p0_worker_0");
  const oracle = requireNodeProcessOracle(capture(spec, 731), spec);
  assert.deepEqual(oracle, {
    nodeSequence: spec.sequence,
    nodeCommand: E4T32_NODE_COMMAND,
    nodePid: 731,
    outputLine: "3",
    completionMarker: marker(spec.sequence, 731, 0),
    oracleTranscript: `3\n${marker(spec.sequence, 731, 0)}\n`,
    exit: 0,
  });
  assert.ok(oracle.oracleTranscript.length <= E4T32_NODE_ORACLE_TRANSCRIPT_MAX_CHARS);
  assert.equal(oracle.oracleTranscript.includes(spec.shellCommand), false);
  assert.equal(validateNodeProcessOracleEvidence(oracle), oracle);
});

test("two fresh runs retain distinct positive Node PIDs", () => {
  const firstSpec = createNodeProcessOracleSpec("p0_worker_0");
  const secondSpec = createNodeProcessOracleSpec("p0_worker_1");
  const runs = [
    requireNodeProcessOracle(capture(firstSpec, 731), firstSpec),
    requireNodeProcessOracle(capture(secondSpec, 744), secondSpec),
  ];
  assert.equal(runs.every((run) => Number.isSafeInteger(run.nodePid) && run.nodePid > 0), true);
  assert.equal(new Set(runs.map((run) => run.nodePid)).size, 2);
});

test("the generated shell line records the distinct PIDs of two real exact Node invocations", () => {
  const specs = [
    createNodeProcessOracleSpec("host_exact_0"),
    createNodeProcessOracleSpec("host_exact_1"),
  ];
  const runs = specs.map((spec) => requireNodeProcessOracle(
    execFileSync("/bin/sh", ["-c", spec.shellCommand], { encoding: "utf8" }),
    spec,
  ));
  assert.deepEqual(runs.map((run) => run.outputLine), ["3", "3"]);
  assert.equal(runs.every((run) => run.nodePid > 0 && run.exit === 0), true);
  assert.equal(new Set(runs.map((run) => run.nodePid)).size, 2);
});

test("missing or mismatched output, sequence, PID, and marker fail closed", () => {
  const spec = createNodeProcessOracleSpec("p0_worker_0");
  const cases = [
    `${spec.shellCommand}\n${marker(spec.sequence, 731, 0)}\n`,
    `${spec.shellCommand}\n3\n`,
    `${spec.shellCommand}\n3\n${marker("p0_worker_1", 731, 0)}\n`,
    `${spec.shellCommand}\n3\n${marker(spec.sequence, 0, 0)}\n`,
    `${spec.shellCommand}\n3\n__E4T32_NODE_DONE_%s_%s_%s\n`,
  ];
  for (const terminal of cases) {
    assert.throws(
      () => requireNodeProcessOracle(terminal, spec),
      (error) => error.code === "incomplete-oracle",
    );
  }
  assert.throws(
    () => requireNodeProcessOracle(capture(spec, 731, 999), spec),
    (error) => error.code === "invalid-exit",
  );
  assert.throws(
    () => requireNodeProcessOracle(
      `${spec.shellCommand}\n${marker(spec.sequence, 731, 0)}\n3\n`,
      spec,
    ),
    (error) => error.code === "incomplete-oracle",
    "output after completion cannot satisfy the process oracle",
  );

  const valid = requireNodeProcessOracle(capture(spec, 731), spec);
  const mutations = [
    ["command", { ...valid, nodeCommand: "node -e 'console.log(4)'" }],
    ["output", { ...valid, outputLine: "4" }],
    ["PID", { ...valid, nodePid: 732 }],
    ["sequence", { ...valid, nodeSequence: "valid_but_wrong" }],
    ["marker", { ...valid, completionMarker: marker(spec.sequence, 732, 0) }],
    ["transcript", { ...valid, oracleTranscript: `${valid.oracleTranscript}guest noise\n` }],
  ];
  for (const [label, evidence] of mutations) {
    assert.throws(() => validateNodeProcessOracleEvidence(evidence), undefined, label);
  }
});

test("the walltime source durably projects every oracle field into E4T32_NODE_LEG", () => {
  const source = readFileSync(new URL("./e4-t32-node-walltime.spec.js", import.meta.url), "utf8");
  assert.match(source, /createNodeProcessOracleSpec,[\s\S]*from "\.\/helpers\/e4-t32-node-oracle\.mjs"/);
  for (const field of [
    "nodeSequence",
    "nodeCommand",
    "nodePid",
    "outputLine",
    "completionMarker",
    "oracleTranscript",
  ]) {
    const occurrences = source.match(new RegExp(`\\b${field}\\b`, "g"))?.length ?? 0;
    assert.ok(occurrences >= 4, `${field} must survive process capture and leg serialization`);
  }
  assert.match(source, /E4T32_NODE_LEG=/);
});
