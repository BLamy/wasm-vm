// One boot-owned, lazy adapter over the unchanged desktop agent transport.
import { createDesktopAgentBridge } from "./desktop-agent-bridge.js";
import { DisconnectedError } from "./agent-channel.js";

export function createDesktopAgentSession({ request, isCurrent, onError = null,
  createBridge = createDesktopAgentBridge } = {}) {
  if (!request || typeof request.key !== "string" || !Number.isSafeInteger(request.generation)
      || request.generation < 1 || typeof isCurrent !== "function") {
    throw new TypeError("desktop agent session requires an owned boot request");
  }
  const automatic = request.key !== "omarchy";
  let controller = null;
  let bridge = null;
  let closed = false;
  const pending = []; // CLI-only, before the controller exists; never retained for lazy Omarchy.
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});

  function close(reason = "desktop agent session retired") {
    if (closed) return false;
    closed = true;
    pending.length = 0;
    rejectReady(new DisconnectedError(String(reason)));
    bridge?.close(reason);
    return true;
  }
  function current() {
    if (closed) return false;
    if (isCurrent()) return true;
    close("desktop agent session no longer owns this boot");
    return false;
  }
  function activate() {
    if (!current()) throw new DisconnectedError("desktop agent session is retired");
    if (!controller) throw new DisconnectedError("desktop agent controller is not attached");
    if (!bridge) {
      try {
        // Fence even reconnects and writes already scheduled by Channel. Never resolve the
        // controller dynamically through a global that can belong to a different generation.
        bridge = createBridge({
          sendAgentInput(bytes) {
            if (!current()) return Promise.reject(new DisconnectedError("desktop agent session is retired"));
            return controller.sendAgentInput(bytes);
          },
        }, { onError });
        bridge.channel.ready.then(resolveReady, rejectReady);
        bridge.start();
        for (const bytes of pending.splice(0)) bridge.receive(bytes);
      } catch (error) {
        close("desktop agent startup failed");
        throw error;
      }
    }
    return bridge.channel;
  }

  // Property/availability reads are passive, including .ready. Consumers explicitly start,
  // waitUntilReady, rehandshake, send/ping, or subscribe (ClipboardService.start does this).
  // The facade stays bound to this session even if a caller retains it after a later boot.
  const channel = {
    get state() { return current() ? bridge?.channel.state ?? "idle" : "closed"; },
    get ready() { return ready; },
    get negotiated() { return current() ? bridge?.channel.negotiated ?? null : null; },
    get negotiatedVersion() { return channel.negotiated?.version ?? null; },
    get negotiatedCapabilities() { return channel.negotiated?.capabilities ?? 0n; },
    get transportGeneration() { return current() ? bridge?.channel.transportGeneration ?? 0 : 0; },
    get pendingCount() { return current() ? bridge?.channel.pendingCount ?? 0 : 0; },
    get maxPending() { return bridge?.channel.maxPending ?? 1024; },
    get lastError() { return bridge?.channel.lastError ?? null; },
    get transportListenerCount() { return current() ? bridge?.channel.transportListenerCount ?? 0 : 0; },
    supports(capability) { return current() && (bridge?.channel.supports(capability) ?? BigInt(capability) === 0n); },
    listenerCount(type) { return current() ? bridge?.channel.listenerCount(type) ?? 0 : 0; },
    start() { activate(); return channel; },
    async waitUntilReady() { return activate().waitUntilReady(); },
    async rehandshake() { return activate().rehandshake(); },
    async send(...args) { return activate().send(...args); },
    async ping(...args) { return activate().ping(...args); },
    subscribe(type, listener) { return activate().subscribe(type, listener); },
    subscribeState(listener) { return activate().subscribeState(listener); },
    close,
    destroy: close,
  };
  return {
    channel,
    isCurrent: current,
    attach(nextController) {
      if (!current()) return false;
      if (!nextController || typeof nextController.sendAgentInput !== "function") {
        throw new TypeError("desktop agent session requires sendAgentInput");
      }
      if (controller && controller !== nextController) throw new Error("desktop agent session cannot change controller");
      controller = nextController;
      if (automatic) activate();
      return true;
    },
    receive(value) {
      if (!current()) return 0;
      if (bridge) return bridge.receive(value);
      if (!automatic) return 0; // No copy, bridge construction, timers, or hidden pending queue.
      const bytes = value instanceof Uint8Array ? value.slice() : Uint8Array.from(value || []);
      if (!bytes.byteLength) return 0;
      pending.push(bytes);
      if (pending.length > 128) pending.shift();
      return bytes.byteLength;
    },
    close,
  };
}
