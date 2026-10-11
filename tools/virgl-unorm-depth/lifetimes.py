"""Keep synchronous native reads distinct from consumed asynchronous fences."""
import copy,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'virgl-packed-unsigned-consumer'))
from pixels import audit_native_lifetimes

def audit_lifetimes(run):
    synchronous=[e for e in run['events'] if e.get('synchronousReadback')]
    for e in synchronous:
        assert e['name']=='readPixels' and e['cpu'] and e['nativeReadReturned']
        assert e['type']=='Uint8Array' and e['bytes']>0 and e['target'] is not None
        assert e['args'][4:6]==[6408,5121] # original native RGBA/UNSIGNED_BYTE pack
        # The actual synchronous CPU readPixels returned these bytes. This is
        # not a claim that an earlier WebGLSync completed a subsequent draw.
    remaining=dict(run,events=[e for e in run['events'] if not e.get('synchronousReadback')])
    result=audit_native_lifetimes(remaining)
    result['fencedCPUReads']=result['cpuReads'];result['synchronousCPUReads']=len(synchronous)
    result['cpuReads']+=len(synchronous)
    return result
