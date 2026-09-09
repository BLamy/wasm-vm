// E5-T18c: CSS-to-guest geometry for desktop cursor and window-control proofs.
//
// PointerEvent coordinates are CSS pixels. The canvas backing store and browser DPR never enter
// this contract: both the host point and the guest pixel are derived from the current CSS rect.
// Pixel rectangles use half-open bounds so a point immediately beside a control cannot activate it.

export const DESKTOP_WIDTH = 1280;
export const DESKTOP_HEIGHT = 800;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function checkedDimension(value, name) {
  const number = finiteNumber(value);
  if (number === null || number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}

function checkedRect(rect) {
  const left = finiteNumber(rect?.left);
  const top = finiteNumber(rect?.top);
  const width = finiteNumber(rect?.width);
  const height = finiteNumber(rect?.height);
  if (left === null || top === null || width === null || height === null || width <= 0 || height <= 0) {
    throw new RangeError("desktop canvas CSS rect must be finite and positive");
  }
  return { left, top, width, height };
}

function checkedGuestSize(size = {}) {
  return {
    width: checkedDimension(size.width ?? DESKTOP_WIDTH, "guest width"),
    height: checkedDimension(size.height ?? DESKTOP_HEIGHT, "guest height"),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Convert a CSS-space client point to the half-open guest pixel containing it. */
export function guestPixelFromClient(clientX, clientY, rect, size = {}) {
  const bounds = checkedRect(rect);
  const guest = checkedGuestSize(size);
  const x = Math.floor(((Number(clientX) - bounds.left) / bounds.width) * guest.width);
  const y = Math.floor(((Number(clientY) - bounds.top) / bounds.height) * guest.height);
  return {
    x: clamp(Number.isFinite(x) ? x : 0, 0, guest.width - 1),
    y: clamp(Number.isFinite(y) ? y : 0, 0, guest.height - 1),
  };
}

/** Sample inside a guest pixel without rounding the guest cursor's rasterized hotspot up.
 * A quarter pixel stays inside its hit box after ABS quantization and below the half-pixel
 * cursor rasterization edge; sampling exactly halfway can move the rendered arrow one pixel.
 */
export function clientPointFromGuest(pixel, rect, size = {}) {
  const bounds = checkedRect(rect);
  const guest = checkedGuestSize(size);
  const x = clamp(Number(pixel?.x), 0, guest.width - 1);
  const y = clamp(Number(pixel?.y), 0, guest.height - 1);
  return {
    x: bounds.left + ((x + 0.25) / guest.width) * bounds.width,
    y: bounds.top + ((y + 0.25) / guest.height) * bounds.height,
  };
}

/** Return the tablet coordinate the production bridge emits for the interior guest pixel sample. */
export function tabletPointFromGuest(pixel, rect, size = {}, tabletMax = 32767) {
  const guest = checkedGuestSize(size);
  const point = clientPointFromGuest(pixel, rect, guest);
  const bounds = checkedRect(rect);
  const max = checkedDimension(tabletMax + 1, "tablet range") - 1;
  return {
    x: Math.round(((point.x - bounds.left) / bounds.width) * max),
    y: Math.round(((point.y - bounds.top) / bounds.height) * max),
  };
}

/** Test a guest pixel against half-open [left, top, right, bottom) control bounds. */
export function hitTestGuestPixel(pixel, controls) {
  if (!pixel || !Array.isArray(controls)) return null;
  for (const control of controls) {
    const left = finiteNumber(control?.left);
    const top = finiteNumber(control?.top);
    const right = finiteNumber(control?.right);
    const bottom = finiteNumber(control?.bottom);
    if ([left, top, right, bottom].some((value) => value === null) || right <= left || bottom <= top) continue;
    if (pixel.x >= left && pixel.x < right && pixel.y >= top && pixel.y < bottom) return control;
  }
  return null;
}

/** Foot 1.17's default 26px CSD buttons, clipped by Weston's always-on-top 32px panel. */
export function westonWindowControls(windowRect, panelBottom = 32) {
  const left = finiteNumber(windowRect?.left);
  const top = finiteNumber(windowRect?.top);
  const right = finiteNumber(windowRect?.right);
  const bottom = finiteNumber(windowRect?.bottom);
  if ([left, top, right, bottom].some((value) => value === null) || right <= left || bottom <= top) {
    throw new RangeError("Weston window rectangle is invalid");
  }
  const visibleTop = Math.max(top, panelBottom);
  const titleBottom = Math.min(top + 26, bottom);
  if (visibleTop >= titleBottom) return [];
  return ["minimize", "maximize", "close"].map((name, index) => {
    const buttonLeft = right - (3 - index) * 26;
    const buttonRight = right - (2 - index) * 26;
    return {
      name, left: buttonLeft, top: visibleTop, right: buttonRight, bottom: titleBottom,
      x: Math.floor((buttonLeft + buttonRight) / 2),
      y: Math.floor((visibleTop + titleBottom) / 2),
    };
  });
}
