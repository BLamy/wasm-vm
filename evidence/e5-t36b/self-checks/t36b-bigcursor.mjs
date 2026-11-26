// E5-T36b self-check: a client cursor larger than the 64x64 plane (a page's 100x100 custom
// cursor in the guest's Chrome). The pointer must still be drawn: sway paints it into the frame.
import { bootNative, last } from "../../../tools/replay-desktop/native-shell.mjs";
const [image, out] = process.argv.slice(2);
const guest = await bootNative({ image, out, timeoutMin: 40 });
const { sh, waitFor } = guest;
const planes = async (label) => {
  const text = await sh("cat /sys/kernel/debug/dri/0/state", label);
  const found = text.split(/^plane\[\d+\]: /m).slice(1).map((b) => `${b.split("\n")[0].trim()} crtc=${/^\s*crtc=(.*)$/m.exec(b)?.[1]} fb=${/^\s*fb=(\d+)/m.exec(b)?.[1]} pos=${/crtc-pos=(\S+)/.exec(b)?.[1]}`);
  console.log(label, JSON.stringify(found)); return found;
};
const asDesktop = (cmd) => `su -s /bin/sh desktop -c 'export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=$(ls /run/user/1000 | grep -m1 "^wayland-[0-9]*$"); ${cmd}'`;
const region = async (x, y, label) => {
  const hash = last(await sh(`${asDesktop(`grim -g "${x - 60},${y - 60} 160x160" -t ppm - 2>/dev/null`)} | sha256sum | cut -c1-16`, label));
  console.log(label, hash); return hash;
};
try {
  await waitFor((s) => /REPLAY_DESKTOP_READY uptime=/.test(s), "READY");
  await guest.rootShell();
  await sh("mount -t debugfs none /sys/kernel/debug 2>/dev/null; export SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock | head -n 1)", "setup");
  await sh(`cat > /tmp/big.html <<'EOS'
<!doctype html><title>big cursor</title>
<body style="margin:0;background:#fff;height:100vh;cursor:url(&quot;data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='red'/></svg>&quot;) 50 50, crosshair"></body>
EOS
chmod 644 /tmp/big.html; pkill chrome; sleep 2`, "page");
  await sh(`${asDesktop("export RECORD_REPLAY_DONT_RECORD=1; /opt/replay-chromium/chrome --ozone-platform=wayland --disable-gpu --no-first-run --no-default-browser-check --disable-background-networking --disable-component-update --disable-sync --password-store=basic --num-raster-threads=1 --renderer-process-limit=1 --user-data-dir=/tmp/chrome-big file:///tmp/big.html >/tmp/chrome-big.log 2>&1 &")}; sleep 45`, "chrome with the page");
  console.log("windows:", last(await sh("swaymsg -t get_tree | grep -c 'big cursor'; true", "tree")));
  const spot = [300, 500], away = [1150, 650];
  await sh(`swaymsg seat seat0 cursor set ${away[0]} ${away[1]} >/dev/null; sleep 2`, "pointer over the terminal");
  await planes("pointer over the terminal:");
  const before = await region(...spot, "page region, pointer away:");
  await sh(`swaymsg seat seat0 cursor set ${spot[0] + 3} ${spot[1] + 3} >/dev/null; sleep 1; swaymsg seat seat0 cursor set ${spot[0]} ${spot[1]} >/dev/null; sleep 3`, "pointer over the page");
  const over = await planes("pointer over the page with a 100x100 cursor:");
  const on = await region(...spot, "page region, pointer on it:");
  console.log("cursor plane off the CRTC:", /plane-1 crtc=\(null\)/.test(over.join(" ")), "| pointer painted into the frame:", before !== on);
  await sh(`swaymsg seat seat0 cursor set ${away[0]} ${away[1]} >/dev/null; sleep 2`, "pointer back over the terminal");
  await planes("pointer back over the terminal:");
  const after = await region(...spot, "page region, pointer away again:");
  console.log("frame restored:", after === before);
} catch (e) { console.log("ERROR", String(e?.stack ?? e)); } finally { guest.stop(); }
