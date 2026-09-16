#!/usr/bin/env python3
"""Read-only incremental source-closure audit; never imports a runner."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HEAD = '7a3f3f3583220c320b850dfb10d7aca87fd1525e'
R1 = '32c412f7ea0fe34d1b2f9f28ace3004a1ed64fad'
AL = '27eab37c78167479866e511cbf6f54f3e5664841'
ENV = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
SHA = lambda data: hashlib.sha256(data).hexdigest()
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, env=ENV)

def seal(path, digest, count):
    data = (ROOT/path).read_bytes()
    assert SHA(data) == digest and data == git('show', HEAD+':'+path)
    rows = data.decode().splitlines()
    assert len(rows) == count
    for line in rows:
        expected, name = line.split('  ', 1)
        assert SHA((ROOT/name).read_bytes()) == expected, name
    return dict(path=path, sha256=digest, files=count)

assert not git('diff', '--name-only', AL, HEAD, '--', 'crates', 'web').strip()
assert not git('status', '--porcelain', '--untracked-files=no', '--', 'crates', 'web').strip()
assert git('diff', '--name-only', R1, HEAD, '--', 'tools/verify').decode().splitlines() == ['tools/verify/omarchy-snapshot-allocation.mjs']
dirty = git('diff', '--name-only', '--', 'tools/verify').decode().splitlines()
assert dirty == ['tools/verify/e5-t22c-guest-mode.mjs']

# Every static import in these modules has a literal specifier. Reject an
# unparsed import declaration rather than treating it as absent. Browser-side
# dynamic imports in unrelated callbacks are reviewed separately below.
pattern = re.compile(r'^import\s+(?:[^;]*?\bfrom\s+)?["\']([^"\']+)["\']\s*;', re.M)
pending = ['tools/verify/omarchy-prepare-direct-opaque.mjs', 'tools/verify/omarchy-desktop-live.mjs']
seen, edges, externals = {}, [], []
while pending:
    name = pending.pop()
    if name in seen: continue
    data = (ROOT/name).read_bytes()
    assert not (ROOT/name).is_symlink()
    assert data == git('show', HEAD+':'+name) == git('show', R1+':'+name), name
    source = data.decode()
    matches = list(pattern.finditer(source))
    assert len(matches) == len(re.findall(r'^import\s+', source, re.M)), name
    assert 'e5-t22c-guest-mode' not in source
    seen[name] = dict(size=len(data), sha256=SHA(data), equalsFrozen=True, equalsR1=True)
    for match in matches:
        target = match[1]
        if target.startswith('node:'): continue
        assert target.startswith('.'), (name, target)
        resolved = str((ROOT/name).parent.joinpath(target).resolve().relative_to(ROOT))
        edges.append(dict(source=name, target=resolved))
        if '/node_modules/' in resolved:
            externals.append(resolved)
        else:
            pending.append(resolved)

assert dirty[0] not in seen
assert 'tools/verify/e5-t22c-cpu-profile.mjs' in seen
assert 'tools/verify/omarchy-snapshot-allocation.mjs' not in seen
live = (ROOT/'tools/verify/omarchy-desktop-live.mjs').read_text()
assert 'const distRoot = path.join(repoRoot, "web", "dist");' in live
assert 'const root = releasesPath ? releaseRoot : distRoot;' in live
assert 'if (!inside(root, candidate)) return { status: 403' in live
assert 'serviceWorkers: "block"' in live
wrapper = (ROOT/'tools/verify/omarchy-prepare-direct-opaque.mjs').read_text()
assert 'receipt.args=["tools/verify/omarchy-desktop-live.mjs","local"' in wrapper
assert 'spawn(process.execPath,receipt.args' in wrapper

runtime_diff = git('diff', '--name-only', R1, HEAD, '--', 'crates', 'web').decode().splitlines()
assert runtime_diff == ['crates/core/src/resume.rs', 'web/dist/pkg/wasm_vm_wasm_bg.wasm',
    'web/dist/roadmap.js', 'web/dist/sw.js', 'web/roadmap.js']
runtime = []
for name in runtime_diff:
    data = (ROOT/name).read_bytes()
    assert data == git('show', AL+':'+name) == git('show', HEAD+':'+name)
    runtime.append(dict(path=name, size=len(data), sha256=SHA(data)))
assert SHA((ROOT/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()) == '8230800b2ed4fe92ed0647d871d6c548fe824f3a550b09ca4a9b4941bc220ca4'

seals = [
    seal('evidence/omarchy-profile/prepared-direct-opaque-verifier/sha256.txt', '383a56be261e6ae83fe558ab7913f10002e4242c14e2adfb2a9c5447c3480eda', 26),
    seal('evidence/omarchy-profile/prepared-direct-opaque-gates/sha256.txt', '22917f60a59d5825e0afd9bfd6ffde22f58bcec34e70b6c3c9ebead547b1b0bb', 15),
    seal('evidence/omarchy-profile/snapshot-allocation-gates/sha256.txt', '01786a6b6a15415c7977b4dc23fde07a2e1d82cb1b775340aefe8c888cb42632', 33),
    seal('evidence/omarchy-profile/snapshot-allocation-verifier/sha256.txt', 'beb56a096ced5f60cbac0c5b1c3d0304046addf599011be2f3812935944a496f', 25),
]
print(json.dumps(dict(auditedAt=datetime.now(timezone.utc).isoformat(), head=HEAD,
    priorPreparationHead=R1, verifiedRuntimeParent=AL, staticClosure=seen, importEdges=edges,
    packageBoundaries=sorted(set(externals)), dirtyUnrelated=dirty, runtimeChanges=runtime,
    carriedSeals=seals, broadWorktreeAssertionWouldFail=True,
    headOnlyToolsDiff=['tools/verify/omarchy-snapshot-allocation.mjs'],
    dynamicReview='The parent spawns the fixed omarchy-desktop-live.mjs entry; the live route has no dynamic Node import. Browser-side dynamic imports are bound separately by actual R2 served-resource receipts. The standalone browser-session entry is guarded by argv equality; imported callback code cannot run its alternate CLI entry. Neither the changed e5-t22c guest-mode entry nor the AL standalone test is imported. The local HTTP server serves web/dist, pinned candidate files, and releases, never tools/verify.',
    metadataDisposition='The broad worktree assertion is a real failed metadata check, preserved. This is a post-launch independent scope audit, not a retroactive prelaunch pass. R2 still requires actual helper/resource receipt equality before its evidence can be admitted.'
), indent=2))
