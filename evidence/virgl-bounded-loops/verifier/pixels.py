import json,pathlib,struct
root=pathlib.Path(__file__).resolve().parents[3];base=root/'evidence/virgl-bounded-loops/worker';out=[]
f=lambda w:struct.unpack('<f',struct.pack('<I',w))[0];u=lambda f:struct.unpack('<I',struct.pack('<f',f))[0]
for mode in ['hardware','sabotage-early-break']:
 r=json.loads((base/mode/'report.json').read_text())
 for rig in r['acceptance']['rigs']:
  for draw in rig['atlases']:
   w=draw['vector']['words'];n=w[36] if w[36]<2**31 else w[36]-2**32;j=1;sites=[]
   while True:
    sites.append(j+10);cmp=f(w[0])>=f(w[4*(j+10)]) if mode!='hardware' else f(w[0])<f(w[4*(j+10)])
    if cmp or j>=n:break
    j+=1;assert j<=18
   tail=j!=w[36];flag=0xffffffff if tail else 0
   idx=[j+9,j+28,j+27] if tail else [0,0,0]
   hdr=[w[4*(j+10)]]*4;prior=[w[4*idx[0]]]*4 if tail else [0]*4
   upper=w[4*idx[1]:4*idx[1]+4] if tail else [0]*4;lower=w[4*idx[2]:4*idx[2]+4] if tail else [0]*4
   mix=[u(f(u(f(a)*.5))+f(u(f(b)*.25))) for a,b in zip(upper,lower)] if tail else [u(f(hdr[0])*.5)]*4
   expected=[[1,2147483648,305419896,4294967295],[j,j+10,j*16,flag],hdr,prior,upper,lower,idx+[flag],mix]
   observed=[];pixels=draw['rgbaBytes'];assert len(pixels)==64*64*4
   for row in range(8):
    words=[0]*4
    for bit in range(32):
     p=pixels[(64*(row*2)+bit*2)*4:(64*(row*2)+bit*2)*4+4]
     assert all(x in [0,255] for x in p)
     for dy in range(2):
      for dx in range(2):assert pixels[(64*(row*2+dy)+bit*2+dx)*4:(64*(row*2+dy)+bit*2+dx)*4+4]==p
     for c,b in enumerate(p):words[c]|=(b//255)<<bit
    observed.append(words)
   assert observed==expected,(mode,draw['vector']['name'],observed,expected)
   assert all(pixels[(64*y+x)*4:(64*y+x)*4+4]==[0,0,255,255] for y in range(16,64) for x in range(64))
   out.append({'mode':mode,'rig':rig['name'],'vector':draw['vector']['name'],'signedCount':n,'actualIterations':j,'tailIndices':idx if tail else [],'observedWords':observed,'allPixelsVerified':4096})
(pathlib.Path(__file__).resolve().parent / 'pixel-reconstruction.json').write_text(json.dumps(out,indent=2)+'\n');print('independent reconstructed',len(out),'atlases',len(out)*32,'words',len(out)*4096,'pixels')
