import subprocess, pathlib, os, sys
root = pathlib.Path(__file__).parent
RS = root / "crates/slirp/src/ws_proxy/relay_security.rs"
DR = root / "crates/slirp/src/ws_proxy/driver.rs"
M = {
 "M1_retain_expiry_only": (RS, "usage.expiry_unix_secs > now_unix_secs || usage.sessions > 0 || usage.active_streams > 0", "usage.expiry_unix_secs > now_unix_secs"),
 "M2_open_session_uncounted": (RS, "        usage.sessions += 1;\n", "\n"),
 "M3_close_session_noop": (RS, "            usage.sessions = usage.sessions.saturating_sub(1);\n", "            let _ = usage;\n"),
 "M4_deadline_cuts_authenticated": (DR, "if self.security.is_some() && self.authenticated_token.is_none() =>", "if self.security.is_some() =>"),
 "M5_port_check_removed": (DR, "        || (require_public && !port_is_allowed(port))\n", ""),
 "M6_6to4_branch_removed": (RS, "    if segments[0] == 0x2002 {\n        return ipv4_is_public(Ipv4Addr::new(octets[2], octets[3], octets[4], octets[5]));\n    }\n", ""),
 "M7_deadline_removed": (DR, "if self.security.is_some() && self.authenticated_token.is_none() =>", "if false =>"),
}
env = {k: v for k, v in os.environ.items() if k not in ("RUSTFLAGS",) and not k.startswith("CARGO_")}
env["CARGO_TARGET_DIR"] = str(root / "target")
cmds = [["cargo", "test", "-p", "wasm-vm-slirp", "--features", "native", "--lib", "ws_proxy"],
        ["cargo", "test", "-p", "wasm-vm-cli", "--test", "wvrelay_smoke", "--test", "wvrelay_token_rejection", "--test", "ws_connector_over_real_ws"]]
sel = sys.argv[1:] or list(M)
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
