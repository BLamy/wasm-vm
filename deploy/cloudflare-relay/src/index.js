// E5-T43a: wasm-vm's public relay on Cloudflare.
//
//   GET /token   -> { token, expiresAt, ws }   for an allowed Origin only (CORS to that origin)
//   GET /ws      -> WebSocket, forwarded to the wvrelay Container with the browser's Origin
//   GET /health  -> "ok"
//
// The token is wvrelay's own format (crates/slirp/src/ws_proxy/relay_security.rs):
// base64url("v1\n<expiry>\n<origin>\n<id>\n<hex hmac-sha256>"), at most 15 minutes. It is carried
// in the protocol's HELLO, never in a URL. wvrelay checks signature, expiry and that the
// WebSocket's Origin is the token's, and refuses loopback/private/link-local/metadata addresses
// after DNS; per-token stream and byte limits are wvrelay's too.
import { Container, getContainer, switchPort } from "@cloudflare/containers";
import { issueToken } from "./token.js";

export class Relay extends Container {
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      WVRELAY_HMAC_SECRET: env.RELAY_HMAC_SECRET,
      WVRELAY_ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
    };
  }
}

const allowed = (env) => new Set(String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean));

function cors(origin) {
  return { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Cache-Control": "no-store" };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const origins = allowed(env);
    if (url.pathname === "/health") return new Response("ok", { headers: { "Cache-Control": "no-store" } });
    if (url.pathname === "/token") {
      if (!origins.has(origin)) return new Response("origin not allowed", { status: 403, headers: { "Cache-Control": "no-store" } });
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors(origin), "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "600" } });
      if (request.method !== "GET") return new Response("method not allowed", { status: 405, headers: cors(origin) });
      if (!env.RELAY_HMAC_SECRET) return new Response("relay not configured", { status: 503, headers: cors(origin) });
      const t = await issueToken(env.RELAY_HMAC_SECRET, origin, Math.floor(Date.now() / 1000), Number(env.TOKEN_TTL_SECS || 600));
      const ws = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}/ws`;
      return Response.json({ ...t, ws }, { headers: cors(origin) });
    }
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket expected", { status: 426 });
      // (wvrelay verifies the token's origin against this header; an Origin outside the list is
      // refused here too so it never costs a container start.)
      if (!origins.has(origin)) return new Response("origin not allowed", { status: 403 });
      // The runtime checks a port is ready with a plain HTTP request, and wvrelay answers only
      // WebSocket: bring the container up by its responder on 8081 first; once it is healthy the
      // WebSocket goes straight to wvrelay on 8080.
      const relay = getContainer(env.RELAY, env.RELAY_INSTANCE || "relay");
      await relay.startAndWaitForPorts(8081);
      return relay.fetch(switchPort(request, 8080));
    }
    return new Response("not found", { status: 404 });
  },
};
