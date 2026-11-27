// wvrelay's token format (crates/slirp/src/ws_proxy/relay_security.rs), issued with WebCrypto.
function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function issueToken(secret, origin, nowSecs, ttlSecs) {
  const ttl = Math.min(Math.max(1, ttlSecs), 900);
  const expiry = nowSecs + ttl;
  const id = hex(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `v1\n${expiry}\n${origin}\n${id}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return { token: base64url(new TextEncoder().encode(`${payload}\n${hex(mac)}`)), expiresAt: expiry };
}

