from pathlib import Path
import hashlib
out=Path(__file__).resolve().parent
repo=out.parents[2]
paths=sorted(p for folder in [out,out.parent/'prepared-recycling-input-r1'] for p in folder.rglob('*') if p.is_file() and p.name!='sha256.txt')
text=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(repo))+'\n' for p in paths)
(out/'sha256.txt').write_text(text)
print(len(paths),'files; index SHA256',hashlib.sha256(text.encode()).hexdigest())
