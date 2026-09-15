// Parent-side safety net for one owned detached recorder and its Playwright browser.
// Playwright's POSIX process launcher also uses a new process group for Chrome.
export function watchOwnedTrial(child, { postVerdictCaptureMs = 0, killGroup = pid => process.kill(-pid, "SIGKILL"),
  groupAlive = pid => { try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } },
  now = Date.now, later = setTimeout, cancel = clearTimeout } = {}) {
  if (![0, 180000].includes(postVerdictCaptureMs)) throw Error("invalid fixed post-verdict capture allowance");
  return new Promise(resolve => {
    let timer, terminationTimer, done = false, navigationSeen = false, browserPid = null, recorderClosed = false;
    let watchdog = null;
    const pidValid = pid => Number.isSafeInteger(pid) && pid > 1;
    const settle = result => {
      if (done) return;
      done = true; cancel(timer); cancel(terminationTimer);
      child.removeListener("message", message);
      resolve({ ...result, watchdog });
    };
    const expire = phase => {
      if (watchdog || done) return;
      cancel(timer);
      const targets = [...new Set([browserPid, recorderClosed ? null : child.pid].filter(pidValid))];
      watchdog = { phase, timestamp: new Date(now()).toISOString(), targetGroups: targets, killedGroups: [], errors: [] };
      for (const pid of targets) {
        try { killGroup(pid); watchdog.killedGroups.push(pid); }
        catch (error) { if (error.code !== "ESRCH") watchdog.errors.push(String(error)); }
      }
      // A missing close event is not an invitation to wait forever or start the next arm.
      terminationTimer = later(() => {
        watchdog.unconfirmedGroups = targets.filter(pid => {
          try { return groupAlive(pid); }
          catch (error) { watchdog.errors.push(String(error)); return true; }
        });
        settle({ code: null, signal: null, closed: watchdog.unconfirmedGroups.length === 0 });
      }, 5000);
    };
    const message = value => {
      if (watchdog || done) return;
      if (value?.kind === "input-trial-owned-browser" && pidValid(value.pid) && browserPid === null) browserPid = value.pid;
      else if (value?.kind === "input-trial-browser-exited" && value.pid === browserPid) browserPid = null;
      else if (value?.kind === "input-trial-navigation" && !navigationSeen) {
        navigationSeen = true;
        cancel(timer);
        const started = value.startedAtMs;
        if (!Number.isSafeInteger(started) || started > now()) { expire("invalid-navigation-receipt"); return; }
        // 300 startup +60 typing +120 readback +20 capture +30 cleanup. Never rearm.
        timer = later(() => expire("navigation-through-cleanup"), Math.max(0, started + 530000 + postVerdictCaptureMs - now()));
      }
    };
    child.on("message", message);
    // `exit` can precede `close` when a descendant still holds a stdio pipe.
    // Remember it immediately so a later watchdog cannot signal a recycled recorder PID.
    child.once("exit", () => { recorderClosed = true; });
    child.once("error", error => {
      recorderClosed = true;
      if (browserPid !== null) expire(`recorder-error-before-browser-exit: ${error}`);
      else settle({ error: String(error), code: null, signal: null, closed: false });
    });
    child.once("close", (code, signal) => {
      recorderClosed = true;
      if (watchdog) return; // Confirm killed groups under the bounded termination timer.
      if (browserPid !== null) expire("recorder-closed-before-browser-exit");
      else settle({ code, signal, closed: true });
    });
    // Setup precedes the product startup clock but must not hang indefinitely either.
    timer = later(() => expire("recorder-setup"), 120000);
  });
}
