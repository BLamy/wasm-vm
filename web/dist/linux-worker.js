// E4-T32: the complete WasmLinux machine lives in this worker. It needs neither SharedArrayBuffer
// nor COOP/COEP; console/input and the explicit controller protocol cross postMessage.
import { startLinuxBoot, tailscaleCommand } from "./loader.js";
import { LINUX_WORKER_PROTOCOL_VERSION, createLinuxWorkerRuntime } from "./linux-worker-protocol.js";

// The nested Tailscale transport reports status/storage/flow events through this global callback.
// Relay them to the page that owns the DOM and localStorage policy.
globalThis.__wasmVmTailscaleEvent = (message) => {
  self.postMessage({ type: "tailscale-event", version: LINUX_WORKER_PROTOCOL_VERSION, message });
};

const runtime = createLinuxWorkerRuntime(self, {
  startBoot: (opts) => startLinuxBoot({
    ...opts,
    workerMode: true,
    onDisplayFrame: (frame) => runtime.callbacks?.onDisplayFrame?.(frame),
  }),
  tailscaleCommand,
});
self.addEventListener("messageerror", () => {
  void runtime.fail(new Error("whole-machine worker received an un-clonable message"));
});
