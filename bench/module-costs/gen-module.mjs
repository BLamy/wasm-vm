// E4-T19 cost-matrix — a minimal, dependency-free WASM binary emitter that builds a module of `n`
// functions sharing one linear memory, matching the SHAPE of a JIT batch module (K block functions,
// one `mem`, per-function export). It is deliberately tiny: each function is `(param i32)(result i32)`
// and returns `local.get 0` plus a fixed number of filler `i32.add`s, so module BYTE SIZE scales with
// both function count and body size — the two axes the compile-latency curve needs. This mirrors the
// real emitter's function/memory/export structure without pulling the Rust crate into the browser.
//
// Used by the Playwright cost matrix to measure WebAssembly.compile / instantiate latency and memory
// as a function of module size (1..256 functions). The bytes it produces validate under every engine.

function leb(v) {
  // unsigned LEB128
  const out = [];
  let x = v >>> 0;
  do {
    let b = x & 0x7f;
    x >>>= 7;
    if (x !== 0) b |= 0x80;
    out.push(b);
  } while (x !== 0);
  return out;
}

function section(id, content) {
  return [id, ...leb(content.length), ...content];
}

function name(s) {
  const bytes = [...new TextEncoder().encode(s)];
  return [...leb(bytes.length), ...bytes];
}

// Build a module with `n` exported functions `run0..run{n-1}`, one exported memory `mem`, each body
// `bodyOps` filler i32.add ops. Returns a Uint8Array of valid WASM.
export function genModule(n, bodyOps = 8) {
  // type section: one type () -> ... actually (i32)->i32
  const types = [
    ...leb(1),
    0x60, // functype
    ...leb(1),
    0x7f, // param i32
    ...leb(1),
    0x7f, // result i32
  ];
  // function section: n functions, all type 0
  const funcs = [...leb(n), ...Array.from({ length: n }, () => 0).flatMap((t) => leb(t))];
  // memory section: one memory, min 1 page
  const mems = [...leb(1), 0x00, ...leb(1)];
  // export section: mem + run0..run{n-1}
  const exports = [];
  exports.push(...name("mem"), 0x02, ...leb(0)); // memory 0
  for (let i = 0; i < n; i++) {
    exports.push(...name("run" + i), 0x00, ...leb(i)); // func i
  }
  const exportSec = [...leb(n + 1), ...exports];
  // code section: n bodies. Body = locals(0) + `local.get 0` + bodyOps*(i32.const 1; i32.add) + end
  const bodies = [];
  for (let i = 0; i < n; i++) {
    const body = [];
    body.push(...leb(0)); // no locals
    body.push(0x20, ...leb(0)); // local.get 0
    for (let k = 0; k < bodyOps; k++) {
      body.push(0x41, ...leb(1)); // i32.const 1
      body.push(0x6a); // i32.add
    }
    body.push(0x0b); // end
    bodies.push([...leb(body.length), ...body]);
  }
  const code = [...leb(n), ...bodies.flat()];

  const bytes = [
    0x00, 0x61, 0x73, 0x6d, // \0asm
    0x01, 0x00, 0x00, 0x00, // version 1
    ...section(1, types),
    ...section(3, funcs),
    ...section(5, mems),
    ...section(7, exportSec),
    ...section(10, code),
  ];
  return new Uint8Array(bytes);
}
