"""Fresh verifier replays source/record validators without rewriting worker evidence."""
from copy import deepcopy
import hashlib,importlib.util,json,pathlib,struct,subprocess,sys
ROOT=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else pathlib.Path(__file__).resolve().parents[3]
V=pathlib.Path(__file__).resolve().parent
OUT=pathlib.Path(sys.argv[2]).resolve() if len(sys.argv)>2 else ROOT/'evidence/virgl-component-floats/worker'
REPORT=sys.argv[3] if len(sys.argv)>3 else 'worker-review.json'
HEAD='6a8d3841e18379d665af4c7d8f9449322529636f'
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,ROOT/path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
main=module('fresh_component_main','tools/virgl-component-floats/receipt.py')
native=module('fresh_component_native','tools/virgl-component-floats/native_receipt.py')
division=module('fresh_component_division','tools/virgl-component-floats/division_receipt.py')
browser=module('fresh_component_browser','tools/virgl-component-floats/browser_receipt.py')
regression=module('fresh_component_regression','tools/virgl-component-floats/regressions.py')
receipt=json.loads((OUT/'receipt.json').read_text());assert receipt['gitHead']==HEAD and receipt['status']=='passed'
for entry in receipt['records']:
 raw=(OUT/entry['path']).read_bytes();assert len(raw)==entry['bytes'] and hashlib.sha256(raw).hexdigest()==entry['sha256']
for entry in receipt['sources']:
 raw=(ROOT/entry['path']).read_bytes();assert len(raw)==entry['bytes'] and hashlib.sha256(raw).hexdigest()==entry['sha256']
 assert raw==subprocess.check_output(['git','show',HEAD+':'+entry['path']],cwd=ROOT)
contract=json.loads((ROOT/'docs/gpu-3d-contract.json').read_text())
n,fixtures,hardware,cases,pairs,originals=native.verify_native(OUT,HEAD)
outer=main.base.verify_browser(OUT/'hardware',HEAD,contract,task='E6-T12e5');proof=outer['acceptance']
for report in [outer]+[main.base.verify_browser(OUT/('sabotage-'+mode),HEAD,contract,passed=False,task='E6-T12e5') for mode in ['lrp-order','frc-floor','div-operands','numeric-negate']]:
 main.translations(report['acceptance'],fixtures,hardware,cases,pairs,originals)
 browser.verify_orientation(report['acceptance'],cases,helpers=vars(main))
main.verify_source_contracts(proof,hardware,cases)
counts={'numeric':main.verify_numeric(proof,hardware,cases),'texture':main.verify_textures(proof,hardware,cases),'division':division.verify_division(proof,hardware,cases,helpers=vars(main)),'observations':division.verify_observations(proof,hardware,cases,helpers=vars(main)),'interfacePixels':main.verify_pairs(proof,hardware,pairs)}
controls=[browser.verify_sabotage(OUT/('sabotage-'+mode),mode,outer,cases,hardware,helpers=vars(main)) for mode in ['lrp-order','frc-floor','div-operands','numeric-negate']]
old=regression.verify(OUT,HEAD,contract)
# Internally coherent byte/digest/decoded observation mutation, outside the exact rational enclosure.
corrupt=deepcopy(proof);capture=corrupt['divisionVertexProbes'][0]['vectors'][0]['captures'][0]
words=capture['observedBits'];words[4]=0x40400000
raw=struct.pack('<12I',*words)+bytes(capture['guard']);capture['rawBytes']=list(raw);capture['bytesSha256']=hashlib.sha256(raw).hexdigest()
lanes=corrupt['divisionVertexProbes'][0]['vectors'][0]['oracle']['lanes'];capture['numericObservations']=[division.division_observation(lane,word,helpers=vars(main)) for lane,word in zip(lanes,words[4:8])]
try:
 division.verify_division(corrupt,hardware,cases,helpers=vars(main))
 raise AssertionError('tampered out-of-bound quotient escaped independent checker')
except ValueError as error:
 assert 'actual ordinary DIV captures satisfy independent rational enclosures' in str(error),str(error)
 tamper={'rejected':True,'observedWord':0x40400000,'message':str(error),'reason':'Actual float word, byte capture, byte digest and decoded observation were changed together; the independent rational enclosure still rejects.'}
summary={'status':'passed','head':HEAD,'workerReceiptSha256':hashlib.sha256((OUT/'receipt.json').read_bytes()).hexdigest(),'sourcesVerified':len(receipt['sources']),'recordsVerified':len(receipt['records']),'counts':counts,'sourceBoundSabotages':controls,'receiptTamper':tamper,'browserErrors':outer['browserErrors'],'compilerSha256':receipt['compilerSha256'],'previousNumericRegressions':{k:v for k,v in old.items() if k not in ['sources','prior','migrations']}}
(V/REPORT).write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:summary[k] for k in ['status','head','sourcesVerified','recordsVerified','counts','sourceBoundSabotages','receiptTamper','browserErrors']},indent=2))
