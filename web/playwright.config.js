// E2-T21: Playwright config for the browser boot verification. Auto-starts the dev server
// (tools/serve-dev.sh) so `npx playwright test` reproduces the exact cold-start path a user
// hits: streamed fetch → sha256 integrity → wasm instantiate → boot unmodified Linux to the
// busybox shell. Prerequisites (fail loudly if missing, they are NOT built here):
//   1. web/pkg/  — `wasm-pack build crates/wasm --target web` then `cp -r crates/wasm/pkg web/pkg`
//   2. releases/kernel/6.6.63/Image and releases/initramfs/initramfs.cpio.gz (Epic 2 artifacts)
//   3. web/artifacts.json — `bash tools/gen-web-manifest.sh`
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT || "8123");
const nodeBenchmark = process.env.E4T32_NODE_BENCH === "1";
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1" || !nodeBenchmark;

export default defineConfig({
  testDir: "./tests",
  // The in-browser wasm interpreter boots to the shell in ~1–2 min; give the whole spec room.
  timeout: 240_000,
  expect: { timeout: 180_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // E4-T32 compares the user's foreground interaction path. Pin the expensive acceptance matrix
    // to a real headed window so a default-headless invocation cannot share its resumable ledger.
    ...(nodeBenchmark ? { headless: false } : {}),
  },
  // Keep the named project available for task-local acceptance commands. The default suite still
  // runs one browser; callers that need the historical Chrome/Firefox matrix use the dedicated
  // playwright.e4-t22.config.js instead.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `bash ../tools/serve-dev.sh ${PORT}`,
    url: `http://localhost:${PORT}/artifacts.json`,
    // Performance evidence must never inherit an unrelated/stale server on :8123 that lacks the
    // verified local Node-asset route. Ordinary functional specs retain the convenient reuse path.
    reuseExistingServer,
    timeout: 30_000,
  },
});
