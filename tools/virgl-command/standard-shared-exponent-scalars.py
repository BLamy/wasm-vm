#!/usr/bin/env python3
"""Independent exact rational inverse of original shared-exponent words."""
from fractions import Fraction
import hashlib,json,struct,sys
from pathlib import Path

def fields(word): return (word&511,word>>9&511,word>>18&511,word>>27)
def values_word(word):
    red,green,blue,exponent=fields(word)
    scale=Fraction(2**(exponent-24)) if exponent>=24 else Fraction(1,2**(24-exponent))
    return [red*scale,green*scale,blue*scale,Fraction(1)]
def canonical_word(word):
    red,green,blue,exponent=fields(word)
    maximum=max(red,green,blue)
    selected=max(0,exponent+maximum.bit_length()-9) if maximum else 0
    new=[m<<(exponent-selected) for m in (red,green,blue)]
    assert all(0<=m<=511 for m in new)
    packed=new[0]|new[1]<<9|new[2]<<18|selected<<27
    assert values_word(packed)==values_word(word)
    return packed
def canonical_bytes(raw): return b''.join(struct.pack('<I',canonical_word(word)) for word, in struct.iter_unpack('<I',raw))
def values(raw): return [float(value) for word, in struct.iter_unpack('<I',raw) for value in values_word(word)]
def compare(original,raw,label):
    predicted=values(original);observed=struct.unpack('<'+'f'*(len(raw)//4),raw)
    assert len(predicted)==len(observed),(label,'complete native plane length')
    for i,(wanted,actual) in enumerate(zip(predicted,observed)): assert wanted==actual,(label,i,wanted,actual)
    return len(predicted)
def self_audit(output):
    cases=[]
    for e in range(32):
        for lane in range(3):
            for mantissa in range(512):
                lanes=[256,271,333];lanes[lane]=mantissa
                cases.append(lanes[0]|lanes[1]<<9|lanes[2]<<18|e<<27)
        for m in (0,1,2,3,7,15,31,63,127,128,255,256,257,510,511):
            cases.extend((m|m<<9|m<<18|e<<27,m|e<<27,m<<9|e<<27,m<<18|e<<27))
    seed=0x73a9210f
    for _ in range(8192):
        seed^=seed<<13&0xffffffff;seed^=seed>>17;seed^=seed<<5&0xffffffff;seed&=0xffffffff;cases.append(seed)
    raw=b''.join(struct.pack('<I',word) for word in cases);packed=canonical_bytes(raw)
    for word,canonical in zip(cases,(x[0] for x in struct.iter_unpack('<I',packed))):
        assert canonical_word(canonical)==canonical
        maximum=max(fields(word)[:3]);e=fields(word)[3]
        # Primary general float conversion, evaluated exactly using rationals.
        colors=values_word(word)[:3];color=max(colors)
        if not color: general_e=0
        else:
            exponent=color.numerator.bit_length()-color.denominator.bit_length()
            if color < (Fraction(2**exponent) if exponent>=0 else Fraction(1,2**-exponent)): exponent-=1
            general_e=max(-16,exponent)+16
        quantum=Fraction(2**(general_e-24)) if general_e>=24 else Fraction(1,2**(24-general_e))
        maximum_rounded=(color/quantum+Fraction(1,2)).numerator//(color/quantum+Fraction(1,2)).denominator
        assert maximum_rounded<512,'already native colors cannot reach refinement'
        rounded=[]
        for c in colors:
            rational=c/quantum+Fraction(1,2);rounded.append(rational.numerator//rational.denominator)
        assert canonical==rounded[0]|rounded[1]<<9|rounded[2]<<18|general_e<<27
    report=dict(schema='original-rgb9e5-rational-packing-proof-v1',status='passed',vectors=len(cases),originalSha256=hashlib.sha256(raw).hexdigest(),canonicalSha256=hashlib.sha256(packed).hexdigest(),allExponents=32,allLaneMantissas=512,lanes=3,refinementCases=0)
    output=Path(output);output.mkdir(parents=True,exist_ok=True);(output/'original.bin').write_bytes(raw);(output/'canonical.bin').write_bytes(packed);(output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__': self_audit(sys.argv[1])
