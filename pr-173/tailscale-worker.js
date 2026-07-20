import { TailscaleWorkerCore } from "./tailscale-worker-core.js";

async function loadRuntime(config, hooks) {
  const moduleUrl = new URL(config.runtimeModuleUrl ?? "./tailscale-runtime.js", self.location.href);
  if (moduleUrl.origin !== self.location.origin) {
    throw new Error("Tailscale runtime module must be same-origin");
  }
  delete config.runtimeModuleUrl;
  const module = await import(moduleUrl.href);
  return module.createTailscaleRuntime(config, hooks);
}

const core = new TailscaleWorkerCore({
  post: (message, transfer) => self.postMessage(message, transfer ?? []),
  loadRuntime,
});

self.addEventListener("message", (event) => {
  void core.accept(event.data);
});

self.addEventListener("messageerror", () => {
  core.fail("protocol", "Worker received an invalid structured-clone message");
});
