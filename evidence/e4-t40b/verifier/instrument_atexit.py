#!/usr/bin/env python3
"""Add-on to instrument.py: every process that touches a counter appends all counters to
$TURBO_COV_FILE when it exits, so a whole `cargo test --workspace` run (test binaries and the
CLI processes they spawn) can be summed."""
import sys
t = sys.argv[1] + '/crates/core/src/turbo.rs'
s = open(t).read()
old = """#[inline(always)]
pub(crate) fn cov(i: usize) {
    COV[i].fetch_add(1, core::sync::atomic::Ordering::Relaxed);
}"""
new = """#[cfg(feature = "std")]
static COV_ONCE: std::sync::Once = std::sync::Once::new();
#[cfg(feature = "std")]
unsafe extern "C" {
    fn atexit(cb: extern "C" fn()) -> i32;
}
#[cfg(feature = "std")]
extern "C" fn cov_at_exit() {
    if let Some(path) = std::env::var_os("TURBO_COV_FILE") {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let mut s = std::string::String::new();
            for (name, hits) in COV_NAMES.iter().zip(COV.iter()) {
                s.push_str(&std::format!(
                    "COV {} {}\\n",
                    hits.load(core::sync::atomic::Ordering::Relaxed),
                    name
                ));
            }
            let _ = f.write_all(s.as_bytes());
        }
    }
}
#[inline(always)]
pub(crate) fn cov(i: usize) {
    #[cfg(feature = "std")]
    COV_ONCE.call_once(|| unsafe {
        atexit(cov_at_exit);
    });
    COV[i].fetch_add(1, core::sync::atomic::Ordering::Relaxed);
}"""
assert s.count(old) == 1
s = s.replace(old, new)
# crates/core/tests/no_stdout_in_core.rs forbids print macros in the core: counters go to the
# file only in this variant.
line = """        std::eprintln!("COV {:>14} {}", hits.load(core::sync::atomic::Ordering::Relaxed), name);"""
assert s.count(line) == 1
s = s.replace(line, "        let _ = (name, hits);")
open(t, 'w').write(s)
print("atexit dump added")
