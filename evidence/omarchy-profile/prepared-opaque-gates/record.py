"""Affected checks for the fixed opaque Foot experiment; no synthetic guest acceptance."""
from pathlib import Path
import hashlib, json, os, subprocess, time

out = Path(__file__).resolve().parent
repo = out.parents[2]
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
commands = [
    ('affected-harness', ['/Users/blamy/.nvm/versions/node/v24.20.0/bin/node', '--test',
        'tools/verify/omarchy-opaque-preparation.test.mjs', 'tools/verify/omarchy-mode-capture.test.mjs',
        'tools/verify/omarchy-opaque-foot.test.mjs', 'tools/verify/omarchy-input-trial.test.mjs',
        'tools/verify/omarchy-owned-trial.test.mjs', 'tools/verify/omarchy-user-input.test.mjs',
        'tools/verify/omarchy-desktop-live.test.mjs']),
    ('real-input-fence', ['/Users/blamy/.nvm/versions/node/v24.20.0/bin/node', '--test', 'tools/verify/omarchy-mode-preparation.browser.test.mjs']),
    ('runner-syntax', ['/Users/blamy/.nvm/versions/node/v24.20.0/bin/node', '--check', 'tools/verify/omarchy-prepare-opaque.mjs']),
    ('recorder-syntax', ['/Users/blamy/.nvm/versions/node/v24.20.0/bin/node', '--check', 'tools/verify/omarchy-desktop-live.mjs']),
]
receipt = {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, env=env, text=True).strip(),
           'wasmSha256': hashlib.sha256((repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()).hexdigest(), 'commands': []}
def save():
    (out/'commands.json').write_text(json.dumps(receipt, indent=2)+'\n')
for label, args in commands:
    row = {'label': label, 'args': args, 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    receipt['commands'].append(row); save()
    with (out/(label+'.log')).open('w') as log:
        result = subprocess.run(args, cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
    row.update(code=result.returncode, finishedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())); save()
    print(label, result.returncode, flush=True)
receipt['allPassed'] = all(row['code'] == 0 for row in receipt['commands']); save()
if not receipt['allPassed']:
    raise SystemExit(1)
