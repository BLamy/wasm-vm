"""Recheck actual fresh-verifier GPU captures using integer-rational arithmetic."""
from fractions import Fraction as F
import hashlib
import json
from pathlib import Path
V=Path(__file__).resolve().parent
fixture=json.loads((V/'gpu-inputs.json').read_text())
result=json.loads((V/'gpu-results.json').read_text())
assert result['status']=='passed' and result['consoleErrors']==[]
assert fixture['runtimeSourceDigests']==result['sourceDigests']
assert fixture['librarySha256']==result['librarySha256']
assert len(fixture['programs'])==len(result['programs'])==15
count=0
for definition,record in zip(fixture['programs'],result['programs']):
    assert definition['name']==record['name']
    assert len(definition['vectors'])==len(record['vectors'])==24
    for vector,observed in zip(definition['vectors'],record['vectors']):
        assert [capture['shift'] for capture in observed['captures']]==[0,8,16,24]
        for capture in observed['captures']:
            assert len(capture['words'])==8
            for lane,word in enumerate(capture['words'][:4]):
                exponent=(word>>23)&255
                fraction=word&0x7fffff
                assert exponent!=255
                actual=(-1 if word>>31 else 1)*F(fraction if exponent==0 else fraction+2**23)*F(2)**(-149 if exponent==0 else exponent-150)
                exact=F(*map(int,vector['rationals'][lane]))
                if lane<vector['divisionLanes'] and exact:
                    e=abs(exact).numerator.bit_length()-abs(exact).denominator.bit_length()
                    if abs(exact)<F(2)**e:e-=1
                    assert abs(actual-exact)<=F(5,2)*F(2)**(e-23),(definition['name'],lane,exact,actual)
                else:
                    assert actual==exact,(definition['name'],lane,exact,actual)
                byte=(word>>capture['shift'])&255
                assert capture['words'][lane+4]==0x3f000000+byte*32768
                count+=1
assert count==5760
summary={'status':'passed','checkedLaneCaptures':count,'inputSha256':hashlib.sha256((V/'gpu-inputs.json').read_bytes()).hexdigest(),'gpuResultSha256':hashlib.sha256((V/'gpu-results.json').read_bytes()).hexdigest(),'meaning':'Independent Fraction arithmetic rechecks every actual GPU float word and simultaneous raw carrier. Every effective tested divisor is positive and in the spec accuracy interval; expected zeros permit either zero sign.'}
(V/'gpu-rational-check.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
