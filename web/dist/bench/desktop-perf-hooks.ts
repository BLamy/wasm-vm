// E5-T25a: test-only deterministic input boundary. This module is never imported by web/main.js;
// the browser harness loads it explicitly with the perfHooks query gate.

export const DESKTOP_PERF_HOOK_VERSION = "e5-t25a-v1";
export const EV_KEY = 1;
export const EV_ABS = 3;
export const ABS_X = 0;
export const ABS_Y = 1;
export const BTN_LEFT = 0x110;
export const ABS_MIN = 0;
export const ABS_MAX = 32767;

function checkedInt(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function checkedBoolean(value, name) {
  if (value !== true && value !== false) throw new TypeError(`${name} must be boolean`);
  return value;
}

function requireController(controller) {
  for (const method of ["sendTabletEvent", "syncTablet", "sendKeyboardEvent", "syncKeyboard"]) {
    if (typeof controller?.[method] !== "function") {
      throw new TypeError(`desktop perf controller requires ${method}`);
    }
  }
}

/**
 * Construct the explicitly enabled perf input adapter. The caller must opt in; there is no
 * default controller lookup and no shell/string command path.
 */
export function createDesktopPerfInput(controller, { enabled = false } = {}) {
  if (enabled !== true) throw new Error("desktop perf input is disabled");
  requireController(controller);
  let sequence = 0;
  const pressed = new Set();
  let queue = Promise.resolve();

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function emit(device, events, sync, noop = false) {
    const record = {
      version: DESKTOP_PERF_HOOK_VERSION,
      sequence: ++sequence,
      device,
      events: events.map((event) => ({ ...event })),
      sync: "SYN_REPORT",
      noop,
    };
    if (noop) return Object.freeze(record);
    for (const event of events) {
      await controller[device === "tablet" ? "sendTabletEvent" : "sendKeyboardEvent"](
        event.eventType, event.code, event.value,
      );
    }
    await controller[sync]();
    return Object.freeze(record);
  }

  function emitButton(device, code, pressedValue, sync) {
    return enqueue(async () => {
      const key = `${device}:${code}`;
      if (!pressedValue && !pressed.has(key)) return emit(device, [], sync, true);
      if (pressedValue && pressed.has(key)) return emit(device, [], sync, true);
      const record = await emit(device, [{ eventType: EV_KEY, code, value: pressedValue ? 1 : 0 }], sync);
      if (pressedValue) pressed.add(key); else pressed.delete(key);
      return record;
    });
  }

  return Object.freeze({
    moveAbsolute: (x, y) => {
      const checkedX = checkedInt(x, "x", ABS_MIN, ABS_MAX);
      const checkedY = checkedInt(y, "y", ABS_MIN, ABS_MAX);
      return enqueue(() => emit("tablet", [
        { eventType: EV_ABS, code: ABS_X, value: checkedX },
        { eventType: EV_ABS, code: ABS_Y, value: checkedY },
      ], "syncTablet"));
    },
    button: (code, pressedValue) => emitButton(
      "tablet",
      checkedInt(code, "button code", 0, 0xffff),
      checkedBoolean(pressedValue, "pressed"),
      "syncTablet",
    ),
    leftButton: (pressedValue) => emitButton(
      "tablet", BTN_LEFT, checkedBoolean(pressedValue, "pressed"), "syncTablet",
    ),
    key: (code, pressedValue) => emitButton(
      "keyboard",
      checkedInt(code, "key code", 0, 0xffff),
      checkedBoolean(pressedValue, "pressed"),
      "syncKeyboard",
    ),
  });
}
