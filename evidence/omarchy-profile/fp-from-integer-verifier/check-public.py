"""Fresh independent TLS byte fetches of both public conversion artifact origins."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
ORIGINS = ['https://d3e13537.wasm-vm.pages.dev', 'https://wasm-vm.pages.dev']
FILES = ['pkg/wasm_vm_wasm_bg.wasm', 'pkg/wasm_vm_wasm.js', 'roadmap.js', 'app.html']
HEAD = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
NOW = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')

def fetch(pair):
    origin, filename = pair
    url = origin + '/' + filename + '?critic=' + HEAD + '-' + NOW
    expected = hashlib.sha256((ROOT / 'web/dist' / filename).read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='from-int-independent-public-', dir='/private/tmp') as directory:
        target = Path(directory) / 'asset'
        result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--max-time', '30', '--output', str(target), '--write-out', '%{http_code}', url], capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        actual = hashlib.sha256(target.read_bytes()).hexdigest()
        row = {'url': url, 'status': int(result.stdout), 'size': target.stat().st_size, 'sha256': actual, 'expectedSha256': expected, 'checkedAt': datetime.now(timezone.utc).isoformat()}
        assert row['status'] == 200 and actual == expected, row
        return row

with ThreadPoolExecutor(max_workers=4) as workers:
    rows = list(workers.map(fetch, [(origin, name) for origin in ORIGINS for name in FILES]))
(OUT / 'independent-public-bytes.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps({'matchedFiles': len(rows), 'origins': ORIGINS, 'wasmSha256': rows[0]['sha256']}))
