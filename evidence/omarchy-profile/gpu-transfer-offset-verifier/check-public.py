"""Independent public bytes, bound to the worker submission commit, not the current tree."""
from pathlib import Path
import concurrent.futures
import datetime
import hashlib
import json
import os
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[3]
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
head = subprocess.check_output(['git','rev-parse','31acd7e8'],cwd=repo,env=env,text=True).strip()
bases = ['https://6d0d0ece.wasm-vm.pages.dev','https://wasm-vm.pages.dev']
files = ['pkg/wasm_vm_wasm_bg.wasm','artifacts-omarchy.json','roadmap.js']
expected = {file:subprocess.check_output(['git','show',head+':web/dist/'+file],cwd=repo,env=env) for file in files}

def check(pair):
    base,file = pair
    with tempfile.TemporaryDirectory(prefix='at-critic-public-',dir='/private/tmp') as directory:
        output = Path(directory)/'body'
        response = subprocess.run(['curl','--fail','--silent','--show-error','--location','--max-time','30',
            '--output',str(output),'--write-out','%{http_code}',base+'/'+file],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        assert response.returncode == 0, response.stderr.decode()
        assert response.stdout == b'200', response.stdout
        body = output.read_bytes()
    assert body == expected[file], file
    if file == 'artifacts-omarchy.json':
        manifest = json.loads(body)['artifacts']
        assert manifest['kernel']['sha256'] == 'af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce'
        assert manifest['bootSnapshot']['sha256'] == '2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5'
        assert manifest['overlayDelta']['sha256'] == '1f56d0bd44c945fab3ec1c201d04f39dd3f590320f54c8d2224446ebffb7e7da'
    if file == 'roadmap.js':
        line = next(line for line in body.decode().splitlines() if 'Linux partial GPU updates' in line)
        assert 'status: "partial"' in line and 'Desktop responsiveness remains unresolved.' in line
    return {'url':base+'/'+file,'status':200,'size':len(body),'sha256':hashlib.sha256(body).hexdigest(),'exactCommittedBytes':True}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    rows = list(pool.map(check,[(base,file) for base in bases for file in files]))
print(json.dumps({'passed':True,'head':head,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'checks':rows,'claim':'Corrected GPU runtime served; desktop response still unresolved and old public defaults retained.'},indent=2))
