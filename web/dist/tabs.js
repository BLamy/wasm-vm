// Tab switching for the demo shell. Roadmap is the default tab. Switching to Terminal re-fits
// xterm (its panel was display:none, so it couldn't size until now — we reuse the existing Fit
// button's logic). Tabs deep-link via the URL hash so a view can be shared/reloaded.
//
// The standalone "Tests" tab was removed: test evidence now lives inside each roadmap ticket
// (see roadmap.js — Verification log / Acceptance criteria per issue). The in-browser riscv-tests
// suite machinery still exists in main.js, bound to the hidden legacy #panel-tests DOM.

const TABS = ["roadmap", "terminal", "docker"];

// Under Playwright (navigator.webdriver === true) reveal every panel so the existing element-level
// specs — which click #boot-alpine, #suite-run, etc. by ID — stay actionable no matter which tab is
// "active". Real users are unaffected: the tab bar still works as normal.
if (navigator.webdriver) {
  document.documentElement.classList.add("e2e-showall");
}

// The Docker tab is GATED on the guest being booted+ready (Alpine auto-boots in the background on
// load). Until then the tab is locked; direct hash navigation is also blocked.
function guestReady() {
  return !!(window.wvmDemo && window.wvmDemo.isGuestReady && window.wvmDemo.isGuestReady());
}
function updateDockerGate() {
  const ready = guestReady();
  const btn = document.querySelector('.tab[data-tab="docker"]');
  if (!btn) return;
  btn.classList.toggle("locked", !ready);
  btn.setAttribute("aria-disabled", ready ? "false" : "true");
  btn.title = ready ? "" : "Booting Alpine in the background… the Docker tab unlocks when the guest is ready.";
  // If the guest went away while Docker was showing, fall back to the IDE/Terminal tab.
  if (!ready && document.querySelector('.tab[data-tab="docker"]')?.classList.contains("active")) {
    show(TABS.includes("ide") ? "ide" : "terminal");
  }
}
window.addEventListener("wvm:guest-ready", updateDockerGate);
window.addEventListener("wvm:guest-booting", updateDockerGate);

function show(tab) {
  if (!TABS.includes(tab)) return;
  if (tab === "docker" && !guestReady()) return; // gated until the guest is up
  for (const b of document.querySelectorAll(".tab")) {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }
  for (const p of document.querySelectorAll(".panel")) {
    p.classList.toggle("active", p.id === `panel-${tab}`);
  }
  if (tab === "terminal") {
    // The terminal panel was hidden; let layout settle, then re-fit xterm via the Fit button
    // and focus it so keystrokes land immediately (xterm ignores input unless focused, and a
    // display:none panel can't hold focus — so it must be re-focused every time it's shown).
    requestAnimationFrame(() => {
      document.getElementById("term-fit")?.click();
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

// Locked-tab styling (injected so we don't depend on index.html CSS).
const gateStyle = document.createElement("style");
gateStyle.textContent = ".tab.locked{opacity:.45;cursor:not-allowed;position:relative}.tab.locked::after{content:'🔒';font-size:.7em;margin-left:5px;opacity:.8}";
document.head.appendChild(gateStyle);
updateDockerGate();

// Honor a deep-linked tab on load (default stays Roadmap). A deep-linked #docker is honored only once
// the guest is ready (updateDockerGate + the show() gate handle the wait).
const initial = location.hash.slice(1);
if (TABS.includes(initial) && initial !== "roadmap") show(initial);
