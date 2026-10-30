// Homepage islands. The page's static text lives in landing.html; these render its controls.
import { useEffect, useState } from "react";
import { Button, List, Segmented } from "@brett_lamy/ui";
import { CHOOSER_ROUTE, START_ROUTE } from "../routes.js";
import { textOf, useDomSnapshot } from "../bridge.js";
import { ButtonLink, LinkRow } from "./primitives.jsx";

// One primary action: start the recommended guest. Choosing another machine is secondary.
export function HomeStart() {
  return (
    <div className="wv-home-start">
      <div className="wv-home-actions">
        <ButtonLink size="lg" href={START_ROUTE} data-wv="home-start">Start Linux</ButtonLink>
        <ButtonLink size="lg" variant="ghost" href={CHOOSER_ROUTE}>Choose a machine</ButtonLink>
      </div>
      <p className="wv-home-note">Starts a BusyBox shell from a saved snapshot. Alpine and a graphical desktop are one step away.</p>
    </div>
  );
}

// The architecture model's layer and motion controls. hero-scene.js listens on the figure's own
// [data-layer] buttons and .model-motion (kept in the figure, hidden); these press them, so the
// scene, its caption and its text fallback all respond exactly as before.
export function ModelControls({ host }) {
  const figure = host.closest("figure");
  const state = JSON.parse(
    useDomSnapshot(
      () => figure,
      () => JSON.stringify({
        layers: [...figure.querySelectorAll(".model-controls [data-layer]")].map((b) => ({
          id: b.dataset.layer,
          label: textOf(b).replace(/^\d+\s*/, ""),
          pressed: b.getAttribute("aria-pressed") === "true",
        })),
        motion: (() => {
          const m = figure.querySelector(".model-motion");
          return m && !m.hidden ? { label: textOf(m), pressed: m.getAttribute("aria-pressed") === "true" } : null;
        })(),
      }),
    ),
  );
  const current = state.layers.find((l) => l.pressed)?.id ?? state.layers[0]?.id;
  const press = (selector) => figure.querySelector(selector)?.click();
  return (
    <div className="wv-model-controls">
      <Segmented
        aria-label="Inspect a layer of the machine"
        value={current}
        onChange={(id) => press(`.model-controls [data-layer="${id}"]`)}
        options={state.layers.map((l) => ({ id: l.id, label: l.label }))}
      />
      {state.motion ? (
        <Button variant="ghost" size="sm" aria-pressed={state.motion.pressed} onPress={() => press(".model-motion")} data-wv="model-motion">
          {state.motion.label}
        </Button>
      ) : null}
    </div>
  );
}

// "Try it here": loads the app's embed mode (BusyBox, terminal only) in a frame on request. A
// loaded frame is not reported as a booted guest; the frame itself shows the real console.
export function LiveSession({ host }) {
  const [state, setState] = useState("idle");
  const src = host.dataset.embedSrc;
  return (
    <div className="wv-live">
      <div className="wv-live-header">
        <span>Guest console</span>
        <span role="status" data-wv="live-state">{state === "idle" ? "Not started" : state === "loading" ? "Loading the machine" : "Session open"}</span>
      </div>
      {state === "idle" ? (
        <div className="wv-live-body">
          <p>Runs the same BusyBox machine inside this page. It downloads the boot snapshot when you start it.</p>
          <Button variant="secondary" onPress={() => setState("loading")} data-wv="live-start">Start it here</Button>
        </div>
      ) : (
        <iframe title="wasm-vm guest console" src={src} onLoad={() => setState("open")} />
      )}
    </div>
  );
}

const GUIDES = [
  { href: "./docs.html?page=quickstart", title: "Get started", detail: "Boot a guest and what each machine needs" },
  { href: "./docs.html?page=architecture", title: "How the machine works", detail: "CPU, memory, devices and the browser boundary" },
  { href: "./docs.html?page=embedding", title: "Embed it in your page", detail: "Loader, assets and byte ownership" },
  { href: "./docs.html?page=verification", title: "Check the evidence", detail: "Commands, traces and stated limits" },
  { href: "./roadmap.html", title: "Roadmap", detail: "Every task, with its acceptance record" },
];

export function GuideLinks() {
  return (
    <List inset>
      <List.Section>
        {GUIDES.map((g) => <LinkRow key={g.href} href={g.href} title={g.title} detail={g.detail} />)}
      </List.Section>
    </List>
  );
}

// The measurement tables are static page content filled from the committed JSON by
// landing-benchmarks.js. They stay outside the island; this button shows or hides them
// (collapsed once JavaScript runs, so without it they are simply visible).
export function BenchToggle({ host }) {
  const target = host.dataset.target;
  const [open, setOpen] = useState(() => location.hash === "#benchmarks");
  useEffect(() => {
    const region = document.getElementById(target);
    if (region) region.hidden = !open;
  }, [open, target]);
  return (
    <Button variant="secondary" aria-expanded={open} aria-controls={target} onPress={() => setOpen(!open)} data-wv="bench-toggle">
      {open ? "Hide the measurement tables" : "Show the measurement tables"}
    </Button>
  );
}
