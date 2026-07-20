// Tab switching for the demo shell + the Tests-tab "capstone validations by epic" grid.
// Roadmap is the default tab. Switching to Terminal re-fits xterm (its panel was display:none, so
// it couldn't size until now — we reuse the existing Fit button's logic). Tabs deep-link via the URL
// hash so a view can be shared/reloaded.

import { ROADMAP } from "./roadmap.js";

const TABS = ["roadmap", "tests", "terminal", "docker"];

// Under Playwright (navigator.webdriver === true) reveal every panel so the existing element-level
// specs — which click #boot-alpine, #suite-run, etc. by ID — stay actionable no matter which tab is
// "active". Real users are unaffected: the tab bar still works as normal.
if (navigator.webdriver) {
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

// Honor a deep-linked tab on load (default stays Roadmap).
const initial = location.hash.slice(1);
if (TABS.includes(initial) && initial !== "roadmap") show(initial);

// ── Tests tab: capstone validations by epic ─────────────────────────────────
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderCapstones() {
  const grid = document.getElementById("capstone-grid");
  if (!grid) return;
  grid.replaceChildren();
  for (const epic of ROADMAP) {
    if (!epic.caps.length) continue;
    const verified = epic.caps.filter((c) => c.status === "verified").length;
    const card = el("div", `cap-epic ${epic.status === "done" ? "done" : ""}`);

    const head = el("div", "cap-epic-head");
    head.append(
      el("span", "epic-tag", epic.epic),
      el("span", "cap-epic-name", epic.title),
      el("span", "cap-epic-count", `${verified}/${epic.caps.length} proven`),
    );
    card.append(head);

    const dots = el("div", "cap-dots");
    for (const c of epic.caps) {
      const dot = el("button", `cap-dot ${c.status || "pending"}${c.capstone ? " capstone" : ""}`);
      dot.type = "button";
      const label = `${c.capstone ? "★ CAPSTONE — " : ""}${c.name}${c.evidence ? " — " + c.evidence : ""}`;
      dot.title = label;
      dot.setAttribute("aria-label", label);
      // Wire into the shared hover-card if present (nicer than the native tooltip).
      dot.addEventListener("mouseenter", (ev) => showHover(ev, c));
      dot.addEventListener("mouseleave", hideHover);
      dot.addEventListener("focus", (ev) => showHover(ev, c));
      dot.addEventListener("blur", hideHover);
      dots.append(dot);
    }
    card.append(dots);
    grid.append(card);
  }
}

const hoverCard = document.getElementById("hover-card");
function showHover(ev, cap) {
  if (!hoverCard) return;
  document.getElementById("hover-name").textContent =
    (cap.capstone ? "★ " : "") + cap.name;
  const st = document.getElementById("hover-status");
  st.textContent = cap.status || "pending";
  st.className = "hover-status " + (cap.status === "verified" ? "pass" : cap.status === "partial" ? "running" : "");
  document.getElementById("hover-detail").textContent = cap.evidence || "";
  hoverCard.hidden = false;
  const r = ev.target.getBoundingClientRect();
  hoverCard.style.left = Math.min(r.left, window.innerWidth - 340) + "px";
  hoverCard.style.top = r.bottom + 8 + "px";
}
function hideHover() {
  if (hoverCard) hoverCard.hidden = true;
}

renderCapstones();
