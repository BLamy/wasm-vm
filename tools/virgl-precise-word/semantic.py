#!/usr/bin/env python3
"""Bind stable TGSI semantics to pinned upstream tokens and actual parser output."""
import argparse,hashlib,json,os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def binding(path):
 raw=(ROOT/path).read_bytes();return dict(path=path,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 paths=['renderer/virgl-shader/UPSTREAM.json','renderer/virgl-shader/vendor/src/gallium/include/pipe/p_shader_tokens.h','renderer/virgl-shader/vendor/src/gallium/auxiliary/tgsi/tgsi_text.c','renderer/virgl-shader/vendor/src/vrend/vrend_shader.c','renderer/virgl-shader/tests/mesa-24.2.8-tgsi.rst','renderer/virgl-shader/native_tests/precise_audit.c','tools/virgl-precise-word/semantic.py']
 sources=list(map(binding,paths));doc=(ROOT/paths[4]).read_text();assert sources[4]['sha256']=='856a2d675bf20e8014ecb77c96b7cd91e6d4bf853bbfbe697f3b09edfc34223c'
 assert 'FSEQ - Float Set On Equal (ordered)' in doc and 'FSNE - Float Set On Not Equal (unordered)' in doc and '(x > y) ? x : y' in doc
 upstream=json.loads((ROOT/paths[0]).read_bytes());binary=ROOT/'renderer/virgl-shader/build/precise-token-audit/precise-token-audit'
 env=dict(os.environ,ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1');run=subprocess.run([str(binary)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=60);assert run.returncode==0 and not run.stderr
 (a.output/'tokens.jsonl').write_bytes(run.stdout);actual=[json.loads(v) for v in run.stdout.splitlines()]
 expected=[dict(stage=s,instructions=[dict(opcode=op,precise=i<4) for i,op in enumerate([1,89,92,13,1,89,92,13,98])]) for s in ('vertex','fragment')];assert actual==expected
 evidence=dict(schema='precise-tgsi-semantic-audit-v1',status='passed',sources=sources,document=dict(version='Mesa 24.2.8',url='https://archive.mesa3d.org/mesa-24.2.8.tar.xz',member='mesa-24.2.8/docs/gallium/tgsi.rst',sha256=sources[4]['sha256']),rules=[dict(id='modifier',line=44,claim='PRECISE forbids result-altering arithmetic optimizations; four supported operations use exact integer word semantics.'),dict(id='max',line=3010,claim='Strict ordered source0 > source1 selects source0; equal and unordered select source1 word unchanged.'),dict(id='equality',line=1510,claim='FSEQ ordered equality and FSNE unordered inequality return all-one or zero integer masks.'),dict(id='scope',claim='The token bit is per instruction. Pinned vrend conditionally marks destination variables only when has_gpu_shader5; ESSL300 exact word lowering retains the bit without relying on that qualifier. This slice does not infer exact arithmetic in an upstream RSQ/DP3 cone.')],supportedOperations=['FSEQ','FSNE','MAX','MOV'],gatedArithmetic=['ADD_PRECISE','MUL_PRECISE'],binary=binding(str(binary.relative_to(ROOT))),tokens=dict(path='tokens.jsonl',bytes=len(run.stdout),sha256=hashlib.sha256(run.stdout).hexdigest()),actual=actual)
 assert list(map(binding,paths))==sources;(a.output/'report.json').write_text(json.dumps(evidence,indent=2)+'\n');print('Both-stage pinned per-instruction PRECISE token audit passed')
if __name__=='__main__':main()
