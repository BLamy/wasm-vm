// Recordings (time travel and saved sessions) and self-checks, as optional library panes.
//
// main.js mounts the real controllers on the native panels in web/index.html:
// session-timeline.js on #session-timeline ([data-timeline=…]), session-library.js on
// #session-library ([data-session=…]), and one probe per self-check panel
// (#event-clock-panel, …). They own every state, action, disabled/error condition, confirmation
// and privacy/offline/GPU restriction, and they write their status into those nodes. The panels
// stay in the document (hidden in the ordinary app, visible under ?testHooks); these components
// read them on every change and operate them the way a person would: buttons are clicked, selects
// and fields get their value plus the real input/change/keydown events the controllers listen
// for, the range gets input while dragging and change on release, the rename form is submitted
// through requestSubmit (so `required` still applies). Values are passed as the native strings:
// the exact transition stays a decimal string of up to 20 digits.
import { useEffect, useReducer, useState } from "react";
import {
  Badge,
  Button,
  Disclosure,
  DisclosurePanel,
  DisclosureTrigger,
  Input,
  Label,
  List,
  Segmented,
  Slider,
  TextField,
} from "@brett_lamy/ui";
import { byId, textOf } from "../bridge.js";
import { NativeLinkedSwitch } from "./projection.jsx";
import { Picker } from "./primitives.jsx";

// Re-render when anything under the native panel changes, plus a slow tick for properties that do
// not reflect to attributes (select/field values). Only while a pane is mounted.
function useNativeRoot(id) {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const root = byId(id);
    const observer = root ? new MutationObserver(bump) : null;
    observer?.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
    const timer = setInterval(bump, 300);
    return () => { observer?.disconnect(); clearInterval(timer); };
  }, [id]);
  return byId(id);
}

const shown = (el) => Boolean(el) && !el.hidden && !el.closest("[hidden]:not(details.session-library)");

// A native label's own words (not the option text of the select inside it).
function labelOf(el) {
  if (!el) return "";
  const label = el.closest("label");
  const own = label ? [...label.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim() : "";
  return own || el.getAttribute("aria-label") || "";
}

export function NButton({ el, variant = "secondary", children }) {
  if (!shown(el)) return null;
  return (
    <Button
      variant={variant}
      size="sm"
      isDisabled={el.disabled}
      onPress={() => { if (!el.disabled) el.click(); }}
      data-native={el.dataset.timeline ?? el.dataset.session ?? el.id}
    >
      {children ?? textOf(el)}
    </Button>
  );
}

const EMPTY = "__wv-empty";

export function NPicker({ el, label }) {
  if (!shown(el)) return null;
  const options = [...el.options].map((o) => ({ id: o.value === "" ? EMPTY : o.value, label: o.textContent.trim() || "(none)" }));
  const text = label ?? labelOf(el);
  if (!options.length) {
    return (
      <div className="wv-rec-field" data-native={el.dataset.timeline ?? el.dataset.session}>
        <span className="wv-rec-label">{text}</span>
        <span className="wv-rec-empty">None yet</span>
      </div>
    );
  }
  return (
    <div className="wv-rec-field" data-native={el.dataset.timeline ?? el.dataset.session} data-disabled={el.disabled ? "true" : "false"}>
      <Picker
        isDisabled={el.disabled}
        label={text}
        options={options}
        value={el.value === "" ? EMPTY : el.value}
        onChange={(next) => {
          if (el.disabled) return;
          el.value = next === EMPTY ? "" : next;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }}
      />
    </div>
  );
}

// Text/number field over a native input. `enter`: "keydown" re-dispatches Enter to the native
// input (the controller's own listener acts on it); "submit" submits the native form.
export function NField({ el, label, enter, type = "text" }) {
  const [, bump] = useReducer((n) => n + 1, 0);
  if (!shown(el)) return null;
  const write = (next) => {
    el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    bump();
  };
  return (
    <TextField
      className="wv-rec-field"
      value={el.value}
      onChange={write}
      isDisabled={el.disabled}
      data-native={el.dataset.timeline ?? el.dataset.session}
    >
      <Label>{label ?? labelOf(el)}</Label>
      <Input
        type={type}
        inputMode={el.getAttribute("inputmode") ?? undefined}
        pattern={el.getAttribute("pattern") ?? undefined}
        maxLength={el.maxLength > 0 ? el.maxLength : undefined}
        min={el.getAttribute("min") ?? undefined}
        max={el.getAttribute("max") ?? undefined}
        step={el.getAttribute("step") ?? undefined}
        required={el.required || undefined}
        autoComplete="off"
        spellCheck={false}
        onBlur={() => el.dispatchEvent(new Event("change", { bubbles: true }))}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !enter) return;
          event.preventDefault();
          if (enter === "submit") el.form?.requestSubmit();
          else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        }}
      />
    </TextField>
  );
}

export function NSlider({ el, label }) {
  if (!shown(el)) return null;
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  return (
    <Slider
      className="wv-rec-field"
      label={label ?? labelOf(el)}
      minValue={min}
      maxValue={max}
      step={Number(el.step || 1)}
      value={Number(el.value)}
      isDisabled={el.disabled}
      data-native={el.dataset.timeline}
      onChange={(next) => {
        el.value = String(next);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }}
      onChangeEnd={(next) => {
        el.value = String(next);
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    />
  );
}

export function NText({ el, as: Tag = "p", tone, role }) {
  if (!shown(el)) return null;
  const text = textOf(el);
  if (!text) return null;
  return <Tag className="wv-rec-text" data-tone={tone} role={role}>{text}</Tag>;
}

const RowGroup = ({ children }) => <div className="wv-rec-actions">{children}</div>;

// GPU replay frames are canvases the timeline places in its own frame node. Show that real node
// (not a copy) in the pane while it is open, and put it back where the controller made it after.
function useAdoptedFrame(slot) {
  useEffect(() => {
    const frame = document.querySelector("#session-timeline [data-timeline-gpu-frame]");
    if (!frame || !slot) return undefined;
    const marker = document.createComment("wv: gpu frame shown in the Recordings pane");
    frame.before(marker);
    slot.append(frame);
    return () => {
      if (marker.isConnected) marker.replaceWith(frame);
      else frame.remove();
    };
  }, [slot]);
}

function Replay({ adoptOutput }) {
  const root = useNativeRoot("session-timeline");
  const [slot, setSlot] = useState(null);
  useAdoptedFrame(adoptOutput ? slot : null);
  if (!root) return null;
  const t = (key) => root.querySelector(`[data-timeline="${key}"]`);
  const notes = [...root.querySelectorAll(":scope > p.session-note:not([data-timeline])")];
  const navigable = ["scrub", "seek", "back", "forward", "play", "points", "events", "point-go", "event-go"].some((k) => t(k) && !t(k).disabled);
  const branchControls = t("branch-controls");
  return (
    <List inset>
      <List.Section title="Replay a recording" footer={textOf(notes[0])}>
        <List.Row>
          <div className="wv-rec-stack">
            <NPicker el={t("sessions")} label="Saved recording" />
            <RowGroup>
              <NButton el={t("open")} variant="default" />
              <NButton el={t("refresh")} />
            </RowGroup>
            <RowGroup>
              <NButton el={t("record")} />
              <NButton el={t("record-file")} />
              <NButton el={t("stop")} />
            </RowGroup>
            <NText el={t("status")} role="status" />
          </div>
        </List.Row>
      </List.Section>

      <List.Section title="Where you are" footer={navigable ? textOf(notes[2]) || undefined : undefined}>
        <List.Row>
          <div className="wv-rec-stack" data-wv="replay-position">
            <NText el={t("mode")} />
            <NText el={t("active")} />
            <NText el={t("position")} />
            {navigable ? null : <p className="wv-rec-text" data-tone="muted">Open a recording to move through it.</p>}
          </div>
        </List.Row>
        {navigable ? (
          <List.Row>
            <div className="wv-rec-stack" data-wv="replay-navigation">
              <NSlider el={t("scrub")} label="Scrub saved history" />
              <div className="wv-rec-inline">
                <NField el={t("target")} label="Exact transition" enter="keydown" />
                <NButton el={t("seek")} />
              </div>
              <RowGroup>
                <NButton el={t("back")} />
                <NButton el={t("forward")} />
                <NButton el={t("play")} />
                <NButton el={t("pause")} />
              </RowGroup>
              <NText el={t("preview")} tone="muted" />
              <div className="wv-rec-inline">
                <NPicker el={t("points")} label="Saved keyframe" />
                <NButton el={t("point-go")} />
              </div>
              <div className="wv-rec-inline">
                <NPicker el={t("events")} label="Recorded event" />
                <NButton el={t("event-go")} />
              </div>
            </div>
          </List.Row>
        ) : null}
        <List.Row>
          <div className="wv-rec-stack">
            <span className="wv-rec-label">Replay console</span>
            <pre className="wv-rec-console" data-wv="replay-console" tabIndex={0} aria-label="Replay serial console">{t("console")?.textContent ?? ""}</pre>
            {adoptOutput ? <div className="wv-rec-frame" ref={setSlot} /> : null}
            <Disclosure className="wv-rec-disclosure">
              <DisclosureTrigger level={4}>Active state digest</DisclosureTrigger>
              <DisclosurePanel><code className="wv-rec-digest">{textOf(t("digest"))}</code></DisclosurePanel>
            </Disclosure>
          </div>
        </List.Row>
      </List.Section>

      <List.Section title="Continue from here">
        <List.Row>
          <div className="wv-rec-stack" data-wv="replay-branch">
            <RowGroup><NButton el={t("branch-create")} /></RowGroup>
            <NText el={t("branch-origin")} tone="muted" />
            {shown(branchControls) ? (
              <>
                <NText el={branchControls.querySelector("p.session-note")} tone="muted" />
                <RowGroup>
                  <NButton el={t("branch-run")} />
                  <NButton el={t("branch-pause")} />
                  <NButton el={t("branch-save")} />
                  <NButton el={t("branch-discard")} />
                  <NButton el={t("branch-live")} />
                </RowGroup>
                <div className="wv-rec-inline">
                  <NField el={t("branch-input")} label="Serial input" enter="keydown" />
                  <NButton el={t("branch-send")} />
                </div>
              </>
            ) : null}
          </div>
        </List.Row>
      </List.Section>

      <List.Section title="Recording files" footer={textOf(notes[1])}>
        <List.Row>
          <div className="wv-rec-stack" data-wv="replay-files">
            <RowGroup>
              <NButton el={t("bundle-export")} />
              <NButton el={t("bundle-import")} />
              <NButton el={t("bundle-cancel")} />
              <NButton el={t("bundle-delete")} />
            </RowGroup>
            <NText el={t("bundle-details")} tone="muted" />
          </div>
        </List.Row>
      </List.Section>
    </List>
  );
}

function SavedSessions() {
  const root = useNativeRoot("session-library");
  if (!root) return null;
  const s = (key) => root.querySelector(`[data-session="${key}"]`);
  const notes = [...root.querySelectorAll(":scope > p.session-note:not([data-session])")];
  const timeEntropy = s("time-entropy");
  return (
    <List inset>
      <List.Section title="Checkpoints" footer={textOf(notes[0])}>
        <List.Row>
          <div className="wv-rec-stack" data-wv="sessions-checkpoints">
            <NText el={s("active")} />
            <RowGroup>
              <NButton el={s("new")} variant="default" />
              <NButton el={s("start")} />
              <NButton el={s("checkpoint")} />
              <NButton el={s("stop")} />
              <NButton el={s("retry")} />
              <NButton el={s("resume")} />
            </RowGroup>
            <NText el={s("status")} role="status" />
          </div>
        </List.Row>
      </List.Section>

      <List.Section title="Saved sessions">
        <List.Row>
          <div className="wv-rec-stack" data-wv="sessions-saved">
            <NPicker el={s("sessions")} label="Selected preview" />
            <NPicker el={s("points")} label="Exact restore point" />
            <RowGroup>
              <NButton el={s("open")} variant="default" />
              <NButton el={s("refresh")} />
              <NButton el={s("delete")} />
            </RowGroup>
            <div className="wv-rec-inline">
              <NField el={s("name")} label="Session name" enter="submit" />
              <NButton el={s("rename")} />
            </div>
            <div className="wv-rec-details" aria-label="Selected session details">
              {[...(s("details")?.children ?? [])].map((line, i) => <p key={i} className="wv-rec-text" data-tone="muted">{textOf(line)}</p>)}
            </div>
          </div>
        </List.Row>
      </List.Section>

      <List.Section title="Input recording" footer={textOf(notes[1])}>
        {timeEntropy ? (
          <List.Row
            title={labelOf(timeEntropy)}
            accessory={<NativeLinkedSwitch block={{ el: timeEntropy, label: labelOf(timeEntropy), checked: timeEntropy.checked, disabled: timeEntropy.disabled }} />}
          />
        ) : null}
        <List.Row>
          <RowGroup>
            <NButton el={s("input-start")} />
            <NButton el={s("input-save")} />
            <NButton el={s("input-stop")} />
          </RowGroup>
        </List.Row>
      </List.Section>

      <List.Section title="GPU desktop" footer={textOf(notes[2])}>
        <List.Row>
          <RowGroup>
            <NButton el={s("gpu-new")} />
            <NButton el={s("gpu-capture")} />
          </RowGroup>
        </List.Row>
      </List.Section>

      <List.Section title="Storage">
        <List.Row>
          <div className="wv-rec-stack" data-wv="sessions-storage">
            <NText el={s("storage")} tone="muted" />
            <Disclosure className="wv-rec-disclosure">
              <DisclosureTrigger level={4}>Limits and cleanup</DisclosureTrigger>
              <DisclosurePanel>
                <div className="wv-rec-stack">
                  <NField el={s("limit-bytes")} type="number" />
                  <NField el={s("limit-points")} type="number" />
                  <RowGroup>
                    <NButton el={s("limits-save")} />
                    <NButton el={s("persist")} />
                    <NButton el={s("cleanup")} />
                  </RowGroup>
                </div>
              </DisclosurePanel>
            </Disclosure>
          </div>
        </List.Row>
      </List.Section>
    </List>
  );
}

// Time travel and saved sessions. `adoptOutput` shows the timeline's real GPU frame node here;
// only one mounted pane may do that.
export function RecordingsPanel({ adoptOutput = false }) {
  const [tab, setTab] = useState("replay");
  return (
    <div className="wv-rec" data-wv="recordings">
      <div className="wv-rec-head">
        <p className="wv-rec-text" data-tone="muted">
          Replays run on a private copy of the machine and pause the live guest. Recordings stay in this browser unless you export them.
        </p>
        <Segmented
          aria-label="Recordings view"
          value={tab}
          onChange={setTab}
          options={[
            { id: "replay", label: "Replay" },
            { id: "sessions", label: "Checkpoints" },
          ]}
        />
      </div>
      {tab === "replay" ? <Replay adoptOutput={adoptOutput} /> : <SavedSessions />}
    </div>
  );
}

const CHECK_RESULT = { live: ["success", "Passed"], regressed: ["destructive", "Failed"] };

function Check({ panel }) {
  const summary = panel.querySelector(":scope > summary");
  const pip = summary?.querySelector(".cap-pip");
  const result = Object.entries(CHECK_RESULT).find(([cls]) => pip?.classList.contains(cls))?.[1];
  const buttons = [...panel.querySelectorAll(".session-actions button")];
  const notes = [...panel.querySelectorAll(":scope > p")].filter((p) => !p.matches('[role="status"]'));
  return (
    <List.Row>
      <div className="wv-rec-stack" data-wv="check" data-check={panel.id}>
        <div className="wv-rec-check-head">
          <span className="wv-rec-check-title">{textOf(summary)}</span>
          {result ? <Badge variant={result[0]}>{result[1]}</Badge> : null}
        </div>
        {notes.map((note, i) => <NText key={i} el={note} tone="muted" />)}
        <RowGroup>{buttons.map((button) => <NButton key={button.id} el={button} />)}</RowGroup>
        <NText el={panel.querySelector('[role="status"]')} role="status" />
      </div>
    </List.Row>
  );
}

// Self-checks: the page's own probe panels. Each runs only when its button is pressed.
const checkPanels = () => [...document.querySelectorAll('#panel-ide details.session-library[id$="-panel"]')];

export function ChecksPanel() {
  // Observe the check panels themselves (not the whole app panel, where the terminal mutates
  // constantly).
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    const observer = new MutationObserver(bump);
    for (const panel of checkPanels()) observer.observe(panel, { attributes: true, childList: true, characterData: true, subtree: true });
    const timer = setInterval(bump, 1000);
    return () => { observer.disconnect(); clearInterval(timer); };
  }, []);
  const panels = checkPanels();
  return (
    <div className="wv-rec" data-wv="checks">
      <List inset>
        <List.Section
          title="Self-checks"
          footer="Each check runs a small private machine in this browser when you press it. Some take minutes or use local storage; the note under each says so."
        >
          {panels.map((panel) => <Check key={panel.id} panel={panel} />)}
        </List.Section>
      </List>
    </div>
  );
}
