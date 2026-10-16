from pathlib import Path
import datetime, hashlib, json, os, shutil, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[3]
OWN = Path(__file__).resolve().parent
SEALED = ROOT / 'target/evidence/omarchy-color-checkpoint-frozen01/hardware/source'
sha = lambda b: hashlib.sha256(b).hexdigest()
scratch = Path(tempfile.mkdtemp(prefix='critic-color-c1-'))
runner = 'tools/virgl-production/omarchy-color-checkpoint-browser.mjs'
original_runner = subprocess.check_output(['git','show','43f227ae:'+runner],cwd=ROOT)
(scratch / runner).parent.mkdir(parents=True)
(scratch / runner).write_bytes(original_runner)
shutil.copytree(SEALED / 'renderer',scratch / 'renderer')
shutil.copytree(SEALED / 'renderer',scratch / 'web/dist/renderer')
shutil.copytree(SEALED / 'target',scratch / 'target')
(scratch / 'web/dist/gpu-checkpoint-build.js').write_bytes((SEALED / 'gpu-checkpoint-build.js').read_bytes())
for p in scratch.rglob('*'):
    if p.is_file(): p.chmod(0o644)
(scratch / 'web/node_modules').symlink_to(ROOT / 'web/node_modules',target_is_directory=True)
subprocess.run(['git','init','-q'],cwd=scratch,check=True)
subprocess.run(['git','add','renderer','tools','target','web/dist'],cwd=scratch,check=True)
subprocess.run(['git','-c','core.hooksPath=/dev/null','-c','user.name=Independent C1 verifier','-c','user.email=verifier@local.invalid','commit','-q','-m','Pin sealed C1 hardware proof inputs for isolated attacks'],cwd=scratch,check=True)
head = subprocess.check_output(['git','rev-parse','HEAD'],cwd=scratch,text=True).strip()
rows = [
    [1,129,254,51,7,196,0,255,83,42,227,16,144,61,218,5,99],
    [247,2,153,33,202,17,111,240,4,189,74,13,222,96,31,166,55],
    [68,251,6,175,24,130,253,90,8,219,49,145,12,233,70,181,39],
    [211,19,128,9,244,62,167,3,101,230,46,158,15,206,81,37,192],
]
markers = [45,182,115,225,76,154,6]
test_path = 'renderer/virgl-command/tests/production-color-checkpoint.mjs'
original_test = (scratch / test_path).read_text()
start = original_test.index('function pattern(')
end = original_test.index('\nasync function retain',start)
replacement = '''function pattern(width,height,seed){
  const tile=PATTERN_ROWS,markers=PATTERN_MARKERS,bytes=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)bytes[y*width+x]=tile[y%4][x%17];
  const bandRows=1048576/width,ys=[0,1,bandRows-1,bandRows,bandRows+1,height-2,height-1];
  ys.forEach((y,i)=>{bytes[y*width]=markers[i];bytes[y*width+width-1]=markers[i]^255;bytes[y*width+Math.floor(width/2)]=markers[i]^85;});
  return bytes;
}'''.replace('PATTERN_ROWS',json.dumps(rows)).replace('PATTERN_MARKERS',json.dumps(markers))
modified_test = (original_test[:start]+replacement+original_test[end:]).replace('fill(0x6d)','fill(0x3a)').replace('value:0x6d','value:0x3a').replace('fill(0xa5)','fill(0xd7)')
(scratch / test_path).write_text(modified_test)
pred = {
    'schema':'critic-color-c1-private-attack-predictions-v1',
    'written_before_any_attack_outcome':True,
    'source_frozen_head':'43f227ae83acb3fc1c5f9c3bcd9766d2710d0875',
    'scratch':str(scratch),'scratch_base_head':head,
    'literal_tile_rows':rows,'markers':markers,'marker_rows':'0,1,bandRows-1,bandRows,bandRows+1,height-2,height-1',
    'marker_columns':'0=marker,width-1=marker XOR 255,floor(width/2)=marker XOR 85',
    'bandRows':'1048576/width','upload_poison':58,'read_poison':215,
    'seed':3735928559,
    'literal_prediction':'All three hardware cases pass with complete independent literal/output/native lanes. Both contexts have correct boundary/tail markers and no native leaks. Product runtime source is byte-identical to the sealed frozen source.',
    'sabotage_prediction':'With original test restored and only const colorScratchLimit replaced by historical RESOURCE_LIMITS.scratchBytes in private original+shipped resources, the first 2048 R8 checkpoint fails with Native color scratch exceeds byte limit after four successful Wasm uploads, before any full readPixels or .wvgjrn, and the browser process exits 1. A setup/build/syntax failure is not sensitivity.',
    'runner_sha256':sha(original_runner),'original_test_sha256':sha(original_test.encode()),'literal_test_sha256':sha(modified_test.encode()),
    'product_resource_sha256':sha((scratch/'renderer/virgl-command/resources.mjs').read_bytes()),
    'dependency':'Only Playwright/node_modules symlinks to installed local pinned dependencies; no app, image, browser profile, GPU objects, checkpoint or guest state is copied.',
}
pin = OWN / 'attack-predictions.json'
assert not pin.exists()
pin.write_text(json.dumps(pred,indent=2)+'\n')
(OWN/'attack-predictions.sha256').write_text(sha(pin.read_bytes())+'  attack-predictions.json\n')
print('Attack predictions sealed '+sha(pin.read_bytes()),flush=True)
env = {k:v for k,v in os.environ.items() if k not in ['RUSTFLAGS','RUST_LOG'] and not k.startswith('CARGO_')}
receipts = []
def run(label,seed):
    output = OWN / label
    command = ['node',str(scratch/runner),'--output',str(output),'--seed',str(seed)]
    start = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (OWN/(label+'.log')).open('wb') as log:
        result = subprocess.run(command,cwd=scratch,env=env,stdout=log,stderr=subprocess.STDOUT)
    receipt = {'label':label,'command':command,'started_utc':start,'finished_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'exit':result.returncode,'log_sha256':sha((OWN/(label+'.log')).read_bytes()),'tracked_diff':subprocess.check_output(['git','diff','--binary'],cwd=scratch,text=True),
               'scrubbed_environment':True,'predictions_sha256':sha(pin.read_bytes())}
    (OWN/(label+'-receipt.json')).write_text(json.dumps(receipt,indent=2)+'\n')
    receipts.append(receipt)
    print(label+' exited '+str(result.returncode),flush=True)
    return result.returncode
assert run('literal-pattern-hardware',3735928559) == 0
(scratch / test_path).write_text(original_test)
for relative in ['renderer/virgl-command/resources.mjs','web/dist/renderer/virgl-command/resources.mjs']:
    p = scratch / relative; source = p.read_text()
    needle = 'const colorScratchLimit = depth ? RESOURCE_LIMITS.scratchBytes : limits.scratchBytes;'
    assert source.count(needle) == 1
    p.write_text(source.replace(needle,'const colorScratchLimit = RESOURCE_LIMITS.scratchBytes;'))
assert run('old-limit-sabotage-hardware',42) == 1
(OWN/'scratch-attack-launch-summary.json').write_text(json.dumps({'scratch':str(scratch),'base_head':head,'results':[{'label':r['label'],'exit':r['exit']}for r in receipts]},indent=2)+'\n')
