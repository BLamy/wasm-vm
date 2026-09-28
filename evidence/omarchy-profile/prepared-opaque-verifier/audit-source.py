#!/usr/bin/env python3
"""Read-only source identity and carried-boundary audit."""
import hashlib
import json
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parents[3]
ENV = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
HEAD = 'e841c3a19934ebe4144f6920849b918eb9bcc566'
BASE = '5f623add'
RUNTIME = '53103e762c6c4003a5976bfa90131a03702fd2e7'
AD = '545f22ad618fe8f9bd6dea3c4fe4cb6c54cc006e'
SHA = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT, env=ENV)
source = lambda revision, name: git('show', revision+':'+name)

frozen_path = ROOT/'evidence/omarchy-profile/prepared-opaque-gates/frozen.json'
frozen = json.loads(frozen_path.read_bytes())
assert frozen['head'] == HEAD
checked = []
for row in frozen['files']:
    actual = (ROOT/row['path']).read_bytes()
    assert SHA(actual) == row['sha256'] and actual == source(HEAD, row['path'])
    checked.append(dict(path=row['path'], size=len(actual), sha256=SHA(actual)))
runtime_diff = git('diff', '--name-only', RUNTIME, HEAD, '--', 'crates', 'web', 'Cargo.toml', 'Cargo.lock')
assert runtime_diff == b'', runtime_diff
recorder = 'tools/verify/omarchy-desktop-live.mjs'
def capture_body(revision):
    text = source(revision, recorder).decode()
    return text[text.index('async function capturePair('):text.index('async function runLive()')].encode()
assert capture_body(AD) == capture_body(HEAD)
carried = []
for name in ['omarchy-mode-preparation.mjs', 'omarchy-owned-trial.mjs', 'omarchy-input-trial.mjs',
             'omarchy-live-recording.mjs', 'omarchy-mode-capture.test.mjs', 'omarchy-mode-preparation.browser.test.mjs']:
    path = 'tools/verify/'+name
    assert source(BASE, path) == source(HEAD, path)
    carried.append(dict(path=path, sha256=SHA(source(HEAD, path))))
command_path = 'tools/verify/omarchy-opaque-foot-command.mjs'
prefix = lambda revision: source(revision, command_path).split(b'export function auditOpaqueFoot')[0]
assert prefix(BASE) == prefix(HEAD)
diff = git('diff', '--unified=3', BASE, HEAD, '--', 'tools/verify')
assert b'#[ignore]' not in diff and b'it.skip(' not in diff and b'test.skip(' not in diff
commands = json.loads((ROOT/'evidence/omarchy-profile/prepared-opaque-gates/commands.json').read_bytes())
assert commands['head'] == HEAD and commands['allPassed'] is True
assert len(commands['commands']) == 4 and all(row['code'] == 0 for row in commands['commands'])
affected = (ROOT/'evidence/omarchy-profile/prepared-opaque-gates/affected-harness.log').read_text()
browser = (ROOT/'evidence/omarchy-profile/prepared-opaque-gates/real-input-fence.log').read_text()
assert 'tests 53' in affected and 'pass 53' in affected and 'fail 0' in affected
assert 'tests 1' in browser and 'pass 1' in browser and 'fail 0' in browser
print(json.dumps(dict(head=HEAD, sourceBase=BASE, unchangedRuntimeParent=RUNTIME,
    frozenManifestSha256=SHA(frozen_path.read_bytes()), checkedSources=checked,
    runtimePathsChanged=[], carriedSourceProofs=carried,
    exactCaptureBody=dict(parent=AD, sha256=SHA(capture_body(HEAD)), unchanged=True),
    exactOpaqueCommandAndPropertyParserUnchanged=True,
    focusedWorkerChecks=dict(tests=53, realChromeFenceTests=1, syntaxChecks=2, passed=True),
    changedTools=git('diff', '--name-only', BASE, HEAD, '--', 'tools/verify').decode().splitlines(),
    implementationDiffSha256=SHA(diff)), indent=2))
