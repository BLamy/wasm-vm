#!/usr/bin/env node
// Self-test for tools/perf/desktop-latency.mjs: run its `click` scenario against a static
// stand-in page (fixtures/desktop-latency-standin.html, no guest) whose repaints are scripted,
// and check what the tool reports. First built by the E4-T40a verifier as a scratch experiment.
//
//   node tools/perf/desktop-latency-selftest.mjs
//
//   before  button repaints 200 ms before the result      -> pressed frame seen on every trial
//   same    button and result repaint in one frame        -> no pressed frame on any trial
//   none    button never repaints                         -> no pressed frame on any trial
//   after   button repaints after the result              -> no pressed frame on any trial
//   miss2   the 2nd press never repaints the result       -> exit 1, missing click.resultMs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, "fixtures/desktop-latency-standin.html"));
const server = http.createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(page); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const out = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-latency-selftest-"));
const N = 6;
// Asynchronous on purpose: this process also serves the page.
function run(mode, timeoutS = "30") {
  const file = path.join(out, `${mode}.json`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(here, "desktop-latency.mjs"),
      "--url", `http://127.0.0.1:${server.address().port}`, "--query", `&mode=${mode}`,
      "--scenarios", "click", "--n", String(N), "--trial-timeout-s", timeoutS, "--out", file],
    { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b) => { stderr += b; });
    child.on("error", reject);
    child.on("close", (status) => {
      try { resolve({ status, stderr, json: JSON.parse(fs.readFileSync(file, "utf8")) }); }
      catch (error) { reject(new Error(`${mode}: no result file (exit ${status}): ${stderr.slice(-500)}`, { cause: error })); }
    });
  });
}
try {
  for (const [mode, seen] of [["before", N], ["same", 0], ["none", 0], ["after", 0]]) {
    const { status, json } = await run(mode);
    const click = json.scenarios.click;
    assert.equal(status, 0, `${mode}: exit status`);
    assert.deepEqual(json.missing, [], `${mode}: no missing required sample`);
    assert.equal(click.resultMs.n, N, `${mode}: every result sample present`);
    assert.deepEqual([click.pressedFrame.seen, click.pressedFrame.none], [seen, N - seen], `${mode}: pressed frames seen/none`);
    if (seen) assert.ok(click.pressedFrame.ms.max < click.resultMs.min, `${mode}: pressed frame precedes the result`);
    console.log(`selftest ${mode}: ok (pressed frame seen ${click.pressedFrame.seen}/${N}, result median ${click.resultMs.median} ms)`);
  }
  const miss = await run("miss2", "4");
  assert.equal(miss.status, 1, "miss2: exit status");
  assert.deepEqual(miss.json.missing, ["click.resultMs"]);
  assert.match(miss.stderr, /missing samples: click\.resultMs/u);
  assert.equal(miss.json.scenarios.click.resultMs.missing, 1);
  console.log("selftest miss2: ok (exit 1, missing click.resultMs)");
  console.log("desktop-latency self-test PASS");
} finally {
  server.close();
  fs.rmSync(out, { recursive: true, force: true });
}
