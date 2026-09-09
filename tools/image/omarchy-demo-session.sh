#!/usr/bin/env bash
# Initialize the small, package-owned Omarchy demo session for one user.
# This is intended to be called from Hyprland's onstart with a live Wayland display.
set -euo pipefail

fail() {
    printf 'omarchy-demo-session: %s\n' "$*" >&2
    exit 1
}

[ -n "${HOME:-}" ] || fail "HOME is required"
case "$HOME" in
    /*) ;;
    *) fail "HOME must be an absolute path" ;;
esac
[ -d "$HOME" ] || fail "HOME must be an existing directory"
[ ! -L "$HOME" ] || fail "HOME must not be a symlink"
[ "${OMARCHY_PATH:-}" = "/usr/share/omarchy" ] || fail "unexpected OMARCHY_PATH"
[ -n "${WAYLAND_DISPLAY:-}" ] || fail "WAYLAND_DISPLAY is required"

# Reject an imported environment variable masquerading as Bash's readonly integer.
case "$(declare -p EUID)" in
    'declare -ir EUID='*|'declare -irx EUID='*) ;;
    *) fail "must run as uid 1000 (Bash readonly EUID required)" ;;
esac
[ "$EUID" = 1000 ] || fail "must run as uid 1000"

command -v foot >/dev/null 2>&1 || fail "Foot is not installed"

ensure_home_directory() {
    local relative=$1
    local current="$HOME"
    local part
    local parts=()

    IFS=/ read -r -a parts <<< "$relative"
    for part in "${parts[@]}"; do
        [ -n "$part" ] || continue
        case "$part" in
            .|..) fail "invalid home path" ;;
        esac
        current="$current/$part"
        [ ! -L "$current" ] || fail "refusing symlinked home path: $relative"
        if [ -e "$current" ]; then
            [ -d "$current" ] || fail "home path is not a directory: $relative"
        else
            mkdir "$current"
        fi
        [ -d "$current" ] && [ ! -L "$current" ] || fail "could not create home path: $relative"
    done
}

ensure_file() {
    local path=$1

    [ ! -L "$path" ] || fail "refusing symlinked home file: $path"
    if [ -e "$path" ]; then
        [ -f "$path" ] || fail "home path is not a regular file: $path"
    else
        : > "$path"
    fi
    [ ! -L "$path" ] || fail "home file became a symlink: $path"
}

append_bookmark() {
    local path=$1
    local line=$2
    local found=0
    local existing

    while IFS= read -r existing; do
        if [ "$existing" = "$line" ]; then
            found=1
            break
        fi
    done < "$path"
    if [ "$found" -eq 0 ]; then
        printf '%s\n' "$line" >> "$path"
    fi
}

ensure_home_directory ".local/state/wasm-vm"
marker="$HOME/.local/state/wasm-vm/omarchy-demo-session-v1"
marker_value="wasm-vm omarchy demo session v1"

if [ -L "$marker" ]; then
    fail "refusing symlinked session marker"
fi

initialized=0
if [ -e "$marker" ]; then
    [ -f "$marker" ] || fail "session marker is not a regular file"
    [ "$(<"$marker")" = "$marker_value" ] || fail "session marker is invalid"
    initialized=1
fi

if [ "$initialized" -eq 0 ]; then
    for directory in Desktop Documents Downloads Music Pictures Public Templates Videos; do
        ensure_home_directory "$directory"
    done
    ensure_home_directory ".config/gtk-3.0"

    bookmarks="$HOME/.config/gtk-3.0/bookmarks"
    ensure_file "$bookmarks"
    for directory in Desktop Documents Downloads Music Pictures Public Templates Videos; do
        append_bookmark "$bookmarks" "file://$HOME/$directory $directory"
    done

    # Do not overwrite an existing marker, including one replaced by a symlink concurrently.
    if [ -e "$marker" ] || [ -L "$marker" ]; then
        fail "session marker appeared during setup"
    fi
    (
        set -o noclobber
        printf '%s\n' "$marker_value" > "$marker"
    )
    [ ! -L "$marker" ] || fail "session marker became a symlink"
fi

# This is deliberately outside the marker branch: every fresh graphical session gets one window.
exec foot >/dev/null 2>&1
