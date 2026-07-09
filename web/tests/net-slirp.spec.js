// E3-net slice 1c: the in-browser end-to-end proof that the slirp LOCAL stack works. Boots the real
// busybox guest with `?slirpNet` (virtio-net → SlirpLocalBackend instead of loopback), configures
// eth0, and pings the gateway 10.0.2.2. A reply can ONLY come from slirp: the default loopback
// backend just echoes the guest's own frames (a swapped-MAC ARP *request*, never a valid reply), so
// the guest never resolves 10.0.2.2 and ping fails. This also exercises the rdtime fix — `ping` reads
// the clock via the vDSO's `rdtime`, which SIGILL'd before the scounteren firmware-seed.
//
// Echo-proof: "bytes from 10.0.2.2" / "packets received" appear only in ping's OUTPUT, not the
// typed command.
import { test, expect } from "@playwright/test";

const rows = "#term .xterm-rows";

test("slirp local stack: guest pings the gateway 10.0.2.2 through slirp in the browser", async ({ page }) => {
  test.setTimeout(240_000);
  const type = (s) => page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);

  await page.goto("/?slirpNet");
  await page.click("#boot-linux");
  await expect(page.locator(rows)).toContainText("busybox userland up", { timeout: 180_000 });
  await expect(page.locator(rows)).toContainText("~ #");

  // Configure eth0 with the slirp guest address and bring it up.
  await type("ip addr add 10.0.2.15/24 dev eth0\r");
  await page.waitForTimeout(1000);
  await type("ip link set eth0 up\r");
  await page.waitForTimeout(1500);

  // Ping the gateway: the guest ARPs 10.0.2.2 → slirp replies as the gateway → ICMP echo/reply.
  // Only slirp produces the reply (loopback can't). (Pre-rdtime-fix this SIGILL'd on the clock read.)
  await type("ping -c 3 -W 2 10.0.2.2\r");
  await expect(page.locator(rows)).toContainText("bytes from 10.0.2.2", { timeout: 30_000 });
});
