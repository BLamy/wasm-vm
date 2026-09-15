// Recorder-only lifecycle seams. Synthetic tests exercise races without launching Chrome/guests.
export async function boundedCliStep(action, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function finishCliRecording({ report, run, deadlineAt, captureFailure,
  closeBrowser, closeServer, writeReport, cleanupTimeoutMs = 5000, serverTimeoutMs = 7000,
  now = Date.now }) {
  // A late continuation must never change a timed-out run back to PASS, including while an
  // asynchronous failure screenshot or report write is in progress.
  let verdict = report.result;
  Object.defineProperty(report, "result", { enumerable: true, configurable: false,
    get: () => verdict,
    set: (next) => { if (verdict !== "FAIL") verdict = next; },
  });
  let failure = null;
  function fail(error) {
    report.result = "FAIL";
    failure ??= error instanceof Error ? error : new Error(String(error));
    report.error ??= failure.stack || String(failure);
  }
  report.cleanup = {};
  async function cleanup(name, action, timeoutMs) {
    const entry = report.cleanup[name] = { confirmed: false };
    try {
      if (await boundedCliStep(action, timeoutMs, name) !== true) {
        throw new Error(`${name} cleanup was not confirmed`);
      }
      entry.confirmed = true;
    } catch (error) {
      entry.error = String(error);
      fail(error);
    }
  }
  try {
    const remaining = deadlineAt - now();
    if (remaining <= 0) throw new Error("CLI regression exceeded five-minute deadline");
    await boundedCliStep(run, remaining, "CLI regression five-minute deadline");
    if (now() >= deadlineAt) throw new Error("CLI regression exceeded five-minute deadline");
  } catch (error) {
    fail(error);
    await cleanup("failureScreenshot", captureFailure, cleanupTimeoutMs);
  } finally {
    // Separate bounded steps: a failed/hung screenshot or browser close cannot skip the server.
    try { await cleanup("browser", closeBrowser, cleanupTimeoutMs); }
    finally { await cleanup("serverGroup", closeServer, serverTimeoutMs); }
  }
  report.result = failure ? "FAIL" : "PASS";
  report.finishedAt = new Date(now()).toISOString();
  await writeReport(report);
  if (failure) throw failure;
}

export async function stopCliServerGroup(child, closed, {
  signal = process.kill, timeoutMs = 5000, killTimeoutMs = 1000, pollMs = 25,
} = {}) {
  if (!child) return true; // A pre-existing server is never ours to signal.
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    throw new Error("owned server has no valid process-group ID");
  }
  let childClosed = false;
  void closed.then(() => { childClosed = true; });
  const groupExists = () => {
    try { signal(-child.pid, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; throw error; }
  };
  const send = (kind) => {
    try { signal(-child.pid, kind); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const waitGone = async (duration) => {
    const deadline = Date.now() + duration;
    do {
      if (!groupExists() && childClosed) return true;
      await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
    } while (Date.now() < deadline);
    return !groupExists() && childClosed;
  };
  try {
    // Check the group even when its original shell exited or child.killed is already true.
    send("SIGTERM");
    if (await waitGone(timeoutMs)) return true;
    send("SIGKILL");
    if (await waitGone(killTimeoutMs)) return true;
    throw new Error("owned server process-group cleanup unconfirmed after SIGKILL");
  } catch (error) {
    // Do not keep the recorder alive solely through failed cleanup's inherited pipe handles.
    child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
    throw error;
  }
}
