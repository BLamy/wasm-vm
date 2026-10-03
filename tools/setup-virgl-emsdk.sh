#!/usr/bin/env bash
# Install this renderer's compiler in an isolated cache, without modifying the
# shell profile or selecting a system-wide SDK. Prints the emcc path on stdout.
set -euo pipefail

readonly version=4.0.22
readonly sdk_commit=15915cad554b707837024dc2758b6a1c5b94b036
readonly release_commit=bebaf7e50e31865b0724f17eaa52e161e2dfef5a
sdk_dir=${1:-${XDG_CACHE_HOME:-${HOME}/.cache}/wasm-vm/emsdk/${version}}

if [[ ! -d "$sdk_dir" ]]; then
    mkdir -p "$(dirname "$sdk_dir")"
    git clone --depth 1 --branch "$version" \
        https://github.com/emscripten-core/emsdk.git "$sdk_dir" >&2
fi
if [[ $(git -C "$sdk_dir" rev-parse HEAD) != "$sdk_commit" ]]; then
    echo "error: $sdk_dir does not contain the pinned emsdk $sdk_commit" >&2
    exit 1
fi
if [[ -n $(git -C "$sdk_dir" status --porcelain --untracked-files=no) ]]; then
    echo "error: pinned emsdk checkout has modified tracked files" >&2
    exit 1
fi
python3 - "$sdk_dir/emscripten-releases-tags.json" "$version" "$release_commit" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    tags = json.load(source)
if tags["releases"][sys.argv[2]] != sys.argv[3]:
    raise SystemExit("SDK release pin mismatch")
PY
"$sdk_dir/emsdk" install "$version" >&2
"$sdk_dir/emsdk" activate "$version" >&2
# macOS's system Python may be older than this compiler accepts. Activate the
# SDK's bundled Python/Node only inside this compiler process, not the caller.
cat > "$sdk_dir/wasm-vm-emcc" <<'SH'
#!/usr/bin/env bash
set -e
compiler_sdk_dir=$(cd "$(dirname "$0")" && pwd)
source "$compiler_sdk_dir/emsdk_env.sh" >/dev/null 2>&1
exec "$compiler_sdk_dir/upstream/emscripten/emcc" "$@"
SH
chmod +x "$sdk_dir/wasm-vm-emcc"
"$sdk_dir/wasm-vm-emcc" --version >&2
printf '%s\n' "$sdk_dir/wasm-vm-emcc"
