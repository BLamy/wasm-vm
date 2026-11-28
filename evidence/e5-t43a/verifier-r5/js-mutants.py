# E5-T43a round-5 verifier: mutants of deploy/cloudflare-relay/src/client.js against test/client.test.mjs.
# Runs in a scratch copy (src/client.js + test/client.test.mjs only). usage: python3 -I js-mutants.py <copy-root>
import pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1]); C = root / "src/client.js"
M = {
 "J1_caller_header_kept": ('  headers.delete("x-wvrelay-client");\n  headers.set("x-wvrelay-client", clientKey(request));',
                           '  if (!headers.get("x-wvrelay-client")) headers.set("x-wvrelay-client", clientKey(request));'),
 "J2_constant_key": ('  const ip = request.headers.get("CF-Connecting-IP") || "unknown";', '  const ip = "unknown";'),
 "J3_ipv6_slash64": ("full.slice(0, 3)", "full.slice(0, 4)"),
 "J4_xff_first": ('request.headers.get("CF-Connecting-IP")', '(request.headers.get("X-Forwarded-For") || request.headers.get("CF-Connecting-IP"))'),
 "J5_no_lowercase": ("(x || \"0\").toLowerCase()", "(x || \"0\")"),
 "J6_relay_headers_drop_others": ("const headers = new Headers(request.headers);", "const headers = new Headers();"),
}
for name, (old, new) in M.items():
    src = C.read_text(); assert src.count(old) == 1, (name, src.count(old))
    C.write_text(src.replace(old, new))
    try:
        p = subprocess.run(["node", "--test", "--test-reporter=tap", "test/client.test.mjs"], cwd=root, capture_output=True, text=True)
        fails = [l.strip() for l in p.stdout.splitlines() if l.strip().startswith("not ok")]
        print(f"== {name}: {'KILLED' if p.returncode else 'SURVIVED'} {fails}")
    finally:
        C.write_text(src)
p = subprocess.run(["node", "--test", "--test-reporter=tap", "test/client.test.mjs"], cwd=root, capture_output=True, text=True)
print("== unmutated:", "PASS" if p.returncode == 0 else "FAIL", [l for l in p.stdout.splitlines() if l.startswith("# pass") or l.startswith("# fail")])
