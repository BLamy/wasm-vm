#!/usr/bin/env python3
"""Read only already-published artifacts; independently compare exact bytes."""
from concurrent.futures import ThreadPoolExecutor
import hashlib,json,subprocess
from pathlib import Path

repo=Path(__file__).resolve().parents[3];out=Path(__file__).resolve().parent
frozen=json.loads((repo/'evidence/omarchy-profile/fmadd-single-r1/frozen.json').read_text())
sources={r['path'].removeprefix('web/dist/'):r['sha256'] for r in frozen['artifacts']}
origins=['https://267908e9.wasm-vm.pages.dev','https://wasm-vm.pages.dev']
def fetch(pair):
 origin,path=pair
 url=origin+'/'+path+'?critic=c531ceffb9b7adc8de9f5ebc927d00076a26f1dd'
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
