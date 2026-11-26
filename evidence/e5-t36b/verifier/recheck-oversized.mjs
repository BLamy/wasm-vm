// E5-T36b verifier: re-check of the oversized-cursor finding, with controls.
//
//   node evidence/e5-t36b/verifier/recheck-oversized.mjs <image> <out dir> legacy|gen1
//
// The pointer is moved with real input events (written to the virtio tablet's evdev node), at
// positions the tablet's axis maps to whole pixels. Three themes are written to ~/.icons with the
// same generator and differ only in the size of their one image: 64x64 (fits the plane), 65x65
// and 128x128 (do not). For each: is the cursor plane on the CRTC, and does the composited frame
// carry a pointer? `legacy` runs that on the image's own session, then on the same session with
// sway's debug log, then on the same image restarted on atomic KMS. `gen1` runs the 128x128
// theme on the published image (software cursors).
import { bootNative, last, lines } from "../../../tools/replay-desktop/native-shell.mjs";

const [image, out, mode] = process.argv.slice(2);
const guest = await bootNative({ image, out, timeoutMin: 45 });
const { waitFor } = guest;
const sh = (cmd, what) => {
  if (cmd.length > 900) throw new Error(`command too long for the serial line editor: ${what}`);
  return guest.sh(cmd, what);
};
const say = (...a) => console.log(...a);
const KERNEL_POS = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/; // DRM_RECT_FMT "%dx%d%+d%+d"
async function planes(label) {
  const text = await sh("cat /sys/kernel/debug/dri/0/state", label);
  const found = text.split(/^plane\[\d+\]: /m).slice(1).map((b) => {
    const raw = /^\s*crtc-pos=(.*)$/m.exec(b)?.[1]?.trim() ?? null;
    const k = KERNEL_POS.exec(raw ?? "");
    return { name: b.split("\n")[0].trim(), crtc: /^\s*crtc=(.*)$/m.exec(b)?.[1]?.trim(), fb: Number(/^\s*fb=(\d+)/m.exec(b)?.[1]), raw, x: k && Number(k[3]), y: k && Number(k[4]) };
  });
  const cursor = found.find((p) => p.name !== "plane-0");
  say(`${label} ${found.map((p) => `${p.name} crtc=${p.crtc} fb=${p.fb} crtc-pos=${p.raw}`).join(" | ")}`);
  return { cursor, on: cursor.crtc !== "(null)" && cursor.fb > 0 };
}
const octal = (bytes) => bytes.map((b) => `\\${b.toString(8).padStart(3, "0")}`).join("");
function event(type, code, value) {
  const b = Buffer.alloc(24); // 16 bytes of time, u16 type, u16 code, s32 value
  b.writeUInt16LE(type, 16); b.writeUInt16LE(code, 18); b.writeInt32LE(value, 20);
  return [...b];
}
let tablet;
// EV_ABS X, EV_ABS Y, EV_SYN; the axis value is the smallest that maps to the pixel.
const pointerTo = async (x, y) => {
  const o = last(await sh(`printf '${octal([event(3, 0, Math.ceil(x * 32768 / 1280)), event(3, 1, Math.ceil(y * 32768 / 800)), event(0, 0, 0)].flat())}' > ${tablet} && echo INJECTED; sleep 1`, `tablet to ${x},${y}`));
  if (o !== "INJECTED") throw new Error(`tablet event not written: ${o}`);
};
const asDesktop = (cmd) => `su -s /bin/sh desktop -c 'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=$(ls /run/user/1000 | grep -m1 "^wayland-[0-9]*$") ${cmd}'`;
const EMPTY = "e3b0c44298fc1c14";
const region = async (x, y, label) => last(await sh(`${asDesktop(`grim -g "${x},${y} 96x96" -t ppm - 2>/dev/null`)} | sha256sum | cut -c1-16`, label));
// Pointer on the spot, away, on the spot again: plane state and the frame around the spot.
async function probe(spot, away, label) {
  const rx = Math.max(0, spot[0] - 16), ry = Math.max(0, spot[1] - 16);
  await pointerTo(...spot);
  const p = await planes(`${label}: pointer at ${spot}:`);
  const on = await region(rx, ry, `${label} on`);
  await pointerTo(...away);
  const off = await region(rx, ry, `${label} away`);
  await pointerTo(...spot);
  const again = await region(rx, ry, `${label} again`);
  const valid = on === again && ![on, off].includes(EMPTY);
  const r = { planeOn: p.on, offset: p.on ? [spot[0] - p.cursor.x, spot[1] - p.cursor.y] : null, painted: on !== off, valid };
  say(`${label}: frame on=${on} away=${off} again=${again} -> RESULT plane on the CRTC=${r.planeOn}${r.offset ? ` pointer-plane=${r.offset}` : ""}, pointer painted into the frame=${r.painted}, a pointer is drawn=${r.planeOn || r.painted}, valid=${valid}`);
  return r;
}
async function theme(name, n) {
  const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255];
  // Xcursor file: header, one table entry, one image chunk; n*n opaque white ARGB pixels follow.
  const header = [0x58, 0x63, 0x75, 0x72, ...u32(16), ...u32(0x10000), ...u32(1), ...u32(0xfffd0002), ...u32(n), ...u32(28),
    ...u32(36), ...u32(0xfffd0002), ...u32(n), ...u32(1), ...u32(n), ...u32(n), ...u32(4), ...u32(4), ...u32(0)];
  say(`theme ${name} (${n}x${n}, hotspot 4,4): ` + last(await sh(`d=/home/desktop/.icons/${name}/cursors; mkdir -p $d && { printf '${octal(header)}'; head -c ${4 * n * n} /dev/zero | tr '\\000' '\\377'; } > $d/default && for n in left_ptr text xterm pointer hand2; do ln -s default $d/$n; done; chown -R 1000:1000 /home/desktop/.icons; echo $(wc -c < $d/default) bytes`, `write theme ${name}`)));
}
const select = async (name, size) => say(`xcursor_theme ${name} ${size}: ` + last(await sh(`swaymsg seat seat0 xcursor_theme ${name} ${size} >/dev/null && echo SET; sleep 2`, `select ${name}`)));
const env = async () => say("sway environment: " + JSON.stringify(lines(await sh("tr '\\0' '\\n' < /proc/$(pidof sway)/environ | grep -E 'WLR_|XCURSOR'", "sway environment")).sort()) +
  " | sway command line: " + last(await sh("tr '\\0' ' ' < /proc/$(pidof sway)/cmdline; echo", "sway command line")));
const restart = async (script) => say(`session restarted with ${script}: ` + last(await sh(`kill $(pidof sway); sleep 3; pkill -9 chrome; pkill foot; rm -rf /run/user/1000/replay-chromium /run/user/1000/sway-ipc.* /run/user/1000/wayland-*; (su -s /bin/sh desktop -c ${script} </dev/null >/run/session2.log 2>&1 &); sleep 5; export SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock | head -n 1); i=0; while [ $i -lt 90 ] && [ "$(swaymsg -t get_tree 2>/dev/null | grep -c '"app_id": "')" -lt 2 ]; do sleep 1; i=$((i+1)); done; sleep 5; echo windows mapped after $i s`, `restart with ${script}`)));

const title = [1040, 10], titleAway = [320, 10];   // sway's own cursor, over two title bars
const term = [1040, 425], termAway = [1150, 300];  // foot (cursor-shape: sway's theme)
const page = [320, 400];                            // Chrome's page body (Chrome's own cursor image)
try {
  await waitFor((s) => /REPLAY_DESKTOP_READY uptime=\S+ mem_hwm_kib=\d+/.test(s), "READY");
  await guest.rootShell();
  await sh("mount -t debugfs none /sys/kernel/debug 2>/dev/null; export SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock | head -n 1)", "setup");
  const devices = (await sh("cat /proc/bus/input/devices", "input devices")).split(/\n\s*\n/);
  tablet = `/dev/input/${/Handlers=.*?(event\d+)/.exec(devices.find((b) => /B: ABS=/.test(b)))[1]}`;
  say(`tablet node: ${tablet}`);
  await env();
  await theme("c64", 64); await theme("c65", 65); await theme("big128", 128);

  if (mode === "gen1") {
    say("\n== generation 1 (software cursors): the 128x128 theme ==");
    await probe(title, titleAway, "gen1, built-in cursor, title bar");
    await select("big128", 128);
    await probe(title, titleAway, "gen1, 128x128 theme, title bar");
    await probe(term, termAway, "gen1, 128x128 theme, foot");
    throw Object.assign(new Error("done"), { done: true });
  }

  say("\n== the image's own session (legacy KMS) ==");
  await probe(title, titleAway, "built-in cursor, title bar");
  await select("c64", 64);
  await probe(title, titleAway, "64x64 theme (fits the plane), title bar");
  await probe(term, termAway, "64x64 theme (fits the plane), foot");
  await select("c65", 65);
  await probe(title, titleAway, "65x65 theme, title bar");
  await probe(term, termAway, "65x65 theme, foot");
  await select("big128", 128);
  await probe(title, titleAway, "128x128 theme, title bar");
  await probe(term, termAway, "128x128 theme, foot");
  say("-- from a client whose own cursor image is on the plane (Chrome) onto foot, 128x128 theme --");
  await pointerTo(...page);
  const onPage = await planes(`pointer over Chrome's page ${page}:`);
  say(`over Chrome's page: plane on the CRTC=${onPage.on} pointer-plane=${[page[0] - onPage.cursor.x, page[1] - onPage.cursor.y]}`);
  await pointerTo(...term);
  const onTerm = await planes(`pointer moved onto foot ${term}:`);
  say(`moved onto foot: plane on the CRTC=${onTerm.on}${onTerm.on ? ` pointer-plane=${[term[0] - onTerm.cursor.x, term[1] - onTerm.cursor.y]} (the theme's hotspot is 4,4)` : ""}`);
  await select("default", 24);
  await probe(title, titleAway, "built-in cursor again, title bar");

  say("\n== the same session with sway's debug log (sway -d), 128x128 theme ==");
  await sh("sed -e 's/^exec sway -c/exec sway -d -c/' /usr/local/bin/replay-desktop-session > /tmp/session-debug && chmod 755 /tmp/session-debug; grep -c 'sway -d' /tmp/session-debug", "debug session script");
  await restart("/tmp/session-debug");
  await env();
  await probe(title, titleAway, "debug session, built-in cursor, title bar");
  await sh("wc -l < /run/user/1000/sway.log > /tmp/log-mark", "mark the log");
  await select("big128", 128);
  await probe(title, titleAway, "debug session, 128x128 theme, title bar");
  say("sway.log lines about the cursor since the theme was selected (count, text):\n" +
    (await sh("tail -n +$(($(cat /tmp/log-mark)+1)) /run/user/1000/sway.log | grep -i -E 'cursor' | sed -e 's/^[0-9:.]* //' | cut -c1-150 | sort | uniq -c | sort -rn | head -n 12", "cursor log lines")).trimEnd());

  say("\n== the same image restarted on atomic KMS (no WLR_DRM_NO_ATOMIC), 128x128 theme ==");
  await sh("sed -e 's/ WLR_DRM_NO_ATOMIC=1//' /usr/local/bin/replay-desktop-session > /tmp/session-atomic && chmod 755 /tmp/session-atomic", "atomic session script");
  await restart("/tmp/session-atomic");
  await env();
  await probe(title, titleAway, "atomic KMS, built-in cursor, title bar");
  await select("big128", 128);
  await probe(title, titleAway, "atomic KMS, 128x128 theme, title bar");
  await probe(term, termAway, "atomic KMS, 128x128 theme, foot");
} catch (e) {
  if (!e.done) say("ERROR", String(e?.stack ?? e));
} finally {
  say(`host seconds: ${guest.hostSeconds().toFixed(1)}`);
  guest.stop();
}
