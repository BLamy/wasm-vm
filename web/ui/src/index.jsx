// Entry for web/ui.js. Pages opt in with a mount point:
//
//   <div data-wv-ui="site-nav" data-current="app" data-diagnostics>…static fallback…</div>
//   <div data-wv-ui="kit"></div>
//
// The static children stay visible until React renders, so a page without JavaScript (or before
// this module loads) still has working links. Each mounted element gets data-wv-mounted="true".
import "./styles.css";
import { createRoot } from "react-dom/client";
import { UIRoot } from "./components/ui-root.jsx";
import { SiteNav } from "./components/site-nav.jsx";
import { Kit } from "./components/kit.jsx";
import { Launcher } from "./components/launcher.jsx";
import { Workspace } from "./components/workspace.jsx";

const ISLANDS = {
  "site-nav": (el) => <SiteNav current={el.dataset.current} showDiagnostics={el.hasAttribute("data-diagnostics")} />,
  kit: () => <Kit />,
  launcher: () => <Launcher />,
  workspace: () => <Workspace />,
};

export function mountIslands(root = document) {
  const mounted = [];
  for (const el of root.querySelectorAll("[data-wv-ui]")) {
    if (el.dataset.wvMounted) continue;
    const render = ISLANDS[el.dataset.wvUi];
    if (!render) {
      console.warn(`[ui] unknown island "${el.dataset.wvUi}"`);
      continue;
    }
    el.replaceChildren();
    createRoot(el).render(<UIRoot>{render(el)}</UIRoot>);
    el.dataset.wvMounted = "true";
    mounted.push(el.dataset.wvUi);
  }
  return mounted;
}

const mounted = mountIslands();
document.documentElement.dataset.wvUi = mounted.join(" ") || "none";
