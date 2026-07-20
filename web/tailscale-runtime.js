import { createIPN } from "./tailscale-connect/pkg.js";

const DEFAULT_DOH_JSON_ENDPOINT = "https://cloudflare-dns.com/dns-query";

function normalizeSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  return entries.every(([key, item]) => key && typeof item === "string")
    ? Object.fromEntries(entries)
    : {};
}

export function selectExitNode(netMap, configuredId = null) {
  if (typeof configuredId === "string" && configuredId.trim()) return configuredId.trim();
  const candidates = Array.isArray(netMap?.peers) ? netMap.peers.filter((peer) => (
    peer?.exitNodeOption === true && peer?.online !== false && typeof peer?.id === "string" && peer.id
  )) : [];
  candidates.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
  return candidates[0]?.id ?? null;
}

export async function lookupPublicA(
  hostname,
  fetchImpl = globalThis.fetch.bind(globalThis),
  endpoint = DEFAULT_DOH_JSON_ENDPOINT,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    const url = new URL(endpoint);
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", "A");
    const response = await fetchImpl(url.href, {
      headers: { accept: "application/dns-json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`DoH returned HTTP ${response.status}`);
    const message = await response.json();
    const addresses = Array.isArray(message?.Answer) ? message.Answer
      .filter((answer) => answer?.type === 1 && typeof answer.data === "string" &&
        /^(?:\d{1,3}\.){3}\d{1,3}$/.test(answer.data))
      .map((answer) => ({ family: 4, address: answer.data })) : [];
    if (addresses.length === 0) throw new Error("DoH returned no IPv4 address");
    return { addresses };
  } finally {
    clearTimeout(timer);
  }
}

export async function createTailscaleRuntime(config, hooks) {
  const shouldProvision = typeof config.authKey === "string" && config.authKey.length > 0;
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
  let selectedExitNodeId = typeof config.exitNodeId === "string" && config.exitNodeId.trim()
    ? config.exitNodeId.trim()
    : null;
  let selectingExitNode = false;
  return {
    async start() {
      ipn.run({
        notifyState(state) {
          stateName = state;
          hooks.status({ state, netMap });
        },
        notifyNetMap(value) {
          try { netMap = typeof value === "string" ? JSON.parse(value) : value; } catch { netMap = null; }
          if (config.useExitNode && !selectedExitNodeId && !selectingExitNode) {
            const candidate = selectExitNode(netMap);
            if (candidate) {
              selectingExitNode = true;
              void ipn.configure({
                acceptDns: Boolean(config.acceptDns),
                routeAll: true,
                exitNodeId: candidate,
              }).then(() => {
                selectedExitNodeId = candidate;
                hooks.status({ state: stateName, netMap: { ...netMap, selectedExitNodeId } });
              }).catch((error) => {
                hooks.status({ state: "error", detail: `cannot select exit node: ${String(error).slice(0, 240)}` });
              }).finally(() => { selectingExitNode = false; });
            }
          }
          if (netMap && selectedExitNodeId) netMap = { ...netMap, selectedExitNodeId };
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
      // run() initializes LocalBackend but deliberately leaves it in NeedsLogin. A one-time key is
      // consumed only when login() starts registration, so auth-key provisioning must make that
      // transition automatically. Retain only this boolean after createIPN copied the key into Go.
      if (shouldProvision) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        ipn.login();
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
    async lookup(hostname) {
      try {
        return await ipn.lookup(hostname);
      } catch {
        // The browser IPN is authoritative for MagicDNS. Its Go resolver has no OS DNS server in a
        // Worker, so only an IPN lookup failure falls back to browser DoH for public names.
        return lookupPublicA(hostname, undefined, config.dohUrl);
      }
    },
    // The Go runtime lives for the Worker lifetime. Flow closure is handled by the core; Worker
    // termination is the deterministic final release and deliberately does not log the node out.
    dispose: async () => {},
  };
}
