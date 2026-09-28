// Harness-only read-only /proc sampling. No guest scheduling, PC, or input-consumption proof.
import assert from "node:assert/strict";

const MAX_TASKS = 32;
const MAX_TIMEOUT_MS = 300_000;
const unsigned = value => typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
const id = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const iso = milliseconds => new Date(milliseconds).toISOString();

export function processSamplePlan(request) {
  assert.equal(request.op, "process-sample");
  assert.ok(Array.isArray(request.targets) && request.targets.length > 0
    && request.targets.length <= MAX_TASKS, "targets must contain 1..32 PID records");
  const timeoutMs = request.timeoutMs ?? MAX_TIMEOUT_MS;
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= MAX_TIMEOUT_MS,
    "process-sample timeoutMs must be 1000..300000");
  const seen = new Set();
  const targets = request.targets.map(target => {
    assert.ok(target && id(target.pid), "invalid PID");
    assert.ok(target.tids === undefined || Array.isArray(target.tids), "tids must be an array");
    const tids = [target.pid, ...(target.tids ?? [])];
    assert.ok(tids.length <= MAX_TASKS, "at most 32 total PID/TID tasks");
    for (const tid of tids) {
      assert.ok(id(tid), "invalid TID");
      assert.ok(!seen.has(tid), "duplicate PID/TID");
      seen.add(tid);
      assert.ok(seen.size <= MAX_TASKS, "at most 32 total PID/TID tasks");
    }
    return { pid: target.pid, tids };
  });
  const records = [
    { label: "boot-before", filename: "/proc/sys/kernel/random/boot_id" },
    { label: "uptime-before", filename: "/proc/uptime" },
    { label: "clock-ticks", filename: null },
  ];
  for (const { pid, tids } of targets) {
    records.push({ label: `leader-${pid}-before`, filename: `/proc/${pid}/stat` });
    for (const tid of tids) {
      const root = `/proc/${pid}/task/${tid}`;
      for (const field of ["stat-before", "schedstat", "wchan", "stat-after"]) {
        records.push({ label: `task-${pid}-${tid}-${field}`, filename: `${root}/${field.startsWith("stat-") ? "stat" : field}` });
      }
    }
    records.push({ label: `leader-${pid}-after`, filename: `/proc/${pid}/stat` });
  }
  records.push({ label: "uptime-after", filename: "/proc/uptime" },
    { label: "boot-after", filename: "/proc/sys/kernel/random/boot_id" });
  // Only fixed paths and validated numeric IDs enter the shell. No ps, task enumeration, or
  // per-file cat/awk subprocesses; getconf is the sole external command. Mark missing files.
  const command = `(\nwv_ps_read() {\n  printf 'WVMPS %s\\n' "$1"\n  if { while IFS= read -r wv_ps_line || [ -n "$wv_ps_line" ]; do printf '%s\\n' "$wv_ps_line"; done; } < "$2" 2>/dev/null; then\n    printf 'WVMPS_END 0\\n'\n  else printf 'WVMPS_END 1\\n'; fi\n}\n${records.map(record => record.filename
    ? `wv_ps_read '${record.label}' '${record.filename}'`
    : "printf 'WVMPS clock-ticks\\n'; getconf CLK_TCK; wv_ps_status=$?; printf 'WVMPS_END %s\\n' \"$wv_ps_status\"").join("\n")}\n)`;
  return { targets, records, timeoutMs, command };
}

export function parseProcStat(text, expectedId) {
  // comm may contain spaces and either parenthesis. The last ') STATE ' separates fields.
  const match = /^(\d+) \((.*)\) ([RSDZTtXxKWPI]) ([-0-9 ]+)\s*$/u.exec(text);
  assert.ok(match && Number(match[1]) === expectedId, "malformed/mismatched proc stat PID");
  const fields = match[4].trim().split(/ +/u);
  assert.ok(fields.length >= 36 && fields.every(field => /^-?\d+$/u.test(field)), "missing/malformed proc stat fields");
  const field = number => fields[number - 4];
  for (const number of [14, 15, 20, 22, 39]) assert.ok(unsigned(field(number)), `invalid stat field ${number}`);
  return { id: expectedId, comm: match[2], state: match[3],
    utime: field(14), stime: field(15), threads: field(20), starttime: field(22), processor: field(39) };
}

const sameStat = (before, after) => before.id === after.id && before.starttime === after.starttime;
function decimalNs(value) {
  assert.match(value, /^\d+(?:\.\d{1,9})?$/u, "invalid guest uptime");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}

export function parseProcessSample(plan, rpc) {
  assert.equal(rpc?.exit, 0, "process-sample RPC failed");
  assert.ok(typeof rpc.stdout === "string" && rpc.stdout.length <= 256 * 1024, "missing/oversized process-sample output");
  const lines = rpc.stdout.replaceAll("\r\n", "\n").trimEnd().split("\n");
  const values = new Map();
  let cursor = 0;
  for (const { label } of plan.records) {
    assert.equal(lines[cursor++], `WVMPS ${label}`, "missing/ambiguous process-sample record");
    const body = [];
    while (cursor < lines.length && !lines[cursor].startsWith("WVMPS_END ")) body.push(lines[cursor++]);
    const end = /^WVMPS_END ([0-9]+)$/u.exec(lines[cursor++] ?? "");
    assert.ok(end, "missing process-sample record status");
    values.set(label, { status: Number(end[1]), body: body.join("\n") });
  }
  assert.equal(cursor, lines.length, "extra process-sample output");
  const read = label => {
    const value = values.get(label);
    assert.equal(value.status, 0, `${label}: missing/unreadable proc field`);
    assert.ok(value.body.length > 0 && !value.body.includes("\n"), `${label}: missing/ambiguous proc field`);
    return value.body;
  };
  const bootId = read("boot-before");
  assert.match(bootId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u, "invalid boot ID");
  assert.equal(read("boot-after"), bootId, "boot ID changed within sample");
  const uptime = label => {
    const fields = read(label).trim().split(/\s+/u);
    assert.equal(fields.length, 2, "malformed uptime");
    fields.forEach(decimalNs);
    return fields[0];
  };
  const uptimeBefore = uptime("uptime-before"), uptimeAfter = uptime("uptime-after");
  assert.ok(decimalNs(uptimeAfter) >= decimalNs(uptimeBefore), "guest uptime decreased within sample");
  const clockTicks = read("clock-ticks");
  assert.ok(unsigned(clockTicks) && BigInt(clockTicks) > 0n && BigInt(clockTicks) <= 1_000_000n, "invalid CLK_TCK");
  const tasks = [];
  for (const { pid, tids } of plan.targets) {
    let leaderBefore, leaderAfter, leaderError;
    try {
      leaderBefore = parseProcStat(read(`leader-${pid}-before`), pid);
      leaderAfter = parseProcStat(read(`leader-${pid}-after`), pid);
      assert.ok(sameStat(leaderBefore, leaderAfter), "PID reused within sample");
    } catch (error) { leaderError = String(error); }
    for (const tid of tids) {
      const prefix = `task-${pid}-${tid}`;
      try {
        assert.ok(!leaderError, leaderError);
        const before = parseProcStat(read(`${prefix}-stat-before`), tid);
        const after = parseProcStat(read(`${prefix}-stat-after`), tid);
        assert.ok(sameStat(before, after), "TID reused within sample");
        if (tid === pid) assert.equal(after.starttime, leaderBefore.starttime, "leader/task identity mismatch");
        for (const key of ["utime", "stime"]) assert.ok(BigInt(after[key]) >= BigInt(before[key]), "task counters decreased within sample");
        const optionalErrors = {};
        let schedstat = null, wchan = null;
        try {
          const fields = read(`${prefix}-schedstat`).trim().split(/\s+/u);
          assert.ok(fields.length === 3 && fields.every(unsigned), "malformed schedstat");
          schedstat = { runtimeNs: fields[0], runqueueWaitNs: fields[1], timeslices: fields[2] };
        } catch (error) { optionalErrors.schedstat = String(error); }
        try {
          wchan = read(`${prefix}-wchan`);
          assert.match(wchan, /^[a-zA-Z0-9_.]+$/u, "malformed wchan");
        } catch (error) { wchan = null; optionalErrors.wchan = String(error); }
        tasks.push({ pid, tid, available: true, leaderStarttime: leaderBefore.starttime,
          statBefore: before, stat: after, schedstat, wchan, optionalErrors });
      } catch (error) { tasks.push({ pid, tid, available: false, error: String(error) }); }
    }
  }
  return { bootId, clockTicks, uptimeBefore, uptimeAfter, tasks };
}

function unsignedDelta(before, after) {
  assert.ok(unsigned(before) && unsigned(after) && BigInt(after) >= BigInt(before), "counter missing/decreased");
  return (BigInt(after) - BigInt(before)).toString();
}

export function processSampleDeltas(previous, current) {
  const unavailable = reason => ({ available: false, reason });
  if (previous?.status !== "sampled" || current?.status !== "sampled") return unavailable("no consecutive successful samples");
  if (previous.process.bootId !== current.process.bootId) return unavailable("boot ID changed");
  if (previous.process.clockTicks !== current.process.clockTicks) return unavailable("CLK_TCK changed");
  const hostElapsedMs = current.finishedMs - previous.finishedMs;
  if (!(hostElapsedMs > 0)) return unavailable("non-increasing host time");
  const guestElapsedNs = decimalNs(current.process.uptimeAfter) - decimalNs(previous.process.uptimeAfter);
  if (guestElapsedNs < 0n) return unavailable("guest uptime decreased");
  const tasks = current.process.tasks.map(task => {
    const old = previous.process.tasks.find(row => row.pid === task.pid && row.tid === task.tid);
    const identity = { pid: task.pid, tid: task.tid };
    if (!old?.available || !task.available) return { ...identity, ...unavailable("task missing/unreadable") };
    if (old.leaderStarttime !== task.leaderStarttime || !sameStat(old.stat, task.stat)) {
      return { ...identity, ...unavailable("PID/TID identity changed") };
    }
    try {
      const utime = unsignedDelta(old.stat.utime, task.stat.utime), stime = unsignedDelta(old.stat.stime, task.stat.stime);
      let schedstat = null, schedstatError = null;
      if (old.schedstat && task.schedstat) {
        try { schedstat = Object.fromEntries(Object.keys(task.schedstat).map(key => [key, unsignedDelta(old.schedstat[key], task.schedstat[key])])); }
        catch (error) { schedstatError = String(error); }
      }
      return { ...identity, available: true, utimeTicks: utime, stimeTicks: stime,
        cpuMs: Number(BigInt(utime) + BigInt(stime)) * 1000 / Number(current.process.clockTicks),
        schedstat, schedstatError };
    } catch (error) { return { ...identity, ...unavailable(String(error)) }; }
  });
  const counters = {};
  for (const [group, keys] of Object.entries({ inputDevice: ["pendingEvents", "pendingFrames", "droppedEvents", "droppedFrames", "rejectedEvents"],
    display: ["framesReceived", "successfulPresents", "replayedFrames"], scheduler: ["retiredInstructions", "slices"] })) {
    counters[group] = {};
    for (const key of keys) {
      const before = previous.after?.values?.[group]?.[key], after = current.after?.values?.[group]?.[key];
      counters[group][key] = Number.isSafeInteger(before) && Number.isSafeInteger(after)
        && (key.startsWith("pending") || after >= before) ? after - before : null;
    }
  }
  return { available: true, hostElapsedMs, guestElapsedNs: guestElapsedNs.toString(), tasks, counters,
    gpuFramesPerHostSecond: counters.display.framesReceived === null ? null : counters.display.framesReceived * 1000 / hostElapsedMs,
    pendingEventsNetChangePerHostSecond: counters.inputDevice.pendingEvents === null ? null : counters.inputDevice.pendingEvents * 1000 / hostElapsedMs,
    limitation: "Sequential observations, not atomic. Backlog changes are not guest-consumption rates; zero schedstat may mean accounting disabled. No current-PC or currently-scheduled-PID claim." };
}

// Dependencies are injected for deterministic harness-only tests; no browser or guest is created here.
export async function sampleProcesses({ request, previous, stats, exec, beforeRpc = async () => {}, now = Date.now }) {
  const plan = processSamplePlan(request); // Reject before any observer/RPC work.
  const startedMs = now(), deadline = startedMs + plan.timeoutMs;
  const result = { status: "unavailable", startedAt: iso(startedMs), startedMs,
    timeoutMs: plan.timeoutMs, command: plan.command, targets: plan.targets,
    limitation: "Read-only sequential proc/host observations; no input-consumption or active-PC proof." };
  let phase = "stats-before";
  const bounded = async work => {
    const remaining = deadline - now();
    if (remaining <= 0) throw Error("process-sample deadline exceeded");
    let timer;
    try {
      const value = await Promise.race([Promise.resolve().then(() => work(remaining)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error("process-sample deadline exceeded")), remaining); })]);
      if (now() > deadline) throw Error("process-sample completed after deadline");
      return value;
    } finally { clearTimeout(timer); }
  };
  const observation = async () => {
    const startedAt = iso(now());
    const values = await bounded(() => stats());
    return { startedAt, completedAt: iso(now()), values };
  };
  try {
    result.before = await observation();
    phase = "rpc";
    result.rpc = { startedAt: iso(now()), command: plan.command };
    await bounded(remaining => beforeRpc({ ...result.rpc, timeoutMs: remaining }));
    const raw = await bounded(remaining => {
      result.rpc.submittedAt = iso(now()); result.rpc.timeoutMs = remaining;
      return exec(plan.command, remaining);
    });
    result.rpc.raw = raw; result.rpc.completedAt = iso(now());
    phase = "stats-after";
    result.after = await observation();
    phase = "parse";
    result.process = parseProcessSample(plan, raw);
    result.status = "sampled";
  } catch (error) {
    result.error = String(error); result.failedPhase = phase;
    result.status = /deadline|timeout|timed out/iu.test(result.error) ? "timeout" : "unavailable";
  }
  result.finishedMs = now(); result.finishedAt = iso(result.finishedMs);
  result.elapsedMs = result.finishedMs - startedMs;
  result.deltas = processSampleDeltas(previous, result);
  return result;
}
