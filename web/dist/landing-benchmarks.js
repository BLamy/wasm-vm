// The system-workload matrix is produced by one portable Node script and keeps raw
// samples per environment. Invalid or partial captures render as unavailable instead of
// plausible data.
const sha256Pattern = /^[0-9a-f]{64}$/;
const nonEmpty = (value) => typeof value === "string" && value.trim() !== "";
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const requireBenchmark = (condition, message) => {
  if (!condition) throw new Error(message);
};
const workloadRows = document.getElementById("workload-rows");
const workloadDate = document.getElementById("workload-updated");
const workloadRuntimeLabels = {
  "native-node": "Native Node",
  "wasm-vm-worker-jit": "wasm-vm · worker + JIT",
  "wasm-vm-worker-interpreter": "wasm-vm · worker interpreter",
  "wasm-vm-main-interpreter": "wasm-vm · main interpreter",
  "webcontainers": "WebContainers",
  "almostnode": "almostnode",
  "webvm": "WebVM",
};
const workloadIds = ["file-read", "file-write", "stream-read", "stream-copy", "server-lifecycle", "http-roundtrip"];
const workloadShortLabels = {
  "file-read": "File read",
  "file-write": "File write",
  "stream-read": "Stream read",
  "stream-copy": "Stream copy",
  "server-lifecycle": "Server lifecycle",
  "http-roundtrip": "HTTP round trip",
};
const validateRuntimeWorkloads = (data) => {
  requireBenchmark(data?.schema === 1, "workload schema must be 1");
  requireBenchmark(data.kind === "node-system-workload-comparison-v1", "workload kind is invalid");
  requireBenchmark(data.publicationStatus === "complete" || data.publicationStatus === "partial",
    "workload publication status is invalid");
  requireBenchmark(Number.isFinite(Date.parse(data.generatedAt)), "workload generatedAt is invalid");
  requireBenchmark(data.campaign?.id === "runtime-workloads-v1", "workload campaign ID drifted");
  requireBenchmark(data.campaign?.source === "./bench-runtime-workloads.mjs"
    && sha256Pattern.test(data.campaign?.scriptSha256), "workload runner provenance is invalid");
  requireBenchmark(data.fixture?.id === "runtime-workloads-v1"
    && Number.isInteger(data.fixture.payloadBytes) && data.fixture.payloadBytes > 0
    && sha256Pattern.test(data.fixture.payloadSha256)
    && Number.isInteger(data.fixture.httpBodyBytes) && data.fixture.httpBodyBytes > 0
    && sha256Pattern.test(data.fixture.httpBodySha256), "workload fixture is invalid");
  requireBenchmark(Number.isInteger(data.policy?.samples) && data.policy.samples > 0
    && Number.isInteger(data.policy?.warmups) && data.policy.warmups > 0
    && Number.isInteger(data.policy?.httpRequests) && data.policy.httpRequests > 0,
  "workload sampling policy is invalid");
  requireBenchmark(Array.isArray(data.environments) && data.environments.length > 0,
    "workload environments are missing");
  const ids = data.environments.map((environment) => environment?.id);
  requireBenchmark(ids.every(nonEmpty) && new Set(ids).size === ids.length,
    "workload environment IDs must be unique");
  data.environments.forEach((environment) => {
    requireBenchmark(environment.status === "measured" || environment.status === "partial",
      `${environment.id} workload capture status is invalid`);
    requireBenchmark(environment.runner?.scriptSha256 === data.campaign.scriptSha256,
      `${environment.id} runner digest differs`);
    requireBenchmark(Array.isArray(environment.workloads)
      && sameJson(environment.workloads.map((workload) => workload.id), workloadIds),
    `${environment.id} workload IDs/order are incomplete`);
    environment.workloads.forEach((workload) => {
      if (workload.status === "measured") {
        requireBenchmark(workload.verification?.passed === true,
          `${environment.id}/${workload.id} is not verified`);
        requireBenchmark(Array.isArray(workload.samples)
          && workload.samples.length === data.policy.samples,
        `${environment.id}/${workload.id} sample count is invalid`);
        requireBenchmark(workload.samples.every((sample) => sample.verification === "passed"
          && Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0),
        `${environment.id}/${workload.id} sample verification is invalid`);
        requireBenchmark(Number.isFinite(workload.summary?.medianMs)
          && Number.isFinite(workload.summary?.p95Ms)
          && workload.summary.p95Ms >= workload.summary.medianMs
          && workload.summary.sampleCount === data.policy.samples,
        `${environment.id}/${workload.id} summary is invalid`);
      } else if (workload.status === "unsupported") {
        requireBenchmark(nonEmpty(workload.reason),
          `${environment.id}/${workload.id} unsupported result needs a reason`);
        requireBenchmark(Array.isArray(workload.samples) && workload.samples.length === 0
          && workload.summary === null,
        `${environment.id}/${workload.id} unsupported result contains timings`);
      } else {
        throw new Error(`${environment.id}/${workload.id} has invalid status ${workload.status}`);
      }
    });
  });
  requireBenchmark(Array.isArray(data.notRun), "workload notRun list is invalid");
  return data;
};
const compactWorkloadReason = (reason) => {
  const firstLine = String(reason ?? "capture unavailable").split(/\r?\n/, 1)[0].replace(/^Error:\s*/i, "");
  if (firstLine.includes("EADDRINUSE")) return "loopback listener collision; bounded retry timed out";
  if (firstLine.includes("stream is not async iterable")) return "stream API is not async iterable";
  if (firstLine.includes("HTTP response status 403")) return "HTTP response returned 403";
  if (firstLine.includes("ENOENT")) return "output capture file unavailable (ENOENT)";
  return firstLine.length > 96 ? `${firstLine.slice(0, 93)}…` : firstLine;
};
const formatWorkloadMetric = (workload) => {
  if (workload.status !== "measured" || !workload.summary) {
    return {
      text: "not measured",
      detail: `unsupported — ${compactWorkloadReason(workload.reason)}`,
      reason: workload.reason ?? "capture unavailable",
      throughput: null,
    };
  }
  const summary = workload.summary;
  return {
    text: `${summary.medianMs.toFixed(1)} ms`,
    detail: `p95 ${summary.p95Ms.toFixed(1)} ms`,
    throughput: summary.throughputMiBPerSec == null
      ? null : `${summary.throughputMiBPerSec.toFixed(1)} MiB/s`,
  };
};
const renderRuntimeWorkloads = (data) => {
  validateRuntimeWorkloads(data);
  workloadDate.textContent = new Date(data.generatedAt).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const renderedRows = data.environments.map((environment) => {
    const tr = document.createElement("tr");
    const runtime = document.createElement("td");
    runtime.className = "workload-runtime";
    const title = document.createElement("strong");
    title.textContent = workloadRuntimeLabels[environment.id] ?? environment.id;
    const identity = document.createElement("span");
    identity.textContent = `${environment.environment?.nodeVersion ?? "Node-compatible"} · ${environment.environment?.platform ?? "unknown"}/${environment.environment?.arch ?? "unknown"}`;
    runtime.append(title, identity);
    tr.append(runtime);
    for (const workloadId of workloadIds) {
      const workload = environment.workloads.find((item) => item.id === workloadId);
      const metric = formatWorkloadMetric(workload);
      const cell = document.createElement("td");
      cell.className = "workload-cell";
      cell.setAttribute("data-workload", workloadShortLabels[workloadId]);
      cell.textContent = metric.text;
      if (metric.reason) {
        cell.classList.add("workload-unavailable");
        cell.title = metric.reason;
      }
      const p95 = document.createElement("span");
      p95.className = "workload-p95";
      p95.textContent = metric.detail;
      cell.append(p95);
      if (metric.throughput) {
        const throughput = document.createElement("span");
        throughput.className = "workload-throughput";
        throughput.textContent = metric.throughput;
        cell.append(throughput);
      }
      tr.append(cell);
    }
    return tr;
  });
  data.notRun.forEach((unavailable) => {
    const tr = document.createElement("tr");
    const runtime = document.createElement("td");
    runtime.className = "workload-runtime";
    const title = document.createElement("strong");
    title.textContent = workloadRuntimeLabels[unavailable.id] ?? unavailable.id;
    runtime.append(title);
    const reason = document.createElement("td");
    reason.className = "workload-pending workload-unavailable-summary";
    reason.colSpan = workloadIds.length;
    reason.title = unavailable.reason;
    reason.textContent = `not measured — ${compactWorkloadReason(unavailable.reason)}`;
    tr.append(runtime, reason);
    renderedRows.push(tr);
  });
  workloadRows.replaceChildren(...renderedRows);
};
const runtimeBenchmarkRevision = "a455f3d0c479";
fetch(`./runtime-benchmarks.json?rev=${runtimeBenchmarkRevision}`, { cache: "no-store" }).then((response) => {
  if (!response.ok) throw new Error(`runtime workload data HTTP ${response.status}`);
  return response.json();
}).then(renderRuntimeWorkloads).catch((error) => {
  workloadDate.textContent = "unavailable";
  workloadRows.innerHTML = `<tr><td colspan="7" class="workload-pending">Runtime workload evidence unavailable.</td></tr>`;
  console.error("runtime workload table failed:", error);
});

// Steady-state compute is a separate campaign. Keep its comparable rows and the native
// handoff diagnostic explicit so a hot-loop win cannot be mistaken for an I/O win.
const computeRows = document.getElementById("compute-rows");
const computeDate = document.getElementById("compute-updated");
const computeDiagnosticRows = document.getElementById("compute-diagnostic-rows");
const computeWorkloadIds = ["integer-mix", "branch-mix", "memory-mix"];
const computeWorkloadLabels = {
  "integer-mix": "Integer mix",
  "branch-mix": "Branch mix",
  "memory-mix": "Memory mix",
};
const validateRuntimeCompute = (data) => {
  requireBenchmark(data?.schema === 1, "compute schema must be 1");
  requireBenchmark(data.kind === "node-steady-state-compute-comparison-v1", "compute kind is invalid");
  requireBenchmark(data.publicationStatus === "complete" || data.publicationStatus === "partial",
    "compute publication status is invalid");
  requireBenchmark(Number.isFinite(Date.parse(data.generatedAt)), "compute generatedAt is invalid");
  requireBenchmark(data.campaign?.id === "runtime-compute-v1"
    && data.campaign?.source === "./bench-runtime-compute.mjs"
    && sha256Pattern.test(data.campaign?.scriptSha256), "compute runner provenance is invalid");
  requireBenchmark(Array.isArray(data.campaign?.workloadIds)
    && sameJson(data.campaign.workloadIds, computeWorkloadIds), "compute workload IDs drifted");
  requireBenchmark(data.fixture?.id === "runtime-compute-v1"
    && data.fixture.iterations === 1_000_000
    && data.fixture.memoryWords === 16_384
    && data.fixture.memoryPasses === 32
    && Object.keys(data.fixture.expectedChecksums ?? {}).length === computeWorkloadIds.length,
  "compute fixture is invalid");
  requireBenchmark(Number.isInteger(data.policy?.samples) && data.policy.samples > 0
    && Number.isInteger(data.policy?.warmups) && data.policy.warmups > 0,
  "compute sampling policy is invalid");
  requireBenchmark(Array.isArray(data.environments) && data.environments.length > 0,
    "compute environments are missing");
  const ids = data.environments.map((environment) => environment?.id);
  requireBenchmark(ids.every(nonEmpty) && new Set(ids).size === ids.length,
    "compute environment IDs must be unique");
  data.environments.forEach((environment) => {
    requireBenchmark(environment.status === "measured" || environment.status === "notRun",
      `${environment.id} compute capture status is invalid`);
    requireBenchmark(nonEmpty(environment.label), `${environment.id} compute label is missing`);
    if (environment.status === "notRun") {
      requireBenchmark(nonEmpty(environment.reason)
        && Array.isArray(environment.workloads) && environment.workloads.length === 0,
      `${environment.id} compute pending result is invalid`);
      return;
    }
    requireBenchmark(environment.runner?.scriptSha256 === data.campaign.scriptSha256,
      `${environment.id} compute runner digest differs`);
    requireBenchmark(Array.isArray(environment.workloads)
      && sameJson(environment.workloads.map((workload) => workload.id), computeWorkloadIds),
    `${environment.id} compute workload IDs/order are incomplete`);
    environment.workloads.forEach((workload) => {
      requireBenchmark(workload.status === "measured" && nonEmpty(workload.unitLabel),
        `${environment.id}/${workload.id} compute result is invalid`);
      requireBenchmark(Number.isInteger(workload.expectedChecksum),
        `${environment.id}/${workload.id} checksum is invalid`);
      requireBenchmark(Array.isArray(workload.samples)
        && workload.samples.length === data.policy.samples
        && workload.samples.every((sample) => sample.verification === "passed"
          && sample.checksum === workload.expectedChecksum
          && Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0),
      `${environment.id}/${workload.id} sample verification is invalid`);
      requireBenchmark(Number.isFinite(workload.summary?.medianMs)
        && Number.isFinite(workload.summary?.p95Ms)
        && workload.summary.p95Ms >= workload.summary.medianMs
        && Number.isFinite(workload.summary?.workUnitsPerSec)
        && workload.summary.workUnitsPerSec > 0
        && workload.summary.sampleCount === data.policy.samples,
      `${environment.id}/${workload.id} compute summary is invalid`);
      requireBenchmark(data.fixture.expectedChecksums[workload.id] === workload.expectedChecksum,
        `${environment.id}/${workload.id} checksum differs from fixture`);
    });
  });
  requireBenchmark(data.diagnostics?.status === "measured"
    && Array.isArray(data.diagnostics.workloads)
    && data.diagnostics.workloads.length === 2,
  "native JIT diagnostic is missing");
  data.diagnostics.workloads.forEach((workload) => {
    requireBenchmark(nonEmpty(workload.label)
      && Number.isFinite(workload.interpreterMips)
      && Number.isFinite(workload.jitMips)
      && Number.isFinite(workload.ratio),
    `diagnostic ${workload.id} is invalid`);
  });
  return data;
};
const formatComputeRate = (workload) => {
  const rate = workload.summary.workUnitsPerSec;
  const compact = rate >= 1_000_000
    ? `${(rate / 1_000_000).toFixed(1)}M`
    : rate >= 1_000 ? `${(rate / 1_000).toFixed(1)}K` : rate.toFixed(1);
  return `${compact} ${workload.unitLabel}/s`;
};
const formatComputeMetric = (workload) => ({
  text: `${workload.summary.medianMs.toFixed(2)} ms`,
  detail: `p95 ${workload.summary.p95Ms.toFixed(2)} ms`,
  throughput: formatComputeRate(workload),
});
const renderRuntimeCompute = (data) => {
  validateRuntimeCompute(data);
  computeDate.textContent = new Date(data.generatedAt).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const renderedRows = data.environments.map((environment) => {
    const tr = document.createElement("tr");
    const runtime = document.createElement("td");
    runtime.className = "workload-runtime";
    const title = document.createElement("strong");
    title.textContent = environment.label;
    const identity = document.createElement("span");
    identity.textContent = environment.status === "measured"
      ? `${environment.environment?.nodeVersion ?? "Node-compatible"} · ${environment.environment?.platform ?? "unknown"}/${environment.environment?.arch ?? "unknown"}`
      : "not measured";
    runtime.append(title, identity);
    tr.append(runtime);
    if (environment.status === "notRun") {
      const reason = document.createElement("td");
      reason.className = "workload-pending workload-unavailable-summary";
      reason.colSpan = computeWorkloadIds.length;
      reason.title = environment.reason;
      reason.textContent = `not measured — ${compactWorkloadReason(environment.reason)}`;
      tr.append(reason);
      return tr;
    }
    for (const workloadId of computeWorkloadIds) {
      const workload = environment.workloads.find((item) => item.id === workloadId);
      const metric = formatComputeMetric(workload);
      const cell = document.createElement("td");
      cell.className = "workload-cell";
      cell.setAttribute("data-workload", computeWorkloadLabels[workloadId]);
      cell.textContent = metric.text;
      const p95 = document.createElement("span");
      p95.className = "workload-p95";
      p95.textContent = metric.detail;
      cell.append(p95);
      const throughput = document.createElement("span");
      throughput.className = "workload-throughput";
      throughput.textContent = metric.throughput;
      cell.append(throughput);
      tr.append(cell);
    }
    return tr;
  });
  computeRows.replaceChildren(...renderedRows);
  const diagnostics = data.diagnostics.workloads.map((workload) => {
    const tr = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = workload.label;
    const interpreter = document.createElement("td");
    interpreter.className = "number";
    interpreter.textContent = `${workload.interpreterMips.toFixed(3)} MIPS`;
    const jit = document.createElement("td");
    jit.className = "number";
    jit.textContent = `${workload.jitMips.toFixed(3)} MIPS`;
    const ratio = document.createElement("td");
    ratio.className = "ratio";
    ratio.textContent = `${workload.ratio.toFixed(3)}×`;
    tr.append(label, interpreter, jit, ratio);
    return tr;
  });
  computeDiagnosticRows.replaceChildren(...diagnostics);
};
const computeBenchmarkRevision = "3a2070175a1b";
fetch(`./runtime-compute-benchmarks.json?rev=${computeBenchmarkRevision}`, { cache: "no-store" }).then((response) => {
  if (!response.ok) throw new Error(`runtime compute data HTTP ${response.status}`);
  return response.json();
}).then(renderRuntimeCompute).catch((error) => {
  computeDate.textContent = "unavailable";
  computeRows.innerHTML = `<tr><td colspan="4" class="workload-pending">Steady-state compute evidence unavailable.</td></tr>`;
  computeDiagnosticRows.innerHTML = `<tr><td colspan="4" class="workload-pending">JIT diagnostic unavailable.</td></tr>`;
  console.error("runtime compute table failed:", error);
});

