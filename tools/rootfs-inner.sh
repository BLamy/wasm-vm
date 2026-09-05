#!/usr/bin/env bash
# E2-T18 in-container build: cross-install + configure the Alpine riscv64 root and pack it into
# an ext4 image. Runs inside tools/rootfs.Dockerfile (host-arch Alpine); env from build-rootfs.sh:
#   MAIN_REPO COMMUNITY_REPO FS_UUID SOURCE_DATE_EPOCH IMG_SIZE PKGS EXTRA_PKGS DISPLAY_CANDIDATE
#   LOCKED_INSTALL ALPINE_BRANCH
set -euo pipefail
ROOT=/rootfs
mkdir -p "$ROOT"

# 1. Cross-install the riscv64 root (unpack only; --no-scripts avoids riscv64 execution).
# Signatures ARE verified: --keys-dir points at the riscv64 signing keys that ship (verified)
# in the build image's alpine-keys package. The riscv64 v3.20 APKINDEX is signed by key
# 60ac2099, which lives under /usr/share/apk/keys/riscv64 (NOT the default /etc/apk/keys), so
# without this apk reports "UNTRUSTED signature". We do NOT use --allow-untrusted (critic #1):
# a MITM/mirror-compromise now fails closed.
if [ -s /out/INSTALL-MANIFEST.txt ]; then
  # Profile-driven builds keep the requested base+desktop package constraints in a small,
  # deterministic input lock. The resolved MANIFEST.txt is still the output lock; using it as the
  # apk world on a second build would change /etc/apk/world when the first build installed the
  # desktop extension as a separate transaction.
  mapfile -t INSTALL_PKGS < <(sed -E 's/-([0-9][^-]*-r[0-9]+)$/=\1/' /out/INSTALL-MANIFEST.txt)
elif [ "${LOCKED_INSTALL:-0}" = 1 ] && [ -s /out/MANIFEST.txt ]; then
  # Convert `name-version-rN` to apk's exact constraint `name=version-rN`. Package names may
  # contain dashes, so split only at the final version beginning with a digit.
  mapfile -t INSTALL_PKGS < <(sed -E 's/-([0-9][^-]*-r[0-9]+)$/=\1/' /out/MANIFEST.txt)
else
  read -r -a INSTALL_PKGS <<< "$PKGS"
fi
apk.static --arch riscv64 -X "$MAIN_REPO" -X "$COMMUNITY_REPO" \
  --keys-dir /usr/share/apk/keys/riscv64 -U \
  --root "$ROOT" --initdb --no-scripts add "${INSTALL_PKGS[@]}"

# Churn attacks add one package only AFTER recreating the exact locked base. This preserves the
# base package extraction/directory-entry order instead of asking apk to resolve one combined world
# where a new dependency can be interleaved ahead of dozens of existing packages and cascade the
# ext4 layout. It is also the honest CDN update model: stable base plus an explicit addition.
if [ -n "${EXTRA_PKGS:-}" ]; then
  read -r -a EXTRA_INSTALL_PKGS <<< "$EXTRA_PKGS"
  apk.static --arch riscv64 -X "$MAIN_REPO" -X "$COMMUNITY_REPO" \
    --keys-dir /usr/share/apk/keys/riscv64 -U \
    --root "$ROOT" --no-scripts add "${EXTRA_INSTALL_PKGS[@]}"
fi

# Record exactly what landed → drift lock (host diffs this against the committed manifest).
apk.static --root "$ROOT" info -v | sort > /out/MANIFEST.new

# 1b. Recreate the busybox applet symlinks. `apk --no-scripts` skipped the package's
# `busybox --install` trigger, so /sbin/init, /sbin/getty, /bin/login, /bin/mount … are ALL
# missing and the kernel falls through to /bin/sh with no init. The build container ships the
# SAME busybox version (1.36.1), so its `--list-full` is the authoritative applet set.
# Suid-requiring applets point at busybox.suid (from busybox-suid) when present.
BB=/bin/busybox
if [ -e "$ROOT/bin/busybox.suid" ]; then SUID=/bin/busybox.suid; else SUID="$BB"; fi
SUID_APPLETS=" login su passwd mount umount crontab ping ping6 traceroute traceroute6 vlock wall "
test -e "$ROOT$BB" || { echo "no $BB in root — busybox not installed?"; exit 1; }
# The applet SET comes from the container's busybox — assert it's the SAME version as the
# target's, else the recreated symlink set could be wrong (critic #4). Both are pinned, so this
# only fires if someone bumps one without the other.
CBB_VER=$(busybox 2>&1 | sed -n '1s/.*v\([0-9.]*\).*/\1/p')
TBB_VER=$(grep -oE '^busybox-[0-9][^ ]*' /out/MANIFEST.new | head -1 | sed 's/^busybox-//; s/-r.*//')
if [ -n "$TBB_VER" ] && [ "$CBB_VER" != "$TBB_VER" ]; then
  echo "busybox version skew: container $CBB_VER vs target $TBB_VER — applet set may differ"; exit 1
fi
for applet in $(busybox --list-full); do
  path="$ROOT/$applet"
  # Skip anything already present — real file OR symlink (even dangling, e.g. /sbin/ifdown from
  # ifupdown-ng) — so we never clobber another package's applet.
  if [ -e "$path" ] || [ -L "$path" ]; then continue; fi
  mkdir -p "$(dirname "$path")"
  name=$(basename "$applet")
  case "$SUID_APPLETS" in
    *" $name "*) ln -s "$SUID" "$path" ;;
    *) ln -s "$BB" "$path" ;;
  esac
done
test -L "$ROOT/sbin/init" && echo "  busybox applets linked (/sbin/init -> $(readlink "$ROOT/sbin/init"))"

# 2. Configure the tree for a serial console + root login on ttyS0.
# 2a. Only a ttyS0 getty (drop the default tty1-6 gettys) + the OpenRC init stanzas.
cat > "$ROOT/etc/inittab" <<'INITTAB'
::sysinit:/sbin/openrc sysinit
::sysinit:/sbin/openrc boot
::wait:/sbin/openrc default
ttyS0::respawn:/sbin/getty -L 115200 ttyS0 vt100
::ctrlaltdel:/sbin/reboot
::shutdown:/sbin/openrc shutdown
INITTAB

# 2b. login refuses root on a tty absent from /etc/securetty — add ttyS0.
grep -qx ttyS0 "$ROOT/etc/securetty" 2>/dev/null || echo ttyS0 >> "$ROOT/etc/securetty"

# 2c. Root filesystem mount (ext4 on the single virtio-blk disk).
cat > "$ROOT/etc/fstab" <<'FSTAB'
/dev/vda / ext4 rw,relatime 0 1
FSTAB

# 2d. Passwordless root (documented). busybox login accepts an empty shadow password on a
# securetty. Set root's shadow to empty rather than run passwd (which needs riscv64 exec).
if [ -f "$ROOT/etc/shadow" ]; then
  sed -i 's@^root:[^:]*:@root::@' "$ROOT/etc/shadow"
else
  echo 'root::19000:0:99999:7:::' > "$ROOT/etc/shadow"
  chmod 640 "$ROOT/etc/shadow"
fi

# 2e. Hostname.
echo wasm-vm > "$ROOT/etc/hostname"

# 2e1. E3-T22c: clipboard conveniences. `osc52-copy` pipes stdin to the HOST clipboard via an OSC 52
# sequence (decoded by the browser terminal's E3-T22a handler) — no host round trip, busybox-only, so
# it works in the default image with no extra packages. The vim + tmux snippets route yanks through it;
# they are inert unless those packages are later added to the image (a separate size decision), so they
# add config only, not bloat. root's HOME is /root.
install -Dm755 /osc52-copy "$ROOT/usr/local/bin/osc52-copy"
# vim: send every yank to the host clipboard via osc52-copy. Loaded only if a `vim` is present; busybox
# `vi` ignores it. Guarded so a vim without the autocmd still starts cleanly.
cat > "$ROOT/root/.vimrc" <<'VIMRC'
" E3-T22c: mirror vim yanks to the host clipboard over OSC 52 (via /usr/local/bin/osc52-copy).
if executable('osc52-copy')
  augroup Osc52Yank
    autocmd!
    autocmd TextYankPost * if v:event.operator ==# 'y'
      \ | call system('osc52-copy', join(v:event.regcontents, "\n"))
      \ | endif
  augroup END
endif
VIMRC
# tmux: route copy-mode selections to the host clipboard; `set-clipboard on` makes tmux emit OSC 52
# itself, and the terminal-features line tells tmux the outer terminal understands it. Inert without tmux.
cat > "$ROOT/root/.tmux.conf" <<'TMUXCONF'
# E3-T22c: host clipboard integration over OSC 52.
set -s set-clipboard on
set -as terminal-features ',*:clipboard'
TMUXCONF

# The production guest uses HTTPS through either the T17 Tailscale provider or T16 relay fallback.
# Keep both official repositories explicit; apk signatures stay mandatory and TLS remains opaque.
cat > "$ROOT/etc/apk/repositories" <<REPOSITORIES
$MAIN_REPO
$COMMUNITY_REPO
REPOSITORIES

# 2e2. E3-T14 networking. The current kernel has CONFIG_NET + CONFIG_VIRTIO_NET and the image's
# alpine-base dependency includes ifupdown-ng. Bring the slirp-backed eth0 up through DHCP during
# the default runlevel; the guest receives 10.0.2.15/24, gateway 10.0.2.2, and DNS 10.0.2.3. Keeping
# this in the image (rather than typing `ip addr` in demos) is what makes networking an OS capability.
mkdir -p "$ROOT/etc/network"
cat > "$ROOT/etc/network/interfaces" <<'INTERFACES'
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
INTERFACES

# 2f. OpenRC runlevels — symlink the services a headless serial boot needs, tolerantly (only if
# the init script exists, so a package-set change never breaks the build). /dev is auto-mounted
# by the kernel (DEVTMPFS_MOUNT), so devfs is belt-and-suspenders.
mkdir -p "$ROOT"/etc/runlevels/sysinit "$ROOT"/etc/runlevels/boot \
         "$ROOT"/etc/runlevels/default "$ROOT"/etc/runlevels/shutdown
link_svc() { # $1=runlevel $2=service
  if [ -e "$ROOT/etc/init.d/$2" ]; then
    ln -sf "/etc/init.d/$2" "$ROOT/etc/runlevels/$1/$2"
  else
    echo "  (skip $1/$2 — no init script)" >&2
  fi
}
for s in devfs dmesg mdev sysfs hwdrivers; do link_svc sysinit "$s"; done
for s in modules hwclock swap hostname bootmisc syslog seedrng; do link_svc boot "$s"; done
link_svc default networking
for s in killprocs savecache mount-ro; do link_svc shutdown "$s"; done

# E5-T16b/c: display finalists are disposable measurement profiles, not the production desktop
# image. Keep them opt-in so the E2/E3 base image remains byte-for-byte on its existing path. The
# profile still uses the real riscv64 APK packages and the emulator's DRM/input devices; it only
# adds the minimum user/runtime/configuration needed to launch one measured compositor session.
if [ -n "${DISPLAY_CANDIDATE:-}" ]; then
  case "$DISPLAY_CANDIDATE" in
    labwc|weston|desktop) ;;
    *)
      echo "unknown DISPLAY_CANDIDATE=$DISPLAY_CANDIDATE (expected labwc, weston, or desktop)" >&2
      exit 2
      ;;
  esac

  # eudev owns /dev event discovery when present. Do not run mdev and udev together in the
  # scratch profile: both can race over the same device nodes and make a result non-replayable.
  if [ -e "$ROOT/etc/init.d/udev" ]; then
    rm -f "$ROOT/etc/runlevels/sysinit/mdev"
    link_svc sysinit udev
    link_svc boot udev-trigger
  fi
  link_svc default seatd

  # Cross-install deliberately skips APK post-install scripts, so create the measurement user
  # and group memberships explicitly. Existing numeric ids are preserved; a missing named group
  # gets a stable private id instead of inheriting the host's account database.
  desktop_shell=/bin/sh
  if [ "$DISPLAY_CANDIDATE" = desktop ]; then desktop_shell=/usr/local/bin/start-desktop; fi
  if grep -q '^desktop:' "$ROOT/etc/passwd" 2>/dev/null; then
    if [ "$DISPLAY_CANDIDATE" = desktop ]; then
      awk -F: -v OFS=: '$1 == "desktop" { $7 = "/usr/local/bin/start-desktop" } { print }' \
        "$ROOT/etc/passwd" > "$ROOT/etc/passwd.e5-t17b"
      mv "$ROOT/etc/passwd.e5-t17b" "$ROOT/etc/passwd"
    fi
  else
    printf 'desktop:x:1000:1000:wasm-vm display:/home/desktop:%s\n' "$desktop_shell" >> "$ROOT/etc/passwd"
  fi
  grep -q '^desktop:' "$ROOT/etc/group" 2>/dev/null || \
    printf 'desktop:x:1000:\n' >> "$ROOT/etc/group"
  add_display_member() {
    group="$1"
    fallback_gid="$2"
    group_file="$ROOT/etc/group"
    group_tmp="$ROOT/etc/group.e5-t16"
    awk -F: -v OFS=: -v wanted="$group" -v member=desktop -v fallback="$fallback_gid" '
      $1 == wanted {
        found = 1
        if ($4 == "") $4 = member
        else if ($4 !~ "(^|,)" member "(,|$)") $4 = $4 "," member
      }
      { print }
      END { if (!found) print wanted, "x", fallback, member }
    ' "$group_file" > "$group_tmp"
    mv "$group_tmp" "$group_file"
  }
  add_display_member video 18
  add_display_member input 997
  add_display_member audio 63
  add_display_member seat 996
  install -d -m0700 -o 1000 -g 1000 "$ROOT/home/desktop" "$ROOT/run/user/1000"
  install -d -m0755 "$ROOT/usr/local/bin"

  # Keep the compositor and terminal in the same desktop session: Wayland creates its socket with
  # the compositor user's ownership, so launching either compositor as root would strand the
  # desktop client. The candidate-specific launchers make the backend and renderer visible in every
  # transcript and keep each scratch image's custom-input manifest self-describing.
  if [ "$DISPLAY_CANDIDATE" = labwc ]; then
    install -d -m0755 "$ROOT/etc/xdg/labwc"
    cat > "$ROOT/usr/local/bin/e5-t16b-start-labwc" <<'LABWC'
#!/bin/sh
set -eu
export WLR_BACKENDS=drm
export WLR_RENDERER=pixman
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/1000}
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
chown desktop:desktop "$XDG_RUNTIME_DIR"
printf '%s\n' "E5T16B_LAUNCH WLR_BACKENDS=$WLR_BACKENDS WLR_RENDERER=$WLR_RENDERER"
exec runuser -u desktop -- env \
  WLR_BACKENDS="$WLR_BACKENDS" \
  WLR_RENDERER="$WLR_RENDERER" \
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
  labwc -d 2>&1
LABWC
    chmod 0755 "$ROOT/usr/local/bin/e5-t16b-start-labwc"
    cat > "$ROOT/usr/local/bin/e5-t16b-open-terminal" <<'TERMINAL'
#!/bin/sh
set -eu
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/1000}
export WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-0}
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
chown desktop:desktop "$XDG_RUNTIME_DIR"
cd /home/desktop
exec runuser -u desktop -- env \
  HOME=/home/desktop \
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
  WAYLAND_DISPLAY="$WAYLAND_DISPLAY" \
  foot "$@"
TERMINAL
    chmod 0755 "$ROOT/usr/local/bin/e5-t16b-open-terminal"
    cat > "$ROOT/etc/xdg/labwc/rc.xml" <<'RCXML'
<?xml version="1.0"?>
<labwc_config>
  <core>
    <adaptiveSync>no</adaptiveSync>
  </core>
</labwc_config>
RCXML
  elif [ "$DISPLAY_CANDIDATE" = weston ]; then
    install -d -m0755 "$ROOT/etc/xdg/weston"
    cat > "$ROOT/usr/local/bin/e5-t16c-start-weston" <<'WESTON'
#!/bin/sh
set -eu
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/1000}
export WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-0}
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
chown desktop:desktop "$XDG_RUNTIME_DIR"
printf '%s\n' "E5T16C_LAUNCH weston --backend=drm --renderer=pixman --socket=wayland-0 --no-config"
exec runuser -u desktop -- env \
  HOME=/home/desktop \
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
  WAYLAND_DISPLAY="$WAYLAND_DISPLAY" \
  weston --backend=drm --renderer=pixman --socket=wayland-0 --no-config 2>&1
WESTON
    chmod 0755 "$ROOT/usr/local/bin/e5-t16c-start-weston"
    cat > "$ROOT/usr/local/bin/e5-t16c-open-terminal" <<'TERMINAL'
#!/bin/sh
set -eu
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/1000}
export WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-0}
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
chown desktop:desktop "$XDG_RUNTIME_DIR"
cd /home/desktop
exec runuser -u desktop -- env \
  HOME=/home/desktop \
  XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
  WAYLAND_DISPLAY="$WAYLAND_DISPLAY" \
  foot "$@"
TERMINAL
    chmod 0755 "$ROOT/usr/local/bin/e5-t16c-open-terminal"
  fi

  if [ "$DISPLAY_CANDIDATE" = desktop ]; then
    # Production desktop startup is deliberately separate from the disposable T16c launcher. The
    # tty1 login invokes this bounded wrapper as desktop's shell, so a missing DRM device cannot
    # strand init or leave a foreground Weston process with no timeout.
    install -d -m0755 "$ROOT/etc/init.d" "$ROOT/usr/local/sbin" \
      "$ROOT/home/desktop/.config/foot" "$ROOT/home/desktop/.local/bin" \
      "$ROOT/etc/xdg/weston"
    install -d -m0700 "$ROOT/home/desktop/.local/state/wasm-vm"
    cat > "$ROOT/etc/init.d/desktop-runtime" <<'DESKTOP_RUNTIME'
#!/sbin/openrc-run
description="Initialize the desktop user's Wayland runtime directory"

depend() {
  need seatd
  after udev udev-trigger
}

start() {
  mkdir -p /run/user/1000
  chmod 700 /run/user/1000
  chown 1000:1000 /run/user/1000
}
DESKTOP_RUNTIME
    chmod 0755 "$ROOT/etc/init.d/desktop-runtime"
    link_svc default desktop-runtime

    # tty1 autologin reaches a real desktop account but never stores a password or an interactive
    # root credential. BusyBox getty's -n/-l path executes this fixed login helper after OpenRC's
    # default runlevel has brought up seatd and the runtime-directory service.
    cat > "$ROOT/usr/local/sbin/desktop-autologin" <<'DESKTOP_AUTOLOGIN'
#!/bin/sh
set -eu
exec /bin/login -f desktop
DESKTOP_AUTOLOGIN
    chmod 0755 "$ROOT/usr/local/sbin/desktop-autologin"
    cat >> "$ROOT/etc/inittab" <<'DESKTOP_TTY1'
tty1::respawn:/sbin/getty -L -n -l /usr/local/sbin/desktop-autologin 115200 tty1 linux
DESKTOP_TTY1

    cat > "$ROOT/usr/local/bin/start-desktop" <<'START_DESKTOP'
#!/bin/sh
set -eu

runtime_dir=${XDG_RUNTIME_DIR:-/run/user/1000}
log_dir=/home/desktop/.local/state/wasm-vm
mkdir -p "$runtime_dir" "$log_dir"
chmod 700 "$runtime_dir" "$log_dir"
chown desktop:desktop "$runtime_dir" "$log_dir"
export XDG_RUNTIME_DIR="$runtime_dir"
export WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-0}

weston_log="$log_dir/weston.log"
foot_log="$log_dir/foot.log"
printf '%s\n' "E5T17B_START_DESKTOP weston --backend=drm --renderer=pixman --socket=$WAYLAND_DISPLAY --no-config"

# The guest display can be absent or already claimed. Both compositor and terminal are bounded;
# the login shell returns cleanly after a failure so tty1/getty cannot block OpenRC shutdown.
/bin/busybox timeout 30 weston \
  --backend=drm --renderer=pixman --socket="$WAYLAND_DISPLAY" --no-config \
  >"$weston_log" 2>&1 &
weston_pid=$!
socket_ready=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  if [ -S "$runtime_dir/$WAYLAND_DISPLAY" ]; then
    socket_ready=1
    break
  fi
  if ! kill -0 "$weston_pid" 2>/dev/null; then break; fi
  /bin/busybox sleep 1
  attempt=$((attempt + 1))
done

if [ "$socket_ready" -ne 1 ]; then
  printf '%s\n' "E5T17B_WESTON_NOT_READY=1" >>"$weston_log"
  kill "$weston_pid" 2>/dev/null || true
  wait "$weston_pid" 2>/dev/null || true
  exit 0
fi

printf '%s\n' "E5T17B_WESTON_READY=1" >>"$weston_log"
/bin/busybox timeout 30 foot --title=wasm-vm \
  >"$foot_log" 2>&1 &
foot_pid=$!
if wait "$weston_pid"; then
  weston_status=0
else
  weston_status=$?
fi
if kill -0 "$foot_pid" 2>/dev/null; then
  kill "$foot_pid" 2>/dev/null || true
fi
wait "$foot_pid" 2>/dev/null || true
printf '%s\n' "E5T17B_WESTON_EXIT=$weston_status" >>"$weston_log"
exit 0
START_DESKTOP
    chmod 0755 "$ROOT/usr/local/bin/start-desktop"
    grep -qxF /usr/local/bin/start-desktop "$ROOT/etc/shells" 2>/dev/null || \
      printf '%s\n' /usr/local/bin/start-desktop >> "$ROOT/etc/shells"

    # Explicitly pin the compositor configuration too. The launcher uses --no-config, while this
    # file makes the production intent inspectable to image consumers and does not permit GL/fbdev
    # fallback through an automatic renderer selection.
    cat > "$ROOT/etc/xdg/weston/weston.ini" <<'WESTON_INI'
[core]
backend=drm-backend.so
renderer=pixman
shell=desktop-shell.so
WESTON_INI

    cat > "$ROOT/home/desktop/.profile" <<'DESKTOP_PROFILE'
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/1000}
export WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-0}
DESKTOP_PROFILE
    cat > "$ROOT/home/desktop/.config/foot/foot.ini" <<'FOOT_INI'
shell=/bin/sh
term=xterm-256color
scrollback-lines=10000
FOOT_INI
    cat > "$ROOT/home/desktop/.local/bin/clip-copy" <<'CLIP_COPY'
#!/bin/sh
set -eu
exec /usr/bin/wl-copy "$@"
CLIP_COPY
    cat > "$ROOT/home/desktop/.local/bin/clip-paste" <<'CLIP_PASTE'
#!/bin/sh
set -eu
exec /usr/bin/wl-paste "$@"
CLIP_PASTE
    chmod 0755 "$ROOT/home/desktop/.local/bin/clip-copy" "$ROOT/home/desktop/.local/bin/clip-paste"
    chown -R 1000:1000 "$ROOT/home/desktop"

    # The desktop image is not a root-login credential store. Remove shell histories, network
    # credential files, and APK download residue before the deterministic manifests are written.
    sed -i 's@^root:[^:]*:@root:!:@' "$ROOT/etc/shadow"
    for credential in \
      "$ROOT/root/.ash_history" "$ROOT/root/.bash_history" "$ROOT/root/.netrc" "$ROOT/root/.curlrc" \
      "$ROOT/root/.wget-hsts" "$ROOT/home/desktop/.ash_history" "$ROOT/home/desktop/.bash_history" \
      "$ROOT/home/desktop/.netrc" "$ROOT/home/desktop/.curlrc" "$ROOT/home/desktop/.wget-hsts"; do
      rm -f "$credential"
    done
    if [ -d "$ROOT/root/.ssh" ]; then rm -rf "$ROOT/root/.ssh"; fi
    if [ -d "$ROOT/home/desktop/.ssh" ]; then rm -rf "$ROOT/home/desktop/.ssh"; fi
    if [ -d "$ROOT/var/cache/apk" ]; then find "$ROOT/var/cache/apk" -type f -delete; fi
  fi
fi

# E5-T23c: the static virtio-console agent. It owns only the named agent port and retries inside
# the process when the kernel removes/recreates that port; no serial-console service is changed.
install -Dm755 /wasmvm-agent-riscv64 "$ROOT/usr/libexec/wasm-vm/wasmvm-agent"
install -Dm755 /wasmvm-agent.initd "$ROOT/etc/init.d/wasmvm-agent"
link_svc default wasmvm-agent

# 2g. E3-T21b2c WVFT agent. Every path is fixed at image-build time. The guest service opens two
# outbound connections to the VM-private slirp endpoint; it does not listen on any interface.
install -Dm755 /wvft-agent-riscv64 "$ROOT/usr/libexec/wasm-vm/wvft-agent"
install -Dm644 /file-transfer.conf "$ROOT/etc/wasm-vm/file-transfer.conf"
install -Dm755 /wasm-vm-file-agent.initd "$ROOT/etc/init.d/wasm-vm-file-agent"
install -Dm755 /vm-download "$ROOT/usr/bin/vm-download"
install -d -m0750 "$ROOT/var/lib/wasm-vm/transfer"
install -d -m0750 "$ROOT/var/lib/wasm-vm/transfer/inbox"
install -d -m0750 "$ROOT/var/lib/wasm-vm/transfer/outbox"
link_svc default wasm-vm-file-agent

# APK's package lock cannot cover these custom inputs. Record bytes, modes, and deterministic
# directory paths so the host-side drift gate can reject an unreviewed image capability change.
{
  for path in \
    /etc/init.d/wasmvm-agent \
    /etc/init.d/wasm-vm-file-agent \
    /etc/wasm-vm/file-transfer.conf \
    /usr/libexec/wasm-vm/wasmvm-agent \
    /usr/libexec/wasm-vm/wvft-agent \
    /usr/bin/vm-download \
    /usr/local/bin/osc52-copy \
    /root/.vimrc \
    /root/.tmux.conf
  do
    mode=$(stat -c '%a' "$ROOT$path")
    digest=$(sha256sum "$ROOT$path" | awk '{print $1}')
    printf '%s 0%s %s\n' "$digest" "$mode" "$path"
  done
  # E5-T16b/c disposable finalist files are present only when DISPLAY_CANDIDATE is set. Include
  # every launcher/config file in the custom-input lock when it exists, while leaving the base
  # image's historical manifest unchanged.
  for path in \
    /usr/local/bin/e5-t16b-start-labwc \
    /usr/local/bin/e5-t16b-open-terminal \
    /etc/xdg/labwc/rc.xml \
    /usr/local/bin/e5-t16c-start-weston \
    /usr/local/bin/e5-t16c-open-terminal \
    /etc/init.d/desktop-runtime \
    /usr/local/sbin/desktop-autologin \
    /usr/local/bin/start-desktop \
    /etc/xdg/weston/weston.ini \
    /home/desktop/.profile \
    /home/desktop/.config/foot/foot.ini \
    /home/desktop/.local/bin/clip-copy \
    /home/desktop/.local/bin/clip-paste \
    /etc/inittab \
    /etc/fstab \
    /etc/hostname \
    /etc/securetty \
    /etc/shadow \
    /etc/shells \
    /etc/apk/repositories \
    /etc/network/interfaces
  do
    [ -e "$ROOT$path" ] || continue
    mode=$(stat -c '%a' "$ROOT$path")
    digest=$(sha256sum "$ROOT$path" | awk '{print $1}')
    printf '%s 0%s %s\n' "$digest" "$mode" "$path"
  done
  if [ -n "${DISPLAY_CANDIDATE:-}" ]; then
    for path in /etc/passwd /etc/group; do
      mode=$(stat -c '%a' "$ROOT$path")
      digest=$(sha256sum "$ROOT$path" | awk '{print $1}')
      printf '%s 0%s %s\n' "$digest" "$mode" "$path"
    done
  fi
  for path in \
    /var/lib/wasm-vm/transfer \
    /var/lib/wasm-vm/transfer/inbox \
    /var/lib/wasm-vm/transfer/outbox \
    /home/desktop \
    /home/desktop/.local/state/wasm-vm \
    /run/user/1000
  do
    [ -e "$ROOT$path" ] || continue
    mode=$(stat -c '%a' "$ROOT$path")
    printf '%s 0%s %s\n' directory "$mode" "$path"
  done
} | sort -k3,3 > /out/FILE-MANIFEST.new

# 3. Pack into a reproducible ext4 (fixed UUID; mke2fs -d needs no privileges/loop mounts).
# `-O ^metadata_csum`: disable ext4 metadata checksums. mke2fs 1.47 enables them by default,
# but a freshly-built csum image deterministically fails `EBADMSG` (Bad message) when the 6.6.63
# kernel allocates a new inode (e.g. bootmisc creating /var/log/wtmp) — a metadata_csum(_seed)
# build-vs-kernel interaction, NOT an emulator fault (the block backend is synchronous, no cache,
# so a write is byte-visible to the next read; verified by the block/virtio-blk tests). Plain
# ext4 without metadata_csum is what QEMU rootfs images conventionally use.
#
# E3-T11 (reproducibility): TWO pins are needed for byte-identical metadata blocks —
#  1. `-E hash_seed=$FS_UUID` — the directory-htree seed (else random per build).
#  2. `E2FSPROGS_FAKE_TIME=$SOURCE_DATE_EPOCH` — mke2fs otherwise stamps the superblock's write/
#     mount times with the REAL wall clock (dumpe2fs "Last write time"), which varies every build
#     and is replicated into every backup superblock — the residual ~11% churn (chunks 0/2/3 +
#     the backups at 128 MB / 384 MB) after the hash seed alone. e2fsprogs honors this env var to
#     freeze all its clock reads. (SOURCE_DATE_EPOCH alone did NOT freeze s_wtime here.)
export E2FSPROGS_FAKE_TIME="$SOURCE_DATE_EPOCH"
#  3. Normalize EVERY file's mtime/atime to SOURCE_DATE_EPOCH. mke2fs -d copies the source tree's
#     timestamps into the inode table (chunks 2-3); the config files rootfs-inner.sh just wrote
#     (inittab, shadow, securetty, …) carry the real build time, so the inode table varied per
#     build — the residual 4.7% churn after freezing the superblock clock. apk-packaged files
#     already have fixed mtimes; this pins the generated ones too. (-h touches symlinks themselves.)
# E3.5-T02: ship the container-capability smoke test into the rootfs (mounted read-only by the
# build; copied to a PATH dir so `container-smoke` runs in-guest).
if [ -f /container-smoke.sh ]; then
  install -Dm755 /container-smoke.sh "$ROOT/usr/local/bin/container-smoke"
fi
# E3.5-T03: ship the tiny OCI runner `wvrun` into the rootfs (runs an unpacked bundle in-guest).
if [ -f /wvrun.sh ]; then
  install -Dm755 /wvrun.sh "$ROOT/usr/local/bin/wvrun"
fi
# E3.5-T03 (AC6): the static seccomp helper wvrun execs the container through.
if [ -f /wvseccomp-riscv64 ]; then
  install -Dm755 /wvseccomp-riscv64 "$ROOT/usr/local/bin/wvseccomp"
fi
# E3.5-T05d: bake pre-built, digest-verified OCI bundles into /opt/containers/<name> so
# `wvrun /opt/containers/<name>` runs a REAL container in the browser with ZERO network. Each bundle
# is rootfs/ + config/ (from tools/build-container-bundle.sh); index.json is the Docker-tab catalog.
if [ -d /container-bundles ]; then
  install -d "$ROOT/opt/containers"
  for d in /container-bundles/*/; do
    name=$(basename "$d")
    [ -d "${d}bundle/rootfs" ] || continue
    cp -a "${d}bundle" "$ROOT/opt/containers/$name"
  done
  [ -f /container-bundles/index.json ] && install -Dm644 /container-bundles/index.json "$ROOT/opt/containers/index.json"
fi

find "$ROOT" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
rm -f /out/alpine-rootfs.ext4
mke2fs -q -t ext4 -O ^metadata_csum -L root -U "$FS_UUID" -E "root_owner=0:0,hash_seed=$FS_UUID" -d "$ROOT" /out/alpine-rootfs.ext4 "$IMG_SIZE"

# `touch` pins mtime/atime but necessarily advances the SOURCE tree's ctime to the real
# container clock. `mke2fs -d` also reads a few source directories while copying them; the
# container's relatime policy can therefore advance their destination atime during the copy,
# even though the source tree was normalized first. `mke2fs` copies ctime and those atimes into
# destination inodes while E2FSPROGS_FAKE_TIME pins the filesystem/superblock and inode creation
# times. Normalize both fields after population with the same pinned e2fsprogs. These are
# historical metadata on an image that has never been mounted, and leaving either field live
# would make the byte-level reproducibility proof depend on build timing.
#
# Address inodes by their image path rather than by source inode number. Quoting/escaping
# keeps the batch correct for whitespace, quotes, and backslashes; repeated hard-link paths
# harmlessly write the same value. No data/block allocation changes in this pass.
CTIME_CMDS=/tmp/debugfs-normalize-ctime.cmds
: > "$CTIME_CMDS"
while IFS= read -r -d '' source_path; do
  image_path=${source_path#"$ROOT"}
  if [ -z "$image_path" ]; then image_path=/; fi
  image_path=${image_path//\\/\\\\}
  image_path=${image_path//\"/\\\"}
  printf 'set_inode_field "%s" ctime %s\n' "$image_path" "$SOURCE_DATE_EPOCH" >> "$CTIME_CMDS"
  printf 'set_inode_field "%s" atime %s\n' "$image_path" "$SOURCE_DATE_EPOCH" >> "$CTIME_CMDS"
done < <(find "$ROOT" -print0)
debugfs -w -f "$CTIME_CMDS" /out/alpine-rootfs.ext4 >/tmp/debugfs-normalize-ctime.log 2>&1

# 4. fsck must report the freshly built image CLEAN (no orphan inodes from the build).
echo "--- fsck.ext4 -f -n ---"
fsck.ext4 -f -n /out/alpine-rootfs.ext4

# 5. Supply-chain / arch sanity: every ELF must be RISC-V. This is an ALLOW-list (flag any ELF
# that is NOT RISC-V), not a blacklist of known-bad arches (critic #6) — so x86/ARM/ppc/s390/…
# are all caught, not just the three we thought to name.
echo "--- foreign-ELF scan (every ELF must be RISC-V) ---"
bad=$(find "$ROOT" -type f -exec file {} + | grep -E "\bELF\b" | grep -v "RISC-V" || true)
if [ -n "$bad" ]; then echo "NON-RISC-V BINARIES FOUND:"; echo "$bad"; exit 1; fi
echo "  (clean — riscv64 only)"
