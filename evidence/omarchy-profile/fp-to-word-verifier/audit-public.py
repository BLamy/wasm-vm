"""Independent public fetches pinned to committed artifacts, not worker claims."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import tempfile
from urllib.parse import urlsplit

repo = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
worker = repo / 'evidence/omarchy-profile/fp-to-word-r1'
frozen = json.loads((worker / 'frozen.json').read_text())
head = frozen['head']
rows = json.loads((worker / 'cloudflare-public.json').read_text())
origins = sorted({f"{urlsplit(row['url']).scheme}://{urlsplit(row['url']).netloc}" for row in rows})
assert len(origins) == 2 and 'https://wasm-vm.pages.dev' in origins
assert all(urlsplit(origin).hostname.endswith('.wasm-vm.pages.dev')
           or urlsplit(origin).hostname == 'wasm-vm.pages.dev' for origin in origins)
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
receipt = {'head': head, 'policy': 'Read-only independent HTTP fetch; expected bytes from frozen Git commit', 'artifacts': []}
with tempfile.TemporaryDirectory(prefix='wasm-vm-to-word-public-critic-', dir='/private/tmp') as scratch:
    for origin in origins:
        for name in ['pkg/wasm_vm_wasm_bg.wasm', 'pkg/wasm_vm_wasm.js', 'roadmap.js', 'app.html', 'sw.js']:
            expected = subprocess.check_output(['git', 'show', head + ':web/dist/' + name], cwd=repo, env=env)
            target = Path(scratch) / 'asset'
            url = origin + '/' + name + '?critic=' + head
            response = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location',
                                       '--max-time', '60', '--output', str(target),
                                       '--write-out', '%{http_code}', url], capture_output=True, text=True)
            assert response.returncode == 0, response.stderr
            actual = target.read_bytes()
            row = {'url': url, 'status': int(response.stdout), 'bytes': len(actual),
                   'sha256': hashlib.sha256(actual).hexdigest(),
                   'expectedSha256': hashlib.sha256(expected).hexdigest()}
            receipt['artifacts'].append(row)
            (out / 'public-inspection.json').write_text(json.dumps(receipt, indent=2) + '\n')
            assert actual == expected, row
            print(json.dumps(row), flush=True)
receipt['passed'] = True
(out / 'public-inspection.json').write_text(json.dumps(receipt, indent=2) + '\n')
