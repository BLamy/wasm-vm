# Refused/incomplete compiler-harness attempt

This attempt is not matched baseline artifact evidence. The source archive initially
omitted `rust-toolchain.toml` and `.cargo/config.toml`. Its native probe built and smoke-ran,
but the WASM build failed with a missing target, exit101; the builder exited1. Its first
metadata version queried rustc from Main's directory rather than the child source directory,
so that version field cannot authenticate the actual compiler selected for this native run.
All original output, metadata, native binary/assembly and builder are retained.

Main restored the committed toolchain/config into the task-owned baseline archive. A new
attempt will also use a standalone probe manifest to exclude unrelated core dev-dependencies
from the WASM probe. No product/runtime fix or semantic/timing result is inferred.
