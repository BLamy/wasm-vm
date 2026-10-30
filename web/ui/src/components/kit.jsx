import { useState } from "react";
import { Badge, Button, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogAction, List } from "@brett_lamy/ui";
import { SiteNav } from "./site-nav.jsx";
import { ButtonLink, SettingSwitch, Choice, Picker, Field } from "./primitives.jsx";
import { RouteList } from "./route-index.jsx";

const SWATCHES = [
  ["--background", "Page"],
  ["--card", "Raised surface"],
  ["--foreground", "Text"],
  ["--muted-foreground", "Secondary text"],
  ["--border", "Rule"],
  ["--primary", "Accent"],
  ["--destructive", "Destructive"],
  ["--success", "Success"],
];

const MACHINES = [
  { id: "busybox", label: "BusyBox shell" },
  { id: "alpine", label: "Alpine Linux" },
  { id: "desktop", label: "Graphical desktop" },
];

// The reference page for the shared controls. Every control here is a library component; the page
// exists so a reviewer can see and operate each one without booting a guest.
export function Kit() {
  const [network, setNetwork] = useState(true);
  const [persist, setPersist] = useState(false);
  const [speed, setSpeed] = useState("auto");
  const [machine, setMachine] = useState("busybox");
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState("");

  return (
    <div className="wv-page">
      <header className="wv-page-header">
        <div className="wv-wrap">
          <SiteNav current="kit" showDiagnostics />
        </div>
      </header>
      <main className="wv-wrap wv-kit">
        <section className="wv-type-specimen" aria-labelledby="kit-title">
          <h1 id="kit-title">Interface kit</h1>
          <p className="wv-prose">
            The controls every wasm-vm page is built from. They come from <span className="wv-mono">@brett_lamy/ui</span>,
            themed with one warm ink palette and a single accent. See the <a href="./docs.html">documentation</a> for
            how the machine works.
          </p>
        </section>

        <section aria-labelledby="kit-actions">
          <h2 id="kit-actions">Actions</h2>
          <div className="wv-kit-row">
            <Button onPress={() => setConfirmed("Primary action pressed")}>Start machine</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Discard</Button>
            <ButtonLink variant="secondary" href="./docs.html">Read the docs</ButtonLink>
            <DialogTrigger>
              <Button variant="secondary">Open dialog</Button>
              <DialogContent size="alert" role="alertdialog">
                <DialogHeader>
                  <DialogTitle>Reset this machine?</DialogTitle>
                  <DialogDescription>The disk returns to its first-boot state. Saved files are lost.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogAction variant="cancel">Cancel</DialogAction>
                  <DialogAction variant="destructive" onPress={() => setConfirmed("Reset confirmed")}>Reset</DialogAction>
                </DialogFooter>
              </DialogContent>
            </DialogTrigger>
            <Badge variant="outline">Badge</Badge>
          </div>
          <p role="status" aria-live="polite" data-wv="kit-status">{confirmed}</p>
        </section>

        <div className="wv-kit-grid">
          <section aria-labelledby="kit-settings">
            <h2 id="kit-settings">Settings</h2>
            <List inset>
              <List.Section footer="Rows toggle when pressed anywhere.">
                <SettingSwitch title="Network" detail="Reach the internet through the browser" checked={network} onChange={setNetwork} />
                <SettingSwitch title="Keep disk changes" detail="Store writes in this browser" checked={persist} onChange={setPersist} />
              </List.Section>
            </List>
          </section>

          <section aria-labelledby="kit-choices">
            <h2 id="kit-choices">Choices</h2>
            <div className="wv-type-specimen">
              <Choice
                label="Execution speed"
                value={speed}
                onChange={setSpeed}
                options={[
                  { id: "auto", label: "Automatic" },
                  { id: "interp", label: "Interpreter" },
                  { id: "jit", label: "JIT" },
                ]}
              />
              <Picker label="Machine" options={MACHINES} value={machine} onChange={setMachine} description="What boots when you press Start." />
              <Field label="Machine name" value={name} onChange={setName} description="Shown in the session list." />
              <p className="wv-mono" data-wv="kit-values">
                speed={speed} machine={machine} network={String(network)} persist={String(persist)} name={name || "-"}
              </p>
            </div>
          </section>
        </div>

        <section aria-labelledby="kit-colors">
          <h2 id="kit-colors">Color</h2>
          <div className="wv-kit-swatches">
            {SWATCHES.map(([token, label]) => (
              <div className="wv-swatch" key={token}>
                <div className="wv-swatch-chip" style={{ background: `var(${token})` }} />
                <div className="wv-swatch-label">
                  <span>{label}</span>
                  <span className="wv-mono wv-muted">{token}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="kit-routes">
          <h2 id="kit-routes">Diagnostic pages</h2>
          <RouteList />
        </section>
      </main>
    </div>
  );
}
