"""Reconstruct a submitted receipt inside its original source/binary checkout."""
import argparse,hashlib,json,pathlib,subprocess,sys
parser=argparse.ArgumentParser();parser.add_argument('--root',type=pathlib.Path,required=True);parser.add_argument('--evidence',type=pathlib.Path,required=True);parser.add_argument('--result',type=pathlib.Path,required=True);args=parser.parse_args();root=args.root.resolve();directory=args.evidence.resolve();head='bfcd3a4076a163648c67bf7674e94d616c42c1e1'
sys.path.insert(0,str(root/'tools/virgl-bounded-loops'));import receipt
observed=receipt.verify(directory,head);raw=(directory/'receipt.json').read_bytes();recorded=json.loads(raw)
assert json.dumps(observed,sort_keys=True,allow_nan=False)==json.dumps(recorded,sort_keys=True,allow_nan=False)
native=json.loads((directory/'native/native-report.json').read_text());coverage=subprocess.check_output(native['coverage']['commands'][1],cwd=root);assert coverage==(directory/'native/coverage.json').read_bytes()
status=subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=root,text=True)
result={'task':'E6-T12e9','sourceHead':head,'checkoutHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'checkout':str(root),'evidence':str(directory),'receiptSha256':hashlib.sha256(raw).hexdigest(),'receiptReconstructedExactly':True,'coverageReexportSha256':hashlib.sha256(coverage).hexdigest(),'sources':len(recorded['sources']),'records':len(recorded['records']),'checkoutStatus':status}
args.result.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
