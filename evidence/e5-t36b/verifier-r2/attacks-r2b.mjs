// E5-T36b round-2 verifier, follow-up to attacks-r2.mjs (predictions R5b-R8b in predictions.md).
//   node evidence/e5-t36b/verifier-r2/attacks-r2b.mjs <image> <out dir>
import { deflateSync } from "node:zlib";
import { bootNative, last, lines } from "../../../tools/replay-desktop/native-shell.mjs";

const [image, out] = process.argv.slice(2);
const guest = await bootNative({ image, out, timeoutMin: 60 });
const sh = (cmd, what) => { if (cmd.length > 900) throw new Error(`too long: ${what}`); return guest.sh(cmd, what); };
const say = (...a) => console.log(...a);
const KERNEL_POS = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/;
async function plane() {
  const text = await sh("cat /sys/kernel/debug/dri/0/state", "DRM state");
  const b = text.split(/^plane\[\d+\]: /m).slice(1).find((x) => !x.startsWith("plane-0"));
  const raw = /^\s*crtc-pos=(.*)$/m.exec(b)?.[1]?.trim(); const k = KERNEL_POS.exec(raw ?? "");
  const crtc = /^\s*crtc=(.*)$/m.exec(b)?.[1]?.trim(), fb = Number(/^\s*fb=(\d+)/m.exec(b)?.[1]);
  return { on: crtc !== "(null)" && fb > 0, raw, w: k && Number(k[1]), h: k && Number(k[2]), x: k && Number(k[3]), y: k && Number(k[4]) };
}
const octal = (bytes) => bytes.map((v) => `\\${v.toString(8).padStart(3, "0")}`).join("");
const event = (type, code, value) => { const b = Buffer.alloc(24); b.writeUInt16LE(type, 16); b.writeUInt16LE(code, 18); b.writeInt32LE(value, 20); return [...b]; };
let tablet;
const pointerTo = async (x, y) => {
  const o = last(await sh(`printf '${octal([event(3, 0, Math.ceil(x * 32768 / 1280)), event(3, 1, Math.ceil(y * 32768 / 800)), event(0, 0, 0)].flat())}' > ${tablet} && echo INJECTED; sleep 1`, `tablet ${x},${y}`));
  if (o !== "INJECTED") throw new Error(`tablet: ${o}`);
};
const asDesktop = (cmd) => `su -s /bin/sh desktop -c 'export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=$(ls /run/user/1000 | grep -m1 "^wayland-[0-9]*$"); ${cmd}'`;
const region = async (x, y) => last(await sh(`${asDesktop(`grim -g "${Math.max(0, x - 16)},${Math.max(0, y - 16)} 96x96" -t ppm - 2>/dev/null`)} | sha256sum | cut -c1-16`, "grim"));
const away = [1150, 650];
// Plane state with the pointer on the spot; if the plane is off, whether the frame carries a pointer.
async function probe(spot, label) {
  await pointerTo(spot[0] + 3, spot[1] + 3); await pointerTo(...spot); await sh("sleep 2", "settle");
  const p = await plane();
  let painted = null;
  if (!p.on) { const on = await region(...spot); await pointerTo(...away); const off = await region(...spot); painted = on !== off; }
  say(`RESULT ${label}: plane ${p.on ? `ON ${p.raw} pointer-plane=${[spot[0] - p.x, spot[1] - p.y]}` : `OFF (${p.raw})`}${painted === null ? "" : ` | painted=${painted}`} | a pointer is drawn=${p.on || painted}`);
}
function png(n, rgba) {
  const t = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = t[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(n * 4).fill(Buffer.from(rgba))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: n }, () => row)), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
async function put(file, text) {
  await sh(`: > ${file}`, "truncate");
  for (let i = 0; i < text.length; i += 600) await sh(`printf '%s' '${text.slice(i, i + 600)}' >> ${file}`, "write");
  await sh(`chmod 644 ${file}`, "chmod");
}
const chrome = async (flags, label) => {
  await sh("pkill -f /opt/replay-chromium/chrome; sleep 3; true", "stop chrome");
  await sh(`${asDesktop(`/opt/replay-chromium/chrome --ozone-platform=wayland --disable-gpu --no-first-run --no-default-browser-check --disable-background-networking --disable-component-update --disable-sync --password-store=basic --num-raster-threads=1 --renderer-process-limit=1 ${flags} --user-data-dir=/tmp/chrome-r2b file:///tmp/r2b.html >/tmp/chrome-r2b.log 2>&1 &`)}; sleep 60`, `chrome ${label}`);
  say(`chrome ${label}: windows titled r2b = ${last(await sh("swaymsg -t get_tree | grep -c '\"name\": \"r2b'; true", "tree"))}`);
};
const KEYWORDS = ["auto", "default", "context-menu", "help", "pointer", "progress", "wait", "cell", "crosshair", "text", "vertical-text",
  "alias", "copy", "move", "no-drop", "not-allowed", "grab", "grabbing", "all-scroll", "col-resize", "row-resize", "n-resize", "e-resize",
  "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize",
  "zoom-in", "zoom-out", "none"];
// 7 x 6 grid of cells over the page; cell centre for index i.
const COLS = 7, CW = 110, RH = 105, X0 = 10, Y0 = 125;
const centre = (i) => [X0 + CW * (i % COLS) + CW / 2, Y0 + RH * Math.floor(i / COLS) + RH / 2];
try {
  await guest.waitFor((s) => /REPLAY_DESKTOP_READY uptime=\S+ mem_hwm_kib=\d+/.test(s), "READY");
  await guest.rootShell();
  await sh("mount -t debugfs none /sys/kernel/debug 2>/dev/null; export SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock | head -n 1)", "setup");
  const devices = (await sh("cat /proc/bus/input/devices", "input devices")).split(/\n\s*\n/);
  tablet = `/dev/input/${/Handlers=.*?(event\d+)/.exec(devices.find((b) => /B: ABS=/.test(b)))[1]}`;

  say("== R5b environment ==");
  const chromePid = last(await sh("pidof chrome | tr ' ' '\\n' | sort -n | head -n 1", "chrome pid"));
  for (const [name, pid] of [["sway", "$(pidof sway)"], ["foot", "$(pidof foot)"], ["chrome browser", chromePid]]) {
    say(`${name} pid ${last(await sh(`echo ${pid}`, "pid"))} cmdline: ${last(await sh(`tr '\\0' ' ' < /proc/${pid}/cmdline | cut -c1-160; echo`, "cmdline"))}`);
    say(`${name} env XCURSOR/GDK/scale: ${JSON.stringify(lines(await sh(`tr '\\0' '\\n' < /proc/${pid}/environ | grep -E 'XCURSOR|GDK|SCALE|ICON'; echo END`, "env")))}`);
  }

  const big = png(256, [0, 0, 255, 255]).toString("base64");
  const svg = "data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%27128%27 height=%27128%27><rect width=%27128%27 height=%27128%27 fill=%27green%27/></svg>";
  const cells = KEYWORDS.map((k, i) => `<div style="cursor:${k}">${k}</div>`).join("") +
    `<div style="cursor:-webkit-image-set(url(data:image/png;base64,${big}) 2x) 40 40, crosshair;background:#ccf">wis-2x</div>` +
    `<div style="cursor:-webkit-image-set(url(&quot;${svg}&quot;) 1x) 40 40, crosshair;background:#cfc">wis-svg</div>`;
  const html = `<!doctype html><title>r2b</title><style>body{margin:0;display:grid;grid-template-columns:repeat(${COLS},${CW}px);grid-auto-rows:${RH}px;padding:0 0 0 ${X0}px}div{border:1px solid #ccc;font:11px sans-serif;user-select:none}</style><body>${cells}</body>`;
  await put("/tmp/r2b.html", html);
  say(`page bytes ${last(await sh("wc -c < /tmp/r2b.html", "size"))} (expected ${Buffer.byteLength(html)})`);

  say("\n== R6b/R7b: the guest's Chrome, DSF 1 (as shipped, own instance with the shipped flags) ==");
  await chrome("", "DSF 1");
  const probeCell = async (i, tag) => probe(centre(i), `${tag} ${i < KEYWORDS.length ? KEYWORDS[i] : ["wis-2x (256 PNG @2x, hot 40,40)", "wis-svg (128 SVG @1x, hot 40,40)"][i - KEYWORDS.length]}`);
  // Calibration: the first cell's text is visible to grim only if the layout is where we think;
  // the plane hotspot of the custom cells (not 1,1) shows the pointer is over the intended cell.
  for (let i = 0; i < KEYWORDS.length + 2; i++) await probeCell(i, "DSF1");

  say("\n== R8b (informational, needs --force-device-scale-factor=3) ==");
  // A 3x3 page of vw/vh cells; at DSF 3 Chrome's toolbar takes ~280 physical px, so row centres
  // are ~367/540/713 and column centres ~131/394/657 (physical, Chrome's window is ~790 wide).
  const K3 = ["context-menu", "help", "cell", "alias", "copy", "no-drop", "not-allowed", "grab", "zoom-in"];
  await put("/tmp/r2b.html", `<!doctype html><title>r2b3</title><style>body{margin:0;display:grid;grid-template-columns:repeat(3,33vw);grid-auto-rows:33vh}div{border:1px solid #ccc}</style><body>${K3.map((k) => `<div style="cursor:${k}">${k}</div>`).join("")}</body>`);
  await chrome("--force-device-scale-factor=3", "forced DSF 3");
  for (let i = 0; i < K3.length; i++) await probe([[131, 394, 657][i % 3], [367, 540, 713][Math.floor(i / 3)]], `DSF3-forced ${K3[i]}`);
} catch (e) {
  say("ERROR", String(e?.stack ?? e));
} finally {
  say(`host seconds: ${guest.hostSeconds().toFixed(1)}`);
  guest.stop();
}
