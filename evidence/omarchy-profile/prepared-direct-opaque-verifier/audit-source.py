#!/usr/bin/env python3
"""Independent source-boundary audit; no guest or browser execution."""
import hashlib
import json
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HEAD = '32c412f7ea0fe34d1b2f9f28ace3004a1ed64fad'
BASE = 'dd7bf922'
RUNTIME = '53103e762c6c4003a5976bfa90131a03702fd2e7'
AG = 'e841c3a19934ebe4144f6920849b918eb9bcc566'
AD = '545f22ad618fe8f9bd6dea3c4fe4cb6c54cc006e'
ENV = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
SHA = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, env=ENV)
source = lambda revision, name: git('show', revision+':'+name)
frozen_path = ROOT/'evidence/omarchy-profile/prepared-direct-opaque-gates/frozen.json'
frozen = json.loads(frozen_path.read_bytes())
assert frozen['head'] == HEAD
checked = []
for row in frozen['files']:
    actual = (ROOT/row['path']).read_bytes()
    assert SHA(actual) == row['sha256'] and actual == source(HEAD, row['path'])
    checked.append(dict(path=row['path'], size=len(actual), sha256=SHA(actual)))
assert git('diff', '--name-only', RUNTIME, HEAD, '--', 'crates', 'web', 'Cargo.toml', 'Cargo.lock') == b''
recorder = 'tools/verify/omarchy-desktop-live.mjs'
def capture_body(revision):
    text = source(revision, recorder).decode()
    return text[text.index('async function capturePair('):text.index('async function runLive()')].encode()
def fence_body(revision):
    text = source(revision, recorder).decode()
    start = text.index('  if (modePair) {', text.index('async function runLive()'))
    return text[start:text.index('  if (coldPair) {', start)].encode()
assert capture_body(AD) == capture_body(HEAD)
assert fence_body(AG) == fence_body(HEAD)
carried = []
for name in ['omarchy-direct-opaque-command.mjs', 'omarchy-direct-opaque.test.mjs',
             'omarchy-opaque-preparation.mjs', 'omarchy-mode-preparation.mjs',
             'omarchy-owned-trial.mjs', 'omarchy-input-trial.mjs', 'omarchy-live-recording.mjs',
             'omarchy-mode-capture.test.mjs', 'omarchy-mode-preparation.browser.test.mjs']:
    path = 'tools/verify/'+name
    assert source(BASE, path) == source(HEAD, path)
    carried.append(dict(path=path, sha256=SHA(source(HEAD, path))))
diff = git('diff', '--unified=3', BASE, HEAD, '--', 'tools/verify')
assert not any(marker in diff for marker in [b'#[ignore]', b'it.skip(', b'test.skip('])
commands = json.loads((ROOT/'evidence/omarchy-profile/prepared-direct-opaque-gates/commands.json').read_text())
assert commands['head'] == HEAD and commands['allPassed'] is True
assert len(commands['commands']) == 3 and all(row['code'] == 0 for row in commands['commands'])
log = (ROOT/'evidence/omarchy-profile/prepared-direct-opaque-gates/affected-harness.log').read_text()
assert all(term in log for term in ['tests 67', 'pass 67', 'fail 0'])
ag_index = ROOT/'evidence/omarchy-profile/prepared-opaque-verifier/sha256.txt'
assert SHA(ag_index.read_bytes()) == 'b71700e20ad7521cff00353f9a41a81263ddaf90b7360745149b04380387f655'
print(json.dumps(dict(head=HEAD, sourceBase=BASE, unchangedRuntimeParent=RUNTIME,
    frozenManifestSha256=SHA(frozen_path.read_bytes()), checkedSources=checked, runtimePathsChanged=[],
    carriedSourceProofs=carried, priorAGIndexSha256=SHA(ag_index.read_bytes()),
    exactCaptureBody=dict(parent=AD, sha256=SHA(capture_body(HEAD)), unchanged=True),
    exactPreNavigationFence=dict(parent=AG, sha256=SHA(fence_body(HEAD)), unchanged=True),
    directSetterAndParserUnchanged=True, workerChecks=dict(tests=67, syntaxChecks=2, passed=True),
    changedTools=git('diff', '--name-only', BASE, HEAD, '--', 'tools/verify').decode().splitlines(),
    implementationDiffSha256=SHA(diff)), indent=2))
