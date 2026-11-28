// Who a request is from, for per-client limits: an IPv4 address, or an IPv6 /48 (a subscriber
// usually holds a /56 or a /48, so a /64 key would give one person hundreds of clients). CF-Connecting-IP is set by Cloudflare and cannot be supplied by
// the caller.
export function clientKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!ip.includes(":")) return ip;
  const full = ip.includes("::")
    ? (() => { const [a, b] = ip.split("::"); const l = a ? a.split(":") : []; const r = b ? b.split(":") : []; return [...l, ...Array(8 - l.length - r.length).fill("0"), ...r]; })()
    : ip.split(":");
  return `${full.slice(0, 3).map((x) => (x || "0").toLowerCase()).join(":")}::/48`;
}

// The headers the relay receives: the caller's, with `x-wvrelay-client` always set from
// CF-Connecting-IP, so a caller's own value never reaches wvrelay.
export function relayHeaders(request) {
  const headers = new Headers(request.headers);
  headers.delete("x-wvrelay-client");
  headers.set("x-wvrelay-client", clientKey(request));
  return headers;
}
