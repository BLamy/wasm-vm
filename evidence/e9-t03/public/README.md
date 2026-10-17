# E9-T03 publication proof

Cloudflare production deployment: https://63dc90b8.wasm-vm.pages.dev
Production entry: https://wasm-vm.pages.dev/
Deployed head: `a2ede81361db60bffa62357b22cc9351a011d5b5`.
Public proof harness head: `54a270af`; runtime bytes unchanged from the independently verified code.

`node tools/verify/e9-session-store-browser.mjs --url https://wasm-vm.pages.dev/ --output target/evidence/e9-t03-public-cache-correct` exited 0. The actual public app passes 127/0, two exact reloads, the 96 MiB + tail bounded stream, four renderer crashes, twenty two-tab races, all promoted critic checks, and the retained accelerated factory restore with resumed CPU and fresh physical presentation. The exact favicon404 permitted by AGENTS.md is recorded separately; all other console/page errors are absent. The original profile, trace and coverage remain at the receipt's absolute path. Every file is bound in `recording-receipts.json`.

`check-public-bytes.mjs` independently fetched and SHA-checked 59 published runtime/status files, including every retained GPU worker file, against committed dist. `public-bytes.json` holds all lengths, URLs and digests. The status rebuild changed only task catalogues and the service-worker cache version.

Initial publication-only harness failures are preserved: Wrangler's generated cache prevented the first run from starting; the next run completed product assertions but rejected normal HTTP304 cache revalidations and favicon404. The corrected checker accepts304 only after this fresh profile authenticated that same cached path with a SHA-verified200 body, records each revalidation, and scopes the permitted favicon exception to its exact console location. Persistent-context shutdown owns the browser; its redundant second Browser.close was removed. No product/runtime change or repeated cold clone was needed.

All PRs remain open. Task T04 owns root contents; T05 owns coherent machine restore; T17/T18 own GPU session replay qualification.
