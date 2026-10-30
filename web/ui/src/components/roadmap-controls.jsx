// Roadmap toolbar and task-detail close, as library controls over roadmap.js's own inputs.
//
// roadmap.js owns the data, filtering, views and task detail: it listens for `input` on
// #rm-search, `change` on #rm-epic / #rm-status and clicks on #rm-view-timeline / #rm-view-board,
// fills the two selects from the published ledger, and closes the detail with .rm-detail-close.
// Those nodes stay in the page (hidden in site.css); these controls write and press them.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, SearchField, Segmented, tintVars } from "@brett_lamy/ui";
import { byId, textOf, useDomSnapshot, useNativeValue } from "../bridge.js";
import { Picker } from "./primitives.jsx";
import { ACCENT } from "./ui-root.jsx";

const ALL = "__all";

function NativeSelect({ id, label }) {
  const [value, write] = useNativeValue(id);
  const options = JSON.parse(
    useDomSnapshot(() => byId(id), (el) => JSON.stringify([...(el?.options ?? [])].map((o) => ({ id: o.value || ALL, label: o.textContent.trim() })))),
  );
  if (options.length === 0) return null;
  return <Picker label={label} options={options} value={value || ALL} onChange={(next) => write(next === ALL ? "" : next)} />;
}

function ViewChoice() {
  const view = useDomSnapshot(() => byId("rm-view-board"), (el) => (el?.getAttribute("aria-selected") === "true" ? "board" : "timeline"));
  return (
    <div className="wv-rm-view">
      <span className="wv-rm-label" id="wv-rm-view-label">View</span>
      <Segmented
        aria-label="Roadmap view"
        value={view}
        onChange={(next) => byId(next === "board" ? "rm-view-board" : "rm-view-timeline")?.click()}
        options={[
          { id: "timeline", label: "Gantt" },
          { id: "board", label: "Kanban" },
        ]}
      />
    </div>
  );
}

function Search() {
  const [value, write] = useNativeValue("rm-search");
  const host = useRef(null);
  // roadmap.js focuses its own (hidden) search on "/"; send that shortcut to this field instead.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "/" || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
      if (!byId("rm-detail")?.hidden) return;
      event.preventDefault();
      requestAnimationFrame(() => host.current?.querySelector("input")?.focus());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="wv-rm-search" ref={host}>
      <span className="wv-rm-label">Search tasks</span>
      <SearchField aria-label="Search tasks" placeholder="Task ID, title or goal" value={value} onChange={(next) => write(next)} />
    </div>
  );
}

// The detail panel is rebuilt by roadmap.js for each task; keep one host at its top while it is open.
function DetailClose() {
  const [host, setHost] = useState(null);
  const open = useDomSnapshot(() => byId("rm-detail"), (el) => String(Boolean(el && !el.hidden)), { subtree: false });
  useEffect(() => {
    const panel = byId("rm-detail");
    if (!panel) return undefined;
    const ensure = () => {
      if (panel.hidden) return;
      let current = panel.querySelector(":scope > [data-wv-host='rm-close']");
      if (!current) {
        current = document.createElement("div");
        current.className = "wv-ui dark wv-proj-host wv-rm-close-host";
        current.dataset.wvHost = "rm-close";
        for (const [key, value] of Object.entries(tintVars(ACCENT))) current.style.setProperty(key, String(value));
        panel.prepend(current);
      }
      setHost((previous) => (previous === current ? previous : current));
    };
    ensure();
    const observer = new MutationObserver(ensure);
    observer.observe(panel, { childList: true, attributes: true, attributeFilter: ["hidden"] });
    return () => observer.disconnect();
  }, []);
  if (open !== "true" || !host?.isConnected) return null;
  const title = textOf(byId("rm-detail")?.querySelector(".rm-detail-title"));
  return createPortal(
    <Button variant="secondary" size="sm" onPress={() => byId("rm-detail")?.querySelector(".rm-detail-close")?.click()} aria-label={title ? `Close ${title}` : "Close task details"} data-wv="rm-close">
      Close
    </Button>,
    host,
  );
}

export function RoadmapControls() {
  return (
    <div className="wv-rm-toolbar">
      <ViewChoice />
      <Search />
      <NativeSelect id="rm-epic" label="Epic" />
      <NativeSelect id="rm-status" label="Status" />
      <DetailClose />
    </div>
  );
}
