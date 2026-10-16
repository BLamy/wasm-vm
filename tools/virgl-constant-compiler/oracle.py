"""Independent Fraction oracle for the authored conditional constant workloads."""
import importlib.util
from fractions import Fraction as F
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('conditional_scalar_math', ROOT / 'tools/virgl-dot-reciprocals/oracle.py')
scalar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scalar)
decode, word, classify, rational, exact_words = scalar.decode, scalar.word, scalar.classify, scalar.rational, scalar.exact_words
require = scalar.require
N = [F(1,4), F(3,4), F(1,2), F(-2)]
INPUT = [F(1,4), F(3,4), F(0), F(1)]

def raw(value): return {'kind': 'raw', 'words': [value]}
def exact(value): return {'kind': 'exact', 'value': rational(value), 'words': exact_words(value)}
def swizzle(values, order): return [values['xyzw'.index(c)] for c in order]
def bank(vector):
    words = [0] * 184
    words[:4], words[176:180], words[180:] = vector['c0'], vector['condition'], vector['c45']
    return words

def pages(kernel, vector, fixture):
    a, b = list(map(decode, vector['c0'])), list(map(decode, vector['c45']))
    result = [list(map(raw, fixture['atlas']['orientationWords'])), list(map(raw, vector['c0'])), list(map(raw, vector['c45']))]
    def emit(values): result.append(list(map(exact, values)))
    family = kernel['family']
    if family == 'arithmetic':
        emit([-x + y for x,y in zip(a,swizzle(N,'yzxw'))]); emit([x+y for x,y in zip(N,b)])
        emit([-x*y for x,y in zip(a,N)]); emit([x*y for x,y in zip(N,swizzle(b,'yzxw'))])
        emit([x*n+y for x,n,y in zip(a,N,b)]); emit([n*y+x for n,y,x in zip(N,b,a)]); emit([n*n+y for n,y in zip(N,b)])
        result.append([{'kind':'division', **scalar._prior.division_bounds(x,N[1])} for x in a])
        result.append([{'kind':'division', **scalar._prior.division_bounds(n,b[2])} for n in N])
        emit([max(x,n) for x,n in zip(a,N)]); emit([max(n,-y) for n,y in zip(N,b)])
        emit([-y-((-y).numerator//(-y).denominator) for y in b])
        emit([x*n+(1-x)*y for x,n,y in zip(a,N,b)])
        emit([n*y+(1-n)*n for n,y in zip(N,b)])
        emit([n*n+(1-n)*y for n,y in zip(N,b)])
        emit([scalar.exact_dot([-v for v in swizzle(a,'zxy')],swizzle(N,'yzx'))]*4)
        emit([scalar.exact_dot(N[:3],swizzle(b,'yzx'))]*4)
        result.append([{'kind':'division', **scalar.rcp_bounds(a[1])}]*4)
        result.append([scalar.rsq_bounds(b[2])]*4)
    elif family == 'provenance':
        aw,bw,condition=vector['c0'],vector['c45'],vector['condition']
        hw=[word(n+F(1,4)) for n in N]; iw=list(map(word,INPUT))
        def choose(c,y,n): return [a if flag else b for flag,a,b in zip(c,y,n)]
        values=[[aw[1],aw[0],aw[2],aw[3]],
                swizzle(swizzle(choose(condition,iw,aw),'wzyx'),'yxwz'),
                swizzle(choose(condition,hw,bw),'yzxw'),
                choose(swizzle(condition,'yxwz'),choose(condition,hw,aw),bw),
                choose(condition,aw,hw),
                choose(condition,swizzle(aw,'yxzw'),swizzle(bw,'wzyx'))[:2]+aw[2:],
                choose(swizzle(condition,'zyxw'),swizzle(aw,'yzxw'),swizzle(bw,'zxyw'))[:3]+bw[3:],
                swizzle(bw,'zwyx')]
        result.extend([list(map(raw,v)) for v in values])
        for i,values in enumerate(values): emit([decode(v)*2 if i in (2,5) else decode(v)+F(1,4) for v in values])
    elif family == 'subnormal':
        chosen=[yes if flag else no for flag,yes,no in zip(vector['condition'],swizzle(vector['c0'],'zwyx'),swizzle(vector['c45'],'yxwz'))]
        chosen[0],chosen[1]=chosen[1],chosen[0]
        copied=swizzle(chosen,'wzyx')
        for index,values in enumerate((vector['c0'],vector['c45'],copied)):
            if index==2:result.append(list(map(raw,copied)))
            row=[]
            for value in values:
                product=decode(value)*2**126
                row.append({'kind':'flush-set','inputWord':value,'preserved':rational(product),'words':[0,0x80000000,word(product)]} if classify(value)=='subnormal' else exact(product))
            result.append(row)
    elif family == 'texture':
        samples=[]
        for slot,coords in ((0,a[:2]),(7,[b[1],b[0]])):
            texel=int(coords[0]>=F(1,2))+2*int(coords[1]>=F(1,2))
            texture=next(item for item in fixture['vectors']['textures'] if item['slot']==slot)
            samples.append([F(v,255) for v in texture['bytes'][4*texel:4*texel+4]])
        for values in samples: emit(values)
        for values in samples: emit([v/2+F(1,4) for v in values])
    else: raise AssertionError('unknown independent kernel')
    require(len(result)==len(kernel['pages']),'complete oracle pages')
    return result

def observe(oracle, bits):
    kind=classify(bits)
    if 'words' in oracle: return {**oracle,'observedWord':bits,'classification':kind,'accepted':bits in oracle['words']}
    if kind!='normal': return {**oracle,'observedWord':bits,'classification':kind,'accepted':False}
    value=decode(bits)
    def number(record):return F(int(record['numerator']),int(record['denominator']))
    error=({'errorLower':rational(value-number(oracle['rootUpper'])),'errorUpper':rational(value-number(oracle['rootLower']))}
           if oracle['kind']=='rsq' else {'error':rational(value-number(oracle['quotient']))})
    return {**oracle,'observedWord':bits,'classification':kind,'observedValue':rational(value),
            'accepted':number(oracle['lower'])<=value<=number(oracle['upper']),**error}

def coupled(vector):
    def selected(v):return [decode(a if flag else b) for a,b,flag in zip(v['c0'],v['c45'],v['condition'])]
    v,f=selected(vector['vertex']),selected(vector['fragment'])
    rect=[int(32*(1-v[0])),int(32*(1-v[1])),int(64*v[0]),int(64*v[1])]
    color=[int((x/4+y)*255+F(1,2)) for x,y in zip(v,f)]
    return rect,color
