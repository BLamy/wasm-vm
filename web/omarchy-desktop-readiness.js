// Shell login and a framebuffer allocation both precede the desktop. Require the package shell's
// mapped bar and background plus actual non-uniform pixels before uncovering the canvas.
export function hasOmarchyDesktopLayers(layers) {
  const found = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Number.isFinite(value.w) && value.w > 0 && Number.isFinite(value.h) && value.h > 0
      && Number.isInteger(value.pid) && value.pid > 0) found.add(value.namespace);
    for (const child of Object.values(value)) if (child && typeof child === "object") visit(child);
  };
  visit(layers);
  return found.has("omarchy-bar") && found.has("omarchy-background");
}

export function hasDesktopPixels(rgba) {
  if (!rgba || rgba.length < 4096 || rgba.length % 4 !== 0) return false;
  const colors = new Set();
  let visible = 0, samples = 0;
  const stride = Math.max(1, Math.floor(rgba.length / 4 / 8192)) * 4;
  for (let i = 0; i < rgba.length; i += stride) {
    samples++;
    if (rgba[i + 3] > 0 && Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > 12) {
      visible++;
      colors.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    }
  }
  return visible > samples / 4 && colors.size >= 8;
}
