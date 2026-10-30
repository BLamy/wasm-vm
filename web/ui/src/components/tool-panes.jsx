// Library tool panes placed inside ide.js's workspace layout.
//
// Each pane renders through a portal into a host element inserted next to the native pane it
// projects (see projection.jsx). Hosts carry .wv-ui and the accent so library styles and the
// isolation guard apply to them; the native panes beside them are hidden by the page CSS in the
// ordinary app and left untouched under ?testHooks.
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { List, tintVars } from "@brett_lamy/ui";
import { ACCENT } from "./ui-root.jsx";
import { ButtonLink } from "./primitives.jsx";
import { ProjectedList, ProjectedTabs, useProjection } from "./projection.jsx";
import { ChecksPanel, RecordingsPanel } from "./recordings.jsx";
import { byId, useDomSnapshot } from "../bridge.js";

function makeHost(name) {
  const host = document.createElement("div");
  host.className = "wv-ui dark wv-proj-host";
  host.dataset.wvHost = name;
  for (const [key, value] of Object.entries(tintVars(ACCENT))) host.style.setProperty(key, String(value));
  return host;
}

// Insert (once) a host relative to a native anchor; re-checks while the anchor may not exist yet.
function useHost(name, place) {
  const [host, setHost] = useState(null);
  useEffect(() => {
    let current = null;
    const ensure = () => {
      if (current?.isConnected) return;
      const next = makeHost(name);
      if (place(next)) {
        current = next;
        setHost(next);
      }
    };
    ensure();
    const timer = setInterval(ensure, 500);
    return () => {
      clearInterval(timer);
      current?.remove();
    };
  }, [name]);
  return host;
}

const sideAnchor = (host) => {
  const side = byId("ide-side");
  if (!side) return false;
  side.prepend(host);
  return true;
};
const editorAnchor = (host) => {
  const area = document.querySelector("#ide-root .ide-editor-area");
  if (!area) return false;
  area.prepend(host);
  host.classList.add("wv-proj-editor-host");
  return true;
};

const explorerSource = () => byId("ide-explorer");
const filesActionsSource = () => document.querySelector("#ide-view-files .ide-files-actions");
const transferSource = () => byId("file-transfer");
const dockerSource = () => byId("ide-dk");
const tabstripSource = () => byId("ide-tabstrip");
const editorToolbarSource = () => document.querySelector("#ide-root .ide-editor-toolbar");

function nextGuestUrl(kind) {
  const url = new URL(location.href);
  for (const key of ["guest", "boot", "os", "noAutoBoot"]) url.searchParams.delete(key);
  url.searchParams.set("guest", kind);
  url.hash = "ide";
  return url.href;
}

// BusyBox has no container runtime. Rather than a wall of disabled controls, say so and offer a
// deliberate restart into an Alpine guest (the page's existing ?guest= contract).
function ContainersNeedAlpine() {
  const machines = JSON.parse(
    useDomSnapshot(
      () => byId("os-launcher"),
      () => JSON.stringify(["node-alpine", "alpine"].filter((os) => {
        const button = document.querySelector(`#os-launcher [data-os="${os}"]`);
        return button && !button.disabled;
      })),
    ),
  );
  return (
    <List inset>
      <List.Section title="Containers" footer="Restarting ends this BusyBox session. Files you created in it are not kept.">
        <List.Row>
          <p className="wv-proj-text" data-tone="muted">
            BusyBox cannot run containers. Containers need an Alpine image that includes the <span className="wv-mono">wvrun</span> runtime,
            and not every host publishes one. After a restart, this pane checks the running image and says whether it can run containers.
          </p>
        </List.Row>
        {machines.includes("node-alpine") ? (
          <List.Row>
            <div className="wv-machine">
              <span className="wv-machine-title">Alpine Linux with Node.js</span>
              <span className="wv-machine-detail">Node.js and npm preinstalled.</span>
              <span className="wv-proj-actions">
                <ButtonLink size="sm" href={nextGuestUrl("node-alpine")}>Restart with Alpine + Node.js</ButtonLink>
              </span>
            </div>
          </List.Row>
        ) : null}
        {machines.includes("alpine") ? (
          <List.Row>
            <div className="wv-machine">
              <span className="wv-machine-title">Alpine Linux</span>
              <span className="wv-machine-detail">Changes are kept in this browser.</span>
              <span className="wv-proj-actions">
                <ButtonLink size="sm" variant="secondary" href={nextGuestUrl("alpine")}>Restart with Alpine Linux</ButtonLink>
              </span>
            </div>
          </List.Row>
        ) : null}
        {machines.length === 0 ? (
          <List.Row>
            <p className="wv-proj-text" data-tone="warn">No Alpine image is published on this host.</p>
          </List.Row>
        ) : null}
      </List.Section>
    </List>
  );
}

function FilesPane() {
  const actions = useProjection(filesActionsSource);
  const tree = useProjection(explorerSource);
  const transfer = useProjection(transferSource);
  return (
    <>
      <ProjectedList blocks={[{ kind: "heading", key: "h:files", text: "Files" }, ...tree, ...actions]} />
      <ProjectedList blocks={transfer} />
    </>
  );
}

function DockerPane() {
  const blocks = useProjection(dockerSource);
  return <ProjectedList blocks={blocks} />;
}

export function SidePane({ side, guestKind }) {
  const host = useHost("side", sideAnchor);
  if (!host || !side) return null;
  const content = side === "files"
    ? <FilesPane />
    : side === "recordings" ? <RecordingsPanel adoptOutput />
    : side === "checks" ? <ChecksPanel />
    : guestKind === "busybox" ? <ContainersNeedAlpine /> : <DockerPane />;
  return createPortal(<div className="wv-proj-side" data-side={side}>{content}</div>, host);
}

export function EditorChrome() {
  const host = useHost("editor", editorAnchor);
  const tabs = useProjection(tabstripSource);
  const toolbar = useProjection(editorToolbarSource);
  if (!host) return null;
  return createPortal(<ProjectedTabs blocks={[...tabs, ...toolbar]} />, host);
}

// Container tabs: ide.js creates one .ide-ctr-panel per opened container. Project its header
// controls above the logs and its exec controls below the exec output.
function ContainerPanel({ panel }) {
  const [hosts, setHosts] = useState(null);
  useEffect(() => {
    const head = makeHost("ctr-head");
    const exec = makeHost("ctr-exec");
    panel.prepend(head);
    panel.querySelector(".ide-ctr-exec")?.append(exec);
    setHosts({ head, exec });
    return () => { head.remove(); exec.remove(); };
  }, [panel]);
  const head = useProjection(useCallback(() => panel.querySelector(".ide-ctr-head"), [panel]));
  const execHead = useProjection(useCallback(() => panel.querySelector(".ide-ctr-exec-head"), [panel]));
  const execForm = useProjection(useCallback(() => panel.querySelector(".ide-ctr-exec-form"), [panel]));
  if (!hosts) return null;
  return (
    <>
      {createPortal(<ProjectedList blocks={head} />, hosts.head)}
      {createPortal(<ProjectedList blocks={[...execHead, ...execForm]} />, hosts.exec)}
    </>
  );
}

const panelIds = new WeakMap();
let nextPanelId = 1;
const panelId = (panel) => {
  if (!panelIds.has(panel)) panelIds.set(panel, nextPanelId++);
  return panelIds.get(panel);
};

export function ContainerPanels() {
  const ids = useDomSnapshot(() => byId("ide-editor-body"), (el) =>
    [...(el?.querySelectorAll(".ide-ctr-panel") ?? [])].map(panelId).join(","), { subtree: false });
  if (!ids) return null;
  const panels = [...byId("ide-editor-body").querySelectorAll(".ide-ctr-panel")];
  return panels.map((panel) => <ContainerPanel key={panelId(panel)} panel={panel} />);
}
