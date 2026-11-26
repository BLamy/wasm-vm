// E5-T36b verifier: live attacks on one native boot of a Replay desktop image, driven from the
// serial root shell with the task's own helper (tools/replay-desktop/native-shell.mjs).
//
//   node evidence/e5-t36b/verifier/attacks.mjs <image> <out dir> new|gen1
//
// `new`  — provenance, the "no painted pointer" check, screen edges, hide/show with real input
//          events (written to the devices' evdev nodes), an oversized cursor theme, and the
//          session restarted on atomic KMS.
// `gen1` — the positive control for the "no painted pointer" check only.
// Everything printed is an observation; the predictions are in predictions.md.
import { execFileSync } from "node:child_process";
import { bootNative, last, lines, repo } from "../../../tools/replay-desktop/native-shell.mjs";

const [image, out, mode] = process.argv.slice(2);
const guest = await bootNative({ image, out, timeoutMin: 45 });
const { waitFor } = guest;
const sh = (cmd, what) => {
  if (cmd.length > 900) throw new Error(`command too long for the serial line editor: ${what}`);
  return guest.sh(cmd, what);
};
const say = (...a) => console.log(...a);
// The acceptance script's own position parser (tools/verify/e5-t36b-hardware-cursor.mjs:40).
const ACCEPTANCE_POS = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/;
// What the kernel prints: DRM_RECT_FMT is "%dx%d%+d%+d".
const KERNEL_POS = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/;

async function planes(label) {
  const text = await sh("cat /sys/kernel/debug/dri/0/state", label);
  const found = text.split(/^plane\[\d+\]: /m).slice(1).map((b) => {
    const raw = /^\s*crtc-pos=(.*)$/m.exec(b)?.[1]?.trim() ?? null;
    const k = KERNEL_POS.exec(raw ?? "");
    return { name: b.split("\n")[0].trim(), crtc: /^\s*crtc=(.*)$/m.exec(b)?.[1]?.trim(), fb: Number(/^\s*fb=(\d+)/m.exec(b)?.[1]),
      fbSize: /^\s*size=(\S+)/m.exec(b)?.[1] ?? null, raw, w: k && Number(k[1]), h: k && Number(k[2]), x: k && Number(k[3]), y: k && Number(k[4]),
      acceptanceParses: ACCEPTANCE_POS.test(raw ?? "") };
  });
  const cursor = found.find((p) => p.name !== "plane-0");
  say(`${label} ${found.map((p) => `${p.name} crtc=${p.crtc} fb=${p.fb}${p.fbSize ? `(${p.fbSize})` : ""} crtc-pos=${p.raw}`).join(" | ")}`);
  return { found, cursor, on: cursor.crtc !== "(null)" && cursor.fb > 0 };
}
const move = (x, y) => sh(`swaymsg seat seat0 cursor set ${x} ${y} >/dev/null && echo MOVED; sleep 1`, `pointer to ${x},${y}`);
const asDesktop = (cmd) => `su -s /bin/sh desktop -c 'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=$(ls /run/user/1000 | grep -m1 "^wayland-[0-9]*$") ${cmd}'`;
// sha256 of a region of the composited output, as grim (wlr-screencopy, no cursor overlay asked) sees it.
async function region(x, y, w, h, label) {
  const hash = last(await sh(`${asDesktop(`grim -g "${x},${y} ${w}x${h}" -t ppm - 2>/dev/null`)} | sha256sum | cut -c1-16`, label));
  say(`${label} region ${x},${y} ${w}x${h} sha256=${hash}`);
  return hash;
}
// One spot: the region with the pointer inside it, the same region with the pointer far away,
// and the first again (so a frame that changes for another reason is not read as a pointer).
const EMPTY = "e3b0c44298fc1c14"; // sha256 of no bytes: grim printed nothing
async function paintedAt(spot, away, label) {
  const rx = Math.max(0, spot[0] - 16), ry = Math.max(0, spot[1] - 16);
  await move(...spot);
  const p = await planes(`${label}: pointer on the spot ${spot}:`);
  const on = await region(rx, ry, 96, 96, `${label}: pointer on the spot,`);
  await move(...away);
  const off = await region(rx, ry, 96, 96, `${label}: pointer away at ${away},`);
  await move(...spot);
  const again = await region(rx, ry, 96, 96, `${label}: pointer on the spot again,`);
  const valid = on === again && ![on, off].includes(EMPTY);
  say(`${label}: cursor plane on the CRTC=${p.on}; the composited frame carries a pointer=${on !== off}; measurement valid (repeatable, grim produced pixels)=${valid}`);
  return { planeOn: p.on, painted: on !== off, valid };
}
// struct input_event on a 64-bit kernel: 16 bytes of time, u16 type, u16 code, s32 value.
const EV_SYN = 0, EV_KEY = 1, EV_ABS = 3, KEY_A = 30, ABS_X = 0, ABS_Y = 1;
function event(type, code, value) {
  const b = Buffer.alloc(24);
  b.writeUInt16LE(type, 16); b.writeUInt16LE(code, 18); b.writeInt32LE(value, 20);
  return [...b];
}
const octal = (bytes) => bytes.map((b) => `\\${b.toString(8).padStart(3, "0")}`).join("");
const inject = async (node, events, label) =>
  say(`${label}: ${last(await sh(`printf '${octal(events.flat())}' > ${node} && echo INJECTED ${events.length} events into ${node}`, label))}`);
const key = (node, label) => inject(node, [event(EV_KEY, KEY_A, 1), event(EV_SYN, 0, 0), event(EV_KEY, KEY_A, 0), event(EV_SYN, 0, 0)], label);
const tabletTo = (node, x, y, label) => inject(node, [
  event(EV_ABS, ABS_X, Math.round(x * 32767 / 1280)), event(EV_ABS, ABS_Y, Math.round(y * 32767 / 800)), event(EV_SYN, 0, 0)], label);

try {
  await waitFor((s) => /REPLAY_DESKTOP_READY uptime=\S+ mem_hwm_kib=\d+/.test(s), "READY");
  say(/REPLAY_DESKTOP_READY[^\r\n]*/.exec(guest.serial())[0]);
  await guest.rootShell();
  await sh("mount -t debugfs none /sys/kernel/debug 2>/dev/null; export SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock | head -n 1)", "setup");
  say("sway environment:", JSON.stringify(lines(await sh("tr '\\0' '\\n' < /proc/$(pidof sway)/environ | grep -E 'WLR_|XCURSOR'", "sway environment")).sort()));

  // ---- P5: can the region check see a painted pointer at all? ----
  say("\n== P5: the composited frame around the pointer, pointer on it and away ==");
  await paintedAt([1150, 650], [1150, 300], "terminal background");
  await paintedAt([300, 400], [640, 100], "Chrome page body");
  if (mode === "gen1") throw Object.assign(new Error("done"), { done: true });

  // ---- P6b: the repo overlay inside the booted image against HEAD ----
  say("\n== P6b: overlay files in the guest against HEAD ==");
  const overlay = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", "HEAD", "tools/replay-desktop/rootfs"], { encoding: "utf8" }).trim().split("\n");
  let same = 0;
  for (const file of overlay) {
    const inGuest = `/${file.slice("tools/replay-desktop/rootfs/".length)}`;
    const want = execFileSync("sh", ["-c", `git -C "${repo}" show "HEAD:${file}" | shasum -a 256`], { encoding: "utf8" }).slice(0, 64);
    const got = last(await sh(`sha256sum ${inGuest} | cut -c1-64`, `sha256 ${inGuest}`));
    if (got === want) same++;
    say(`${got === want ? "same" : "DIFFERENT"} ${inGuest} guest=${got.slice(0, 16)} HEAD=${want.slice(0, 16)}`);
  }
  say(`overlay files identical to HEAD: ${same} of ${overlay.length}`);

  say("\n== inventory ==");
  say(lines(await sh("sway --version; foot --version | head -n 1; ls /usr/share/icons /usr/share/cursors /home/desktop/.icons 2>&1; echo errors-in-sway.log:; grep -c -i -E 'error|fail' /run/user/1000/sway.log", "inventory")).join("\n"));
  say("outputs: " + lines(await sh("swaymsg -t get_outputs | grep -E '\"(name|width|height|scale|dpms|power)\"' | head -n 10", "outputs")).join(" "));
  say("sway.log:\n" + (await sh("head -n 30 /run/user/1000/sway.log | cut -c1-200", "sway.log")).trim());
  const devices = (await sh("cat /proc/bus/input/devices", "input devices")).split(/\n\s*\n/).map((b) => ({
    name: /N: Name="(.*)"/.exec(b)?.[1], event: /Handlers=.*?(event\d+)/.exec(b)?.[1], abs: /B: ABS=/.test(b), kbd: /Handlers=.*\bkbd\b/.test(b) })).filter((d) => d.event);
  say("input devices:", JSON.stringify(devices));
  const keyboard = `/dev/input/${devices.find((d) => d.kbd && !d.abs).event}`;
  const tablet = `/dev/input/${devices.find((d) => d.abs).event}`;

  // ---- P10: screen edges ----
  say("\n== P10: screen edges (sway's own cursor over a title bar, then the four corners) ==");
  await move(40, 10);
  const ref = (await planes("title bar, pointer 40,10:")).cursor;
  const hot = [40 - ref.x, 10 - ref.y];
  say(`hotspot of sway's own cursor over a title bar: ${hot}`);
  for (const [x, y] of [[0, 0], [1279, 0], [0, 799], [1279, 799]]) {
    await move(x, y);
    const p = await planes(`corner ${x},${y}:`);
    say(`corner ${x},${y}: on the CRTC=${p.on} plane=${p.cursor.x},${p.cursor.y} pointer-plane=${[x - p.cursor.x, y - p.cursor.y]} acceptance regex (line 40) parses "${p.cursor.raw}"=${p.cursor.acceptanceParses}`);
  }

  // ---- P8: a hidden pointer and real input ----
  say("\n== P8: hiding the pointer, and real input events ==");
  await sh("swaymsg '[app_id=replay-terminal] focus' >/dev/null; echo ok", "focus the terminal");
  await move(1036, 420);
  await planes("pointer over foot, before typing:");
  await key(keyboard, "KEY_A press+release, foot as shipped");
  await sh("sleep 1", "settle");
  const typed = await planes("after a real key into foot (image as shipped):");
  say(`foot as shipped hides the pointer while typing: ${!typed.on}`);
  say("when-typing:", last(await sh("swaymsg seat seat0 hide_cursor when-typing enable >/dev/null && echo ENABLED", "hide when typing")));
  await key(keyboard, "KEY_A press+release, sway hide_cursor when-typing");
  await sh("sleep 1", "settle");
  const hidden = await planes("after a real key with hide_cursor when-typing:");
  say(`the key hid the pointer: ${!hidden.on}`);
  await move(1000, 500);
  say(`after a move through sway's IPC the plane is on the CRTC: ${(await planes("after swaymsg cursor set 1000 500:")).on}`);
  await tabletTo(tablet, 900, 300, "tablet ABS to 900,300");
  await sh("sleep 1", "settle");
  const back = await planes("after a real pointer event:");
  say(`after a real pointer event the plane is on the CRTC: ${back.on}; pointer-plane=${[900 - back.cursor.x, 300 - back.cursor.y]}`);
  await sh("swaymsg seat seat0 hide_cursor when-typing disable >/dev/null; swaymsg seat seat0 hide_cursor 3000 >/dev/null; sleep 6", "idle timeout 3 s, 6 s idle");
  say(`idle for 6 s with hide_cursor 3000, plane on the CRTC: ${(await planes("after the idle timeout:")).on}`);
  await tabletTo(tablet, 950, 350, "tablet ABS to 950,350");
  await sh("sleep 0.5", "settle");
  const woke = await planes("right after a real pointer event:");
  say(`after a real pointer event the plane is on the CRTC: ${woke.on}; pointer-plane=${[950 - woke.cursor.x, 350 - woke.cursor.y]}`);
  await sh("swaymsg seat seat0 hide_cursor 0 >/dev/null; echo ok", "idle timeout off");
  await tabletTo(tablet, 960, 360, "tablet ABS to 960,360");
  await sh("sleep 1", "settle");
  await planes("idle timeout off, after a real pointer event:");

  // ---- P4: an oversized cursor ----
  say("\n== P4: a cursor image larger than the 64x64 plane (an Xcursor theme in ~/.icons, 128x128 only) ==");
  const header = [0x58, 0x63, 0x75, 0x72, 16, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 2, 0, 0xfd, 0xff, 128, 0, 0, 0, 28, 0, 0, 0,
    36, 0, 0, 0, 2, 0, 0xfd, 0xff, 128, 0, 0, 0, 1, 0, 0, 0, 128, 0, 0, 0, 128, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0];
  say("theme:", last(await sh(`d=/home/desktop/.icons/big128/cursors; mkdir -p $d && { printf '${octal(header)}'; head -c 65536 /dev/zero | tr '\\000' '\\377'; } > $d/default && for n in left_ptr text xterm pointer hand2; do ln -s default $d/$n; done; chown -R 1000:1000 /home/desktop/.icons; echo $(wc -c < $d/default) bytes $(ls $d | wc -l) names`, "install the theme")));
  const title = [1036, 10], titleAway = [300, 10];
  const before = await paintedAt(title, titleAway, "built-in cursor, title bar");
  say("xcursor_theme big128:", last(await sh("swaymsg seat seat0 xcursor_theme big128 128 >/dev/null && echo SET; sleep 2", "select the theme")));
  say("sway environment now:", JSON.stringify(lines(await sh("tr '\\0' '\\n' < /proc/$(pidof sway)/environ | grep -E 'WLR_|XCURSOR'", "sway environment")).sort()));
  const big = await paintedAt(title, titleAway, "128 px theme, title bar");
  const bigFoot = await paintedAt([1036, 420], [1150, 300], "128 px theme, foot (cursor-shape)");
  const bigChrome = await paintedAt([300, 400], [640, 100], "128 px theme, Chrome page (its own small cursor)");
  say(`OVERSIZED over the title bar: plane on the CRTC=${big.planeOn}, pointer painted=${big.painted}; a pointer is drawn somewhere=${big.planeOn || big.painted}`);
  say(`OVERSIZED over foot: plane on the CRTC=${bigFoot.planeOn}, pointer painted=${bigFoot.painted}; a pointer is drawn somewhere=${bigFoot.planeOn || bigFoot.painted}`);
  say(`back over a client with a small cursor: plane on the CRTC=${bigChrome.planeOn}, pointer painted=${bigChrome.painted}`);
  // The acceptance script's four positions on this session: would its assertions hold?
  const four = [];
  for (const [x, y] of [[300, 400], [640, 100], [93, 516], [1036, 420]]) { await move(x, y); four.push((await planes(`acceptance position ${x},${y}:`)).on); }
  say(`acceptance positions with a second plane on the CRTC: ${JSON.stringify(four)} -> "a second plane ... after every move" would ${four.every(Boolean) ? "PASS" : "FAIL"}`);
  await sh("swaymsg seat seat0 xcursor_theme default 24 >/dev/null; sleep 2", "built-in theme again");
  const after = await paintedAt(title, titleAway, "built-in cursor again, title bar");
  say(`restored: plane on the CRTC=${after.planeOn}, pointer painted=${after.painted} (before: ${before.planeOn}, ${before.painted})`);
  say("sway.log errors so far: " + (await sh("grep -i -E 'error|fail' /run/user/1000/sway.log | cut -c1-200 | tail -n 12; echo end", "sway.log errors")).trim());

  // ---- P12: the same image on atomic KMS ----
  say("\n== P12: the session restarted without WLR_DRM_NO_ATOMIC (atomic KMS, hardware cursors allowed) ==");
  say("script:", last(await sh("sed -e 's/ WLR_DRM_NO_ATOMIC=1//' /usr/local/bin/replay-desktop-session > /tmp/session-atomic && chmod 755 /tmp/session-atomic && grep '^export WLR' /tmp/session-atomic", "atomic session script")));
  const restart = (script) => sh(`kill $(pidof sway); sleep 3; pkill -9 chrome; pkill foot; rm -rf /run/user/1000/replay-chromium /run/user/1000/sway-ipc.* /run/user/1000/wayland-*; (su -s /bin/sh desktop -c ${script} </dev/null >/run/session2.log 2>&1 &); sleep 5; export SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock | head -n 1); i=0; while [ $i -lt 90 ] && [ "$(swaymsg -t get_tree 2>/dev/null | grep -c '"app_id": "')" -lt 2 ]; do sleep 1; i=$((i+1)); done; sleep 5; echo windows mapped after $i s`, `restart the session with ${script}`).then((o) => say(`restart with ${script}: ${last(o)}`));
  await restart("/tmp/session-atomic");
  say("sway environment:", JSON.stringify(lines(await sh("tr '\\0' '\\n' < /proc/$(pidof sway)/environ | grep -E 'WLR_|XCURSOR'", "sway environment")).sort()));
  const atomic = await paintedAt([1150, 650], [1150, 300], "atomic KMS, terminal background");
  say(`ATOMIC: plane on the CRTC=${atomic.planeOn}, pointer painted=${atomic.painted}`);
  await restart("/usr/local/bin/replay-desktop-session");
  say("sway environment:", JSON.stringify(lines(await sh("tr '\\0' '\\n' < /proc/$(pidof sway)/environ | grep -E 'WLR_|XCURSOR'", "sway environment")).sort()));
  const legacy = await paintedAt([1150, 650], [1150, 300], "the image's own session again, terminal background");
  say(`LEGACY AGAIN: plane on the CRTC=${legacy.planeOn}, pointer painted=${legacy.painted}`);
} catch (e) {
  if (!e.done) say("ERROR", String(e?.stack ?? e));
} finally {
  say(`host seconds: ${guest.hostSeconds().toFixed(1)}`);
  guest.stop();
}
