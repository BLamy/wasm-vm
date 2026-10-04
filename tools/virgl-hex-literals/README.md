# Canonical hexadecimal FLT32 proof

`make verify-E6-T12g6c` records 676 public native cases under ASan/UBSan and
LLVM coverage. The 512 canonical witnesses compare their independent literal
word tables with the pinned TGSI parser's actual token words. Raw-path results
must equal decimal UINT32 controls exactly; legacy controls compare metadata
and actual GPU pixels because upstream emits different GLSL for those types.

The Wasm path repeats all singles and pairs, including exceptional private
words, their unsafe numerical/output uses, and malformed encodings. Three
seeded physical Chrome/WebGL2 runs expose every exponent class through two
normal finite vertex carriers and check all 32 fragment bit planes. Oracles
derive from the literal words, never compiler IR or emitted source. Two actual
emitted-source corruptions must contradict physical words/pixels, with all GL
objects disposed on both success and failure.

G6b's unchanged resource/arena/stack evidence stays HELD; the promoted 402-case
join guard, 49 critic-promoted hexadecimal grammar/domain/version guards and
25 literal original bodies are replayed. Complete unsupported
compositor programs still reject. There is no guest negotiation, production
import, performance, portability or live desktop claim.

Freeze source before final recording. Then run once:

```sh
make verify-E6-T12g6c
python3 tools/virgl-hex-literals/cold.py --output target/evidence/virgl-hex-literals-cold
python3 tools/virgl-hex-literals/seal.py --hot target/evidence/virgl-hex-literals --cold target/evidence/virgl-hex-literals-cold --output evidence/virgl-hex-literals/worker
```

The clean clone scrubs toolchain/Node/Python/Rust/npm overrides, checks exact
HEAD and empty checkout state, and runs the same deterministic acceptance.
Receipts and deterministic archives bind source, generated binaries, primary
words, sanitizer coverage, actual framebuffer/feedback bytes, GPU identity,
screenshots and source-fault failures. A fresh critic audits them independently.
