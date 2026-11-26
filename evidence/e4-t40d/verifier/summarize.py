import json, sys, statistics
def upper_med(v):
    v = sorted(v); return v[min(len(v)-1, len(v)//2)]
rows = {}
for p in sys.argv[1:]:
    d = json.load(open(p))
    j = d.get("jit") or {}
    s = d["scenarios"]
    click = s["click"]["raw"]["answered"]; sweep = s["sweep"]["raw"]["answered"]
    pressed = s["click"]["raw"]["pressed"]
    hits, builds = j.get("blockEntryHits"), j.get("blockBuilds")
    print(f"{p.split('/')[-1]}: label={d['label']} url=...{d['url'][-60:]}")
    print(f"   browser={d['browser']} started={d['startedAt']} finished={d['finishedAt']}")
    print(f"   missing={d.get('missing')} consoleErrors={d.get('consoleErrors')}")
    print(f"   decodedCacheEntries={j.get('decodedCacheEntries')} blockBuilds={builds} blockEntryHits={hits} miss={100*builds/(hits+builds):.2f}%")
    print(f"   click answered={click} median(tool)={s['click']['resultMs']['median']}  pressed={pressed}")
    print(f"   sweep answered={sweep} median(tool)={s['sweep']['resultMs']['median']}")
    print(f"   type median={s['type']['echoMs']['median']}  node done={s['node']['raw']['done']}  idle mips={s['idle']['mips']}")
    rows[p] = dict(size=j.get('decodedCacheEntries'), click=click, sweep=sweep, builds=builds)
for size in (16384, 262144):
    c = [x for r in rows.values() if r['size']==size for x in r['click']]
    w = [x for r in rows.values() if r['size']==size for x in r['sweep']]
    print(f"pooled {size}: n={len(c)} click true-median={statistics.median(c):.1f} upper-median={upper_med(c)} | sweep true-median={statistics.median(w):.1f} upper-median={upper_med(w)}")
c16=[x for r in rows.values() if r['size']==16384 for x in r['click']]; c26=[x for r in rows.values() if r['size']==262144 for x in r['click']]
w16=[x for r in rows.values() if r['size']==16384 for x in r['sweep']]; w26=[x for r in rows.values() if r['size']==262144 for x in r['sweep']]
if c16 and c26:
    for name,f in (("true-median",statistics.median),("upper-median",upper_med)):
        print(f"pooled change ({name}): click {100*(f(c26)/f(c16)-1):+.1f}%  sweep {100*(f(w26)/f(w16)-1):+.1f}%")
    b16=[r['builds'] for r in rows.values() if r['size']==16384]; b26=[r['builds'] for r in rows.values() if r['size']==262144]
    print(f"blockBuilds ratio min16384/max262144 = {min(b16)/max(b26):.1f}x")
