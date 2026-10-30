// Workspace chrome around the running guest: which view is main (terminal or display), which
// tools are open (files, containers, editor), and a Settings sheet for input and network.
//
// The panes themselves are ide.js's real DOM (file tree, container list, editor, xterm, canvas).
// This island never moves or wraps them: it sets data attributes on #ide-root that the page CSS
// uses for layout, and presses ide.js/main.js's own controls. Those nodes stay outside .wv-ui, so
// the isolation guard never touches xterm, the canvas or the legacy panes.
import { useEffect, useRef, useState } from "react";
import {
  Button,
  List,
  Segmented,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetClose,
  Switch,
  Spinner,
} from "@brett_lamy/ui";
import { byId, pressNative, textOf, useDomSnapshot } from "../bridge.js";
import { NetworkSettings } from "./network-settings.jsx";
import { ContainerPanels, EditorChrome, SidePane } from "./tool-panes.jsx";
import { OPEN_INTENT } from "./projection.jsx";

const GUEST_NAMES = {
  busybox: "BusyBox",
  alpine: "Alpine Linux",
  "node-alpine": "Alpine + Node.js",
  omarchy: "Omarchy",
};

const PHONE = "(max-width: 760px)";

function useMedia(query) {
  const [match, setMatch] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatch(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return match;
}

// Layout state lives on #ide-root as data attributes; index.html's workspace CSS reads them.
function setLayout(key, value) {
  const root = byId("ide-root");
  if (!root) return;
  if (value) root.dataset[key] = value;
  else delete root.dataset[key];
  // xterm sizes itself to its pane; refit after the layout change has painted.
  requestAnimationFrame(() => {
    try { window.__term?.fitNow?.(); } catch { /* terminal not created yet */ }
  });
}

function useGuest() {
  return JSON.parse(
    useDomSnapshot(
      () => document.documentElement,
      (html) => {
        const bar = byId("boot-progress-bar");
        const surface = byId("boot-progress-surface");
        return JSON.stringify({
          kind: html.dataset.linuxGuest ?? null,
          status: textOf(byId("ide-sb-guest-txt")),
          ready: byId("ide-sb-dot")?.classList.contains("ready") ?? false,
          progress: surface && !surface.hidden
            ? {
                label: textOf(byId("boot-progress-label")),
                value: Number(bar?.getAttribute("aria-valuenow") ?? 0),
                indeterminate: bar?.dataset.indeterminate === "true",
              }
            : null,
        });
      },
    ),
  );
}

function useDisplayState() {
  return useDomSnapshot(() => byId("ide-display-status"), (el) => el?.dataset.state ?? "none");
}

function useEditorTabs() {
  return Number(useDomSnapshot(() => byId("ide-tabstrip"), (el) => String(el?.children.length ?? 0), { subtree: false }));
}

function GuestStatus({ guest }) {
  const name = GUEST_NAMES[guest.kind] ?? guest.kind ?? "Machine";
  const progress = guest.progress && !guest.ready ? guest.progress : null;
  const label = guest.ready ? "Ready" : progress ? progress.label : guest.status ? guest.status.replace(/^guest /, "") : "Starting";
  return (
    <div className="wv-ws-guest" role="status" aria-live="polite" data-ready={guest.ready ? "true" : "false"}>
      <span className="wv-ws-guest-name">{name}</span>
      <span className="wv-ws-guest-state">
        {guest.ready ? <span className="wv-ws-dot" aria-hidden="true" /> : <Spinner size={14} />}
        <span data-wv="guest-state">{label}</span>
        {progress && !progress.indeterminate ? <span className="wv-ws-pct">{Math.round(progress.value)}%</span> : null}
      </span>
    </div>
  );
}

// Keyboard and pointer: main.js's capture toggles and counters, as readouts and real presses.
function InputSettings() {
  const state = JSON.parse(
    useDomSnapshot(
      () => byId("ide-term-pane"),
      () => JSON.stringify({
        captured: byId("ide-keyboard-state")?.dataset.captured !== "false",
        keyboard: textOf(byId("ide-keyboard-debug")),
        pointer: textOf(byId("ide-pointer-state")),
        pointerDebug: textOf(byId("ide-pointer-debug")),
        pointerToggle: textOf(byId("ide-pointer-toggle")),
        pointerDisabled: Boolean(byId("ide-pointer-toggle")?.disabled),
        microphone: textOf(byId("ide-microphone-state")),
      }),
    ),
  );
  return (
    <>
      <List.Section title="Keyboard" footer={`${state.keyboard}. Keys reach the guest while the terminal or display has focus.`}>
        <List.Row
          title="Send keys to the guest"
          subtitle="Off leaves shortcuts to the browser."
          accessory={<Switch aria-label="Send keys to the guest" checked={state.captured} onChange={() => pressNative("ide-keyboard-toggle")} />}
        />
        <List.Row
          title="Release held keys"
          subtitle="If a modifier seems stuck."
          accessory={<Button variant="secondary" size="sm" onPress={() => pressNative("ide-keyboard-release")}>Release</Button>}
        />
      </List.Section>
      <List.Section title="Pointer" footer={`${state.pointer}. ${state.pointerDebug}. ${state.microphone}.`}>
        <List.Row
          title="Pointer mode"
          subtitle={state.pointerDisabled ? "Needs a guest display." : "Relative locks the pointer."}
          accessory={
            <Button variant="secondary" size="sm" isDisabled={state.pointerDisabled} onPress={() => pressNative("ide-pointer-toggle")}>
              {state.pointerToggle.replace(/^Pointer: /, "") || "absolute"}
            </Button>
          }
        />
      </List.Section>
      <List.Section title="Terminal">
        <List.Row
          title="Clear the screen"
          subtitle="The guest keeps running."
          accessory={<Button variant="secondary" size="sm" onPress={() => pressNative("ide-term-clear")}>Clear</Button>}
        />
      </List.Section>
    </>
  );
}

// Sound: the autoplay state main.js writes to #audio-autoplay-badge, shown here rather than as a
// header banner. Sound still unlocks on the first click or key press anywhere on the page.
function SoundSettings() {
  const sound = JSON.parse(
    useDomSnapshot(
      () => byId("audio-autoplay-badge"),
      (el) => JSON.stringify({ waiting: Boolean(el && !el.hidden), unavailable: el?.dataset.audioState === "unavailable", text: textOf(el) }),
    ),
  );
  const title = sound.unavailable ? "Unavailable" : sound.waiting ? "Muted for now" : "On";
  return (
    <List.Section title="Sound">
      <List.Row title={title} subtitle={sound.waiting ? sound.text : "Guest audio plays through this tab."} />
    </List.Section>
  );
}

function SettingsSheet({ open, onOpenChange, trigger, children }) {
  return (
    <Sheet isOpen={open} onOpenChange={onOpenChange}>
      {trigger}
      <SheetContent side="right" grabber={false} aria-label="Machine settings">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>
        <SheetClose />
        <SheetBody>
          <List inset>
            {children}
            <InputSettings />
            <SoundSettings />
            <NetworkSettings />
          </List>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

const PANES = [
  { id: "files", label: "Files", detail: "Browse and edit the guest's files.", act: "ide-act-files" },
  { id: "containers", label: "Containers", detail: "Images and running containers (Alpine guests).", act: "ide-act-docker" },
  { id: "editor", label: "Editor", detail: "Files and container logs you have open." },
  { id: "recordings", label: "Recordings", detail: "Time travel, replays and saved checkpoints." },
  { id: "checks", label: "Self-checks", detail: "Run the page's own replay and storage checks." },
];
// Panes that occupy the side column on a desktop (and the main area on a phone).
const SIDE_PANES = new Set(["files", "containers", "recordings", "checks"]);

export function Workspace() {
  const phone = useMedia(PHONE);
  const guest = useGuest();
  const display = useDisplayState();
  const tabs = useEditorTabs();
  const [view, setView] = useState("terminal");
  const [side, setSide] = useState(null); // files | containers | null
  const [editor, setEditor] = useState(false);
  const [pane, setPane] = useState(null); // phone: files | containers | editor | null
  const [settings, setSettings] = useState(false);
  const [hint, setHint] = useState(true);
  const previousTabs = useRef(tabs);

  // A restored shell has already printed its prompt before the snapshot was taken, so a new visitor
  // sees only the engine's start-up lines. Say what to do until they run their first command.
  useEffect(() => {
    const pane = byId("ide-term-pane");
    if (!pane || !hint) return undefined;
    const onKey = (event) => { if (event.key === "Enter") setHint(false); };
    pane.addEventListener("keydown", onKey, true);
    return () => pane.removeEventListener("keydown", onKey, true);
  }, [hint, guest.ready]);
  const backRef = useRef(null);

  // Pressing a file or a container in a pane opens it in the editor, whether ide.js creates a new
  // tab or re-activates an existing one (same tab count). On a phone that replaces the pane.
  useEffect(() => {
    const onOpen = () => {
      setEditor(true);
      if (phone) setPane("editor");
    };
    window.addEventListener(OPEN_INTENT, onOpen);
    return () => window.removeEventListener(OPEN_INTENT, onOpen);
  }, [phone]);

  // A tab opened some other way (ide.js itself) still brings the editor into view.
  useEffect(() => {
    if (tabs > previousTabs.current) {
      setEditor(true);
      if (phone) setPane("editor");
    }
    if (tabs === 0) setEditor(false);
    previousTabs.current = tabs;
  }, [tabs, phone]);

  useEffect(() => setLayout("wsView", view), [view]);
  useEffect(() => setLayout("wsSide", phone ? (SIDE_PANES.has(pane) ? pane : null) : side), [side, pane, phone]);
  useEffect(() => setLayout("wsEditor", (phone ? pane === "editor" : editor) ? "open" : null), [editor, pane, phone]);
  useEffect(() => setLayout("wsPane", phone ? pane : null), [pane, phone]);

  // Files and Alpine containers use ide.js's own views (pressing them loads the tree / starts the
  // container poll). BusyBox has no container runtime, so its Containers pane never starts the
  // guest probe that would otherwise write into the shell.
  const openSide = (id) => {
    const target = PANES.find((p) => p.id === id);
    if (id === "containers" && guest.kind === "busybox") return;
    if (target?.act) pressNative(target.act);
  };
  const toggleSide = (id) => {
    if (side === id) return setSide(null);
    openSide(id);
    setSide(id);
  };
  const showPane = (id) => {
    if (id !== "editor") openSide(id);
    setPane(id);
    setSettings(false);
    requestAnimationFrame(() => backRef.current?.focus());
  };

  const chooseView = (next) => {
    setView(next);
    // Choosing the terminal means typing into it next; the display keeps pointer focus.
    if (next === "terminal") requestAnimationFrame(() => window.wvmDemo?.focusTerminal?.());
  };
  const viewChoice = (
    <Segmented
      aria-label="Main view"
      value={view}
      onChange={chooseView}
      options={[
        { id: "terminal", label: "Terminal" },
        { id: "display", label: "Display" },
      ]}
    />
  );

  const settingsButton = (label) => (
    <Button variant="secondary" size="sm" aria-label={label === "Settings" ? undefined : "Tools and settings"}>
      {label}
    </Button>
  );

  const sideOpen = phone ? (SIDE_PANES.has(pane) ? pane : null) : side;
  const panes = (
    <>
      <SidePane side={sideOpen} guestKind={guest.kind} />
      <EditorChrome />
      <ContainerPanels />
    </>
  );

  if (phone && pane) {
    const current = PANES.find((p) => p.id === pane);
    return (
      <div className="wv-ws-bar" data-wv="workspace-bar">
        {panes}
        <Button
          variant="secondary"
          size="sm"
          onPress={() => {
            setPane(null);
            if (view === "terminal") requestAnimationFrame(() => window.wvmDemo?.focusTerminal?.());
          }}
          data-wv="pane-back"
          ref={backRef}
        >
          Back to {view === "display" ? "display" : "terminal"}
        </Button>
        <h2 className="wv-ws-pane-title">{current?.label}</h2>
      </div>
    );
  }

  return (
    <div className="wv-ws-bar" data-wv="workspace-bar">
      {panes}
      <GuestStatus guest={guest} />
      {viewChoice}
      <div className="wv-ws-tools">
        {phone ? null : (
          <>
            <Button variant={side === "files" ? "default" : "ghost"} size="sm" onPress={() => toggleSide("files")} aria-pressed={side === "files"}>
              Files
            </Button>
            <Button variant={side === "containers" ? "default" : "ghost"} size="sm" onPress={() => toggleSide("containers")} aria-pressed={side === "containers"}>
              Containers
            </Button>
            <Button variant={editor ? "default" : "ghost"} size="sm" onPress={() => setEditor(!editor)} aria-pressed={editor}>
              Editor{tabs ? ` (${tabs})` : ""}
            </Button>
            <Button variant={side === "recordings" ? "default" : "ghost"} size="sm" onPress={() => toggleSide("recordings")} aria-pressed={side === "recordings"}>
              Recordings
            </Button>
          </>
        )}
        <SettingsSheet open={settings} onOpenChange={setSettings} trigger={settingsButton(phone ? "Tools" : "Settings")}>
          {phone ? (
            <List.Section title="Open">
              {PANES.map((p) => (
                <List.Row key={p.id} title={p.id === "editor" && tabs ? `${p.label} (${tabs})` : p.label} subtitle={p.detail} accessory="chevron" onPress={() => showPane(p.id)} />
              ))}
            </List.Section>
          ) : (
            <List.Section title="More tools">
              <List.Row
                title="Self-checks"
                subtitle="Run the page's own replay and storage checks."
                accessory="chevron"
                onPress={() => { setSettings(false); setSide("checks"); }}
              />
            </List.Section>
          )}
        </SettingsSheet>
      </div>
      {hint && guest.ready && view === "terminal" && guest.kind !== "omarchy" ? (
        <p className="wv-ws-hint" data-wv="first-use-hint">
          Shell ready. Type a command and press Enter, for example <code className="wv-mono">uname -a</code> or <code className="wv-mono">ls /</code>.
        </p>
      ) : null}
      {view === "display" && display === "none" ? (
        <p className="wv-ws-note" role="note">
          No guest display yet. The Omarchy desktop and other graphical guests draw here; BusyBox and Alpine use the terminal.
        </p>
      ) : null}
    </div>
  );
}
