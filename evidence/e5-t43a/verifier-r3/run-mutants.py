# E5-T43a round-3 verifier: mutants, applied in a SCRATCH copy (git archive HEAD), restored after each.
# usage: python3 -I run-mutants.py <scratch-root> [names...]
import subprocess, pathlib, os, sys
root = pathlib.Path(sys.argv[1])
RS = root / "crates/slirp/src/ws_proxy/relay_security.rs"
DR = root / "crates/slirp/src/ws_proxy/driver.rs"
WA = root / "crates/slirp/src/ws_proxy/ws_adapter.rs"
M = {
 # the five the worker claims
 "W1_deadline_cuts_authenticated": (DR, "if self.security.is_some() && self.authenticated_token.is_none() =>", "if self.security.is_some() =>"),
 "W2_port_check_removed": (DR, "        || (require_public && !port_is_allowed(port))\n", ""),
 "W3_close_keeps_client_place": (RS, "            *count = count.saturating_sub(1);\n", "            let _ = &count;\n"),
 "W4_close_keeps_token_session": (RS, "            usage.sessions = usage.sessions.saturating_sub(1);\n", "            let _ = usage;\n"),
 "W5_no_per_client_cap": (RS, "            >= limits.max_sessions_per_client\n", "            >= usize::MAX\n"),
 # the verifier's own
 "V1_per_client_off_by_one": (RS, "            >= limits.max_sessions_per_client\n", "            > limits.max_sessions_per_client\n"),
 "V2_no_total_cap": (RS, "        if registry.total_sessions >= limits.max_sessions_total {\n", "        if false {\n"),
 "V3_close_keeps_total": (RS, "        registry.total_sessions = registry.total_sessions.saturating_sub(1);\n", ""),
 "V4_header_ignored_peer_ip_only": (WA, "            *callback_client.lock().expect(\"client capture poisoned\") = client;\n", "            let _ = client; let _ = &callback_client;\n"),
 "V5_refusal_ignored": (DR, "                eprintln!(\"{{\\\"event\\\":\\\"relay_session_refused\\\",\\\"reason\\\":\\\"{reason:?}\\\"}}\");\n                return Err(RelayError::Authentication);\n", "                eprintln!(\"{{\\\"event\\\":\\\"relay_session_refused\\\",\\\"reason\\\":\\\"{reason:?}\\\"}}\");\n"),
 "V6_header_len_unbounded": (WA, "                .filter(|value| !value.is_empty() && value.len() <= 64);\n", "                .filter(|value| !value.is_empty());\n"),
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
        print(f"== {name}: {'KILLED' if killed else 'SURVIVED'}")
        for r in res: print("   ", r)
        sys.stdout.flush()
    finally:
        path.write_text(src)
