#!/usr/bin/env python3
"""Run the held storage inverse on the complete retained matrix.

Full UN24 domains remain at the unchanged, fully reopened D42 boundary.
This matrix executes all retained storage paths and all256 original S8 fields.
"""
import importlib.util,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('held_packed_depth_inverse',ROOT/'tools/virgl-packed-depth/values.py')
held=importlib.util.module_from_spec(spec);spec.loader.exec_module(held)
held.main(sys.argv[1],allow_partial=True)
record=json.loads(Path(sys.argv[1],'independent-values.json').read_text())
assert record['status']=='passed' and record['stencilValues']==256 and record['nativePixels']>0
assert record['scope']=='inner-loop' and record['domainWordsPerFormat']=={'20':0,'21':0}
assert record['publicFixedFieldsExact'] and not record['oracleImportsProductCode']
