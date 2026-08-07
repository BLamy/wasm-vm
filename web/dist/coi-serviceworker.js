// E4-T22: COOP/COEP header-injection shim for header-less static hosts (e.g. GitHub Pages), which
// cannot set `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` on responses. A service
// worker CAN synthesize those headers on the responses it returns, which is enough to flip
// `crossOriginIsolated` to true — on the SECOND load (the first load registers + activates the SW;
// the page must reload once the SW controls the client). This is the well-known "coi-serviceworker"
// pattern, reimplemented inline (no external dependency; CSP-clean).
//
// Ownership: this SW ONLY rewrites headers to add cross-origin isolation. It does NOT cache — the
// app-shell offline cache is owned by web/sw.js (E3-T24c). The two are registered independently.
//
// Register from the page BEFORE loading the threaded backend, e.g.:
//   import { ensureCrossOriginIsolated } from "./coi-serviceworker-register.js";
// or inline the tiny registration snippet documented in docs/e4-t22-cpu-worker-coop-coep.md.

const COEP_MODE = "require-corp"; // or "credentialless" — require-corp is the strict, portable choice

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  // Let the page ask the SW to deactivate (e.g. a debug escape hatch).
  if (event.data && event.data.type === "coi-deregister") {
    self.registration.unregister().then(() => self.clients.claim());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return; // Chrome constraint

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.status === 0) return response; // opaque — leave as-is

        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Embedder-Policy", COEP_MODE);
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        // Cross-origin subresources (fonts, R2 blobs) need CORP to load under require-corp; the SW
        // can only stamp CORP on responses it can read (same-origin / CORS). Cross-origin assets
        // must be served with their own CORP or fetched with crossorigin — documented in the deploy
        // notes. We do not force it here to avoid masking a genuinely un-embeddable response.
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
      .catch((err) => {
        console.error("[coi-sw] fetch failed", err);
        throw err;
      }),
  );
});
