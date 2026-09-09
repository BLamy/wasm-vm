// Self-contained so Playwright can serialize the same inspected oracle into the page.
export function inspectRecoveryCanvas() {
  const canvas = document.getElementById("desktop-canvas");
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let black = 0, white = 0, colored = 0, bodySum = 0, bodyCount = 0, panelSum = 0, panelCount = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i], green = pixels[i + 1], blue = pixels[i + 2];
    if (red < 24 && green < 24 && blue < 24) black++;
    if (red > 140 && Math.abs(red - green) < 10 && Math.abs(red - blue) < 10) white++;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 30) colored++;
    const row = Math.floor(i / (4 * canvas.width));
    if (row < 32) { panelSum += red + green + blue; panelCount++; }
    if (row >= 80) { bodySum += red + green + blue; bodyCount++; }
  }
  const total = pixels.length / 4;
  const bodyMean = bodyCount ? bodySum / (3 * bodyCount) : 0;
  const panelMean = panelCount ? panelSum / (3 * panelCount) : 0;
  // The pinned Weston wallpaper is neutral gray, NOT a colored fill. Its large bright body
  // and darker top panel distinguish the desktop from blank scanout and sparse fbcon text.
  const desktop = black < total * .2 && bodyMean > 48 && bodyMean - panelMean > 18;
  return { black, white, colored, total, bodyMean, panelMean, desktop };
}
