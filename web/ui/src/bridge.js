// Bridge between library controls and the engine's own DOM.
//
// main.js and ide.js look up their native inputs, buttons and status nodes by id at load time and
// react to real `change`/`click` events. Those nodes stay in the document as the engine's inputs.
// The library controls on top read them and write back through the same events, so persistence,
// credential handling and every runtime listener behave exactly as before.
import { useEffect, useState, useSyncExternalStore } from "react";

export const byId = (id) => (typeof document === "undefined" ? null : document.getElementById(id));

// Re-render when a node's text, attributes or children change. `read` must return a primitive or a
// stable string so React can compare snapshots.
export function useDomSnapshot(target, read, { subtree = true } = {}) {
  const subscribe = (notify) => {
    const el = typeof target === "function" ? target() : target;
    if (!el) {
      // The node may be created later (ide.js builds the workspace after this bundle runs).
      const id = setInterval(notify, 250);
      return () => clearInterval(id);
    }
    const observer = new MutationObserver(notify);
    observer.observe(el, { attributes: true, childList: true, characterData: true, subtree });
    return () => observer.disconnect();
  };
  const snapshot = () => read(typeof target === "function" ? target() : target);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// Form values are properties, not attributes, so observers cannot see main.js clearing a field.
// While a control is mounted, poll its native value (cheap: a handful of inputs, only while a sheet
// is open) and also listen for real input/change events.
export function useNativeValue(id, { checkbox = false, interval = 250 } = {}) {
  const read = () => {
    const el = byId(id);
    if (!el) return checkbox ? false : "";
    return checkbox ? el.checked : el.value;
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    const sync = () => setValue(read());
    const el = byId(id);
    el?.addEventListener("input", sync);
    el?.addEventListener("change", sync);
    const timer = setInterval(sync, interval);
    return () => {
      el?.removeEventListener("input", sync);
      el?.removeEventListener("change", sync);
      clearInterval(timer);
    };
  }, [id]);
  const write = (next, { commit = true } = {}) => {
    const el = byId(id);
    if (!el) return;
    if (checkbox) el.checked = Boolean(next);
    else el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    if (commit) el.dispatchEvent(new Event("change", { bubbles: true }));
    setValue(read());
  };
  return [value, write];
}

// Activate a native control the way a person would. Runs inside the library control's own press
// handler, so user activation (popups, fullscreen) carries over.
export function pressNative(id) {
  const el = byId(id);
  if (!el || el.disabled) return false;
  el.click();
  return true;
}

export const textOf = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
