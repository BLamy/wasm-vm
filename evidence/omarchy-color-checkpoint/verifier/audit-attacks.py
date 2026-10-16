from pathlib import Path
import gzip, hashlib, json

OWN = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()
pred = json.loads((OWN/'attack-predictions.json').read_bytes())
rows = pred['literal_tile_rows']; markers = pred['markers']
frozen = OWN.parent/'omarchy-color-checkpoint-frozen01/hardware'
checks = []
for name in ['literal-pattern-hardware','old-limit-sabotage-hardware']:
    ev = OWN/name
    report = json.loads((ev/'report.json').read_bytes())
    for pin in report['sources']:
        data = (ev/'source'/pin['path']).read_bytes()
        assert len(data) == pin['bytes'] and sha(data) == pin['sha256']
    for pin in report['artifacts']:
        data = (ev/pin['path']).read_bytes()
        assert len(data) == pin['total'] == pin['written'] and sha(data) == pin['sha256'] and pin['complete']
    runs = []
    for index,pin in enumerate(report['runs']):
        zipped = (ev/pin['path']).read_bytes(); data = gzip.decompress(zipped)
        assert len(zipped) == pin['gzipBytes'] and sha(zipped) == pin['gzipSha256']
        assert len(data) == pin['bytes'] and sha(data) == pin['sha256']
        run = json.loads(data); runs.append(run)
        (OWN/(name+f'-run-{index:04}.expanded.json')).write_text(json.dumps(run,indent=2)+'\n')
    assert report['browserErrors'] == {'console':[],'page':[],'requests':[]}
    assert 'Apple M4 Max' in report['browser']['gpu']['devices'][0]['deviceString']
    product = (ev/'source/renderer/virgl-command/resources.mjs').read_bytes()
    old = (frozen/'source/renderer/virgl-command/resources.mjs').read_bytes()
    if name == 'literal-pattern-hardware':
        assert product == old
        assert report['status'] == 'passed' and len(runs) == 3
        all_checks = []
        for i,run in enumerate(runs):
            if i < 2:
                width = height = run['metadata']['width']; prefix = f'production-R8-{width}'
                outname = prefix+'-restored.bin'; native_names = [prefix+'-native-0.bin',prefix+'-native-1.bin']
            else:
                width,height = 1024,2048; prefix='historical-R8-eight-MiB'
                outname=prefix+'-read.bin'; native_names=[prefix+'-native.bin']
            expected=bytearray()
            for y in range(height): expected += (bytes(rows[y%4])*(width//17+1))[:width]
            band=1048576//width; ys=[0,1,band-1,band,band+1,height-2,height-1]
            for y,mark in zip(ys,markers):
                expected[y*width]=mark;expected[y*width+width-1]=mark^255;expected[y*width+width//2]=mark^85
            literal=(ev/'bytes'/f'{prefix}-literal.bin').read_bytes(); output=(ev/'bytes'/outname).read_bytes()
            assert expected == literal == output
            for filename in native_names:
                b=(ev/'bytes'/filename).read_bytes()
                assert b[0::4] == expected and b[1::4] == bytes(width*height) and b[2::4] == bytes(width*height) and b[3::4] == bytes([255])*(width*height)
            if i < 2:
                assert run['poison']['value'] == 58 and run['poison']['sha256'] == sha(bytes([58])*1048576)
                assert run['remainingNativeObjects'] == [0,0] and run['layout']['ramBytes'] == 4194304
            else: assert run['remainingNativeObjects'] == 0
            all_checks.append({'name':prefix,'logical_bytes':len(expected),'sha256':sha(expected),'all_output_and_native_bytes_independently_checked':True,
                               'markers':[{'row':y,'first':mark,'tail':mark^255,'middle':mark^85}for y,mark in zip(ys,markers)]})
        checks.append({'name':name,'status':'HELD','report_sha256':sha((ev/'report.json').read_bytes()),'unchanged_product_source_sha256':sha(product),'cases':all_checks})
    else:
        assert product == old.replace(b'const colorScratchLimit = depth ? RESOURCE_LIMITS.scratchBytes : limits.scratchBytes;',b'const colorScratchLimit = RESOURCE_LIMITS.scratchBytes;')
        assert (ev/'source/renderer/virgl-command/tests/production-color-checkpoint.mjs').read_bytes() == (frozen/'source/renderer/virgl-command/tests/production-color-checkpoint.mjs').read_bytes()
        assert report['status'] == 'failed' and len(runs) == 1
        run=runs[0];assert run['failure']['message']=='GPU checkpoint: Native color scratch exceeds byte limit.'
        assert len(run['records']) == 8 and len([e for e in run['native'][0]if e['name']=='texSubImage2D']) == 4
        assert not any(e['name']=='readPixels' for ctx in run['native']for e in ctx)
        assert not any(a['name'].endswith('.wvgjrn')for a in report['artifacts'])
        assert run['remainingNativeObjects'] == [0,0]
        receipt=json.loads((OWN/(name+'-receipt.json')).read_bytes());assert receipt['exit']==1
        checks.append({'name':name,'status':'HELD','report_sha256':sha((ev/'report.json').read_bytes()),'sabotaged_product_source_sha256':sha(product),
                       'only_selected_limit_expression_changed':True,'original_test_body_unchanged':True,'meaningful_boundary_failure':run['failure']['message'],
                       'original_wasm_commands_completed':8,'native_uploads_completed':4,'native_reads':0,'journal_artifacts':0,'exit':1,'objects_remaining':[0,0],
                       'stale_build_stamp_is_deliberately_not_promoted_as_a_new_runtime_identity':True})
p=OWN/'attack-audit.json'
p.write_text(json.dumps({'predictions_sha256':sha((OWN/'attack-predictions.json').read_bytes()),'checks':checks},indent=2)+'\n')
print(json.dumps({'sha256':sha(p.read_bytes()),'checks':[{k:r[k]for k in ['name','status','report_sha256']}for r in checks]},indent=2))
