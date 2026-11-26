// E5-T36b round-2 verifier: can anything the image ships give the cursor plane an image larger
// than 64x64? Predictions R5-R10 in predictions.md.
//
//   node evidence/e5-t36b/verifier-r2/attacks-r2.mjs <image> <out dir>
//
// Pointer moves are real virtio-tablet events (as round 1's recheck-oversized.mjs). "A pointer is
// drawn" = the cursor plane is on the CRTC, or the frame around the pointer changes with it.
import { deflateSync } from "node:zlib";
import { bootNative, last, lines } from "../../../tools/replay-desktop/native-shell.mjs";

const [image, out] = process.argv.slice(2);
const guest = await bootNative({ image, out, timeoutMin: 60 });
const { waitFor } = guest;
const sh = (cmd, what) => {
  if (cmd.length > 900) throw new Error(`command too long for the serial line editor: ${what} (${cmd.length})`);
  return guest.sh(cmd, what);
};
const say = (...a) => console.log(...a);
const KERNEL_POS = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/;
async function planes(label) {
  const text = await sh("cat /sys/kernel/debug/dri/0/state", label);
  const found = text.split(/^plane\[\d+\]: /m).slice(1).map((b) => {
    const raw = /^\s*crtc-pos=(.*)$/m.exec(b)?.[1]?.trim() ?? null;
    const k = KERNEL_POS.exec(raw ?? "");
    return { name: b.split("\n")[0].trim(), crtc: /^\s*crtc=(.*)$/m.exec(b)?.[1]?.trim(), fb: Number(/^\s*fb=(\d+)/m.exec(b)?.[1]), raw,
      w: k && Number(k[1]), h: k && Number(k[2]), x: k && Number(k[3]), y: k && Number(k[4]) };
  });
  const cursor = found.find((p) => p.name !== "plane-0");
  say(`${label} ${found.map((p) => `${p.name} crtc=${p.crtc} fb=${p.fb} crtc-pos=${p.raw}`).join(" | ")}`);
  return { cursor, on: cursor.crtc !== "(null)" && cursor.fb > 0 };
}
const octal = (bytes) => bytes.map((b) => `\\${b.toString(8).padStart(3, "0")}`).join("");
function event(type, code, value) {
  const b = Buffer.alloc(24); b.writeUInt16LE(type, 16); b.writeUInt16LE(code, 18); b.writeInt32LE(value, 20); return [...b];
}
let tablet;
const pointerTo = async (x, y) => {
  const o = last(await sh(`printf '${octal([event(3, 0, Math.ceil(x * 32768 / 1280)), event(3, 1, Math.ceil(y * 32768 / 800)), event(0, 0, 0)].flat())}' > ${tablet} && echo INJECTED; sleep 1`, `tablet to ${x},${y}`));
  if (o !== "INJECTED") throw new Error(`tablet event not written: ${o}`);
};
const asDesktop = (cmd) => `su -s /bin/sh desktop -c 'export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=$(ls /run/user/1000 | grep -m1 "^wayland-[0-9]*$"); ${cmd}'`;
const EMPTY = "e3b0c44298fc1c14";
const region = async (x, y) => last(await sh(`${asDesktop(`grim -g "${x},${y} 96x96" -t ppm - 2>/dev/null`)} | sha256sum | cut -c1-16`, "grim"));
// Pointer on the spot (approached from 3 px away so the client sees motion), away, on again.
async function probe(spot, away, label) {
  const rx = Math.max(0, spot[0] - 16), ry = Math.max(0, spot[1] - 16);
  await pointerTo(spot[0] + 3, spot[1] + 3); await pointerTo(...spot); await sh("sleep 2", "settle");
  const p = await planes(`${label}: pointer at ${spot}:`);
  const on = await region(rx, ry);
  await pointerTo(...away);
  const off = await region(rx, ry);
  await pointerTo(spot[0] + 3, spot[1] + 3); await pointerTo(...spot); await sh("sleep 2", "settle");
  const again = await region(rx, ry);
  const valid = on === again && ![on, off].includes(EMPTY);
  const r = { planeOn: p.on, size: p.on ? `${p.cursor.w}x${p.cursor.h}` : null, offset: p.on ? [spot[0] - p.cursor.x, spot[1] - p.cursor.y] : null, painted: on !== off, valid };
  say(`RESULT ${label}: plane on the CRTC=${r.planeOn}${r.offset ? ` ${r.size} pointer-plane=${r.offset}` : ""} | painted=${r.painted} | a pointer is drawn=${r.planeOn || r.painted} | frame on=${on} away=${off} again=${again} valid=${valid}`);
  return r;
}
// Solid-colour RGBA PNG, n x n.
function png(n, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(n * 4).fill(Buffer.from(rgba))]);
  const raw = Buffer.concat(Array.from({ length: n }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
// Files are written in pieces (the serial line editor takes ~900 chars per command).
async function put(file, text) {
  await sh(`: > ${file}`, `truncate ${file}`);
  for (let i = 0; i < text.length; i += 600) await sh(`printf '%s' '${text.slice(i, i + 600)}' >> ${file}`, `write ${file}`);
  await sh(`chmod 644 ${file}`, "chmod");
}
const chrome = async (flags, label) => {
  await sh("pkill -f /opt/replay-chromium/chrome; sleep 3; true", "stop chrome");
  await sh(`${asDesktop(`/opt/replay-chromium/chrome --ozone-platform=wayland --disable-gpu --no-first-run --no-default-browser-check --disable-background-networking --disable-component-update --disable-sync --password-store=basic --num-raster-threads=1 --renderer-process-limit=1 ${flags} --user-data-dir=/tmp/chrome-r2 file:///tmp/r2.html >/tmp/chrome-r2.log 2>&1 &`)}; sleep 60`, `chrome ${label}`);
  say(`chrome ${label}: windows titled r2 = ${last(await sh("swaymsg -t get_tree | grep -c '\"name\": \"r2'; true", "tree"))}`);
};
const away = [1150, 650]; // over foot
// Chrome's window is the left ~790 px; its page starts ~110 px down.
const bands = [["128x128 PNG 1x", [130, 300]], ["128 image-set 1x", [395, 300]], ["256 PNG image-set 2x", [660, 300]]];
const own = [["text input (I-beam)", [200, 650]], ["link (hand)", [600, 650]], ["tab strip (arrow)", [400, 45]]];
try {
  await waitFor((s) => /REPLAY_DESKTOP_READY uptime=\S+ mem_hwm_kib=\d+/.test(s), "READY");
  await guest.rootShell();
  await sh("mount -t debugfs none /sys/kernel/debug 2>/dev/null; export SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock | head -n 1)", "setup");
  const devices = (await sh("cat /proc/bus/input/devices", "input devices")).split(/\n\s*\n/);
  tablet = `/dev/input/${/Handlers=.*?(event\d+)/.exec(devices.find((b) => /B: ABS=/.test(b)))[1]}`;

  say("== R5 inventory ==");
  say("cursor theme dirs/files (find / -xdev -name cursors -o -iname '*xcursor*' -o -name index.theme):\n" + (await sh("find / -xdev \\( -name cursors -o -iname '*xcursor*' -o -name index.theme \\) 2>/dev/null | grep -v ^/proc | head -n 40; echo END", "find themes")).trimEnd());
  say("icon dirs:\n" + (await sh("ls -d /usr/share/icons/* /usr/share/pixmaps /home/desktop/.icons /home/desktop/.local/share/icons 2>&1 | head -n 20; echo END", "icon dirs")).trimEnd());
  for (const proc of ["sway", "foot", "chrome"]) say(`${proc} env XCURSOR/scale vars: ` + JSON.stringify(lines(await sh(`for p in $(pgrep -x ${proc} | head -n 1); do tr '\\0' '\\n' < /proc/$p/environ | grep -E 'XCURSOR|SCALE|GDK|QT_' ; done; echo END`, `${proc} env`))));
  say("chrome browser cmdline: " + last(await sh("tr '\\0' ' ' < /proc/$(pgrep -o -x chrome)/cmdline; echo", "chrome cmdline")));
  say("outputs: " + JSON.stringify(lines(await sh("swaymsg -t get_outputs | grep -E '\"(name|scale|physical_width|physical_height)\"'", "outputs"))));
  say("seat cursor config: " + JSON.stringify(lines(await sh("grep -ri -E 'xcursor|seat|scale' /etc/replay-desktop/sway.conf /etc/sway 2>/dev/null; echo END", "sway conf"))));
  say("gtk/cursor libs: " + JSON.stringify(lines(await sh("ls /usr/lib/*/libgtk-3* /usr/lib/*/libwayland-cursor* /usr/lib/*/libXcursor* 2>/dev/null; ls /home/desktop/.config 2>/dev/null; echo END", "libs"))));
  say("wayland clients (binaries linking libwayland-client): " + JSON.stringify(lines(await sh("for f in /usr/bin/* /usr/local/bin/* /usr/sbin/* /opt/replay-chromium/chrome; do grep -l -s libwayland-client $f; done 2>/dev/null | tr '\\n' ' '; echo", "wayland clients"))));

  const a = png(128, [255, 0, 0, 255]).toString("base64"), b = png(256, [0, 0, 255, 255]).toString("base64");
  const svg = "data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%27128%27 height=%27128%27><rect width=%27128%27 height=%27128%27 fill=%27green%27/></svg>";
  const html = `<!doctype html><title>r2 cursors</title><style>body{margin:0;display:flex;flex-direction:column;height:100vh}.r{flex:1;display:flex}.r>*{flex:1;margin:0;border:0;font-size:40px}</style><body><div class=r>` +
    `<div style="background:#fee;cursor:url(data:image/png;base64,${a}) 40 40, crosshair"></div>` +
    `<div style="background:#efe;cursor:image-set(url(&quot;${svg}&quot;) 1x) 40 40, crosshair"></div>` +
    `<div style="background:#eef;cursor:image-set(url(data:image/png;base64,${b}) 2x) 40 40, crosshair"></div></div>` +
    `<div class=r><input value="text text text text"><a href="#x" style="display:block;background:#ffd">a link a link</a></div></body>`;
  await put("/tmp/r2.html", html);
  say("page bytes: " + last(await sh("wc -c < /tmp/r2.html", "size")) + " (expected " + Buffer.byteLength(html) + ")");

  say("\n== R6/R7: the guest's Chrome at DSF 1 ==");
  await chrome("", "DSF 1");
  for (const [name, spot] of [...bands, ...own]) await probe(spot, away, `DSF1 ${name}`);

  say("\n== R10 novel: sway's own cursor over the tiling seam and title-bar corners ==");
  const tree = await sh("swaymsg -t get_tree | grep -E '\"(app_id|x|width)\"' | tr -d ' ' | tr '\\n' ' '; echo", "tree geometry");
  say("tree geometry: " + last(tree));
  for (const [name, spot] of [["seam between Chrome and foot", [791, 400]], ["seam, 1 px right", [793, 400]], ["foot title bar", [1000, 8]], ["screen right edge", [1279, 400]], ["screen bottom-right", [1279, 799]]])
    await probe(spot, away[0] === spot[0] ? [300, 300] : [1150, 650 === spot[1] ? 600 : 650], `seam ${name}`);

  say("\n== R8 (informational): Chrome with --force-device-scale-factor=2 ==");
  await chrome("--force-device-scale-factor=2", "forced DSF 2");
  for (const [name, spot] of [...bands, ["text input (I-beam)", [200, 650]]]) await probe(spot, away, `DSF2-forced ${name}`);
  await chrome("--force-device-scale-factor=3", "forced DSF 3");
  for (const [name, spot] of [["128x128 PNG 1x", [130, 300]], ["text input (I-beam)", [200, 650]]]) await probe(spot, away, `DSF3-forced ${name}`);

  say("\n== R9 (informational): sway output scale 2 (IPC), built-in cursor and Chrome ==");
  say("scale: " + last(await sh("swaymsg output '*' scale 2 >/dev/null && echo SET; sleep 3", "scale 2")));
  await chrome("", "on a scale-2 output");
  await probe([1150, 400], [300, 300], "scale2 foot (built-in theme)");
  await probe([1000, 8], [300, 300], "scale2 title bar (built-in)");
  await probe([130, 300], [1150, 400], "scale2 Chrome 128x128 PNG");
  await probe([400, 300], [1150, 400], "scale2 Chrome 128 image-set 1x");
} catch (e) {
  say("ERROR", String(e?.stack ?? e));
} finally {
  say(`host seconds: ${guest.hostSeconds().toFixed(1)}`);
  guest.stop();
}
