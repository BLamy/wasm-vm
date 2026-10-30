// First view of the app: one obvious start, other machines one step down.
//
// main.js owns the real launcher: it binds clicks on the native [data-os] buttons, marks them
// disabled after probing each image manifest, writes start/failure messages to
// #os-launcher-status, reads #desktop-graphics when Omarchy starts, and hides #os-launcher once a
// guest is running. Those nodes stay in the page (hidden) and this island operates them.
import { useState } from "react";
import { Button, Disclosure, DisclosurePanel, DisclosureTrigger, List, Segmented, Spinner } from "@brett_lamy/ui";
import { byId, textOf, useDomSnapshot, useNativeValue } from "../bridge.js";
import { ButtonLink } from "./primitives.jsx";
import { ChecksPanel, RecordingsPanel } from "./recordings.jsx";

const OTHER_MACHINES = [
  {
    os: "node-alpine",
    title: "Alpine Linux with Node.js",
    detail: "Node.js and npm preinstalled. Its 512 MiB disk is fetched in pieces as files are read.",
  },
  {
    os: "alpine",
    title: "Alpine Linux",
    detail: "A small Alpine system. Its disk is fetched in pieces; changes are kept in this browser.",
  },
  {
    os: "omarchy",
    title: "Omarchy desktop",
    detail: "A Hyprland desktop with Chromium, LibreOffice, Node.js and Foot. It opens full window from a prepared checkpoint; GPU compositing needs a hardware check.",
  },
];

const nativeButton = (os) => (typeof document === "undefined" ? null : document.querySelector(`#os-launcher [data-os="${os}"]`));

function useMachine(os) {
  return useDomSnapshot(
    () => byId("os-launcher"),
    () => {
      const button = nativeButton(os);
      const meta = document.querySelector(`#os-launcher [data-os-meta="${os}"]`);
      return JSON.stringify({ disabled: Boolean(button?.disabled), state: meta?.dataset.state ?? "ready", note: textOf(meta) });
    },
  );
}

const engineReady = () => document.documentElement.dataset.launcherReady === "true";

// main.js binds the native buttons after it has probed the image manifests. A press before then is
// held and delivered once, as soon as the engine marks itself ready.
function start(os, setLast, setWaiting) {
  setLast(os);
  const deliver = () => {
    const button = nativeButton(os);
    if (button && !button.disabled) button.click();
  };
  if (engineReady()) return deliver();
  setWaiting(true);
  const observer = new MutationObserver(() => {
    if (!engineReady()) return;
    observer.disconnect();
    setWaiting(false);
    deliver();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-launcher-ready"] });
}

const isFailure = (text) => /could not|not available|failed|error/i.test(text);

function MachineRow({ os, title, detail, onStart }) {
  const machine = JSON.parse(useMachine(os));
  const checking = machine.state === "checking";
  const unavailable = machine.disabled && !checking;
  const note = checking ? "Checking whether this image is published…" : unavailable ? "Not published on this host." : null;
  return (
    <List.Row
      align="top"
      accessory={
        <Button variant="secondary" size="sm" isDisabled={machine.disabled} onPress={() => onStart(os)} aria-label={`Start ${title}`}>
          Start
        </Button>
      }
    >
      {/* Row children instead of title/subtitle: the library truncates subtitles to one line, and
          these notes are the honest requirements, so they must wrap. */}
      <div className="wv-machine">
        <span className="wv-machine-title">{title}</span>
        <span className="wv-machine-detail">{detail}</span>
        {note ? <span className="wv-machine-note" data-state={checking ? "checking" : "unavailable"}>{note}</span> : null}
      </div>
    </List.Row>
  );
}

function GraphicsChoice() {
  const [value, write] = useNativeValue("desktop-graphics");
  return (
    <List.Row>
      <div className="wv-launcher-setting">
        <span className="wv-launcher-setting-label" id="wv-graphics-label">Desktop graphics</span>
        <Segmented
          aria-label="Desktop graphics"
          value={value || "gpu"}
          onChange={(next) => write(next)}
          options={[
            { id: "gpu", label: "GPU" },
            { id: "software", label: "Software" },
          ]}
        />
        <span className="wv-launcher-setting-help">
          {value === "software"
            ? "Draws on the CPU from a saved snapshot. No GPU qualification required."
            : "Uses WebGL after a hardware check. Falls back with a clear error if the GPU is unsuitable."}
        </span>
      </div>
    </List.Row>
  );
}

// Shown on the full-window desktop when its GPU start fails; mirrors main.js's recovery links.
function GpuRecovery() {
  const state = JSON.parse(
    useDomSnapshot(
      () => byId("os-launcher"),
      () => {
        const link = (id) => {
          const el = byId(id);
          return el && !el.hidden ? el.getAttribute("href") : null;
        };
        return JSON.stringify({ status: textOf(byId("gpu-status")), software: link("gpu-retry"), cold: link("gpu-cold-retry") });
      },
    ),
  );
  if (!state.status && !state.software && !state.cold) return null;
  return (
    <div className="wv-launcher-recovery" role="group" aria-label="Desktop graphics recovery">
      {state.status ? <p className="wv-launcher-status" data-tone="error">{state.status}</p> : null}
      <div className="wv-launcher-actions">
        {state.software ? <ButtonLink href={state.software}>Restart with software graphics</ButtonLink> : null}
        {state.cold ? <ButtonLink variant="secondary" href={state.cold}>Cold boot with GPU rendering</ButtonLink> : null}
      </div>
    </div>
  );
}

function LazyDisclosure({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure className="wv-launcher-advanced" isExpanded={open} onExpandedChange={setOpen}>
      <DisclosureTrigger level={3}>{title}</DisclosureTrigger>
      <DisclosurePanel>{open ? children() : null}</DisclosurePanel>
    </Disclosure>
  );
}

export function Launcher() {
  const [last, setLast] = useState(null);
  const [waiting, setWaiting] = useState(false);
  // main.js puts the raw error (with a JS stack) in its status line; show the first line only.
  const status = useDomSnapshot(() => byId("os-launcher-status"), (el) =>
    (el?.textContent ?? "").trim().split(/\n|\s+at\s+\S+\s+\(/)[0].replace(/\s+/g, " ").trim(),
  );
  const busybox = JSON.parse(useMachine("busybox"));
  const failed = isFailure(status);
  const starting = waiting || /^Starting /.test(status);
  const begin = (os) => start(os, setLast, setWaiting);

  return (
    <div className="wv-launcher">
      <div className="wv-launcher-lead">
        <h1 className="wv-launcher-title">Linux, running in this tab</h1>
        <p className="wv-launcher-copy">
          A RISC-V computer emulated in WebAssembly. Start a shell and type commands; nothing is installed on your device.
        </p>
        <div className="wv-launcher-actions">
          <Button size="lg" onPress={() => begin("busybox")} isDisabled={busybox.disabled || starting} data-wv="start-linux">
            Start Linux
          </Button>
          <span className="wv-launcher-caption">BusyBox shell · no disk image · restores from a saved snapshot</span>
        </div>
        <p className="wv-launcher-status" role="status" aria-live="polite" data-tone={failed ? "error" : starting ? "busy" : "idle"}>
          {starting ? <Spinner size={14} /> : null}
          <span data-wv="launcher-status">{waiting ? "Loading the emulator…" : failed || starting ? status : ""}</span>
        </p>
        {failed && last ? (
          <div className="wv-launcher-actions">
            <Button variant="secondary" onPress={() => begin(last)}>Try again</Button>
          </div>
        ) : null}
        <GpuRecovery />
      </div>

      <section className="wv-launcher-more" aria-labelledby="wv-other-machines">
        <h2 id="wv-other-machines" className="wv-launcher-subtitle">Other machines</h2>
        <List inset>
          <List.Section>
            {OTHER_MACHINES.map((machine) => (
              <MachineRow key={machine.os} {...machine} onStart={begin} />
            ))}
          </List.Section>
        </List>
        {/* Advanced: only the Omarchy desktop reads this, and the default suits most machines. */}
        <Disclosure className="wv-launcher-advanced">
          <DisclosureTrigger level={3}>Desktop settings</DisclosureTrigger>
          <DisclosurePanel>
            <List inset>
              <List.Section>
                <GraphicsChoice />
              </List.Section>
            </List>
          </DisclosurePanel>
        </Disclosure>
        {/* Optional: saved recordings and checkpoints can be opened before any guest starts. The
            panes mount only while expanded, so a closed section reads nothing. */}
        <LazyDisclosure title="Recordings and time travel">{() => <RecordingsPanel />}</LazyDisclosure>
        <LazyDisclosure title="Self-checks">{() => <ChecksPanel />}</LazyDisclosure>
      </section>
    </div>
  );
}
