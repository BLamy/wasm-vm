from pathlib import Path
import concurrent.futures
import hashlib
import json
import subprocess
import tempfile

out = Path(__file__).resolve().parent
repo = out.parents[2]
bases = ["https://6d0d0ece.wasm-vm.pages.dev", "https://wasm-vm.pages.dev"]
files = ["pkg/wasm_vm_wasm_bg.wasm", "artifacts-omarchy.json", "main.js", "roadmap.js", "tasks.json", "app.html"]
def check(pair):
    base, file = pair
    url = base + "/" + file
    with tempfile.TemporaryDirectory(prefix="gpu-transfer-public-") as tmp:
        file_out = Path(tmp) / "body"
        status = int(subprocess.check_output(["curl", "--fail", "--silent", "--show-error", "--location",
            "--max-time", "60", "--output", str(file_out), "--write-out", "%{http_code}", url], text=True))
        data = file_out.read_bytes()
    expected = (repo / "web/dist" / file).read_bytes()
    row = {"url": url, "status": status, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
           "expectedSha256": hashlib.sha256(expected).hexdigest(), "matches": data == expected}
    assert status == 200 and row["matches"], row
    return row
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    rows = list(pool.map(check, [(base, file) for base in bases for file in files]))
manifest = json.loads((repo / "web/dist/artifacts-omarchy.json").read_text())
assert manifest["artifacts"]["kernel"]["sha256"] == "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce"
assert manifest["artifacts"]["bootSnapshot"]["sha256"] == "2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5"
receipt = {"deployment": bases[0], "production": bases[1], "checks": rows, "passed": True,
           "claim": "GPU source-offset correction published; existing desktop defaults retained; responsiveness remains unsolved"}
(out / "public.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"passed": True, "checks": len(rows), "deployment": bases[0]}))
