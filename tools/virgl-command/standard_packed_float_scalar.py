"""Independent nearest-neighbor inverse of actual native unsigned float fields."""
import bisect,math,struct

def finite_field(n,m):
    exponent,fraction=divmod(n,2**m)
    return (1+fraction/2**m)*2.0**(exponent-15) if exponent else fraction*2.0**(-14-m)

POOLS={m:[finite_field(n,m) for n in range(31*2**m)] for m in (5,6)}
def nearest(value,m):
    if math.isnan(value):return 31*2**m+2**(m-1)
    if value<=0:return 0
    if math.isinf(value):return 31*2**m
    pool=POOLS[m];at=bisect.bisect_left(pool,value)
    if at==0:return 0
    if at==len(pool):return len(pool)-1
    below,above=value-pool[at-1],pool[at]-value
    return at-1 if below<above or below==above and (at-1)%2==0 else at

def packed_from_native(raw):
    assert len(raw)%16==0
    return b''.join(struct.pack('<I',nearest(r,6)|(nearest(g,6)<<11)|(nearest(b,5)<<22)) for r,g,b,a in struct.iter_unpack('<ffff',raw))
