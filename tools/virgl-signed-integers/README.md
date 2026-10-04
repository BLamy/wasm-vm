# Private signed comparison and maximum proof

`make verify-E6-T12g6d` exercises ISLT/IMAX through the public native/Wasm APIs,
ASan/UBSan and LLVM coverage. Signed predictions use BigInt values obtained
directly from literal source words. Every pair of the 16 endpoint/special-word
classes plus seeded values executes on actual WebGL2 hardware. Two normal
finite carriers expose all 32 selected/mask bits; fragment planes expose exact
zero/one pixels. Dynamic banks also exercise swizzles, destination masks,
aliased reads, both branch predecessors and old/new bank replacements.

The pinned TGSI parser and converter record actual signed source/destination
types and GLSL. Its float-backed temporaries canonicalize NaN encodings on this
GPU, including the canonical all-ones comparison mask. It therefore supplies
a predicate reference for ISLT (UCMP maps nonzero to finite one), and exact IMAX
references when selected words are normal or zero. Alias/masked references use
normal/zero inputs. This restriction is explicit: the owned raw emitter alone
is held to every original integer word by the independent BigInt oracle.
No upstream reference shader is rewritten after translation.

The real shared renderer checks both shader stages' constant metadata, A/B/A
replacement/restoration and caller byte mutation in synchronous and asynchronous
submissions. The existing decoder's nonfinite constant-packet rejection remains
unchanged; arbitrary host-injected word probes do not claim guest transport.
Signed selection cannot borrow an IN float locator or constant-bank numeric/
raster authority. Existing normal/zero bit facts still authorize established
safe uses. Original programs and prior 402 join / 49 literal guards are replayed;
unchanged capacity, arenas, stack, heap and prior compiler proofs remain HELD.
The fresh critic's 108 signed authority, mask, version, join and grammar guards
also run through both native and Wasm in the recurring gate.

Three hardware seeds and actual wrong-signedness/wrong-winner emitted-source
faults form the final recording. Freeze the source, then run once:

```sh
make verify-E6-T12g6d
python3 tools/virgl-signed-integers/cold.py --output target/evidence/virgl-signed-integers-cold
python3 tools/virgl-signed-integers/seal.py --hot target/evidence/virgl-signed-integers --cold target/evidence/virgl-signed-integers-cold --output evidence/virgl-signed-integers/worker
```

The clean clone scrubs overrides and repeats that exact source acceptance.
Source/generated hashes, raw physical bytes, GL identities/reflection/disposal,
captured consumer snapshots, diagnostics and screenshots are sealed for a fresh
critic. Production imports/caps/negotiation stay disabled. This is no guest boot,
desktop responsiveness, MIPS or FPS claim.
