# Exact-head clean-clone identity

- Clone method: `git clone --no-local /Users/blamy/Documents/Codex/wasm-vm /private/tmp/e5-t19a-clean.rcEfYx/repo`
- Detached revision: `1be872f25f2d836f3d56310db82875053b6c185b`
- Acceptance: `env -u RUST_LOG -u RUSTFLAGS -u CARGO_HOME -u CARGO_TARGET_DIR -u CARGO_BUILD_TARGET make verify-E5-T19a`
- Result: exit 0; `verify-E5-T19a (PCM lifecycle and Linux XRUN recovery): OK`
- Post-run audit: `git rev-parse HEAD` returned the exact revision above; `git status --porcelain` was empty; unstaged and staged `git diff --quiet` both exited 0.
- This is the sole clean-clone proof for this frozen remediation unless a portability failure invalidates it.
