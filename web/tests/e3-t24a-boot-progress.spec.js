// E3-T24a live boot-progress surface. The pure model's invariants (monotonic, no fake 99%, stage
// errors, <15% byte divergence) are proven headlessly in e3-t24a-progress.spec.js; this exercises
// the wired surface against a REAL busybox boot: an accessible progressbar that advances monotonically
// with the fetch, stays explicitly indeterminate through the unmeasurable boot-to-login, reaches 100%
// only at the usable prompt (within two seconds of it), and renders a stage-named error on a failed
// fetch instead of spinning forever.
import { expect, test } from "@playwright/test";

test("progress is accessible, monotonic, honest, and completes at the prompt", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#boot-linux")).toBeEnabled();

  // Instrument before boot: sample the bar + note when the prompt and 100% first appear.
  await page.evaluate(() => {
    const bar = document.getElementById("boot-progress-bar");
    const rows = () => document.querySelector("#term .xterm-rows")?.textContent || "";
    const s = { samples: [], readyAt: null, full100At: null, start: performance.now(), sawIndeterminate: false };
    window.__t24 = s;
    const tick = () => {
      const t = performance.now() - s.start;
      const v = Number(bar.getAttribute("aria-valuenow"));
      s.samples.push({ t, v, indet: bar.dataset.indeterminate, ready: bar.dataset.ready });
      if (bar.dataset.indeterminate === "true") s.sawIndeterminate = true;
      if (v >= 100 && s.full100At == null) s.full100At = t;
      if (/busybox userland up/.test(rows()) && s.readyAt == null) s.readyAt = t;
      s.timer = setTimeout(tick, 100);
    };
    tick();
  });

  // Accessibility contract.
  const bar = page.locator("#boot-progress-bar");
  await expect(bar).toHaveAttribute("role", "progressbar");
  await expect(bar).toHaveAttribute("aria-valuemin", "0");
  await expect(bar).toHaveAttribute("aria-valuemax", "100");

  await page.click("#boot-linux");

  // Both artifacts fetch to 100% (existing honest per-role counter), then the bar should sit in the
  // byte-weighted "fetched, now booting" band — advanced but NOT complete, with the login phase shown
  // as explicitly indeterminate (no fabricated creep to 99%).
  await expect(page.locator("#boot-progress")).toContainText("kernel 100%", { timeout: 60_000 });
  await expect(page.locator("#boot-progress")).toContainText("initramfs 100%", { timeout: 60_000 });
  await page.waitForFunction(
    () => Number(document.getElementById("boot-progress-bar").getAttribute("aria-valuenow")) >= 70,
    null,
    { timeout: 60_000 },
  );
  {
    const v = Number(await bar.getAttribute("aria-valuenow"));
    expect(v, "fetched-but-booting band").toBeGreaterThanOrEqual(70);
    expect(v, "must not fake completion before the prompt").toBeLessThan(100);
  }

  // The definitive signal: the usable prompt. Only then may the bar reach 100%.
  await expect(page.locator("#term .xterm-rows")).toContainText("busybox userland up", { timeout: 180_000 });
  await page.waitForFunction(
    () => document.getElementById("boot-progress-bar").dataset.ready === "true",
    null,
    { timeout: 5_000 },
  );

  const data = await page.evaluate(() => {
    clearTimeout(window.__t24.timer);
    return window.__t24;
  });

  // Monotonic: aria-valuenow never regresses.
  for (let i = 1; i < data.samples.length; i += 1) {
    expect(data.samples[i].v).toBeGreaterThanOrEqual(data.samples[i - 1].v);
  }
  expect(data.readyAt, "prompt observed").not.toBeNull();
  expect(data.full100At, "100% observed").not.toBeNull();
  // AC: 100% is reached no MORE than two seconds before the usable prompt (early completion by up to
  // 2s is allowed; a fabricated-early 100% is not). Nothing reaches 100% earlier than that window.
  const earlySamples = data.samples.filter((x) => x.t < data.readyAt - 2_000);
  expect(Math.max(0, ...earlySamples.map((x) => x.v))).toBeLessThan(100);
  expect(data.full100At).toBeGreaterThanOrEqual(data.readyAt - 2_000);
  // …and it does complete at the prompt, not long after (bounded so a stuck bar refutes).
  expect(data.full100At).toBeLessThan(data.readyAt + 5_000);
  // The unmeasurable phases were shown as explicit "working", not a moving number.
  expect(data.sawIndeterminate).toBe(true);
  // Final state is a real 100%.
  expect(Number(await bar.getAttribute("aria-valuenow"))).toBe(100);
});

test("a failed fetch surfaces a stage-named error, not an endless spinner", async ({ page }) => {
  // Block the kernel image so its fetch fails mid-boot.
  await page.route("**/releases/kernel/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#boot-linux")).toBeEnabled();
  await page.click("#boot-linux");

  const bar = page.locator("#boot-progress-bar");
  await expect(bar).toHaveAttribute("data-error", "true", { timeout: 60_000 });
  // Stage-named, not a bare "error" and not the indeterminate spinner.
  await expect(bar).toHaveAttribute("data-indeterminate", "false");
  await expect(page.locator("#boot-progress-label")).toContainText("failed");
  const valuetext = await bar.getAttribute("aria-valuetext");
  expect(valuetext.toLowerCase()).toMatch(/kernel|fetch|engine|manifest/);
});
