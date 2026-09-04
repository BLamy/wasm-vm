// E3-T24c: versioned offline app shell. A service worker that makes the app shell (HTML/JS/wasm/CSS/
// fonts) load offline after one visit, from ONE build-versioned cache, without double-owning the disk
// chunks or the CoW overlay.
//
// Design — RUNTIME caching, not a hardcoded precache list: same-origin app-shell GETs are cached as
// they are fetched (so "the complete app shell after one visit" is exactly what the page loaded), and
// served cache-first with a network fallback. This is robust to build-path differences (dev serves
// ./node_modules/@xterm/…, dist serves ./vendor/xterm/…) — whatever the page actually loads is what
// gets cached.
//
// Ownership boundary (do NOT double-own storage): the SW NEVER caches the large disk artifacts — the
// lazy-fetched chunked image, the kernel/initramfs, or any cross-origin (R2) blob. Those belong to
// the E3-T03 chunk layer (IndexedDB overlay + R2). The SW touches only the small same-origin shell.
//
// Atomic upgrade: the cache name is keyed by BUILD VERSION. `activate` deletes every other
// `wasm-vm-shell-*` cache before claiming clients, so a new build never serves a half-old/half-new
// asset set — a client is either fully on the old cache or fully on the new one.

// Replaced at build time (tools/build-web-dist.sh) with a content hash of the shipped assets; stays
// the literal token in dev (a stable dev version). Changing it ⇒ a new cache namespace ⇒ atomic swap.
const VERSION = "3dd84661a223";
const CACHE = `wasm-vm-shell-${VERSION}`;
const CACHE_PREFIX = "wasm-vm-shell-";

// Same-origin app-shell asset? Excludes the disk artifacts owned by the chunk layer so the SW and the
// E3-T03 store never both hold the same bytes. Cross-origin (R2) is never same-origin → excluded.
function isShellAsset(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false; // R2 chunks / any CDN → passthrough
  const p = url.pathname;
  if (p.includes("/releases/")) return false; // kernel Image / initramfs / rootfs
  if (p.includes("/chunked-alpine") || p.includes("/chunks/") || p.endsWith(".ext4")) return false;
  return true;
}

self.addEventListener("install", () => {
  // No blocking precache — assets are cached on first fetch. Take over ASAP so the very next load is
  // controlled and starts populating the cache.
  self.skipWaiting();
});

// Atomic upgrade primitive: drop every shell cache that is not THIS build's, so a client is never
// served a half-old/half-new asset set. Used by activate() (the real upgrade path) and exposed via a
// message so a controlled client can deterministically verify/trigger the purge.
async function purgeOtherShellCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
  );
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await purgeOtherShellCaches();
      await self.clients.claim();
    })(),
  );
});

// A controlled client can ask the SW to run the same purge (used by the E3-T24c atomic-upgrade test,
// and usable by the app to reclaim space). Replies on the provided MessagePort when done.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "purge-other-shell-caches") {
    event.waitUntil(
      purgeOtherShellCaches().then(() => {
        const port = event.ports && event.ports[0];
        if (port) port.postMessage({ type: "purged", current: CACHE });
      }),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!isShellAsset(req)) return; // passthrough — the network (and the chunk layer) handle it
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit; // offline-first within a build version
      try {
        // Bypass the BROWSER HTTP cache on the network fetch (cache: "reload"). A new build version has
        // an empty SW cache, so this is a miss and we fetch from the network — but a plain fetch(req)
        // would hit the browser's HTTP cache, which Cloudflare populates with a long TTL, so a fresh
        // deploy would re-cache STALE bytes into the new SW cache (the recurring "prod serves the old
        // main.js after deploy" bug). Reloading forces truly-fresh bytes for the app shell.
        const resp = await fetch(new Request(req, { cache: "reload" }));
        // Cache the FULL response (headers intact — AC3) but only a clean 200 (never a 206 range, an
        // opaque, or an error) so a transient failure can't poison the offline shell.
        if (resp && resp.status === 200 && resp.type === "basic") {
          cache.put(req, resp.clone());
        }
        return resp;
      } catch (err) {
        const any = await cache.match(req);
        if (any) return any;
        throw err;
      }
    })(),
  );
});
