import importlib.util,json,hashlib
from pathlib import Path
root=Path.cwd()
s=importlib.util.spec_from_file_location('scalar',root/'tools/virgl-dot-reciprocals/receipt.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
output=root/'evidence/virgl-dot-reciprocals/worker-incremental';head='cb6726dc68eebecdaf9b848ea846e525003e86c9';contract=r.read(root/'docs/gpu-3d-contract.json')
gate=r.module('native','tools/virgl-dot-reciprocals/native_receipt.py')
native,fixtures,hardware,cases,pairs,originals=gate.verify_native(root/'evidence/virgl-dot-reciprocals/worker',head)
# Native source, fixture and runtime bytes are unchanged; no old Git-head field is rewritten.
modes=['dp3-lane','rcp-source','rsq-operation','numeric-negate']
reports=[r.base.verify_browser(output/name,head,contract,task='E6-T12e6',passed=name=='hardware') for name in ['hardware']+['sabotage-'+mode for mode in modes]]
extra=r.module('extra','tools/virgl-dot-reciprocals/browser_receipt.py');reciprocal=r.module('quant','tools/virgl-dot-reciprocals/reciprocal_receipt.py')
for report in reports:
 r.translations(report['acceptance'],fixtures,hardware,cases,pairs,originals)
 extra.verify_orientation(report['acceptance'],cases,helpers=vars(r))
p=reports[0]['acceptance'];r.verify_sequences(p,hardware);r.verify_source_contracts(p,hardware,cases)
counts={'numeric':r.verify_numeric(p,hardware,cases),'textures':r.verify_textures(p,hardware,cases),'reciprocals':reciprocal.verify_reciprocals(p,hardware,cases,helpers=vars(r)),'observations':reciprocal.verify_observations(p,hardware,cases,helpers=vars(r)),'interfacePixels':r.verify_pairs(p,hardware,pairs)}
for mode in modes:extra.verify_sabotage(output/('sabotage-'+mode),mode,reports[0],cases,hardware,helpers=vars(r))
functions={}
for path in output.glob('*/browser-coverage.json'):
 for script in r.read(path)['scripts']:
  if script['source']=='renderer/virgl-shader/tests/dot-reciprocals.mjs':
   for function in script['coverage']['functions']:
    region=function['ranges'][0];key=(function['functionName'],region['startOffset'],region['endOffset']);functions[key]=functions.get(key,0)+region['count']
r.require(len(functions)==151 and all(functions.values()),'all remaining authored browser functions entered')
print(json.dumps({'status':'passed','gitHead':head,'counts':counts,'functionsEntered':len(functions),'reports':[r.binding(output/name/'report.json',output) for name in ['hardware']+['sabotage-'+mode for mode in modes]]},indent=2))
