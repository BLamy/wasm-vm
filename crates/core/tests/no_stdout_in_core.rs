//! E0-T15 enforcement: `crates/core` must never `println!`/`eprintln!`/`print!` — the
//! core routes diagnostics through the `log` facade so hosts control output (and so it
//! stays no_std). This test greps the core sources and fails if any appear.

use std::path::Path;

#[test]
fn core_has_no_stdout_macros() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut offenders = Vec::new();
    visit(&src, &mut offenders);
    assert!(
        offenders.is_empty(),
        "crates/core must use the `log` facade, not stdout/stderr macros. Found:\n{}",
        offenders.join("\n")
    );
}

fn visit(dir: &Path, out: &mut Vec<String>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            visit(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            let text = std::fs::read_to_string(&path).unwrap();
            for (n, line) in text.lines().enumerate() {
                let code = line.split("//").next().unwrap_or(line);
                for m in ["println!", "eprintln!", "print!", "eprint!"] {
                    if code.contains(m) {
                        out.push(format!("{}:{}: {}", path.display(), n + 1, m));
                    }
                }
            }
        }
    }
}
