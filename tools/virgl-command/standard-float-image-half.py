import hashlib,json,math,struct,sys
from pathlib import Path
p=Path(sys.argv[1])
data=json.loads(p.read_text());finite=nan=0
for record in data['records']:
    original=struct.unpack('<e',struct.pack('<H',record['half']))[0]
    actual=struct.unpack('<f',struct.pack('<I',record['floatWord']))[0]
    if math.isnan(original):
        assert math.isnan(actual)
        assert record['roundtrip']&0x7c00==0x7c00 and record['roundtrip']&0x3ff
        nan+=1
    else:
        assert original==actual
        assert math.copysign(1,original)==math.copysign(1,actual)
        assert record['roundtrip']==record['half']
        finite+=1
for record in data['rounding']:
    number=struct.unpack('<f',struct.pack('<I',record['inputWord']))[0]
    if math.isnan(number):
        assert record['half']&0x7c00==0x7c00 and record['half']&0x3ff
    else:
        try: expected=struct.unpack('<H',struct.pack('<e',number))[0]
        except OverflowError: expected=0xfc00 if number<0 else 0x7c00
        assert record['half']==expected,(record,expected,number)
result=dict(schema='independent-half-rounding-v1',status='passed',gitHead=data['gitHead'],inputSha256=hashlib.sha256(p.read_bytes()).hexdigest(),originalFiniteAndInf=finite,originalNan=nan,originalBinary32Rounding=len(data['rounding']))
p.with_name('half-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
