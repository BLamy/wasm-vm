// E4-T19 cost-matrix Playwright config: three engine projects (Chromium, Firefox, WebKit — the
// Safari substitute) and a static file server rooted at this directory so the harness + its ES module
// generator load same-origin. One `npx playwright test` run produces results/{chromium,firefox,webkit}.json.

import { defineConfig, devices } from "@playwright/test";

const PORT = 8137;

const projects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  // WebKit is the committed Safari substitute (no macOS CI runner); document.title of the row.
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
];

// Optional robustness screen for a separately installed Chrome. The normal `run.sh` matrix stays
// exactly three pinned projects; setting this path adds one explicitly named result without making
// the clean-checkout command depend on a host-installed browser.
if (process.env.E4_T19_CHROME_EXECUTABLE) {
  projects.push({
    name: "chromium-system",
    use: {
      ...devices["Desktop Chrome"],
      launchOptions: { executablePath: process.env.E4_T19_CHROME_EXECUTABLE },
    },
  });
}

export default defineConfig({
  testDir: ".",
  testMatch: "cost-matrix.spec.mjs",
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}` },
  projects,
  webServer: {
    command: `npx http-server -p ${PORT} -c-1 --silent .`,
    url: `http://localhost:${PORT}/harness.html`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
