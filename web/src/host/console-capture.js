// E5-T08: host-owned display/serial view switching and bounded canvas recording.
// The view controller changes visibility only; callers continue to deliver every guest frame and
// every serial byte while either face is hidden. The recorder owns the MediaRecorder lifecycle so a
// stop, duration cap, or teardown always stops the captured canvas tracks.

const VIEWS = Object.freeze(["display", "serial"]);
const MIME_TYPES = Object.freeze([
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
]);

function checkedView(view) {
  if (!VIEWS.includes(view)) throw new RangeError(`unknown host view: ${view}`);
  return view;
}

function setVisible(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  element.setAttribute?.("aria-hidden", String(!visible));
  if (element.dataset) element.dataset.visible = String(visible);
}

function setSelected(button, selected) {
  if (!button) return;
  button.setAttribute?.("aria-selected", String(selected));
  button.setAttribute?.("tabindex", selected ? "0" : "-1");
  button.classList?.toggle("active", selected);
}

/**
 * Install the two host view tabs once and keep their state independent of guest execution.
 * `onViewChange` is intentionally called after the DOM state is committed, so focus and evidence
 * callbacks observe one coherent active view.
 */
export function createHostViewController({
  displayPanel,
  serialPanel,
  displayButton,
  serialButton,
  ownerElement = null,
  onViewChange = () => {},
  initialView = "display",
} = {}) {
  if (!displayPanel || !serialPanel) throw new TypeError("host views require display and serial panels");
  checkedView(initialView);

  let activeView = initialView;
  let transitions = 0;
  const registrations = [];

  function snapshot() {
    return {
      activeView,
      transitions,
      listenerCount: registrations.length,
      displayHidden: displayPanel.hidden === true,
      serialHidden: serialPanel.hidden === true,
    };
  }

  function commit(view, reason = "api", countTransition = true) {
    checkedView(view);
    const previousView = activeView;
    if (countTransition && previousView !== view) transitions += 1;
    activeView = view;
    setVisible(displayPanel, view === "display");
    setVisible(serialPanel, view === "serial");
    setSelected(displayButton, view === "display");
    setSelected(serialButton, view === "serial");
    if (ownerElement) ownerElement.textContent = `Keyboard: ${view}`;
    const next = snapshot();
    onViewChange({ ...next, previousView, reason });
    return next;
  }

  function register(button, view) {
    if (!button?.addEventListener) return;
    const listener = () => commit(view, "button");
    button.addEventListener("click", listener);
    registrations.push({ button, listener });
  }

  register(displayButton, "display");
  register(serialButton, "serial");
  commit(initialView, "initial", false);

  return {
    show(view, reason = "api") { return commit(view, reason); },
    toggle(reason = "toggle") { return commit(activeView === "display" ? "serial" : "display", reason); },
    activeView: () => activeView,
    snapshot,
    dispose() {
      for (const { button, listener } of registrations.splice(0).reverse()) {
        button.removeEventListener?.("click", listener);
      }
      setVisible(displayPanel, false);
      setVisible(serialPanel, false);
    },
  };
}

/** Return the first WebM type the current MediaRecorder advertises. */
export function supportedRecordingMimeType(MediaRecorderCtor = globalThis.MediaRecorder) {
  if (typeof MediaRecorderCtor !== "function") return "";
  if (typeof MediaRecorderCtor.isTypeSupported !== "function") return MIME_TYPES[0];
  return MIME_TYPES.find((type) => {
    try { return MediaRecorderCtor.isTypeSupported(type); } catch { return false; }
  }) || "";
}

/**
 * Capture a canvas as WebM with a hard duration cap. The returned result retains the Blob and
 * lifecycle metadata; download and playback are deliberately page-owned concerns.
 */
export function createCanvasRecorder(canvas, {
  frameRate = 30,
  maxDurationMs = 10_000,
  MediaRecorderCtor = globalThis.MediaRecorder,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  onStateChange = () => {},
} = {}) {
  if (!canvas || typeof canvas.captureStream !== "function") {
    throw new TypeError("canvas recording requires captureStream");
  }
  if (typeof MediaRecorderCtor !== "function") {
    throw new Error("MediaRecorder is unavailable");
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) throw new RangeError("frameRate must be positive");
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    throw new RangeError("maxDurationMs must be positive");
  }

  let session = null;
  let lastResult = null;

  function snapshot() {
    return {
      recording: session !== null,
      frameRate,
      maxDurationMs,
      mimeType: session?.mimeType ?? lastResult?.mimeType ?? "",
      startedAt: session?.startedAt ?? lastResult?.startedAt ?? null,
      stopReason: session?.stopReason ?? lastResult?.stopReason ?? null,
      blobSize: session?.chunks.reduce((sum, chunk) => sum + (chunk.size ?? 0), 0)
        ?? lastResult?.blobSize
        ?? 0,
    };
  }

  function stopTracks(stream) {
    for (const track of stream?.getTracks?.() ?? []) {
      try { track.stop?.(); } catch { /* teardown is best-effort */ }
    }
  }

  function start() {
    if (session) throw new Error("canvas recording is already active");
    const stream = canvas.captureStream(frameRate);
    const mimeType = supportedRecordingMimeType(MediaRecorderCtor);
    let recorder;
    try {
      recorder = mimeType
        ? new MediaRecorderCtor(stream, { mimeType })
        : new MediaRecorderCtor(stream);
    } catch (error) {
      stopTracks(stream);
      throw error;
    }
    const chunks = [];
    const startedAt = now();
    let timer = null;
    let resolveFinished;
    let rejectFinished;
    const finished = new Promise((resolve, reject) => {
      resolveFinished = resolve;
      rejectFinished = reject;
    });
    const current = {
      recorder,
      stream,
      chunks,
      mimeType: recorder.mimeType || mimeType || "video/webm",
      startedAt,
      stopReason: "duration-cap",
      finished,
      timer: null,
      rejectFinished,
    };
    session = current;

    const fail = (error) => {
      if (session !== current) return;
      if (timer !== null) clearTimeoutFn(timer);
      session = null;
      stopTracks(stream);
      rejectFinished(error);
      onStateChange({ state: "error", error: error?.message || String(error), snapshot: snapshot() });
    };
    recorder.addEventListener?.("dataavailable", (event) => {
      if (event?.data && event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener?.("error", (event) => {
      fail(event?.error || new Error("MediaRecorder error"));
    });
    recorder.addEventListener?.("stop", () => {
      if (session !== current) return;
      if (timer !== null) clearTimeoutFn(timer);
      session = null;
      stopTracks(stream);
      const blob = new Blob(chunks, { type: current.mimeType });
      const stoppedAt = now();
      const result = {
        blob,
        blobSize: blob.size,
        mimeType: current.mimeType,
        frameRate,
        maxDurationMs,
        startedAt,
        stoppedAt,
        durationMs: Math.max(0, stoppedAt - startedAt),
        stopReason: current.stopReason,
      };
      lastResult = result;
      resolveFinished(result);
      onStateChange({ state: "idle", result, snapshot: snapshot() });
    });
    try {
      recorder.start();
    } catch (error) {
      fail(error);
      throw error;
    }
    current.timer = setTimeoutFn(() => {
      void stop("duration-cap").catch(() => {});
    }, maxDurationMs);
    timer = current.timer;
    onStateChange({ state: "recording", snapshot: snapshot() });
    return snapshot();
  }

  function stop(reason = "manual") {
    if (!session) return Promise.resolve(lastResult);
    const current = session;
    current.stopReason = reason;
    if (current.timer !== null) clearTimeoutFn(current.timer);
    current.timer = null;
    try {
      if (current.recorder.state === "inactive") {
        current.recorder.dispatchEvent?.(new Event("stop"));
      } else {
        current.recorder.stop();
      }
    } catch (error) {
      // A synchronous stop failure must settle the same promise as an asynchronous recorder error.
      if (session === current) {
        session = null;
        stopTracks(current.stream);
        current.rejectFinished(error);
      }
    }
    return current.finished;
  }

  return {
    start,
    stop,
    isRecording: () => session !== null,
    snapshot,
    lastResult: () => lastResult,
    dispose() {
      if (session) void stop("dispose").catch(() => {});
    },
  };
}

export { MIME_TYPES, VIEWS };
