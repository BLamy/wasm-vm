# E5-T43a round-4 verifier: mutants, applied in a SCRATCH clone (git clone --shared, sparse, at 091cb8ab1),
# restored after each. usage: python3 -I run-mutants.py <scratch-root> [names...]
import subprocess, pathlib, os, sys
root = pathlib.Path(sys.argv[1])
RS = root / "crates/slirp/src/ws_proxy/relay_security.rs"
DR = root / "crates/slirp/src/ws_proxy/driver.rs"
WA = root / "crates/slirp/src/ws_proxy/ws_adapter.rs"
REFRESH = '*self.last_activity.lock().expect("activity clock poisoned") = tokio::time::Instant::now();\n'
M = {
 # the six the worker claims
 "W1_no_forced_close": (WA, "let _ = tokio::time::timeout(CLOSE_GRACE, async {", "let _ = tokio::time::timeout(std::time::Duration::from_secs(3600), async {"),
 "W2_client_header_ignored": (WA, '            *callback_client.lock().expect("client capture poisoned") = client;\n', "            let _ = client; let _ = &callback_client;\n"),
 "W3_header_len_unbounded": (WA, ".filter(|value| !value.is_empty() && value.len() <= 64);", ".filter(|value| !value.is_empty());"),
 "W4_idle_never_closes": (DR, ".elapsed() >= limit)", ".elapsed() >= limit && false)"),
 "W5_client_bytes_unchecked": (DR, "            .is_ok()\n            && security\n", "            .map_or(true, |()| true)\n            && security\n"),
 "W6_inbound_no_refresh": (DR, "        " + REFRESH + "        if !self.core.is_ready()", "        if !self.core.is_ready()"),
 "W5b_registry_client_bytes_unchecked": (RS, "Some(next) if next <= limits.max_bytes_per_client_per_hour", "Some(next) if true || next <= limits.max_bytes_per_client_per_hour"),
 # the verifier's own
 "V1_idle_close_skips_cleanup": (DR, '"{{\\"event\\":\\"relay_session_idle_closed\\"}}");\n                        break;', '"{{\\"event\\":\\"relay_session_idle_closed\\"}}");\n                        return;'),
 "V2_outbound_no_refresh": (DR, "        " + REFRESH + "        let now = std::time::SystemTime::now()", "        let now = std::time::SystemTime::now()"),
 "V3_empty_header_accepted": (WA, ".filter(|value| !value.is_empty() && value.len() <= 64);", ".filter(|value| value.len() <= 64);"),
 "V4_hour_never_resets": (RS, "        registry.client_bytes.retain(|_, (h, _)| *h == hour);\n", ""),
 "V5_hour_le_to_lt": (RS, "Some(next) if next <= limits.max_bytes_per_client_per_hour", "Some(next) if next < limits.max_bytes_per_client_per_hour"),
 "V6_hourly_keyed_by_token": (DR, ".record_client_bytes(&security.client, bytes, now, security.limits)", ".record_client_bytes(&token.id, bytes, now, security.limits)"),
 "V7_daily_window": (RS, "let hour = now_unix_secs / 3600;", "let hour = now_unix_secs / 86400;"),
}
env = {k: v for k, v in os.environ.items() if k not in ("RUSTFLAGS", "RUST_LOG") and not k.startswith("CARGO_")}
env["CARGO_TARGET_DIR"] = str(root / "target")
cmds = [["cargo", "test", "-p", "wasm-vm-slirp", "--features", "native", "--lib", "ws_proxy"],
        ["cargo", "test", "-p", "wasm-vm-cli", "--test", "wvrelay_smoke", "--test", "wvrelay_token_rejection", "--test", "ws_connector_over_real_ws"]]
sel = sys.argv[2:] or list(M)
for name in sel:
    path, old, new = M[name]
    src = path.read_text()
    assert src.count(old) == 1, (name, src.count(old))
    path.write_text(src.replace(old, new))
    try:
        res = []
        for cmd in cmds:
            p = subprocess.run(cmd, cwd=root, env=env, capture_output=True, text=True)
            out = p.stdout + p.stderr
            fails = [l for l in out.splitlines() if l.startswith("test ") and l.endswith("FAILED")]
            summary = [l for l in out.splitlines() if l.startswith("test result:")]
            errs = [l for l in out.splitlines() if l.startswith("error")][:3]
            res.append({"cmd": " ".join(cmd[2:]), "rc": p.returncode, "failed": fails, "summary": summary, "errors": errs})
        killed = any(r["rc"] != 0 for r in res)
        compile_err = any(r["errors"] and not r["summary"] for r in res)
        print(f"== {name}: {'KILLED' if killed else 'SURVIVED'}{' (COMPILE ERROR - invalid mutant)' if compile_err else ''}")
        for r in res: print("   ", r)
        sys.stdout.flush()
    finally:
        path.write_text(src)
