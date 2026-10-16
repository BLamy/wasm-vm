#!/usr/bin/env python3
import json,os,shutil,subprocess
from pathlib import Path
from shared import binding
emcc=Path(os.environ['EMCC']).resolve();sdk=next(p for p in emcc.parents if (p/'upstream/emscripten/emcc.py').exists())
files=[Path(shutil.which('clang')).resolve(),emcc,sdk/'upstream/emscripten/emcc.py',sdk/'upstream/bin/clang',sdk/'upstream/bin/wasm-ld',sdk/'upstream/bin/wasm-opt']
print(json.dumps(dict(schema='original-corpus-toolchain-v1',emccVersion=subprocess.check_output([str(emcc),'--version'],text=True).splitlines()[0],clangVersion=subprocess.check_output(['clang','--version'],text=True).splitlines()[0],tools=[binding(p,Path('/')) for p in files])))
