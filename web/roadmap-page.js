// The canonical task renderer owns data, filtering, views and evidence. This
// standalone public host supplies navigation and accessibility around it. Its visible toolbar
// and the detail Close are library controls (ui.js roadmap-controls) over these native inputs.
import "./roadmap.js";

const lanes = document.getElementById("rm-lanes");
const detail = document.getElementById("rm-detail");
const scrim = document.getElementById("roadmap-scrim");
const tabs = [...document.querySelectorAll(".rm-vt")];
let opener = null;
let detailOpen = false;

function enhanceView() {
  const active = tabs.find(tab => tab.getAttribute("aria-selected") === "true");
  if (active) lanes.setAttribute("aria-labelledby", active.id);
  tabs.forEach(tab => { tab.tabIndex = tab === active ? 0 : -1; });
  lanes.setAttribute("aria-busy", String(lanes.childElementCount === 0));
  lanes.querySelectorAll(".rm-gantt,.rm-board,.rm-col-body").forEach(region => {
    region.tabIndex = 0;
    region.setAttribute("role", "region");
    const label = region.classList.contains("rm-gantt") ? "Task activity Gantt, scroll horizontally and vertically" : region.classList.contains("rm-board") ? "Kanban status columns, scroll horizontally" : `${region.closest(".rm-col")?.querySelector(".rm-col-label")?.textContent || "Task"} cards, scroll vertically`;
    region.setAttribute("aria-label", label);
  });
  lanes.querySelectorAll(".rm-g-epic-head").forEach(button => {
    button.setAttribute("aria-expanded", String(button.querySelector(".rm-caret")?.textContent === "▼"));
  });
  lanes.querySelectorAll(".rm-g-label").forEach(button => {
    button.title = button.textContent;
    button.setAttribute("aria-label", `${button.textContent}. Open task details and evidence`);
  });
}
new MutationObserver(enhanceView).observe(lanes, { childList: true });
document.querySelector(".rm-viewtoggle").addEventListener("keydown", event => {
  const current = tabs.indexOf(document.activeElement);
  if (current < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  tabs[next].click();
});

document.addEventListener("click", event => {
  if (!detail.hidden) return;
  const button = event.target.closest(".rm-card,.rm-g-label,.rm-g-bar,.rm-sub-ctx");
  if (button) opener = button.matches("button") ? button : button.closest(".rm-g-row")?.querySelector(".rm-g-label");
}, true);
new MutationObserver(() => {
  const open = !detail.hidden;
  scrim.hidden = !open;
  document.querySelectorAll("main,.site-header,.footer-inner").forEach(surface => { surface.inert = open; });
  document.body.classList.toggle("roadmap-detail-open", open);
  const title = detail.querySelector(".rm-detail-title");
  if (title) { title.id = "roadmap-detail-title"; detail.setAttribute("aria-labelledby", title.id); }
  if (detailOpen && !open) { (opener?.isConnected ? opener : document.getElementById("rm-search")).focus(); }
  detailOpen = open;
}).observe(detail, { attributes: true, attributeFilter: ["hidden"], childList: true });
scrim.addEventListener("click", () => detail.querySelector(".rm-detail-close")?.click());
document.addEventListener("keydown", event => {
  if (detail.hidden) return;
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); detail.querySelector(".rm-detail-close")?.click(); return; }
  if (event.key !== "Tab") return;
  // Only visible controls: the native close stays in the panel (hidden) for roadmap.js, while the
  // library Close (ui.js) is the one people use.
  const controls = [...detail.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(el => el.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}, true);

enhanceView();
