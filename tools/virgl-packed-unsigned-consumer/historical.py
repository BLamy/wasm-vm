#!/usr/bin/env python3
"""Reuse the unchanged D33 whole-word inverse on one affected historical path."""
import importlib.util,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/virgl-integer-image-consumer'))
spec=importlib.util.spec_from_file_location('held_integer_inverse',ROOT/'tools/virgl-integer-image-consumer/pixels.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
output=Path(sys.argv[1]).resolve();result=module.inspect(output,False)
(output/'pixel-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
