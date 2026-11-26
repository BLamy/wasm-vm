// E5-T36b self-check of two attack-list items, natively: a cursor image larger than the 64x64
// plane (the pointer must still be drawn: sway falls back to painting it), and what the kernel's
// cursor plane does when a client hides the pointer.
import { createHash } from "node:crypto";
import { bootNative, last } from "../../../tools/replay-desktop/native-shell.mjs";
const [image, out] = process.argv.slice(2);
const guest = await bootNative({ image, out, timeoutMin: 30 });
const { sh, waitFor } = guest;
const planes = async (label) => {
  const text = await sh("cat /sys/kernel/debug/dri/0/state", label);
  const found = text.split(/^plane\[\d+\]: /m).slice(1).map((b) => `${b.split("\n")[0].trim()} crtc=${/^\s*crtc=(.*)$/m.exec(b)?.[1]} fb=${/^\s*fb=(\d+)/m.exec(b)?.[1]} pos=${/crtc-pos=(\S+)/.exec(b)?.[1]}`);
  console.log(label, JSON.stringify(found));
  return found;
};
// sha256 of a 96x96 region of the composited output around (x, y), as grim sees it.
const region = async (x, y, label) => {
  const hash = last(await sh(`su -s /bin/sh desktop -c 'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=$(ls /run/user/1000 | grep -m1 "^wayland-[0-9]*$") grim -g "${x - 16},${y - 16} 96x96" -t ppm - 2>/dev/null' | sha256sum | cut -c1-16`, label));
  console.log(label, hash);
  return hash;
};
try {
  await waitFor((s) => /REPLAY_DESKTOP_READY uptime=/.test(s), "READY");
  await guest.rootShell();
  await sh("mount -t debugfs none /sys/kernel/debug 2>/dev/null; export SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock | head -n 1)", "setup");
  // An empty part of the terminal's background.
  const spot = [1150, 650], away = [1150, 300];
  await sh(`swaymsg seat seat0 cursor set ${spot[0]} ${spot[1]} >/dev/null; sleep 1`, "pointer to the spot");
  await planes("64 px cursor, pointer on the spot:");
  const hwOn = await region(...spot, "frame around the pointer (hardware cursor):");
  await sh(`swaymsg seat seat0 cursor set ${away[0]} ${away[1]} >/dev/null; sleep 1`, "pointer away");
  const hwAway = await region(...spot, "same region, pointer away:");
  console.log("hardware cursor: the frame carries no pointer:", hwOn === hwAway);
  // A cursor theme size the 64x64 plane cannot hold.
  console.log("xcursor 128:", last(await sh("swaymsg seat seat0 xcursor_theme default 128 >/dev/null && echo SET; sleep 2", "xcursor 128")));
  await sh(`swaymsg seat seat0 cursor set ${spot[0]} ${spot[1]} >/dev/null; sleep 1`, "pointer to the spot");
  await planes("128 px cursor, pointer on the spot:");
  const swOn = await region(...spot, "frame around the pointer (128 px cursor):");
  await sh(`swaymsg seat seat0 cursor set ${away[0]} ${away[1]} >/dev/null; sleep 1`, "pointer away");
  const swAway = await region(...spot, "same region, pointer away:");
  console.log("oversized cursor: the pointer is painted into the frame:", swOn !== swAway);
  // Back to a size the plane holds.
  await sh("swaymsg seat seat0 xcursor_theme default 24 >/dev/null; sleep 2", "xcursor 24");
  await sh(`swaymsg seat seat0 cursor set ${spot[0]} ${spot[1]} >/dev/null; sleep 1`, "pointer to the spot");
  await planes("24 px theme again, pointer on the spot:");
  // A client hides the pointer: sway's own switch for it.
  await sh("swaymsg seat seat0 hide_cursor 1000 >/dev/null; sleep 3", "hide_cursor");
  await planes("after sway hid the cursor (1 s idle timeout, 3 s on):");
  await sh(`swaymsg seat seat0 cursor set ${away[0]} ${away[1]} >/dev/null; sleep 1`, "pointer moved");
  await planes("after the pointer moved again:");
} catch (e) { console.log("ERROR", String(e?.stack ?? e)); } finally { guest.stop(); }
