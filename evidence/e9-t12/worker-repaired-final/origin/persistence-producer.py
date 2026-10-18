from pathlib import Path
import argparse,hashlib,json,shutil,time
p=argparse.ArgumentParser();p.add_argument("--archive",type=Path,required=True);p.add_argument("--output",type=Path,required=True);p.add_argument("--origins",type=Path,required=True);a=p.parse_args()
source=a.archive.resolve();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
def sha(p):
 h=hashlib.sha256()
 with p.open("rb")as f:
  for b in iter(lambda:f.read(1<<20),b""):h.update(b)
 return h.hexdigest()
x=json.loads((source/"provenance.json").read_text());kept=[];deferred=[]
for e in x["files"]:
 if "chromium-profile"in Path(e["original_path"]).parts:deferred.append(e);continue
 p=source/e["gzip"];assert sha(p)==e["gzip_sha256"];dest=out/e["gzip"];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest);assert sha(dest)==e["gzip_sha256"];kept.append(e)
for name in ["original-receipt.json","archive-producer.py"]:
 shutil.copy2(source/name,out/name);assert sha(out/name)==sha(source/name)
origin=out/"origin";origin.mkdir();origins=[]
for name,raw in json.loads(a.origins.read_text()).items():
 p=Path(raw);dest=origin/name;shutil.copy2(p,dest);assert sha(dest)==sha(p);origins.append({"source":str(p.resolve()),"path":str(dest.relative_to(out)),"bytes":dest.stat().st_size,"sha256":sha(dest)})
r={**x,"scope":"Lossless primary evidence for the frozen repaired head. All native and browser complete frames/traces, DMA/device/cursor witnesses, durable session object graph, Playwright recordings/captures/logs and source/command inventories retained. Derived GPU-regression Chromium profiles are inventoried and preserved in the original raw recording/full gzip archive; exported proof and runtime hashes are the evidence of record. No claim depends on an unexported IndexedDB database.","files":kept,"deferred_derived_profiles":deferred,"full_archive":str(source),"full_archive_provenance_sha256":sha(source/"provenance.json"),"origins":origins,"primary_original_bytes":sum(e["original_bytes"]for e in kept),"primary_compressed_bytes":sum(e["gzip_bytes"]for e in kept),"preserved_original_files":len(x["files"]),"finished":time.time()}
(out/"provenance.json").write_text(json.dumps(r,indent=2)+"\n")
print(json.dumps({"files":len(kept),"compressed":r["primary_compressed_bytes"],"derived_profiles_preserved_in_original":len(deferred),"sha256":sha(out/"provenance.json")}))
