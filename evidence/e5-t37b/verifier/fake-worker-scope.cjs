// Verifier preload: make node's global pass `instanceof WorkerGlobalScope`, so JsHostTimer::new()
// (crates/wasm/src/lib.rs:1520) finds a host clock (node's own monotonic globalThis.performance).
globalThis.WorkerGlobalScope = class { static [Symbol.hasInstance](v) { return v === globalThis; } };
