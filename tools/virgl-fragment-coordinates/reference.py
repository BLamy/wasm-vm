#!/usr/bin/env python3
"""Independent rational geometry and literal TGSI execution before GPU observation."""
from fractions import Fraction as F
from pathlib import Path
import hashlib,json,re,struct,subprocess,sys

def value(w):
    sign=-1 if w>>31 else 1;e=(w>>23)&255;m=w&0x7fffff
    if e==255:raise ValueError('nonfinite prediction')
    return sign*F(m if not e else m+(1<<23))*F(2)**(-149 if not e else e-150)

def word(x):
    if not x:return 0
    sign=0x80000000 if x<0 else 0;x=abs(x)
    e=x.numerator.bit_length()-x.denominator.bit_length()
    if x<F(2)**e:e-=1
    shift=max(e-23,-149);scaled=x/F(2)**shift;q,r=divmod(scaled.numerator,scaled.denominator)
    q+=int(2*r>scaled.denominator or (2*r==scaled.denominator and q&1))
    if q>=1<<24:q>>=1;shift+=1
    if shift==-149 and q<1<<23:return sign|q
    return sign|((shift+150)<<23)|(q-(1<<23))

def coordinates(g,x,y):
    x0,y0,width,height=g['viewport'];vertices=[list(map(F,v))for v in g['vertices'][:3]]
    screen=[(F(x0)+(v[0]/v[3]+1)*width/2,F(y0)+(v[1]/v[3]+1)*height/2)for v in vertices]
    (ax,ay),(bx,by),(cx,cy)=screen;px,py=F(2*x+1,2),F(2*y+1,2)
    determinant=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy)
    a=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/determinant
    b=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/determinant;weights=[a,b,1-a-b]
    # Constant-W quads have the same plane in both triangles. Varying case
    # uses one oversized triangle, independently clipped by the hardware.
    near,far=map(F,g['depthRange']);z=sum(t*v[2]/v[3] for t,v in zip(weights,vertices))
    return [px,py,near+(z+1)*(far-near)/2,sum(t/v[3]for t,v in zip(weights,vertices))]

def execute(text,coordinate,generic):
    registers={('IN',0):[word(v)for v in coordinate],('IN',1):[word(F(v))for v in generic]};taint={('IN',0):[False,False,True,True],('IN',1):[False]*4}
    selected=None;active=True;stack=[]
    def operand(token):
        m=re.fullmatch(r'(-?)(IN|TEMP|IMM)\[(\d+)\](?:\.([xyzw]{4}))?',token);assert m,token
        sign,file,index,swizzle=m.groups();key=(file,int(index));swizzle=swizzle or 'xyzw'
        return [(registers[key]['xyzw'.index(c)]^(0x80000000 if sign else 0),taint[key]['xyzw'.index(c)])for c in swizzle]
    for line in text.splitlines():
        if line.startswith('IMM['):
            m=re.fullmatch(r'IMM\[(\d+)\] UINT32 \{(.+)\}',line);assert m
            key=('IMM',int(m[1]));registers[key]=list(map(int,m[2].split(',')));taint[key]=[False]*4;continue
        if not line or line.startswith(('FRAG','DCL','PROPERTY')):continue
        op,*rest=line.split(' ',1)
        if op=='END':break
        if op=='UIF':stack.append((active,operand(rest[0])[0][0]!=0));active=active and stack[-1][1];continue
        if op=='ELSE':active=stack[-1][0] and not stack[-1][1];continue
        if op=='ENDIF':active=stack.pop()[0];continue
        if not active:continue
        tokens=rest[0].split(', ');d=re.fullmatch(r'(TEMP|OUT)\[(\d+)\](?:\.([xyzw]+))?',tokens[0]);assert d
        file,index,mask=d.groups();key=(file,int(index));mask=mask or 'xyzw';args=[operand(t)for t in tokens[1:]]
        if op=='USHR' and key==('TEMP',1):selected=args[0][0]
        values=[];flags=[]
        for lane in range(4):
            a,t=args[0][lane];b,u=args[1][lane]if len(args)>1 else(0,False)
            if op=='MOV':r=a
            elif op=='AND':r=a&b
            elif op=='OR':r=a|b
            elif op=='USHR':r=a>>(b&31)
            elif op=='I2F':r=word(F(a if a<0x80000000 else a-(1<<32)))
            elif op=='ADD':r=word(value(a)+value(b))
            elif op=='MUL':r=word(value(a)*value(b))
            elif op=='DIV':r=word(value(a)/value(b))
            else:raise ValueError(op)
            values.append(r);flags.append(t or u)
        registers.setdefault(key,[0]*4);taint.setdefault(key,[False]*4)
        for c in mask:lane='xyzw'.index(c);registers[key][lane]=values[lane];taint[key][lane]=flags[lane]
    assert selected is not None
    return selected

def main():
    seed=int(sys.argv[1]);out=Path(sys.argv[2]);root=Path(__file__).resolve().parents[2]
    plan=json.loads(subprocess.check_output(['node','--input-type=module','-e',f"import{{physicalPlan}}from'./tools/virgl-fragment-coordinates/cases.mjs';process.stdout.write(JSON.stringify(physicalPlan({seed})));"],cwd=root))
    rows=[]
    for probe in plan:
        g=probe['geometry'];x0,y0,w,h=g['viewport'];points=[]
        for y in range(g['height']):
            for x in range(g['width']):
                inside=x0<=x<x0+w and y0<=y<y0+h
                if not inside:points.append(dict(x=x,y=y,written=False,rgba=[17,34,51,68]));continue
                coordinate=coordinates(g,x,y);predicted,tainted=execute(probe['text'],coordinate,probe['generic'])
                budget='0'if g['exactZW']or not tainted else'1/1048576'
                # Raw integer operations may deliberately encode NaNs. They
                # are compared as complete words, never as floating values.
                finite=((predicted>>23)&255)!=255
                assert finite or budget=='0'
                points.append(dict(x=x,y=y,written=True,coordinates=[str(v)for v in coordinate],word=predicted,value=str(value(predicted))if finite else None,budget=budget))
        rows.append(dict(textSha256=hashlib.sha256(probe['text'].encode()).hexdigest(),geometry=g,points=points))
    result=dict(schema='fragment-coordinate-rational-reference-v1',task='E6-T12g6k',seed=seed,sourceSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),planSha256=hashlib.sha256(json.dumps(plan,separators=(',',':')).encode()).hexdigest(),rows=rows)
    out.write_text(json.dumps(result,separators=(',',':'))+'\n');print(f'{len(rows)} source-derived coordinate predictions before observation.')
if __name__=='__main__':main()
