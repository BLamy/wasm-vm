#!/usr/bin/env python3
"""Read only already-published artifacts; independently compare exact bytes."""
from concurrent.futures import ThreadPoolExecutor
import hashlib,json,subprocess,re
from pathlib import Path

repo=Path(__file__).resolve().parents[3];out=Path(__file__).resolve().parent
frozen=json.loads((repo/'evidence/omarchy-profile/direct-fp-imports-r1/frozen.json').read_text())
sources={r['path'].removeprefix('web/dist/'):r['sha256'] for r in frozen['artifacts']}
deployment=(repo/'evidence/omarchy-profile/direct-fp-imports-r1/cloudflare-deploy.log').read_text()
preview=re.findall(r'https://[a-z0-9]+[.]wasm-vm[.]pages[.]dev',deployment)[-1]
origins=[preview,'https://wasm-vm.pages.dev']
def fetch(pair):
 origin,path=pair
 url=origin+'/'+path+'?critic='+frozen['head']
 response=subprocess.run(['curl','--fail','--silent','--show-error','--location',
                          '--max-time','45','--write-out','\n%{http_code}',url],
                         capture_output=True,check=True)
 data,status_bytes=response.stdout.rsplit(b'\n',1)
 status=int(status_bytes)
 digest=hashlib.sha256(data).hexdigest()
 assert status==200 and digest==sources[path],(url,status,digest,sources[path])
 return dict(url=url,status=status,bytes=len(data),sha256=digest,expectedSha256=sources[path])
with ThreadPoolExecutor(max_workers=4) as pool:
 rows=list(pool.map(fetch,[(origin,path) for origin in origins for path in sources]))
assert len(rows)==12
(out/'public-inspection.json').write_text(json.dumps({'passed':True,'artifacts':rows},indent=2)+'\n')
print(json.dumps({'passed':True,'files':len(rows)},indent=2))
