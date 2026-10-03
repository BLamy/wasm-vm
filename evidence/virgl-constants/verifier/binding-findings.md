# Independent binding audit — E6-T12e3b

VERDICT: verified (binding/evidence scope only; parent owns task verdict)

Predictions were recorded in `binding-predictions.md` before evidence inspection.
Frozen runtime/harness: `81cd3a4c403176be4b0191fa00ed37f4fd1e1e35`.
Claim commit: `68186f6edf63a6f3c0e2160892a2bc5b868ab8f8`.

- **B1 HELD — exact source and artifact identity.** Independently checked431 source bindings against filesystem and frozen Git blobs,32 worker receipt records,31 served browser files, and screenshot/coverage hashes. Sabotage serves precisely the frozen `state.mjs` with one high-upload truncation substitution. Citation: `binding-worker-audit.json:9`, worker receipt SHA256 `b8c266ccb74028314366b0ed556377b6e2ca49bff9234734fa1b9f6aeab014d5`, hardware report SHA256 `605e77cc268e735c2fb572b0a69c5b9e8dd41369753a45f5a7f32b25aa6856d4`.
- **B2 HELD — original/native/Wasm/driver text binding.** All19 original results equal the verified E3 outputs in full (12 success,7 rejection); all8 fixture texts and full results match native transcript, Wasm translation, actual renderer requests and actual `shaderSource` text. The out-of-range frontend boundary carries forward from unchanged verified E3 source. Citation: `binding-worker-audit.json:20`; native report SHA256 `1ecee077496f3eea591ff4ac3a14afef91a33700d69d92b174d82bad3881ffef`.
- **B3 HELD — literal raw transport.** Independently decoded little-endian packet framing and stage/slot/finite-word constraints for all23 cases; derived8 acceptances and15 exact code/offset rejections without importing the decoder or worker receipt. Citation: `binding-worker-audit.json:32`; decoder SHA256 `7dcbfe96253cac18e65b530aa40554e2b5587d9f3772c575ff2ca6e4c0c2767f`.
- **B4 HELD — independent raw-input-to-output proof.** Replayed92 accepted raw uploads by context/subcontext and linked each of44 draw banks to the latest applicable raw packet. Every actual uploaded uniform prefix matches those raw words. A small independent interpreter evaluated original TGSI MOV/MUL/ADD source and rasterized the original indexed geometry, reproducing all45,056 recorded pixels without using generated GLSL, reported colors/rectangles, expectedMode, or the worker pixel oracle. Same shader/packet/bank inputs under source sabotage yield the all-blue framebuffer and fail the independent expectation at byte0. Citation: `binding-worker-audit.json:178`; sabotage report SHA256 `32c15f3dfbd79a2e2d387c717ea00343223389f3d802709c0bea88d087de7d77`.
- **B5 HELD — cold clone and claim identity.** Repeated the full independent audit on the copied cold acceptance, with all44 derived framebuffers identical to the worker run. All35 copied cold artifacts equal the retained clone's original files; that clone still has clean tracked/untracked status at the frozen head. The frozen cold harness's actual environment-scrub AST was exercised against hostile Rust/Cargo/build/compiler/Node/Python/Git overrides, removing every injected override; all its subprocess calls use the scrubbed dictionary. All13 claim-cited digests match the committed evidence. The claim commit changes only evidence and task metadata. Citation: `binding-cold-claim-audit.json:1`; cold report SHA256 `66cd6d29faf2546c1c46171f4ef86f4947c3f041482887732538030d3bd1118c`.
- **B6 HELD — production remains disabled.** No web, crates, or GitHub runtime activation changes occur in this slice, and the production contract is byte-equivalent in value to E3: empty capsets,0 numCapsets, guestRendererImplemented false, virglFeature false. Citation: `binding-worker-audit.json:1560`.

Commands (from the worktree):

```sh
python3 evidence/virgl-constants/verifier/binding-audit.py
python3 evidence/virgl-constants/verifier/binding-audit.py evidence/virgl-constants/cold-clone/acceptance evidence/virgl-constants/verifier/binding-cold-acceptance-audit.json
python3 evidence/virgl-constants/verifier/binding-cold-claim-audit.py
```

Independent result digests:

- `binding-worker-audit.json`: `356f2691034b652399e9d5bdbdd1db21bbf3c73ab934979c29b79d25aaaf579d`.
- `binding-cold-acceptance-audit.json`: `048f4089c498e2a1584c0c9cd71f488ef2266af9a2dd5ba2b030884b823543f3`.
- `binding-cold-claim-audit.json`: `f8c9067fd9c54f9d5781ececb3310e3a9aa429c54ac7754b505dbfd86e399ae8`.

No implementation, root harness, task status, or Git commit was changed by this helper.
