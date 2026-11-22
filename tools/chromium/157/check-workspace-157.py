#!/usr/bin/env python3
"""E5-T32a acceptance: the Chromium 157 checkout matches workspace-157.json and resolves.

Run inside the x64 build container (paths below are the container's), with the manifest
and args copied to /opt:
  python3 /opt/check-workspace-157.py /opt/workspace-157.json /opt/args-riscv64-157.gn
Checks: every manifest repository revision equals `gclient revinfo`; src HEAD and the
pinned clang/rustc/gn versions match; the unbundled driver stub is empty; `gn gen` with
the recorded args succeeds into a scratch out dir and `ninja -n chrome` resolves to the
final chrome link. Exits non-zero on any mismatch.
"""
import json, os, subprocess, sys, shutil

ROOT = "/opt/replay-chromium-157"
SRC = ROOT + "/src"
env = {**os.environ, "VPYTHON_BYPASS": "manually managed python not supported by chrome operations",
       "PATH": f"{ROOT}/depot_tools:" + os.environ["PATH"], "DEPOT_TOOLS_UPDATE": "0",
       "GCLIENT_SUPPRESS_GIT_VERSION_WARNING": "1"}


def run(cmd, cwd=SRC):
    return subprocess.run(cmd, cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout


def main():
    manifest = json.load(open(sys.argv[1]))
    args_file = sys.argv[2]
    bad = []
    live = {}
    for line in run(["gclient", "revinfo"], cwd=ROOT).splitlines():
        if ": " in line:
            path, url = line.strip().split(": ", 1)
            live[path] = url.rsplit("@", 1)[1] if "@" in url and not url.startswith("gs://") else None
    for repo in manifest["repositories"]:
        if live.get(repo["path"], "MISSING") != repo["revision"]:
            bad.append(f"revision mismatch: {repo['path']} manifest={repo['revision']} live={live.get(repo['path'])}")
    extra = set(live) - {r["path"] for r in manifest["repositories"]}
    bad += [f"unrecorded dependency: {p}" for p in sorted(extra)]
    # gclient revinfo reports what DEPS requests; also check what is actually checked
    # out, and that no dependency repository carries local edits.
    for repo in manifest["repositories"]:
        path = os.path.join(ROOT, repo["path"])
        if repo["revision"] and os.path.isdir(os.path.join(path, ".git")):
            actual = run(["git", "rev-parse", "HEAD"], cwd=path).strip()
            if actual != repo["revision"]:
                bad.append(f"checkout mismatch: {repo['path']} HEAD={actual} manifest={repo['revision']}")
            dirty = run(["git", "status", "--porcelain", "--untracked-files=no", "--ignore-submodules=all"],
                        cwd=path).strip()
            if dirty and repo["path"] != "src":
                bad.append(f"local edits in dependency {repo['path']}: {dirty.splitlines()[0]}")
    head = run(["git", "rev-parse", "HEAD"]).strip()
    if head != manifest["source_revision"]:
        bad.append(f"src HEAD {head} != {manifest['source_revision']}")
    tc = manifest["toolchains"]
    for name, cmd in (("clang", ["third_party/llvm-build/Release+Asserts/bin/clang", "--version"]),
                      ("rustc", ["third_party/rust-toolchain/bin/rustc", "--version"]),
                      ("gn", ["buildtools/linux64/gn", "--version"])):
        got = run(cmd).splitlines()[0].strip()
        if got != tc[name]:
            bad.append(f"{name} {got!r} != {tc[name]!r}")
    stub = open(SRC + "/base/record_replay_driver.cc").read()
    if "gRecordReplayDriverSize = 0;" not in stub or 'gRecordReplayDriver[] = "";' not in stub:
        bad.append("record_replay_driver.cc is not the empty unbundled stub")
    out = SRC + "/out/RISCV64-check"
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    shutil.copy(args_file, out + "/args.gn")
    try:
        run(["buildtools/linux64/gn", "gen", "out/RISCV64-check"])
        last = run(["third_party/ninja/ninja", "-C", "out/RISCV64-check", "-n", "chrome"]).splitlines()[-1]
        if not last.endswith("LINK ./chrome"):
            bad.append(f"ninja -n chrome did not resolve to the chrome link: {last}")
        else:
            print("graph:", last)
    finally:
        shutil.rmtree(out, ignore_errors=True)
    for b in bad:
        print("FAIL:", b)
    print("E5-T32a workspace check:", "FAIL" if bad else f"OK ({len(manifest['repositories'])} repositories)")
    return 1 if bad else 0


sys.exit(main())
