#!/usr/bin/env bash
# Isolated shader compiler acceptance. This does not enable a guest GPU device.
set -euo pipefail
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_dir"
evidence_dir=${VIRGL_SHADER_EVIDENCE_DIR:-target/evidence/virgl-shader}
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
# A failed rerun must not leave a previous success receipt looking current.
rm -f "$evidence_dir/receipt.json"

if [[ -z ${EMCC:-} ]]; then
    EMCC=$(bash tools/setup-virgl-emsdk.sh)
fi
export EMCC
if [[ ! -d web/node_modules/playwright ]]; then
    (cd web && npm ci --no-audit --no-fund)
fi

# Keep both a command transcript and immutable input/output identities. Source
# hashes include dirty files for development; final submissions use a frozen head.
exec > >(tee "$evidence_dir/acceptance.log") 2>&1
set -x
git rev-parse HEAD
git status --short --untracked-files=no
"${CC:-clang}" --version
"$EMCC" --version
node --version
python3 --version
bash renderer/virgl-shader/build.sh native
bash renderer/virgl-shader/build.sh sanitize
bash renderer/virgl-shader/build.sh wasm
node tools/verify-virgl-shader.mjs --output "$evidence_dir/browser"
set +x

python3 - "$evidence_dir" <<'PY'
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path.cwd()
output = Path(sys.argv[1])
files = [path for path in Path("renderer/virgl-shader").rglob("*")
         if path.is_file() and "build" not in path.parts and "__pycache__" not in path.parts]
files += [Path(name) for name in (
    "Makefile", "tools/setup-virgl-emsdk.sh", "tools/verify-virgl-shader.sh",
    "tools/verify-virgl-shader.mjs")]
artifacts = [path for path in Path("renderer/virgl-shader/build").rglob("*")
             if path.is_file()]
def digests(paths):
    result = {}
    for path in sorted(paths):
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        result[str(path)] = digest.hexdigest()
    return result
emcc = Path(shutil.which(os.environ["EMCC"]) or os.environ["EMCC"]).resolve()
sdk = next((parent for parent in emcc.parents
            if (parent / "upstream/emscripten/emcc.py").is_file()), None)
if sdk is None:
    raise SystemExit("Compiler provenance requires the pinned emsdk; use tools/setup-virgl-emsdk.sh")
compilers = [emcc, Path(shutil.which(os.environ.get("CC", "clang"))).resolve()]
compilers += [sdk / name for name in (
    "upstream/emscripten/emcc.py", "upstream/bin/clang", "upstream/bin/wasm-ld",
    "upstream/bin/wasm-opt")]
receipt = {
    "status": "passed",
    "head": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "trackedStatus": subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=no"], text=True),
    "sourceSha256": digests(files),
    "buildSha256": digests(artifacts),
    "compilerSha256": digests(compilers),
    "claim": "Isolated TGSI-to-GLSL translation and hardware WebGL2 pixels; no guest GPU acceleration",
}
(output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(f"Shader bridge acceptance passed; receipt: {output / 'receipt.json'}")
PY
