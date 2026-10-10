#!/usr/bin/env python3
"""Independent finite-neighbor and exceptional public inverse predictions."""
import argparse,bisect,json,math,random,struct
from pathlib import Path

def field(n,m):
    e,f=divmod(n,2**m)
    return f*2.0**(-14-m) if e==0 else (1+f/2**m)*2.0**(e-15)

POOLS={m:[field(n,m) for n in range(31*2**m)] for m in (5,6)}

def predicted(word,m):
    value=struct.unpack('<f',struct.pack('<I',word))[0]
    if math.isnan(value):return 31*2**m+2**(m-1)
    if value<=0:return 0
    if math.isinf(value):return 31*2**m
    values=POOLS[m]
    at=bisect.bisect_left(values,value)
    if at==0:return 0
    if at==len(values):return len(values)-1
    lower,upper=value-values[at-1],values[at]-value
    return at-1 if lower<upper or lower==upper and (at-1)%2==0 else at

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path);args=parser.parse_args()
    inputs=[]
    for lane,m in [(0,6),(1,6),(2,5)]:
        for n,value in enumerate(POOLS[m]):
            words=[0,0,0];words[lane]=struct.unpack('<I',struct.pack('<f',value))[0];inputs.append(words)
    rng=random.Random(0x5b6d8179)
    edge=[0,0x80000000,1,0x80000001,0x007fffff,0x00800000,0x35000000,0x35800000,0x36000000,0x38800000,0x3f800000,0x47800000,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0x7fc00000,0xffc01234]
    inputs.extend([[x,y,z] for x,y,z in zip(edge,edge[::-1],edge[3:]+edge[:3])])
    inputs.extend([[rng.getrandbits(32) for _ in range(3)] for _ in range(1024)])
    # Every adjacent finite field midpoint, plus the exact next binary32 value
    # on both sides, independently exercises nearest-even conversion boundaries.
    for m in (5,6):
        for a,b in zip(POOLS[m],POOLS[m][1:]):
            midpoint=(a+b)/2;word=struct.unpack('<I',struct.pack('<f',midpoint))[0]
            inputs.extend([[word-1,word,word+1],[word+1,word-1,word]])
    records=[{'words':words,'expected':(predicted(words[0],6)|(predicted(words[1],6)<<11)|(predicted(words[2],5)<<22))} for words in inputs]
    args.output.write_text(json.dumps({'schema':'original-packed-scalar-inverse-v1','nativeExecuted':False,'records':records},indent=2)+'\n')
    print(len(records))
if __name__=='__main__':main()
