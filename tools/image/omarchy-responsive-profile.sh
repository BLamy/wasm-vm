#!/usr/bin/env bash
# Apply the responsive browser-desktop profile to a *running* Omarchy demo session.
#
# Runs as the demo user (uid 1000) on the serial console of a restored desktop, before a new
# prepared snapshot is captured (tools/image/prepare-omarchy-responsive.mjs). Every change is
# user-level; configure-omarchy-demo.py seeds the same profile into fresh images.
#
# Measured causes (evidence/omarchy-responsive/README.md):
#  1. The Quickshell `omarchy.background` layer re-renders and re-commits every compositor frame,
#     and Hyprland damages a layer's whole geometry on every commit, so llvmpipe recomposites the
#     full 1280x800 screen back to back (~1.5e9 guest instructions per frame, 100% of the hart).
#     Its wallpaper is a .webp the image cannot decode, so the layer draws nothing visible.
#  2. Foot always creates an ext-background-effect object, and Hyprland damages the whole
#     window box on every commit of a surface that has one, so each echoed keystroke
#     recomposites the full terminal instead of one glyph cell.
#  3. Once the desktop can idle, the icount guest clock fast-forwards through idle time, so the
#     150 s screensaver / 300 s lock would fire within seconds of wall time. The demo user has
#     no password, so a lock would strand the session.
#  4. With an llvmpipe rasterizer thread, a KMS commit can copy a half-rasterized frame (torn
#     64x64 tile rows, stale buffers) that stays on screen. LP_NUM_THREADS=0 in the user's uwsm
#     env fixes this for the NEXT graphical session only; prepare-omarchy-responsive-cold.mjs
#     cold-boots the profiled disk so the captured pair's compositor actually runs with it.
set -euo pipefail

fail() { printf 'omarchy-responsive-profile: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 1000 ] || fail "must run as the demo user"
[ -n "${HOME:-}" ] && [ -d "$HOME" ] && [ ! -L "$HOME" ] || fail "HOME must be a real directory"
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/1000}
command -v python3 >/dev/null || fail "python3 is required"

# (3) Omarchy's own stay-awake toggle: the idle service keeps screensaver and lock disabled.
mkdir -p "$HOME/.local/state/omarchy/indicators"
: > "$HOME/.local/state/omarchy/indicators/stay-awake"

# (1) + (2) files; the helper is idempotent and shared with the image configurator.
python3 - "$HOME" <<'PY'
import json, os, sys
home = sys.argv[1]

def atomic_write(path, data, mode):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.chmod(tmp, mode)
    os.replace(tmp, path)

# (1) A user shell.json replaces the package defaults wholesale, so start from those defaults.
defaults = "/usr/share/omarchy/config/omarchy/shell.json"
user = os.path.join(home, ".config/omarchy/shell.json")
config = json.load(open(user if os.path.exists(user) else defaults))
disabled = config.setdefault("disabledPlugins", [])
if "omarchy.background" not in disabled:
    disabled.append("omarchy.background")
atomic_write(user, (json.dumps(config, indent=2) + "\n").encode(), 0o644)

# (2) Same-length rename of one Wayland interface name: this Foot never binds the global,
# so it never creates the per-surface effect object. Nothing else in the binary changes.
src = open("/usr/bin/foot", "rb").read()
old, new = b"ext_background_effect_manager_v1\0", b"ext_background_effect_manager_v0\0"
if src.count(old) != 1:
    raise SystemExit("unexpected /usr/bin/foot: interface name not found exactly once")
atomic_write(os.path.join(home, ".local/bin/foot"), src.replace(old, new), 0o755)

# New terminals (Super+Return, xdg-terminal-exec) resolve foot.desktop from XDG_DATA_HOME first.
entry = open("/usr/share/applications/foot.desktop").read()
patched = "\n".join(
    line.replace("Exec=foot", "Exec=" + os.path.join(home, ".local/bin/foot"), 1)
    if line.startswith("Exec=foot") else line
    for line in entry.split("\n"))
atomic_write(os.path.join(home, ".local/share/applications/foot.desktop"), patched.encode(), 0o644)

# (4) Next graphical session only (uwsm reads this file when it starts the compositor):
#  - LP_NUM_THREADS=0 makes llvmpipe rasterize inside the flush, on the compositor's own thread.
#    Hyprland on virtio-gpu has no explicit sync here and only glFlush()es before its atomic
#    commit (its software-renderer check looks at the DRM driver name, virtio_gpu), so with a
#    rasterizer thread the commit's TRANSFER_TO_HOST_2D can copy a half-rasterized frame: torn
#    64x64 tile rows and stale buffers stay on screen until that region is damaged again. One
#    emulated hart gains nothing from the extra thread.
#  - ~/.local/bin first on PATH, so the session's initial terminal is the profile Foot above.
uwsm_env = os.path.join(home, ".config/uwsm/env")
lines = [l for l in (open(uwsm_env).read().split("\n") if os.path.exists(uwsm_env) else []) if l]
lines = [l.replace("LP_NUM_THREADS=1", "LP_NUM_THREADS=0") for l in lines]
if not any("LP_NUM_THREADS=0" in l for l in lines):
    lines.append("export LP_NUM_THREADS=0")
path_line = 'export PATH="$HOME/.local/bin:$PATH"'
if path_line not in lines:
    lines.append(path_line)
atomic_write(uwsm_env, ("\n".join(lines) + "\n").encode(), 0o644)
PY
echo "omarchy-responsive-profile: files applied"
