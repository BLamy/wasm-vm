"""Bind the recording to its committed harness and unchanged verified runtime."""
from pathlib import Path
import hashlib, json, os, subprocess, time

out = Path(__file__).resolve().parent
repo = out.parents[2]
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
verified = '53103e762c6c4003a5976bfa90131a03702fd2e7'
def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo, env=env)
def sha(data): return hashlib.sha256(data).hexdigest()
assert not git('diff', '--name-only', verified, '--', 'crates', 'web').strip()
assert not git('status', '--short', '--', 'crates', 'web').strip()
files = ['crates/core/src/jit.rs', 'crates/core/src/dispatch.rs',
         'crates/wasm/src/lib.rs', 'crates/wasm/src/jit_browser.rs',
         'web/main.js', 'web/dist/pkg/wasm_vm_wasm_bg.wasm',
         'tools/verify/omarchy-input-trial.mjs', 'tools/verify/omarchy-recycling-ab.mjs',
         'tools/verify/omarchy-residency-ab.mjs', 'tools/verify/omarchy-desktop-live.mjs',
         'tools/verify/omarchy-owned-trial.mjs',
         'tools/verify/omarchy-worker-cost.mjs', 'tools/verify/omarchy-worker-cost-capture.mjs',
         'tools/verify/e5-t22c-cpu-profile.mjs', 'tools/verify/e5-t22c-symbolize-cpu.mjs']
assert not git('status', '--short', '--', *files).strip()
rows = []
for name in files:
    data = (repo/name).read_bytes()
    assert data == git('show', 'HEAD:'+name)
    unchanged = name.startswith(('crates/', 'web/')) or name.endswith('omarchy-owned-trial.mjs')
    if unchanged: assert data == git('show', verified+':'+name)
    rows.append(dict(path=name, sha256=sha(data), unchangedFromVerified=unchanged))
prior = out.parent/'fp-division-r1/sha256.txt'
assert sha(prior.read_bytes()) == 'da8b6685880651034ec46f81a030ba2dcb516d8c1eb5fba551bb7158829e902a'
for line in prior.read_text().splitlines():
    digest, name = line.split('  ', 1)
    assert sha((prior.parent/name).read_bytes()) == digest, name
assert len(prior.read_text().splitlines()) == 69
wrapper = (repo/'crates/wasm/src/lib.rs').read_text()
selection = wrapper[wrapper.index('fn enable_browser_jit('):wrapper.index('\n}', wrapper.index('fn enable_browser_jit('))+2]
assert selection.count('budget.') == 1 and 'budget.max_batches = max_batches;' in selection
receipt = dict(head=git('rev-parse', 'HEAD').decode().strip(), verifiedParent=verified,
    frozenAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), files=rows,
    wasmSha256=sha((repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()),
    priorDivisionIndexSha256=sha(prior.read_bytes()), priorDivisionEvidenceFiles=69,
    otherBudgets=dict(code_bytes=33554432, table_slots=32768, metadata_bytes=8388608),
    budgetProof='Unchanged selector assigns only max_batches; unchanged BrowserExecutor defaults and JitCacheBudget::DEFAULT supply all other budgets. These are source-bound values, not new runtime observations.')
(out/'frozen.json').write_text(json.dumps(receipt, indent=2)+'\n')
print(json.dumps(receipt, indent=2))
