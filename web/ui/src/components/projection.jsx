// Library rendering of ide.js's tool panes (files, transfers, containers, editor tabs, container
// controls).
//
// ide.js builds those panes imperatively and binds its handlers to the native nodes it creates,
// re-rendering with replaceChildren() as state changes. Duplicating that logic would fork it. The
// native panes therefore stay in the document as the engine's controls (hidden in the ordinary app,
// visible under ?testHooks), and this projector reads them on every mutation and renders the same
// content with library components. Each library control acts on its native node: buttons and rows
// are clicked, checkboxes toggled, text inputs written with real input events and submitted through
// their native form, drops re-dispatched with the original DataTransfer. Nothing is simulated: a
// projected button exists only while ide.js renders the native one, with its label, title and
// disabled state.
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Button, Icon, Input, List, Switch, TextField } from "@brett_lamy/ui";
import { textOf } from "../bridge.js";

const ROW = ".ide-dk-row, .ide-node, .ide-tab, #file-transfer-list > li";
const HEADING = ".ide-dk-h, h3, h4";
const TONE = /error|fail|unavailable|absent/;

// A person pressed something that opens an editor tab (a file, or a container's logs). ide.js
// either creates the tab or re-activates the existing one, so the workspace cannot infer this
// from the tab count; it listens for this intent and brings the editor into view.
export const OPEN_INTENT = "wv:open-intent";
const announceOpen = (kind) => window.dispatchEvent(new CustomEvent(OPEN_INTENT, { detail: { kind } }));

const visible = (el) => !el.hidden && el.style.display !== "none" && el.getAttribute("aria-hidden") !== "true";
const keyOf = (el, index) => el.id || (el.dataset.action ? `${el.dataset.action}:${el.dataset.image ?? el.dataset.id ?? ""}` : el.dataset.a || el.dataset.path || `${el.tagName}:${index}`);
// Glyph prefixes ide.js uses as icons ("▶ Run", "↻ Check", "🐳 name") are dropped from labels.
const clean = (text) => text.replace(/^[←-⯿\u{1F300}-\u{1FAFF}️\s]+/u, "").trim();

function buttonOf(el, index) {
  return { kind: "button", key: keyOf(el, index), el, label: clean(textOf(el)) || el.getAttribute("aria-label") || el.title, title: el.title, disabled: el.disabled, primary: el.classList.contains("run") };
}

// Walk a native subtree into a flat list of blocks, in document order.
export function project(root) {
  const blocks = [];
  let index = 0;
  const walk = (el, depth) => {
    for (const child of el.children) {
      if (!visible(child)) continue;
      index += 1;
      if (child.matches("button")) blocks.push(buttonOf(child, index));
      else if (child.matches('input[type="checkbox"]')) {
        blocks.push({ kind: "switch", key: keyOf(child, index), el: child, label: clean(textOf(child.closest("label"))) || child.dataset.a, checked: child.checked, disabled: child.disabled });
      } else if (child.matches("label") && child.querySelector('input[type="checkbox"]')) walk(child, depth);
      else if (child.matches('input[type="text"], input:not([type])')) {
        blocks.push({ kind: "input", key: keyOf(child, index), el: child, label: child.getAttribute("aria-label") || child.placeholder, placeholder: child.placeholder, disabled: child.disabled });
      } else if (child.matches('input[type="file"]')) continue;
      else if (child.matches("pre")) blocks.push({ kind: "pre", key: keyOf(child, index), text: child.textContent });
      else if (child.matches(".ide-node")) {
        const twisty = textOf(child.querySelector(".tw"));
        blocks.push({
          kind: "node", key: child.dataset.path || `node:${index}`, el: child, depth,
          name: textOf(child.querySelector(".nm")), dir: twisty !== "", open: twisty === "▾",
          loading: Boolean(child.querySelector(".ide-spin")), selected: child.classList.contains("sel"),
          root: !child.dataset.path,
        });
      } else if (child.matches(".ide-tab")) {
        const close = child.querySelector(".t-close");
        blocks.push({ kind: "tab", key: `tab:${textOf(child.querySelector(".t-nm"))}`, el: child, close, name: clean(textOf(child.querySelector(".t-nm"))), active: child.classList.contains("active"), dirty: Boolean(child.querySelector(".t-dirty")) });
      } else if (child.matches(ROW)) {
        const name = child.querySelector(".nm");
        const titleEl = name?.firstElementChild ?? name;
        const subtitle = [...(name?.querySelectorAll(".sub, .ide-dk-ctr-meta") ?? [])].map(textOf).filter(Boolean).join(" · ");
        const actions = [...child.querySelectorAll("button")].filter(visible).map((b, i) => buttonOf(b, `${index}.${i}`));
        blocks.push({
          kind: "row", key: keyOf(child, index), el: child, title: clean(textOf(titleEl)) || clean(textOf(child).replace(actions.map((a) => a.label).join(" "), "")),
          subtitle, actions, pressable: child.classList.contains("ide-dk-ctr"),
        });
      } else if (child.matches(HEADING)) blocks.push({ kind: "heading", key: `h:${textOf(child)}`, text: textOf(child) });
      else if (child.matches("dl")) {
        const pairs = [...child.querySelectorAll("dt")].map((dt) => [textOf(dt), textOf(dt.nextElementSibling)]);
        blocks.push({ kind: "pairs", key: keyOf(child, index), pairs });
      } else if (child.matches('[role="button"][tabindex]') && !child.matches("button")) {
        blocks.push({ kind: "drop", key: keyOf(child, index), el: child, text: textOf(child) });
      } else if (child.matches("ul, ol")) walk(child, depth + (child.matches(".ide-tree") && child.parentElement?.matches("li") ? 1 : 0));
      else if (child.matches("li")) walk(child, depth);
      else if (child.children.length === 0 || child.querySelectorAll("*").length === child.querySelectorAll("b, code, span:not([class])").length) {
        const text = textOf(child);
        if (text && !child.matches(".sp")) {
          const state = `${child.dataset.state ?? ""} ${child.className}`;
          blocks.push({ kind: "text", key: keyOf(child, index), el: child, text, tone: TONE.test(state) ? "warn" : /ok|ready|available|active|following/.test(child.dataset.state ?? "") ? "ok" : "muted", status: child.getAttribute("role") === "status" });
        }
      } else walk(child, depth);
    }
  };
  if (root) walk(root, 0);
  return blocks;
}

// Re-read the native subtree whenever ide.js mutates it. Properties that do not reflect to
// attributes (checkbox state) are picked up by a slow tick while the projection is mounted.
export function useProjection(source) {
  const [, bump] = useReducer((n) => n + 1, 0);
  const [root, setRoot] = useState(null);
  useEffect(() => {
    let observer = null;
    let current = null;
    const attach = () => {
      const next = typeof source === "function" ? source() : source;
      if (next === current) return;
      observer?.disconnect();
      current = next;
      setRoot(next);
      if (next) {
        observer = new MutationObserver(bump);
        observer.observe(next, { attributes: true, childList: true, characterData: true, subtree: true });
      }
    };
    attach();
    const timer = setInterval(() => { attach(); bump(); }, 500);
    return () => { clearInterval(timer); observer?.disconnect(); };
  }, [source]);
  return project(root);
}

function NativeInput({ block }) {
  const [value, setValue] = useState(block.el.value);
  useEffect(() => {
    const sync = () => setValue(block.el.value);
    const timer = setInterval(sync, 250);
    return () => clearInterval(timer);
  }, [block.el]);
  return (
    <TextField
      aria-label={block.label}
      value={value}
      isDisabled={block.disabled}
      onChange={(next) => {
        block.el.value = next;
        block.el.dispatchEvent(new Event("input", { bubbles: true }));
        setValue(next);
      }}
      className="wv-proj-input"
    >
      <Input
        placeholder={block.placeholder}
        autoComplete="off"
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          block.el.form?.requestSubmit();
        }}
      />
    </TextField>
  );
}

// The library Switch renders react-aria's <input role="switch"> but forwards neither isDisabled
// nor a ref (it only reads checked/onChange/className/style and its aria labels). To mirror an
// engine-disabled checkbox, set disabled on that same input after each render: the browser then
// blocks activation, assistive tech reads it as disabled, and changes are ignored meanwhile.
export function NativeLinkedSwitch({ block }) {
  const host = useRef(null);
  useLayoutEffect(() => {
    const input = host.current?.querySelector('input[role="switch"]');
    if (input) input.disabled = block.disabled;
  });
  return (
    <span ref={host} className="wv-proj-switch" data-disabled={block.disabled ? "true" : "false"}>
      <Switch
        aria-label={block.label}
        checked={block.checked}
        onChange={() => {
          if (!block.el.disabled) block.el.click();
        }}
      />
    </span>
  );
}

function ProjectedButton({ block, size = "sm" }) {
  return (
    <Button
      variant={block.primary ? "default" : "secondary"}
      size={size}
      isDisabled={block.disabled}
      title={block.title || undefined}
      onPress={() => block.el.click()}
      data-native={block.el.id || block.el.dataset.action || block.el.dataset.a || undefined}
    >
      {block.label}
    </Button>
  );
}

function DropZone({ block }) {
  const [over, setOver] = useState(false);
  const forward = (type, event) => {
    event.preventDefault();
    block.el.dispatchEvent(new DragEvent(type, { dataTransfer: event.dataTransfer, bubbles: true, cancelable: true }));
  };
  return (
    <div
      className="wv-proj-drop"
      data-over={over ? "true" : "false"}
      onDragOver={(event) => { setOver(true); forward("dragover", event); }}
      onDragLeave={(event) => { setOver(false); forward("dragleave", event); }}
      onDrop={(event) => { setOver(false); forward("drop", event); }}
    >
      {block.text}
    </div>
  );
}

// Group blocks into library list sections: headings open a section; runs of loose buttons become
// one action row; notes are row text.
export function ProjectedList({ blocks, empty }) {
  const sections = [];
  let section = { title: null, items: [] };
  let actions = null;
  const flushActions = () => {
    if (actions) section.items.push({ kind: "actions", key: `actions:${actions[0].key}`, buttons: actions });
    actions = null;
  };
  for (const block of blocks) {
    if (block.kind === "heading") {
      flushActions();
      if (section.title || section.items.length) sections.push(section);
      section = { title: block.text, items: [] };
    } else if (block.kind === "button") {
      actions = actions ?? [];
      actions.push(block);
    } else {
      flushActions();
      section.items.push(block);
    }
  }
  flushActions();
  if (section.title || section.items.length) sections.push(section);
  if (!sections.length) return empty ?? null;
  return (
    <List inset>
      {sections.map((s, i) => (
        <List.Section key={`${s.title ?? "section"}:${i}`} title={s.title ?? undefined}>
          {s.items.map((item) => <ProjectedItem key={item.key} item={item} />)}
        </List.Section>
      ))}
    </List>
  );
}

function ProjectedItem({ item }) {
  switch (item.kind) {
    case "actions":
      return (
        <List.Row>
          <div className="wv-proj-actions">{item.buttons.map((b) => <ProjectedButton key={b.key} block={b} />)}</div>
        </List.Row>
      );
    case "text":
      return (
        <List.Row>
          <p className="wv-proj-text" data-tone={item.tone} role={item.status ? "status" : undefined}>{item.text}</p>
        </List.Row>
      );
    case "pre":
      return (
        <List.Row>
          <pre className="wv-proj-pre">{item.text}</pre>
        </List.Row>
      );
    case "pairs":
      return item.pairs.map(([k, v]) => <List.Row key={`${item.key}:${k}`} title={k} trailing={<span className="wv-proj-value">{v}</span>} />);
    case "switch":
      return (
        <List.Row
          title={item.label}
          accessory={<NativeLinkedSwitch block={item} />}
        />
      );
    case "input":
      return (
        <List.Row>
          <NativeInput block={item} />
        </List.Row>
      );
    case "drop":
      return (
        <List.Row>
          <DropZone block={item} />
        </List.Row>
      );
    case "node":
      return (
        <List.Row
          title={item.name}
          selected={item.selected}
          leading={
            <span className="wv-proj-node-lead" style={{ paddingLeft: `${item.depth * 16}px` }}>
              <Icon name={item.root ? "folder-fill" : item.dir ? "folder" : "doc"} size={18} />
            </span>
          }
          accessory={item.dir && !item.root ? (item.open ? <Icon name="chevron-down" size={14} /> : "chevron") : undefined}
          onPress={item.root ? undefined : () => {
            item.el.click();
            if (!item.dir) announceOpen("file");
          }}
        />
      );
    case "row":
      return (
        <List.Row
          title={item.title}
          subtitle={item.subtitle || undefined}
          onPress={item.pressable ? () => { item.el.click(); announceOpen("container"); } : undefined}
          accessory={item.actions.length ? <div className="wv-proj-actions">{item.actions.map((b) => <ProjectedButton key={b.key} block={b} />)}</div> : undefined}
        />
      );
    default:
      return null;
  }
}

// Editor tabs: library buttons that activate (click) and close (click .t-close) ide.js's tabs.
export function ProjectedTabs({ blocks }) {
  const tabs = blocks.filter((b) => b.kind === "tab");
  const rest = blocks.filter((b) => b.kind !== "tab");
  return (
    <div className="wv-proj-editorbar">
      <div className="wv-proj-tabs" role="toolbar" aria-label="Open files and containers">
        {tabs.map((tab) => (
          <span className="wv-proj-tab" key={tab.key} data-active={tab.active ? "true" : "false"}>
            <Button variant={tab.active ? "secondary" : "ghost"} size="sm" onPress={() => tab.el.click()} aria-current={tab.active ? "true" : undefined}>
              {tab.name}{tab.dirty ? " •" : ""}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Close ${tab.name}`} onPress={() => tab.close?.click()}>
              <Icon name="xmark" size={14} />
            </Button>
          </span>
        ))}
      </div>
      <div className="wv-proj-editor-tools">
        {rest.map((b) =>
          b.kind === "button" ? <ProjectedButton key={b.key} block={b} /> : b.kind === "text" ? <span key={b.key} className="wv-proj-text" data-tone={b.tone}>{b.text}</span> : null,
        )}
      </div>
    </div>
  );
}
