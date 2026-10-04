#!/usr/bin/env python3
"""Attack real workload provenance and the reproducible client-only inventory."""
import argparse
import copy
import json
from pathlib import Path
import shutil
import struct
import tempfile

import inventory as model
from gears_check import check_gears
from validate import CaptureError, checked_file, load_json, require, sha256, validate_capture


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus',type=Path,default=Path('evidence/virgl-workload-inventory'))
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    capture = args.corpus/'captures/es2gears'
    index = load_json((args.corpus/'index.json').read_bytes())
    require(index.get('schema')=='virgl-required-workload-evidence-v1','wrong workload evidence schema')
    require(index['capture']['path']=='captures/es2gears/manifest.json'
            and index['gearsInventory']['path']=='es2gears-inventory.json'
            and index['kmscubeInventory']['path']=='kmscube-inventory.json'
            and index['archiveName']=='mesa-demos-9.0.0.tar.xz','evidence binding path differs')
    checked_file(args.corpus,index['capture'])
    require(index.get('originalManifests')==model.OLD_MANIFESTS,'four-workload identity changed')
    for workload,digest in model.OLD_MANIFESTS.items():
        path = model.ROOT/'evidence/virgl-corpus/captures'/workload/'manifest.json'
        require(sha256(path.read_bytes())==digest,'original capture was replaced')
    original_inputs = load_json((model.ROOT/'renderer/virgl-shader/tests/original-corpus.json').read_bytes())['originals']
    require(len(original_inputs)==19,'original shader claim changed extent')
    for entry in original_inputs:
        data = (model.ROOT/entry['path']).read_bytes()
        require(sha256(data)==entry['sha256'] and len(data)==entry['bytes'],'one of nineteen original bodies changed')
    expected = model.inventory(capture)
    require((args.corpus/'es2gears-inventory.json').read_bytes()==model.encoded(expected),'saved gears inventory differs')
    checked_file(args.corpus,index['gearsInventory'])
    checked_file(args.corpus,index['kmscubeInventory'])
    require(index.get('additionalClientShaders')==sorted(set(expected['clientShaderSha256'])-
            {item['sha256'] for item in original_inputs}),'new original shader gap list differs')

    manifest = load_json((capture/'manifest.json').read_bytes())
    artifacts = {r['role']:checked_file(capture,r) for r in manifest['artifacts']}
    summary,_ = validate_capture(capture)
    events = [load_json(raw) for raw in checked_file(capture,manifest['events']).splitlines()]
    bare = model.Inventory(capture,summary).run(events)
    original_bytes = model.encoded(bare)
    results = []

    def rejected(name,action):
        try:
            action()
        except (CaptureError,ValueError,KeyError,TypeError,IndexError) as error:
            results.append({'case':name,'result':'rejected','reason':str(error)})
        else:
            raise RuntimeError('accepted deliberate forgery: '+name)

    def artifact_case(name,role,transform):
        changed = dict(artifacts)
        changed[role] = transform(changed[role])
        rejected(name,lambda:check_gears(copy.deepcopy(manifest),changed))

    for key,bad in (('rendered','0'),('resized','0'),('window-close','124'),
                    ('client-exit','124'),('client-exit','137'),('client-exit','143'),('identity','0')):
        artifact_case('control-'+key+'-'+bad,'gears-control.log',
                      lambda raw,key=key,bad=bad:raw.replace((key+'='+('0' if key in ('window-close','client-exit') else '1')).encode(),
                                                           (key+'='+bad).encode()))
    artifact_case('duplicate-control-exit','gears-control.log',lambda raw:raw+b'client-exit=0\n')
    artifact_case('wrong-client-exe','gears-executable.sha256',lambda raw:b'0'*64+raw[64:])
    artifact_case('wrong-client-comm','gears-comm.txt',lambda _:b'Hyprland\n')
    artifact_case('fake-fps','workload.log',lambda raw:raw.replace(b' frames in ',b' fabricated-frames in '))
    artifact_case('early-closure-script','guest.sh',lambda raw:raw.replace(b'sleep 45',b'sleep 1'))
    artifact_case('fake-renderer-script','guest.sh',lambda raw:raw+b'echo GL_RENDERER=virgl\n')
    artifact_case('fake-zero-exit-script','guest.sh',lambda raw:raw.replace(b'gears_result=$?',b'gears_result=0'))
    artifact_case('missing-render-node','gears-fds.txt',lambda raw:raw.replace(b'/dev/dri/renderD128',b'/dev/null'))
    artifact_case('wrong-drm-driver','gears-drm-driver.txt',lambda _:b'/sys/bus/virtio/drivers/virtio_blk\n')
    artifact_case('missing-keyboard','input-setup.log',lambda raw:raw.replace(b'ID_INPUT_KEYBOARD=1',b'ID_INPUT_KEYBOARD=0'))
    artifact_case('wrong-builder-source','build_gears_in_container.py',lambda raw:raw+b'\n# substituted\n')
    artifact_case('wrong-pins','gears-pins.json',lambda raw:raw.replace(b'9.0.0',b'0.0.0'))
    artifact_case('wrong-binary','es2gears_wayland',lambda raw:raw[:-1]+bytes([raw[-1]^1]))
    artifact_case('wrong-official-archive',index['archiveName'],lambda raw:raw[:-1]+bytes([raw[-1]^1]))
    artifact_case('guest-fallback-environment','gears-environ.bin',lambda raw:raw+b'GALLIUM_DRIVER=llvmpipe\0')
    artifact_case('missing-runtime-library-hash','gears-library-hashes.txt',lambda raw:b'\n'.join(raw.splitlines()[1:])+b'\n')

    def changed_json(role,transform):
        value = load_json(artifacts[role]);transform(value)
        return model.encoded(value)

    for name,role,transform in (
        ('wrong-build-command','gears-build-manifest.json',lambda b:b['command']['argv'].append('-DFAKE_SCENE')),
        ('wrong-upstream-source','gears-build-manifest.json',lambda b:b['sources'][0].update(sha256='0'*64)),
        ('wrong-client-ipc-pid','gears-clients.json',lambda cs:[c.update(pid=c['pid']+1) for c in cs]),
        ('wrong-client-ipc-title','gears-clients.json',lambda cs:[c.update(title='unrelated') for c in cs]),
        ('wrong-client-ipc-size','gears-clients.json',lambda cs:[c.update(size=[0,0]) for c in cs]),
    ):
        changed = dict(artifacts);changed[role] = changed_json(role,transform)
        rejected(name,lambda changed=changed:check_gears(copy.deepcopy(manifest),changed))
    for name,transform in (
        ('wrong-kernel-launch',lambda m:m['command']['argv'].__setitem__(m['command']['argv'].index('-kernel')+1,'/kernel/other')),
        ('wrong-recording-host-preload',lambda m:m['command']['env'].update(LD_PRELOAD='/capture/fake.so')),
        ('wrong-gears-build-launch',lambda m:m['command']['guestWorkload'].update(gearsDirectory='/capture/other')),
        ('failed-workload-marked-complete',lambda m:m['result'].update(workloadPass=False)),
    ):
        changed = copy.deepcopy(manifest);transform(changed)
        rejected(name,lambda changed=changed:check_gears(changed,dict(artifacts)))

    cache = {}
    original_blob = model.blob
    def cached(directory,reference):
        digest = reference['sha256']
        if digest not in cache:
            cache[digest] = original_blob(directory,reference)
        raw = cache[digest]
        require(sha256(raw)==digest and len(raw)==reference['bytes'],'damaged referenced command/name blob')
        return raw
    model.blob = cached
    try:
        selected = {c['key'] for c in bare['contexts'] if c['selected']}
        selected_create = {c['createEvent'] for c in bare['contexts'] if c['selected']}
        client_submissions = {p['citation']['event'] for p in bare['clientPackets']}
        changed = copy.deepcopy(events)
        for event in changed:
            if event['seq'] in selected_create:
                raw = b'not-the-client'
                reference = event['blobs'][0]
                reference.update(sha256=sha256(raw),bytes=len(raw));cache[sha256(raw)] = raw
        rejected('compositor-draws-cannot-replace-client',lambda:model.Inventory(capture,summary).run(changed))
        changed = copy.deepcopy(events)
        for event in changed:
            if event['seq'] in client_submissions:
                ref = event['blobs'][0];raw = bytearray(cached(capture,ref));offset = 0
                while offset<len(raw):
                    header = struct.unpack_from('<I',raw,offset)[0]
                    if header&255==8:
                        struct.pack_into('<I',raw,offset,header&~255)
                    offset += 4*(1+(header>>16))
                ref.update(sha256=sha256(raw));cache[sha256(raw)] = bytes(raw)
        rejected('all-client-draws-removed',lambda:model.Inventory(capture,summary).run(changed))
        client_vertex = next(r for r in bare['resources'] if any(
            key in selected and 'vertex-buffer' in use['drawRoles'] for key,use in r['uses'].items()))
        changed = copy.deepcopy(events)
        changed[client_vertex['createEvent']-1]['bind'] = 1
        rejected('forged-client-vertex-role',lambda:model.Inventory(capture,summary).run(changed))
        client_color = next(r for r in bare['resources'] if any(
            key in selected and 'color-surface' in use['drawRoles'] for key,use in r['uses'].items()))
        changed = copy.deepcopy(events)
        changed[client_color['createEvent']-1]['format'] = 67
        def check_reconstruction():
            raw = model.encoded(model.Inventory(capture,summary).run(changed))
            require(raw==original_bytes,'altered original format changes reproducible inventory')
        rejected('forged-client-color-format',check_reconstruction)
        damaged = copy.deepcopy(events)
        ref = damaged[next(iter(client_submissions))-1]['blobs'][0]
        ref['bytes'] += 4
        rejected('damaged-packet-reference',lambda:model.Inventory(capture,summary).run(damaged))
    finally:
        model.blob = original_blob

    with tempfile.TemporaryDirectory(prefix='virgl-gears-source-version-') as temporary:
        scratch = Path(temporary)/'capture'
        shutil.copytree(capture,scratch,copy_function=shutil.copy2)
        old = model.ROOT/'evidence/virgl-corpus/captures/kmscube/payload/capture.py'
        (scratch/'payload/capture.py').write_bytes(old.read_bytes())
        mutated = copy.deepcopy(manifest)
        ref = next(ref for ref in mutated['artifacts'] if ref['role']=='capture.py')
        ref.update(sha256=sha256(old.read_bytes()),bytes=old.stat().st_size)
        (scratch/'manifest.json').write_bytes(model.encoded(mutated))
        rejected('legacy-driver-cannot-authorize-new-gears',lambda:validate_capture(scratch))
        # A missing snapshot fails framing even if the new stream is rehashed.
        snap = next(e['seq'] for e in events if e['type']=='backing_snapshot' and e.get('reason')=='submit'
                    and e['resourceId']==client_vertex['resourceId'] and e['seq']>client_vertex['createEvent'])
        missing = copy.deepcopy(events);missing.pop(snap-1)
        for sequence,event in enumerate(missing,1):
            event['seq'] = sequence
            for key in ('callSeq','parentCallSeq'):
                if event.get(key,0)>snap:
                    event[key] -= 1
        sizes = {ref['sha256']:ref['bytes'] for event in events for ref in event['blobs']}
        from validate import validate_events
        rejected('missing-required-backing-snapshot',lambda:validate_events(missing,lambda digest:
                 original_blob(capture,{'sha256':digest,'bytes':sizes[digest]})))
        require('submit omitted attached resource backing' in results[-1]['reason'],
                'missing snapshot mutation failed for an unrelated reason')

    require(len(results)>=38 and all(r['result']=='rejected' for r in results),'missing workload attacks')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    report = {'schema':'virgl-required-workload-acceptance-v1','passed':True,
              'captureManifestSha256':expected['captureManifestSha256'],
              'inventorySha256':sha256(model.encoded(expected)),
              'clientDraws':len(expected['clientDraws']),'supportingDraws':expected['supportingDraws'],
              'unchangedOriginalShaders':19,'additionalClientShaders':index['additionalClientShaders'],
              'cases':results,'boundary':'Provenance/framing/client inventory only; no rendered-pixel or performance proof.'}
    args.output.write_bytes(model.encoded(report))
    print(json.dumps({'passed':True,'cases':len(results),'clientDraws':len(expected['clientDraws']),
                      'additionalClientShaders':index['additionalClientShaders']}))


if __name__=='__main__':
    main()
