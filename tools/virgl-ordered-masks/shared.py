"""Typed source/evidence bindings for the PRECISE word successor."""
import hashlib
import json
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[2]
def require(ok,message):
 if not ok:raise ValueError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path):return json.loads(Path(path).read_bytes())
def same(a,b):return json.dumps(a,sort_keys=True,separators=(',',':'),allow_nan=False)==json.dumps(b,sort_keys=True,separators=(',',':'),allow_nan=False)
def binding(path,base=ROOT):
 path=Path(path);raw=path.read_bytes();return {'path':str(path.relative_to(base)),'bytes':len(raw),'sha256':sha(raw)}
def source(item,head):
 require(type(item) is dict and set(item)=={'path','bytes','sha256'} and type(item['bytes']) is int and item['bytes']>=0,'typed closed source binding')
 path=ROOT/item['path'];require(same(binding(path),item),'exact current source or artifact '+item['path'])
 if not item['path'].startswith('renderer/virgl-shader/build/'):
  require(path.read_bytes()==subprocess.check_output(['git','show',f'{head}:{item["path"]}'],cwd=ROOT),'exact committed source '+item['path'])
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
