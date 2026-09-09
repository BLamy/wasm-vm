// Tab switching for the demo shell. Roadmap is the default tab. Switching to the IDE re-fits xterm
// (its panel was display:none, so it couldn't size until now). Tabs deep-link via the URL hash so a
// view can be shared/reloaded.
//
// The standalone "Tests" tab was removed: test evidence now lives inside each roadmap ticket
// (see roadmap.js). The in-browser riscv-tests suite machinery still exists in main.js, bound to the
// hidden legacy #panel-tests DOM.
//
// The old top-level Docker tab was folded into the IDE (Docker view + container tabs live in ide.js),
// and Docs is now an in-app tab (a docstream renderer mounts into #docs-mount) instead of a page
// link — so navigating to Docs no longer reloads the SPA and interrupts the background Alpine boot.

const TABS = ["roadmap", "ide", "docs"];

// Under Playwright or the explicit test-hooks URL, reveal every panel so the existing
// element-level specs — which click #suite-run, etc. by ID — stay actionable no matter which tab
// is "active". The in-app browser does not always expose navigator.webdriver, so testHooks is the
// deterministic opt-in for that environment.
if (navigator.webdriver || new URLSearchParams(location.search).has("testHooks")) {
  document.documentElement.classList.add("e2e-showall");
}

function show(tab) {
  if (!TABS.includes(tab)) return;
  for (const b of document.querySelectorAll(".tab")) {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }
  for (const p of document.querySelectorAll(".panel")) {
    p.classList.toggle("active", p.id === `panel-${tab}`);
  }
  if (tab === "ide") {
    // The terminal panel was hidden; let layout settle, then re-fit xterm locally and focus it so
    // keystrokes land immediately. Do not click the manual Fit button here: that button also types
    // `stty rows …` into the guest, which can interleave with a command already running.
    requestAnimationFrame(() => {
      window.__term?.fitNow?.();
      window.__term?.focus?.();
    });
  }
  if (location.hash.slice(1) !== tab) {
    history.replaceState(null, "", `#${tab}`);
  }
}

for (const b of document.querySelectorAll(".tab")) {
  b.addEventListener("click", () => show(b.dataset.tab));
}
window.addEventListener("hashchange", () => show(location.hash.slice(1)));

// Honor a deep-linked tab on load (default stays Roadmap).
const initial = location.hash.slice(1);
if (TABS.includes(initial) && initial !== "roadmap") show(initial);
