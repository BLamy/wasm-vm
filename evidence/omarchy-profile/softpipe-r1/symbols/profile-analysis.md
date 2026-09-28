# c48 profile symbol analysis

- Profile: evidence/omarchy-profile/input-followup-r1/renderer.cpuprofile (96d5cfb0d18f81cf3ff54af6b0473db34763859de3b5b76a82ec25642a601bc2)
- Exact release: c48e9c2d9ec550c7daf4875716fef1dc729072fdfc91b805394d379bee4b9305; name companion: 954f5edfda14dd461ddf615f557a0a3116b88bdb28148dd841c70b4cd5162c57; exact non-custom section binding: **true**; names: 1883
- Samples: 6716; sampled time: 10029726 us.

## Top 30 direct self time

| Rank | Symbol | Self us | Self % | Samples | Indices |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | wasm_vm_core::Machine::run::hb3a70af4514667f1 | 2002768 | 19.968 | 1344 | 183 |
| 2 | wasm_vm_core::hart::Hart::execute::hd1da7e6748700a68 | 1512928 | 15.084 | 1000 | 175 |
| 3 | wasm_vm_core::Machine::next_micro_op::h12a59264ce5c0708 | 594972 | 5.932 | 401 | 286 |
| 4 | wasm_vm_core::dispatch::BlockCache::get::hbf5b755754df63bf | 562135 | 5.605 | 378 | 503 |
| 5 | wasm_vm_core::mmu::translate_cached::hf2b93220145a733d | 539969 | 5.384 | 363 | 247 |
| 6 | __udivti3 | 456985 | 4.556 | 305 | 1394 |
| 7 | alloc::collections::btree::map::BTreeMap<K,V,A>::remove::h49400433011d1148 | 378571 | 3.774 | 255 | 761 |
| 8 | js-to-wasm:iil:i @ wasm://wasm/000143b6 | 334576 | 3.336 | 224 |  |
| 9 | now @ <host> | 320103 | 3.192 | 216 |  |
| 10 | wasm_vm_core::dispatch::BlockDiscovery::on_block_entry::h603a5b4937cad8ca | 307875 | 3.070 | 207 | 235 |
| 11 | wasm_vm_core::Machine::try_jit_block::h95922160ac631d34 | 261534 | 2.608 | 175 | 193 |
| 12 | wasm_vm_core::pmp::Pmp::check::h49feb29917fd316e | 241302 | 2.406 | 162 | 683 |
| 13 | wasm_vm_core::mmu::finish_leaf::hb5c91ebad7369df2 | 200944 | 2.003 | 135 | 760 |
| 14 | Module @ <host> | 107295 | 1.070 | 72 |  |
| 15 | wasm_vm_core::decode::decode::hc0ed8cae72412bec | 106258 | 1.059 | 71 | 197 |
| 16 | <wasm_vm_wasm::jit_browser::BrowserExecutor as wasm_vm_core::jit::CompiledBlockExecutor>::execute_with_budget::h1c6b17789b9d53e7 | 87088 | 0.868 | 57 | 198 |
| 17 | rustc_apfloat::ieee::sig::mul::h05bcd4e13dd4cace | 83923 | 0.837 | 56 | 394 |
| 18 | <std[f839c7267e543978]::hash::random::DefaultHasher as core[2c5ad5f686fcca5c]::hash::Hasher>::write | 76142 | 0.759 | 51 | 500 |
| 19 | <rustc_apfloat::ieee::IeeeFloat<S> as rustc_apfloat::Float>::mul_r::ha9b0486279c76e53 | 70988 | 0.708 | 47 | 484 |
| 20 | wasm_vm_core::dev::virtio::net::service::h88973684b4a526cb | 67816 | 0.676 | 45 | 215 |
| 21 | core::hash::BuildHasher::hash_one::he61abe7265f819be | 67753 | 0.676 | 46 | 655 |
| 22 | <wasm_vm_core::softfloat::F32 as wasm_vm_core::softfloat::SoftFloat>::fma::h1178d08e2231c9c4 | 67044 | 0.668 | 45 | 435 |
| 23 | __multi3 | 63349 | 0.632 | 42 | 1116 |
| 24 | wasm_vm_core::hart::Hart::decode_at::hbaeb13e5b7b0e262 | 62779 | 0.626 | 42 | 385 |
| 25 | wasm_vm_core::csr::Csrs::next_interrupt::he02f95cae226d67a | 61117 | 0.609 | 41 | 366 |
| 26 | wasm_vm_core::hart::cload64::h1a2ce2b7a170fbe8 | 60744 | 0.606 | 41 | 377 |
| 27 | rustc_apfloat::ieee::IeeeFloat<S>::normalize::h443a248fe51b2c2d | 59632 | 0.595 | 40 | 272 |
| 28 | wasm_vm_core::dev::virtio::gpu::service_cursor::hda6c1825a97ffd87 | 57696 | 0.575 | 39 | 232 |
| 29 | (idle) @ <host> | 55914 | 0.557 | 37 |  |
| 30 | wasm_vm_core::hart::cstore64_with_phys::h36eb018b493461e6 | 54907 | 0.547 | 37 | 469 |

## __udivti3

Direct self: 456985 us (4.556%), 305 samples. Inclusive: 456985 us (4.556%).

### Direct callers

| Caller | Sampled us | % | Samples |
| --- | ---: | ---: | ---: |
| wasm_vm_core::Machine::run::hb3a70af4514667f1 | 387494 | 3.863 | 259 |
| (root) @ <host> | 51388 | 0.512 | 34 |
| wasm_vm_core::Machine::try_jit_block::h95922160ac631d34 | 9073 | 0.090 | 6 |
| wasm_vm_wasm::WasmLinux::run_chunk::h07405c1400974665 | 9030 | 0.090 | 6 |

### Inclusive callers

| Ancestor | Sampled us | % | Samples |
| --- | ---: | ---: | ---: |
| (root) @ <host> | 456985 | 4.556 | 305 |
| runTick @ http://127.0.0.1:58755/loader.js | 405597 | 4.044 | 271 |
| runChunk @ http://127.0.0.1:58755/pkg/wasm_vm_wasm.js | 405597 | 4.044 | 271 |
| js-to-wasm:iid:iii @ http://127.0.0.1:58755/pkg/wasm_vm_wasm_bg.wasm | 405597 | 4.044 | 271 |
| wasmlinux_runChunk multivalue shim | 405597 | 4.044 | 271 |
| wasm_vm_wasm::WasmLinux::run_chunk::h07405c1400974665 | 405597 | 4.044 | 271 |
| wasm_vm_core::Machine::run::hb3a70af4514667f1 | 396567 | 3.954 | 265 |
| wasm_vm_core::Machine::try_jit_block::h95922160ac631d34 | 9073 | 0.090 | 6 |

## softfloat and rustc_apfloat entries

| Symbol | Self us | Self % | Inclusive us | Inclusive % | Indices |
| --- | ---: | ---: | ---: | ---: | --- |
| rustc_apfloat::ieee::sig::mul::h05bcd4e13dd4cace | 83923 | 0.837 | 115554 | 1.152 | 394 |
| <rustc_apfloat::ieee::IeeeFloat<S> as rustc_apfloat::Float>::mul_r::ha9b0486279c76e53 | 70988 | 0.708 | 207691 | 2.071 | 484 |
| <wasm_vm_core::softfloat::F32 as wasm_vm_core::softfloat::SoftFloat>::fma::h1178d08e2231c9c4 | 67044 | 0.668 | 104716 | 1.044 | 435 |
| rustc_apfloat::ieee::IeeeFloat<S>::normalize::h443a248fe51b2c2d | 59632 | 0.595 | 59632 | 0.595 | 272 |
| <wasm_vm_core::softfloat::F32 as wasm_vm_core::softfloat::SoftFloat>::mul::h5142bd146be88903 | 44744 | 0.446 | 236002 | 2.353 | 563 |
| rustc_apfloat::ieee::sig::add_or_sub::hf896c0db1ae81e92 | 36219 | 0.361 | 37735 | 0.376 | 192 |
| <rustc_apfloat::ieee::IeeeFloat<S> as rustc_apfloat::Float>::add_r::hcfc98d4568b301f8 | 34501 | 0.344 | 64544 | 0.644 | 438 |
| <wasm_vm_core::softfloat::F32 as wasm_vm_core::softfloat::SoftFloat>::add::h97b784e5467c9f89 | 33210 | 0.331 | 87419 | 0.872 | 561 |
| <wasm_vm_core::softfloat::F32 as wasm_vm_core::softfloat::SoftFloat>::le::h3899dca02857e471 | 12046 | 0.120 | 13552 | 0.135 | 574 |
| wasm_vm_core::softfloat::f32_from_int::ha8f5c825713e0f44 | 9007 | 0.090 | 23439 | 0.234 | 453 |
| <rustc_apfloat::ieee::IeeeFloat<S> as rustc_apfloat::Float>::to_u128_r::h18aeab74eba47281 | 8931 | 0.089 | 8931 | 0.089 | 420 |
| <wasm_vm_core::softfloat::F32 as wasm_vm_core::softfloat::SoftFloat>::div::h0209fd751f96d682 | 7948 | 0.079 | 15506 | 0.155 | 562 |
| rustc_apfloat::ieee::sig::div::h9f71ab2bd7008bab | 7558 | 0.075 | 7558 | 0.075 | 221 |
| wasm_vm_core::softfloat::f32_to_int::ha960e873d9ab44a1 | 1507 | 0.015 | 10438 | 0.104 | 452 |
| <rustc_apfloat::ieee::IeeeFloat<S> as rustc_apfloat::Float>::cmp_abs_normal::h6d6e52d72854877b | 1506 | 0.015 | 1506 | 0.015 | 983 |
| <wasm_vm_core::softfloat::F32 as wasm_vm_core::softfloat::SoftFloat>::sub::hf8ca7ffcf00e2652 | 0 | 0.000 | 1508 | 0.015 | 401 |

## Source-lined offsets

No source-line mapping is claimed. The exact c48 companion contains no DWARF; the raw target has DWARF but is a different module (raw functions: 3927; c48 functions: 1710). Applying raw DWARF offsets would be guessing.

| Symbol | c48 index/offset | Result |
| --- | --- | --- |
| wasm_vm_core::Machine::run::hb3a70af4514667f1 | 183/167341 | unavailable-without-guessing |
| wasm_vm_core::hart::Hart::execute::hd1da7e6748700a68 | 175/53093 | unavailable-without-guessing |
| wasm_vm_core::Machine::next_micro_op::h12a59264ce5c0708 | 286/601890 | unavailable-without-guessing |

## Interpreter versus JIT labels

These are measured host CPU sample buckets, not guest-instruction counts. JIT-labeled frames are kept separate.

| Bucket | Sampled us | % | Samples |
| --- | ---: | ---: | ---: |
| interpreter-core-rust | 6202116 | 61.837 | 4150 |
| jit-control-rust | 966317 | 9.635 | 648 |
| jit-wasm-module | 648117 | 6.462 | 433 |
| other-rust | 582209 | 5.805 | 392 |
| compiler-builtin | 555875 | 5.542 | 371 |
| host-js-or-other | 531072 | 5.295 | 358 |
| numeric-runtime | 478764 | 4.773 | 320 |
| wasm-bindgen-glue | 53776 | 0.536 | 36 |
| wasm-runtime-rust | 11480 | 0.114 | 8 |

Interpreter-core bucket: 6202116 us (61.837%). JIT-labeled bucket: 1614434 us (16.096%).

## Narrow future T03d candidate

Investigate the observed __udivti3 integer-division path, beginning with its top direct caller: **wasm_vm_core::Machine::run::hb3a70af4514667f1**. This is the narrowest evidence-supported target from this profile; measure divisor/value patterns and verify generated code before proposing a replacement. It is not a softfloat diagnosis.
