import json,statistics as st,collections,sys
f=sys.argv[1]; base=sys.argv[2] if len(sys.argv)>2 else 'A_O'
d=collections.defaultdict(lambda: collections.defaultdict(list))
for l in open(f):
    x=json.loads(l); k=x['r']['root']
    d[k]['main'].append(x['r']['main_s']); d[k]['ins'].append(x['ru']['instructions']/1e9); d[k]['cyc'].append(x['ru']['cycles']/1e9); d[k]['cpu'].append(x['ru']['user_s']+x['ru']['sys_s'])
b=d[base]
print(f"{'cfg':10s} {'main_s':>7s} {'cpu_s':>7s} {'Ginstr':>8s} {'Gcycles':>8s} | speedup vs {base}: main  cycles  instr   (n)")
for k,v in sorted(d.items(), key=lambda kv: st.median(kv[1]['cyc'])):
    m={q:st.median(v[q]) for q in v}
    print(f"{k:10s} {m['main']:7.2f} {m['cpu']:7.2f} {m['ins']:8.2f} {m['cyc']:8.2f} | {st.median(b['main'])/m['main']:.3f} {st.median(b['cyc'])/m['cyc']:.3f} {st.median(b['ins'])/m['ins']:.3f} ({len(v['cyc'])}) cyc={[round(c,1) for c in v['cyc']]}")
