// Temporary, owned guest observer. A traced result is diagnostic, never release acceptance.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { remainingTrialMs, withinTrialDeadline } from "./omarchy-input-trial.mjs";
import { parseProcStat } from "./omarchy-process-sample.mjs";

export const INPUT_OBSERVER_COLLECTION_MS = 180000;
export const INPUT_OBSERVER_INSTANCES = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const iso = () => new Date().toISOString();

export function assertOriginalInputGeometry(s) {
  assert.equal(s.width, 1280); assert.equal(s.height, 800); assert.equal(s.fixedViewport, true);
  assert.equal(s.gpu.width, 1280); assert.equal(s.gpu.height, 800);
  assert.equal(s.latest.resourceWidth, 1280); assert.equal(s.latest.resourceHeight, 832);
  const { x, y, width, height } = s.latest.rect;
  for (const n of [x, y, width, height]) assert.ok(Number.isSafeInteger(n));
  assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1280 && y + height <= 800);
  assert.ok(s.framesReceived > 0 && s.successfulPresents > 0);
}

export function decodeInputEvents(hex) {
  assert.match(hex, /^(?:[0-9a-f]{2})*$/u);
  const data = Buffer.from(hex, "hex"), events = [];
  let offset = 0;
  for (; offset + 24 <= data.length; offset += 24) {
    events.push({ seconds: data.readBigInt64LE(offset).toString(),
      microseconds: data.readBigInt64LE(offset + 8).toString(), type: data.readUInt16LE(offset + 16),
      code: data.readUInt16LE(offset + 18), value: data.readInt32LE(offset + 20) });
  }
  return { events, trailingHex: data.subarray(offset).toString("hex") };
}

function processCommand(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  // Sequential reads, explicitly not an atomic process snapshot.
  return `for t in /proc/${pid}/task/*; do for f in stat status wchan syscall schedstat; do printf 'WVINPROC %s/%s\\n' "$t" "$f"; cat "$t/$f" 2>&1; printf '\\n'; done; done; printf 'WVINEXE\\n'; readlink /proc/${pid}/exe; printf 'WVINFDS\\n'; ls -l /proc/${pid}/fd; printf 'WVINDEVICES\\n'; cat /proc/bus/input/devices`;
}

function parseProcess(text, pid) {
  const records = text.split(/^WVINPROC /mu).slice(1).map(part => {
    const lineEnd = part.indexOf("\n");
    return [part.slice(0, lineEnd), part.slice(lineEnd + 1).split(/^WVIN(?:PROC|EXE|FDS|DEVICES)/mu)[0].trim()];
  });
  const stats = records.filter(([name]) => name.endsWith("/stat")).map(([name, body]) => {
    const tid = Number(name.split("/").at(-2));
    return { tid, ...parseProcStat(body, tid) };
  });
  const statuses = records.filter(([name]) => name.endsWith("/status")).map(([name, body]) => {
    const fields = Object.fromEntries(body.split("\n").map(line => {
      const i = line.indexOf(":"); return [line.slice(0, i), line.slice(i + 1).trim()];
    }));
    return { tid: Number(name.split("/").at(-2)), tgid: Number(fields.Tgid),
      tracerPid: Number(fields.TracerPid), state: fields.State, name: fields.Name };
  });
  assert.ok(stats.some(row => row.tid === pid));
  assert.equal(stats.length, statuses.length);
  assert.ok(statuses.every(row => row.tgid === pid));
  return { stats, statuses };
}

async function command(receipt, exec, text, deadline, stage) {
  const row = { stage, command: text, startedAt: iso() }; receipt.commands.push(row);
  try {
    row.response = await withinTrialDeadline(() => exec(text, remainingTrialMs(deadline), stage), deadline, stage);
    row.completedAt = iso(); return row.response;
  } catch (error) { row.error = String(error); throw error; }
}

export async function prepareInputObserver(exec, deadline, report, binaryPath) {
  const bytes = await fs.readFile(binaryPath), packed = gzipSync(bytes, { level: 9 });
  assert.ok(bytes.length < 128 * 1024 && bytes.length > 1000);
  const directory = `/tmp/wv-input-observer-${randomBytes(8).toString("hex")}`;
  const r = report.inputObserver = { purpose: "compositor-read-diagnostic", acceptanceClaim: false,
    schedulingPerturbed: true, startedAt: iso(), preparationDeadlineAt: new Date(deadline).toISOString(),
    binaryPath, binaryBytes: bytes.length, binarySha256: sha(bytes), compressedSha256: sha(packed),
    directory, commands: [], status: "preparing" };
  const run = (text, stage) => command(r, exec, text, deadline, `input-observer:${stage}`);
  try {
    // Heredoc lines stay below the Linux tty canonical line limit; one fenced RPC.
    const payload = packed.toString("base64").match(/.{1,1024}/gu).join("\n");
    const install = `(umask 077; mkdir '${directory}' && base64 -d <<'WVIN_OBSERVER_BINARY' | gzip -d > '${directory}/observer'\n${payload}\nWVIN_OBSERVER_BINARY\nchmod 700 '${directory}/observer' && sha256sum '${directory}/observer')`;
    const installed = await run(install, "install");
    assert.equal(installed.exit, 0); assert.equal(installed.stdout.trim(), `${r.binarySha256}  ${directory}/observer`);
    const instances = await run(INPUT_OBSERVER_INSTANCES, "instances");
    assert.equal(instances.exit, 0);
    const rows = JSON.parse(instances.stdout);
    assert.ok(Array.isArray(rows) && rows.length === 1);
    r.instance = rows[0]; r.pid = rows[0].pid;
    assert.ok(Number.isSafeInteger(r.pid) && r.pid > 1);
    const before = await run(processCommand(r.pid), "process-before");
    assert.equal(before.exit, 0); r.before = parseProcess(before.stdout, r.pid);
    assert.ok(r.before.statuses.every(row => row.tracerPid === 0));
    assert.equal(r.before.statuses.find(row => row.tid === r.pid).name, "Hyprland");
    const start = await run(`'${directory}/observer' ${r.pid} > '${directory}/trace.jsonl' 2> '${directory}/stderr' < /dev/null & wv_input_observer_pid=$!; printf 'WVINPID %s\\n' "$wv_input_observer_pid"`, "start");
    assert.equal(start.exit, 0);
    const matches = [...start.stdout.matchAll(/^WVINPID (\d+)\s*$/gmu)]; assert.equal(matches.length, 1);
    const match = matches[0];
    r.tracerPid = Number(match[1]); assert.ok(r.tracerPid > 1);
    for (;;) {
      const observed = await run(`cat '${directory}/trace.jsonl'`, "ready");
      assert.equal(observed.exit, 0);
      // cat can end between the observer's writes; never invent a complete row.
      const complete = observed.stdout.slice(0, observed.stdout.lastIndexOf("\n") + 1);
      const records = complete.split("\n").filter(Boolean).map(line => JSON.parse(line));
      assert.ok(!records.some(row => row.kind === "error"), JSON.stringify(records));
      const ready = records.find(row => row.kind === "ready");
      if (ready) {
        assert.equal(ready.pid, r.pid); assert.equal(ready.tracerPid, r.tracerPid);
        assert.ok(ready.threads > 0); r.ready = ready; r.initialRecords = records;
        break;
      }
      assert.ok(!records.some(row => row.kind === "finished"), "observer exited before ready");
      await withinTrialDeadline(() => new Promise(resolve => setTimeout(resolve, 200)), deadline, "observer ready");
    }
    const attached = await run(processCommand(r.pid), "process-attached");
    assert.equal(attached.exit, 0); r.attached = parseProcess(attached.stdout, r.pid);
    assert.ok(r.attached.statuses.every(row => row.tracerPid === r.tracerPid));
    assert.equal(r.before.stats.find(row => row.tid === r.pid).starttime,
      r.attached.stats.find(row => row.tid === r.pid).starttime);
    r.status = "attached"; r.attachedAt = iso();
  } catch (error) { r.status = "preparation-failed"; r.error = String(error); throw error; }
}

export async function collectInputObserver(exec, report, out) {
  const r = report.inputObserver;
  if (!r || r.collection) return;
  const deadline = Date.now() + INPUT_OBSERVER_COLLECTION_MS;
  r.collection = { startedAt: iso(), deadlineAt: new Date(deadline).toISOString(), timeoutMs: INPUT_OBSERVER_COLLECTION_MS };
  const run = (text, stage) => command(r, exec, text, deadline, `input-observer:${stage}`);
  try {
    if (r.tracerPid) {
      const boundary = await run(`printf 'WVINTRACER\\n'; cat /proc/${r.tracerPid}/stat /proc/${r.tracerPid}/status 2>&1; printf 'WVINTRACEEND\\n'; tail -n 1 '${r.directory}/trace.jsonl'`, "observation-boundary");
      r.boundary = boundary;
      // Only the exact owned diagnostic executable may receive SIGTERM.
      const stop = await run(`if [ -e /proc/${r.tracerPid}/exe ]; then [ "$(readlink /proc/${r.tracerPid}/exe)" = '${r.directory}/observer' ] && kill -TERM ${r.tracerPid}; fi; wait ${r.tracerPid}; wv_input_observer_exit=$?; printf 'WVINEXIT %s\\n' "$wv_input_observer_exit"`, "stop");
      r.observerExit = stop;
    }
    const trace = await run(`gzip -c '${r.directory}/trace.jsonl' | base64; printf '\\nWVINSTDERR\\n'; cat '${r.directory}/stderr'`, "trace");
    assert.equal(trace.exit, 0);
    const split = trace.stdout.split("\nWVINSTDERR\n"); assert.equal(split.length, 2);
    const traceBytes = gunzipSync(Buffer.from(split[0].replaceAll(/\s/gu, ""), "base64"), { maxOutputLength: 16 * 1024 * 1024 });
    await fs.writeFile(path.join(out, "compositor-input.jsonl"), traceBytes);
    await fs.writeFile(path.join(out, "compositor-input.stderr"), split[1]);
    r.trace = { bytes: traceBytes.length, sha256: sha(traceBytes), path: "compositor-input.jsonl" };
    const after = await run(processCommand(r.pid), "process-after");
    assert.equal(after.exit, 0); r.after = parseProcess(after.stdout, r.pid);
    assert.ok(r.after.statuses.every(row => row.tracerPid === 0 && !/^[TtZX]/u.test(row.state)), "compositor still stopped or exited");
    assert.equal(r.before.stats.find(row => row.tid === r.pid).starttime,
      r.after.stats.find(row => row.tid === r.pid).starttime);
    r.collection.status = "collected-and-detached";
  } catch (error) { r.collection.status = "collection-unproven"; r.collection.error = String(error); }
  finally { r.collection.finishedAt = iso(); }
}
