"""Authenticate held compiler and dimensional evidence without rerunning them."""
import importlib.util,json,subprocess,sys
from pathlib import Path
repo=Path(__file__).resolve().parents[2];output=Path(sys.argv[1]);output.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('custody',repo/'tools/virgl-dimensional-depth-surfaces/custody.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
seals=[]
for role,digest in [('worker','cd82a9b788f33e1261f62694c40f0d22d4eedbe591a8f53a7204dbdd43440b1d'),('verifier','c82404435ddd31f8ac9878f08b3cbf5e00e874eee01617cb9440baf546b490e4'),('deployment','94011feafe8720006fea2c4eab4e529c5d7b826d76cb590c86034001a673d8a0')]:
    directory=repo/'evidence/virgl-stream-output-shaders'/role;auth,_=module.reopen(directory,digest);seals.append(dict(path=str(directory.relative_to(repo)),**auth))
assert 'status: verified' in subprocess.check_output(['git','show','967826b1539c3099b2da5952a553c282b0428d35:tasks/epic-6-transcendence/E6-T11d65-stream-output-shaders.md'],cwd=repo,text=True)
assert not subprocess.check_output(['git','diff','--name-only','967826b1539c3099b2da5952a553c282b0428d35','HEAD','--','renderer/virgl-shader'],cwd=repo)
(output/'authentication.json').write_text(json.dumps({'status':'passed','held':seals,'compilerUnchanged':True},indent=2)+'\n')
print('Authenticated and reopened three held D65 seals; compiler unchanged.')
