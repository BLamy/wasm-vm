// What does the kernel's cursor plane look like when the compositor goes away and comes back?
import { bootNative } from "../../../tools/replay-desktop/native-shell.mjs";
const [image, out] = process.argv.slice(2);
const guest = await bootNative({ image, out, timeoutMin: 20 });
const { sh, waitFor } = guest;
const planes = async (label) => {
  const text = await sh("cat /sys/kernel/debug/dri/0/state", label);
  const found = text.split(/^plane\[\d+\]: /m).slice(1).map((b) => `${b.split("\n")[0].trim()} crtc=${/^\s*crtc=(.*)$/m.exec(b)?.[1]} fb=${/^\s*fb=(\d+)/m.exec(b)?.[1]} pos=${/crtc-pos=(\S+)/.exec(b)?.[1]}`);
  console.log(label, JSON.stringify(found));
};
try {
  await waitFor((s) => /REPLAY_DESKTOP_READY uptime=/.test(s), "READY");
  await guest.rootShell();
  await sh("mount -t debugfs none /sys/kernel/debug 2>/dev/null; true", "debugfs");
  await planes("session up:");
  await sh("kill $(pidof sway); sleep 3", "kill sway");
  console.log("sway pids after kill:", JSON.stringify((await sh("pidof sway; echo end", "pidof")).trim()));
  await planes("sway gone:");
  await sh("pkill -9 chrome; pkill foot; rm -rf /run/user/1000/replay-chromium /run/user/1000/sway-ipc.* /run/user/1000/wayland-*; (su -s /bin/sh desktop -c /usr/local/bin/replay-desktop-session </dev/null >/run/session2.log 2>&1 &); sleep 8", "restart session");
  await planes("session restarted (8 guest s on):");
} catch (e) { console.log("ERROR", String(e)); } finally { guest.stop(); }
