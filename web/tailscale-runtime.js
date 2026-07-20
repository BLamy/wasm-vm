import { createIPN } from "./tailscale-connect/pkg.js";

function normalizeSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  return entries.every(([key, item]) => key && typeof item === "string")
    ? Object.fromEntries(entries)
    : {};
}

export async function createTailscaleRuntime(config, hooks) {
  const state = new Map(Object.entries(normalizeSnapshot(config.state)));
  const emitState = () => hooks.storageUpdate(Object.fromEntries(state));
  const stateStorage = {
    getState: (key) => state.get(key) ?? "",
    setState: (key, value) => {
      state.set(key, value);
      emitState();
    },
  };
  const ipnConfig = {
    stateStorage,
    authKey: typeof config.authKey === "string" ? config.authKey : "",
    controlURL: typeof config.controlUrl === "string" ? config.controlUrl : undefined,
    hostname: typeof config.hostname === "string" ? config.hostname : undefined,
    wasmURL: new URL(config.wasmUrl ?? "./tailscale-connect/main.wasm", import.meta.url).href,
    panicHandler: (error) => hooks.status({ state: "error", detail: String(error).slice(0, 300) }),
  };
  const ipn = await createIPN(ipnConfig);
  delete ipnConfig.authKey;
  delete config.authKey;

  let netMap = null;
  let stateName = "NoState";
  return {
    async start() {
      ipn.run({
        notifyState(state) {
          stateName = state;
          hooks.status({ state, netMap });
        },
        notifyNetMap(value) {
          try { netMap = typeof value === "string" ? JSON.parse(value) : value; } catch { netMap = null; }
          hooks.status({ state: stateName, netMap });
        },
        notifyBrowseToURL(loginUrl) { hooks.status({ state: stateName, loginUrl }); },
        notifyPanicRecover(error) { hooks.status({ state: "error", detail: String(error).slice(0, 300) }); },
      });
      if (config.acceptDns || config.useExitNode || config.exitNodeId) {
        await ipn.configure({
          acceptDns: Boolean(config.acceptDns),
          routeAll: Boolean(config.useExitNode),
          exitNodeId: config.exitNodeId ?? null,
        });
      }
    },
    login: () => ipn.login(),
    logout() {
      ipn.logout();
      state.clear();
      emitState();
    },
    dialTCP: (host, port, timeoutMs) => ipn.dialTCP(host, port, timeoutMs),
    dialUDP: (host, port, timeoutMs) => ipn.dialUDP(host, port, timeoutMs),
    lookup: (hostname) => ipn.lookup(hostname),
    // The Go runtime lives for the Worker lifetime. Flow closure is handled by the core; Worker
    // termination is the deterministic final release and deliberately does not log the node out.
    dispose: async () => {},
  };
}
