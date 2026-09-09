// E5-T26e — browser composition of the T23d agent Channel, core desktop restore, and T22.
//
// The core owns the atomic guest transaction. This small page-side boundary owns the two host
// prerequisites that cannot live in no-std Rust: a fresh Channel HELLO and the actual
// PresentationController that paints the restored viewport.

function checkedViewport(value) {
  if (!value || !Number.isInteger(value.width) || !Number.isInteger(value.height)
      || value.width < 1 || value.height < 1) {
    throw new RangeError("desktop restore host viewport must contain positive integer dimensions");
  }
  return { width: value.width, height: value.height };
}
function ownedBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new TypeError("desktop restore snapshot must be bytes");
}

/**
 * Restore one desktop envelope through the live host boundaries.
 *
 * `agentChannel.rehandshake()` is the T23d proof point: it resolves only after the new transport's
 * peer HELLO has been decoded and intersected. `controller.confirmAgentHello()` transfers that
 * application-level fact to the core. T22's real PresentationController is cleared and resized
 * before the core commit, so a refusal cannot leave the previous frame visible.
 */
export async function restoreDesktopThroughHost({
  controller,
  agentChannel,
  presentation,
  viewportController = null,
  beforeRestore = null,
}, snapshot, hostViewport) {
  if (!controller || typeof controller.confirmAgentHello !== "function"
      || typeof controller.restoreDesktopSnapshot !== "function") {
    throw new Error("desktop restore controller is unavailable");
  }
  if (!agentChannel || typeof agentChannel.rehandshake !== "function") {
    throw new Error("desktop restore requires the live T23d agent Channel");
  }
  if (!presentation || typeof presentation.setViewport !== "function"
      || typeof presentation.clear !== "function") {
    throw new Error("desktop restore requires the live T22 presentation owner");
  }
  const viewport = checkedViewport(hostViewport);
  const bytes = ownedBytes(snapshot);
  try {
    // Clear before any host resize so a rejected transaction cannot retain a pre-restore frame.
    presentation.clear();
    const appliedViewport = presentation.setViewport(viewport.width, viewport.height);
    const handshake = await agentChannel.rehandshake();
    if (!handshake || agentChannel.state !== "ready") {
      throw new Error("agent Channel did not reach READY after fresh HELLO");
    }
    if (!await controller.confirmAgentHello()) {
      throw new Error("virtio-console rejected the fresh application HELLO");
    }
    // The guest must be running while the fresh HELLO is transported and handled. The page
    // owner can then pause at this exact boundary so the composite restore call is atomic with
    // respect to the executor, without deadlocking the handshake behind a paused guest.
    await beforeRestore?.();
    const report = await controller.restoreDesktopSnapshot(bytes, viewport.width, viewport.height);
    if (!report?.hostViewport
        || report.hostViewport.width !== viewport.width
        || report.hostViewport.height !== viewport.height) {
      throw new Error("desktop restore returned a different host viewport");
    }
    viewportController?.applyCanvasStyle?.();
    return Object.freeze({ report, handshake, appliedViewport });
  } catch (error) {
    // The core performs the device/agent fallback. This covers host-side failures before the core
    // call and keeps the visible T22 surface honest for the next cold boot.
    try { presentation.clear(); } catch { /* preserve the original restore error */ }
    throw error;
  }
}
