// Fail-closed observer grammar for the T03f launch-crash claim. These are
// read-only queries, not arbitrary shell utility prefixes. The sole stateful
// exception disables serial echo; it cannot signal or reconfigure Hyprland.
import assert from "node:assert/strict";
import { probeCommand } from "./omarchy-browser-session.mjs";

const templates = new Set([
  "id -u",
  'stty -echo; /usr/bin/id -u; printf \'%s\\n\' "$HOME"',
  "/usr/bin/pgrep -u 1000 -x Hyprland >/dev/null && XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances",
  "journalctl --user --no-pager -n {N} -o short-monotonic",
  "ps -u 1000 -o pid=,comm=; XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances",
  "journalctl --user -b --no-pager -n {N} -o short-monotonic",
  "systemctl --user list-jobs --no-pager; ps -u 1000 -o pid=,comm=",
  "ps -p {PIDS} -o pid=,stat=,pcpu=,wchan=,args=; journalctl --user -b --no-pager -n {N} -o short-monotonic",
  "systemctl --user show wayland-wm@hyprland.desktop.service -p ActiveState -p SubState -p MainPID -p ExecMainStatus -p Result; ps -u 1000 -o pid=,comm=",
  "ps -u 1000 -o pid=,comm=; systemctl --user show wayland-wm@hyprland.desktop.service -p MainPID -p ActiveState -p SubState -p Result",
  "tr '\\000' '\\n' < /proc/{PID}/environ | sed -n '/^GALLIUM_DRIVER=/p;/^LIBGL_ALWAYS_SOFTWARE=/p;/^LP_NUM_THREADS=/p'; ps -T -p {PIDS} -o pid=,comm=; XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances",
  "journalctl --user -b -u wayland-wm@hyprland.desktop.service --no-pager -n {N} -o short-monotonic",
  "tail -n {N} /run/user/1000/hypr/{INSTANCE}/hyprland.log; ps -u 1000 -o pid=,comm=",
  "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances; ps -p {PIDS} -o pid=,stat=,wchan=,args=; journalctl --user -b --no-pager -n {N} -o short-monotonic",
  "coredumpctl --no-pager info {PID}; journalctl --user -b --no-pager -n {N} -o short-monotonic",
  "sed -n '/^Name:/p;/^State:/p;/^CoreDumping:/p;/^Threads:/p' /proc/{PID}/status; systemctl --user show wayland-wm@hyprland.desktop.service -p MainPID -p ActiveState -p SubState -p Result; coredumpctl --no-pager info {PID}",
  "coredumpctl --no-pager info {PID}; ps -p {PIDS} -o pid=,stat=,comm=",
  "ps -eo pid=,stat=,time=,comm= | sed -n '/coredump/p;/Hyprland/p'; coredumpctl --no-pager info {PID}",
  "systemctl show systemd-coredump@*.service -p Id -p ActiveState -p SubState -p MainPID -p ExecMainPID -p ExecMainStatus; ps -eo pid=,ppid=,stat=,time=,comm= | tail -n {N}; df -h /var/lib/systemd/coredump",
  "coredumpctl --no-pager info {PID}; ps -p {PIDS} -o pid=,stat=,time=,comm=",
  "coredumpctl --no-pager info {PID}",
  'test ! -d /proc/{PID}; printf \'PROCESS_ABSENCE_STATUS=%s\\n\' "$?"; cat /proc/sys/kernel/random/boot_id; systemctl --user show wayland-wm@hyprland.desktop.service -p ActiveState -p SubState -p MainPID -p Result',
  "cat /proc/{PID}/status",
  "cat /proc/{PID}/environ",
  "coredumpctl info {PID}",
  "test ! -d /proc/{PID}",
]);

export function validateObserverCommand(command) {
  assert.equal(typeof command, "string");
  const normalized = command
    .replace(/\/proc\/[1-9][0-9]*/gu, "/proc/{PID}")
    .replace(/\bps (-T )?-p [1-9][0-9]*(?:,[1-9][0-9]*)*/gu, (_, thread) => `ps ${thread || ""}-p {PIDS}`)
    .replace(/(coredumpctl (?:--no-pager )?info )[1-9][0-9]*/gu, "$1{PID}")
    .replace(/\/hypr\/[0-9a-f]{40}_[1-9][0-9]*_[1-9][0-9]*\/hyprland\.log/gu, "/hypr/{INSTANCE}/hyprland.log")
    .replace(/ -n ([1-9][0-9]*)/gu, (match, n) => Number(n) <= 200 ? " -n {N}" : match);
  assert.ok(templates.has(normalized), `observer command is not an approved read-only probe: ${command}`);
}

export function validateObserverTraffic(events) {
  const allowedWire = new Set();
  let loginAllowed = true;
  for (const event of events) {
    if (event.type === "probe-sent" || event.type === "manual-probe-request") {
      validateObserverCommand(event.command);
      if (event.type === "probe-sent") {
        loginAllowed = false;
        allowedWire.add(probeCommand(event.command, event.token));
      }
    }
    if (event.type === "serial-input") {
      const login = loginAllowed && event.text === "omarchy\r";
      if (login) loginAllowed = false;
      assert.ok(allowedWire.delete(event.text) || login,
        "unframed, duplicated, or observer-mutating serial input");
    }
    if (event.type === "terminal-input") {
      assert.ok(Array.isArray(event.bytes) && event.bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 127));
      assert.match(Buffer.from(event.bytes).toString("ascii"), /^\x1b\[[1-9][0-9]*;[1-9][0-9]*R$/u,
        "terminal input is not a cursor-position response");
    }
    assert.ok(!["dom-key", "evdev"].includes(event.type), "physical input is not part of a launch-crash measurement");
  }
}
