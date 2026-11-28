// E5-T43a round 4: the Worker's half of the per-client cap. wvrelay caps sessions per value of
// `x-wvrelay-client` (crates/slirp ws_adapter tests); here: two clients get two values, one
// client always the same, and a caller cannot choose its own.
import assert from "node:assert/strict";
import test from "node:test";
import { clientKey, relayHeaders } from "../src/client.js";

const req = (ip, extra = {}) => new Request("https://relay.example/ws", { headers: { "CF-Connecting-IP": ip, ...extra } });

test("IPv4 clients are their address", () => {
  assert.equal(clientKey(req("203.0.113.7")), "203.0.113.7");
  assert.notEqual(clientKey(req("203.0.113.7")), clientKey(req("203.0.113.8")));
});

test("IPv6 clients are their /48, however written", () => {
  for (const ip of ["2001:db8:abcd:12:1:2:3:4", "2001:db8:abcd:ffff::1", "2001:DB8:ABCD::"]) {
    assert.equal(clientKey(req(ip)), "2001:db8:abcd::/48", ip);
  }
  assert.notEqual(clientKey(req("2001:db8:abcd::1")), clientKey(req("2001:db8:abce::1")));
  assert.equal(clientKey(req("2001:db8::1")), "2001:db8:0::/48");
});

test("the relay always gets the Worker's value, never the caller's", () => {
  for (const spoof of ["victim", "", "x".repeat(200), "203.0.113.9"]) {
    const h = relayHeaders(req("198.51.100.4", { "x-wvrelay-client": spoof, "X-Forwarded-For": "1.2.3.4" }));
    assert.equal(h.get("x-wvrelay-client"), "198.51.100.4", JSON.stringify(spoof));
  }
  assert.equal(relayHeaders(req("198.51.100.4")).get("origin"), null, "other headers pass through as sent");
  assert.equal(relayHeaders(new Request("https://r.example/ws", { headers: { Origin: "https://wasm-vm.pages.dev", "CF-Connecting-IP": "198.51.100.4" } })).get("origin"), "https://wasm-vm.pages.dev");
});
