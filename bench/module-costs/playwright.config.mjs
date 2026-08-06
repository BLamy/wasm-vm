// E4-T19 cost-matrix Playwright config: three engine projects (Chromium, Firefox, WebKit — the
// Safari substitute) and a static file server rooted at this directory so the harness + its ES module
// generator load same-origin. One `npx playwright test` run produces results/{chromium,firefox,webkit}.json.

import { defineConfig, devices } from "@playwright/test";

const PORT = 8137;

export default defineConfig({
  testDir: ".",
  testMatch: "cost-matrix.spec.mjs",
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    // WebKit is the committed Safari substitute (no macOS CI runner); document.title of the row.
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `npx http-server -p ${PORT} -c-1 --silent .`,
    url: `http://localhost:${PORT}/harness.html`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
