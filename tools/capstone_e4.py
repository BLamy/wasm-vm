#!/usr/bin/env python3
"""E4-T28a: reproducible Level-4 capstone measurement boundary.

The capstone children measure different workloads, but they must all identify the same source
head, denominator rows, browser isolation policy, and deployable boot artifacts. This module is
the small, dependency-free validator used by ``capstone_e4.sh``. It deliberately records
identities and controls only; it never reports a performance result or reads benchmark caches.

The self-test emits a deterministic JSON envelope on stdout. It also exercises the failure
boundary in temporary fixtures so a harness that silently accepts a changed denominator, dirty
candidate, or bad artifact digest cannot pass its own test.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse


REPO = Path(__file__).resolve().parents[1]
BASELINE_REL = Path("bench/capstone-baselines.json")
LEDGER_REL = Path("bench/ledger.json")
SERVED_MANIFEST_REL = Path("web/artifacts.json")
DEPLOY_MANIFEST_REL = Path("web/dist/artifacts.json")
HEADERS_REL = Path("web/_headers")

# This pin makes the baseline contract itself tamper-evident. Appending later measurements to
# bench/ledger.json is allowed; changing this contract requires a deliberate review of this tool.
EXPECTED_BASELINE_CONTRACT_SHA256 = (
    "4fc45cbb02b235dbf5c62243c2abcdb24a87e906abc8b423fd729c55abf7a60a"
)

GENESIS_PREV = "0" * 64
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
HOST_PATH_RE = re.compile(r"(?:^|[/\\])(?:Users|private|home)[/\\]")
WINDOWS_PATH_RE = re.compile(r"^[A-Za-z]:[/\\]")
FORBIDDEN_KEY_RE = re.compile(r"(?:token|password|secret|authorization)", re.IGNORECASE)

# These are build/runtime knobs rather than source inputs. The shell wrapper removes them before
# invoking this module; checking again here makes direct Python invocation fail closed as well.
FORBIDDEN_ENV_EXACT = {
    "RUSTFLAGS",
    "RUSTDOCFLAGS",
    "RUST_LOG",
    "CCACHE_DIR",
    "SCCACHE_DIR",
    "NPM_CONFIG_CACHE",
    "PLAYWRIGHT_BROWSERS_PATH",
}
FORBIDDEN_ENV_PREFIXES = ("CARGO_", "WASM_VM_")

# The desktop workspace may have deploy-only files from an earlier local Pages publish. They are
# accepted by --self-test so the exact command remains runnable here, but --prepare is strict and
# rejects every dirty path. An edited source file or an untracked candidate never belongs here.
SELF_TEST_ALLOWED_DIRTY = (
    ".wrangler/",
    "web/dist/artifacts.json",
    "web/dist/artifacts-alpine.json",
    "web/dist/artifacts-node-alpine.json",
)

REQUIRED_BASELINES = {"coremark", "dhrystone", "boot", "gcc"}
REQUIRED_HEADERS = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
}
REQUIRED_LEDGER_KEYS = {
    "bench",
    "engine",
    "score",
    "unit",
    "higher_is_better",
    "spread",
    "commit",
    "vm_build",
    "baseline",
    "config",
    "date",
    "prev_sha256",
}


class ContractError(RuntimeError):
    """A validation failure that should be reported as a failed harness run."""


def _fail(message: str) -> None:
    raise ContractError(message)


def _canonical_sha256(value: object) -> str:
    # This matches tools/bench.py's hash-chain canonicalization exactly.
    encoded = json.dumps(value, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1 << 16), b""):
                digest.update(block)
    except OSError as exc:
        _fail(f"cannot read {path}: {exc}")
    return digest.hexdigest()


def _read_json(path: Path) -> object:
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except OSError as exc:
        _fail(f"cannot read {path}: {exc}")
    except json.JSONDecodeError as exc:
        _fail(f"invalid JSON in {path}: {exc}")
    raise AssertionError("unreachable")


def _git(repo: Path, *args: str, check: bool = True) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=check,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        _fail(f"git is unavailable: {exc}")
    # Porcelain status uses the leading two columns for index/worktree state; stripping the
    # output would turn a leading ` M path` into `M path` and lose the first character of `path`.
    return result.stdout if args and args[0] == "status" else result.stdout.strip()


def _relative_path(path: Path, repo: Path) -> str:
    try:
        return path.resolve().relative_to(repo.resolve()).as_posix()
    except ValueError:
        _fail(f"path is outside the repository: {path}")
    raise AssertionError("unreachable")


def _status_paths(repo: Path) -> list[str]:
    output = _git(repo, "status", "--porcelain=v1", "--untracked-files=all")
    paths: list[str] = []
    for line in output.splitlines():
        if len(line) < 4:
            continue
        path = line[3:]
        # A rename has `old -> new`; both paths are candidate changes and neither is allowed by
        # the generated-file exception.
        if " -> " in path:
            paths.extend(part.strip() for part in path.split(" -> ", 1))
        else:
            paths.append(path.strip('"'))
    return paths


def _is_allowed_dirty(path: str, allowed: tuple[str, ...]) -> bool:
    return any(path == item or (item.endswith("/") and path.startswith(item)) for item in allowed)


def check_clean(repo: Path, allowed: tuple[str, ...] = ()) -> list[str]:
    dirty = _status_paths(repo)
    unexpected = [path for path in dirty if not _is_allowed_dirty(path, allowed)]
    if unexpected:
        _fail("candidate has uncommitted files: " + ", ".join(sorted(unexpected)))
    return dirty


def check_environment() -> None:
    dirty = sorted(
        key
        for key in os.environ
        if key in FORBIDDEN_ENV_EXACT or key.startswith(FORBIDDEN_ENV_PREFIXES)
    )
    if dirty:
        _fail("measurement environment is not scrubbed: " + ", ".join(dirty))


def _validate_ledger(ledger: object) -> list[dict[str, object]]:
    if not isinstance(ledger, dict) or ledger.get("schema_version") != 1:
        _fail("ledger must be an object with schema_version=1")
    entries = ledger.get("entries")
    if not isinstance(entries, list) or not entries:
        _fail("ledger has no entries")

    previous = GENESIS_PREV
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            _fail(f"ledger entry {index} is not an object")
        missing = sorted(REQUIRED_LEDGER_KEYS - set(entry))
        if missing:
            _fail(f"ledger entry {index} is missing keys: {missing}")
        if entry.get("prev_sha256") != previous:
            _fail(
                f"ledger entry {index} has prev_sha256={entry.get('prev_sha256')!r}; "
                f"expected {previous}"
            )
        previous = _canonical_sha256(entry)
    return entries


def _validate_baseline_contract(
    repo: Path,
    ledger_path: Path | None = None,
    contract_path: Path | None = None,
) -> tuple[dict[str, object], str, list[dict[str, object]]]:
    contract_path = contract_path or (repo / BASELINE_REL)
    ledger_path = ledger_path or (repo / LEDGER_REL)
    contract_hash = _file_sha256(contract_path)
    if contract_path.resolve() == (repo / BASELINE_REL).resolve() and contract_hash != EXPECTED_BASELINE_CONTRACT_SHA256:
        _fail(
            f"baseline contract digest mismatch: have {contract_hash}, "
            f"expected {EXPECTED_BASELINE_CONTRACT_SHA256}"
        )
    contract = _read_json(contract_path)
    if not isinstance(contract, dict) or contract.get("schema_version") != 1:
        _fail("baseline contract must be an object with schema_version=1")
    if contract.get("name") != "e4-level4-baseline-contract-v1":
        _fail("unexpected baseline contract name")
    if contract.get("ledger") != LEDGER_REL.as_posix():
        _fail("baseline contract points at the wrong ledger")
    if contract.get("baseline") != "level3-interpreter":
        _fail("baseline contract points at the wrong baseline")

    ledger = _read_json(ledger_path)
    entries = _validate_ledger(ledger)
    ledger_hash = _file_sha256(ledger_path)
    rows = contract.get("rows")
    if not isinstance(rows, list):
        _fail("baseline contract rows must be a list")

    seen: set[str] = set()
    references: list[dict[str, object]] = []
    for row in rows:
        if not isinstance(row, dict):
            _fail("baseline contract row is not an object")
        bench = row.get("bench")
        if not isinstance(bench, str) or bench in seen:
            _fail(f"baseline contract has duplicate or invalid benchmark {bench!r}")
        seen.add(bench)
        index = row.get("entry_index")
        if not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= len(entries):
            _fail(f"baseline row {bench} has an invalid ledger entry_index")
        entry = entries[index]
        for key in ("bench", "commit", "score", "unit", "higher_is_better"):
            if entry.get(key) != row.get(key):
                _fail(f"baseline row {bench} does not match ledger entry {index} in field {key}")
        if entry.get("baseline") != contract["baseline"]:
            _fail(f"ledger entry {index} is not a level3-interpreter baseline")
        config = row.get("config")
        if not isinstance(config, dict) or entry.get("config") != config:
            _fail(f"baseline row {bench} build/config flags differ from ledger entry {index}")
        config_hash = row.get("config_sha256")
        if config_hash != _canonical_sha256(config):
            _fail(f"baseline row {bench} config_sha256 does not match its config")
        row_hash = row.get("row_sha256")
        if not isinstance(row_hash, str) or not SHA256_RE.fullmatch(row_hash):
            _fail(f"baseline row {bench} has an invalid row_sha256")
        actual_hash = _canonical_sha256(entry)
        if actual_hash != row_hash:
            _fail(f"baseline row {bench} digest mismatch at ledger entry {index}")
        references.append(
            {
                "bench": bench,
                "ledger_entry": index,
                "commit": entry.get("commit"),
                "score": entry.get("score"),
                "unit": entry.get("unit"),
                "higher_is_better": entry.get("higher_is_better"),
                "config": copy.deepcopy(config),
                "config_sha256": config_hash,
                "row_sha256": row_hash,
            }
        )
    if seen != REQUIRED_BASELINES:
        _fail(f"baseline contract must cover exactly {sorted(REQUIRED_BASELINES)}; got {sorted(seen)}")
    return contract, ledger_hash, sorted(references, key=lambda item: str(item["bench"]))


def _local_artifact_candidates(manifest_path: Path, repo: Path, relative_url: str) -> list[Path]:
    parsed = urlparse(relative_url)
    relative = Path(parsed.path)
    if relative.is_absolute() or ".." in relative.parts:
        _fail(f"artifact URL escapes its manifest root: {relative_url}")
    # A built dist can contain copied releases/, while a clean checkout has the source releases/.
    # Search only these repository-local roots; never follow a URL to an arbitrary host path.
    roots = [manifest_path.parent, repo / "web", repo]
    candidates: list[Path] = []
    for root in roots:
        candidate = (root / relative).resolve()
        try:
            candidate.relative_to(root.resolve())
        except ValueError:
            continue
        if candidate not in candidates:
            candidates.append(candidate)
    return candidates


def _validate_manifest(path: Path, repo: Path) -> dict[str, object]:
    manifest = _read_json(path)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("generated"), str):
        _fail(f"{_relative_path(path, repo)} has no generated marker")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        _fail(f"{_relative_path(path, repo)} has no artifacts")

    normalized: dict[str, dict[str, object]] = {}
    for role, artifact in sorted(artifacts.items()):
        if not isinstance(role, str) or not isinstance(artifact, dict):
            _fail(f"{_relative_path(path, repo)} has an invalid artifact entry")
        url = artifact.get("url")
        digest = artifact.get("sha256")
        size = artifact.get("size")
        if not isinstance(url, str) or not url or any(ord(char) < 32 for char in url):
            _fail(f"{_relative_path(path, repo)} {role} has an invalid URL")
        parsed = urlparse(url)
        if parsed.scheme and (parsed.scheme not in {"http", "https"} or not parsed.netloc):
            _fail(f"{_relative_path(path, repo)} {role} has an invalid URL scheme")
        if parsed.username or parsed.password:
            _fail(f"{_relative_path(path, repo)} {role} URL contains credentials")
        if not parsed.scheme and (parsed.path.startswith("/") or ".." in Path(parsed.path).parts):
            _fail(f"{_relative_path(path, repo)} {role} URL is not repository-relative")
        if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
            _fail(f"{_relative_path(path, repo)} {role} has an invalid sha256")
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            _fail(f"{_relative_path(path, repo)} {role} has an invalid size")

        verification = "declared-remote"
        if not parsed.scheme:
            candidates = _local_artifact_candidates(path, repo, url)
            local = next((candidate for candidate in candidates if candidate.is_file()), None)
            if local is None:
                _fail(f"{_relative_path(path, repo)} {role} local artifact is missing: {url}")
            actual_size = local.stat().st_size
            actual_hash = _file_sha256(local)
            if actual_size != size or actual_hash != digest:
                _fail(
                    f"{_relative_path(path, repo)} {role} digest/size mismatch: "
                    f"declared {digest}/{size}, found {actual_hash}/{actual_size}"
                )
            verification = "local-bytes"
        normalized[role] = {
            "url": url,
            "sha256": digest,
            "size": size,
            "verification": verification,
        }
    return {
        "path": _relative_path(path, repo),
        "sha256": _file_sha256(path),
        "artifacts": normalized,
    }


def _validate_headers(path: Path, repo: Path) -> dict[str, object]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        _fail(f"cannot read {_relative_path(path, repo)}: {exc}")
    for line in lines:
        match = re.match(r"^\s*([^:#]+):\s*(.*?)\s*$", line)
        if match:
            values[match.group(1)] = match.group(2)
    for key, expected in REQUIRED_HEADERS.items():
        if values.get(key) != expected:
            _fail(f"{_relative_path(path, repo)} requires {key}: {expected}")
    return {
        "path": _relative_path(path, repo),
        "sha256": _file_sha256(path),
        "required": dict(REQUIRED_HEADERS),
    }


def _validate_string_safety(value: object, key: str = "") -> None:
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            if isinstance(child_key, str) and FORBIDDEN_KEY_RE.search(child_key):
                _fail(f"result contains a secret-bearing field name: {child_key}")
            _validate_string_safety(child_value, child_key if isinstance(child_key, str) else key)
    elif isinstance(value, list):
        for child in value:
            _validate_string_safety(child, key)
    elif isinstance(value, str):
        if HOST_PATH_RE.search(value) or WINDOWS_PATH_RE.match(value):
            _fail(f"result contains a host-specific absolute path in {key}")
        if value.startswith("file://"):
            _fail(f"result contains a file URL in {key}")


def validate_envelope(envelope: object) -> None:
    if not isinstance(envelope, dict) or envelope.get("schema_version") != 1:
        _fail("result envelope must have schema_version=1")
    if envelope.get("schema") != "e4-level4-capstone-result-v1":
        _fail("unexpected result envelope schema")
    if envelope.get("mode") not in {"self-test", "prepare"}:
        _fail("result envelope has an invalid mode")

    candidate = envelope.get("candidate")
    if not isinstance(candidate, dict) or not COMMIT_RE.fullmatch(str(candidate.get("commit", ""))):
        _fail("result envelope has no full candidate commit")
    if candidate.get("working_tree") not in {
        "clean",
        "self-test-only: allowed deploy-local files",
    }:
        _fail("result envelope has an invalid working-tree status")

    build = envelope.get("build")
    if not isinstance(build, dict) or build.get("profile") != "release":
        _fail("result envelope has no release build profile")
    flags = build.get("flags")
    if not isinstance(flags, dict) or not all(isinstance(item, str) and item for item in flags.values()):
        _fail("result envelope build flags are incomplete")

    baseline = envelope.get("baseline")
    if not isinstance(baseline, dict):
        _fail("result envelope has no baseline block")
    contract = baseline.get("contract")
    ledger = baseline.get("ledger")
    if not isinstance(contract, dict) or contract.get("path") != BASELINE_REL.as_posix():
        _fail("result envelope has no baseline contract path")
    if not SHA256_RE.fullmatch(str(contract.get("sha256", ""))):
        _fail("result envelope has no baseline contract digest")
    if not isinstance(ledger, dict) or ledger.get("path") != LEDGER_REL.as_posix():
        _fail("result envelope has no ledger path")
    if not SHA256_RE.fullmatch(str(ledger.get("sha256", ""))):
        _fail("result envelope has no ledger digest")
    rows = baseline.get("rows")
    if not isinstance(rows, list) or {row.get("bench") for row in rows if isinstance(row, dict)} != REQUIRED_BASELINES:
        _fail("result envelope does not contain all four exact baseline rows")

    controls = envelope.get("controls")
    if not isinstance(controls, dict):
        _fail("result envelope has no execution controls")
    for arm in ("jit", "interpreter"):
        if not isinstance(controls.get(arm), dict):
            _fail(f"result envelope has no {arm} control")
    jit = controls["jit"]
    if jit.get("enabled") is not True or jit.get("threshold") != 512 or jit.get("residency") != "repack-off":
        _fail("result envelope does not pin the shipping JIT controls")
    interpreter = controls["interpreter"]
    if interpreter.get("enabled") is not False or interpreter.get("query") != "?jit=0":
        _fail("result envelope does not pin the interpreter control")

    fresh = envelope.get("fresh_profile")
    if not isinstance(fresh, dict) or fresh.get("required") is not True:
        _fail("result envelope does not require a fresh profile")
    if fresh.get("persistent_profile") is not False or fresh.get("warmup") is not False:
        _fail("result envelope permits a warmed or persistent profile")
    if fresh.get("translation_cache") != "new machine/worker per sample; no warmup":
        _fail("result envelope does not pin a fresh translation cache")

    artifacts = envelope.get("artifacts")
    if not isinstance(artifacts, dict) or not isinstance(artifacts.get("served"), dict) or not isinstance(artifacts.get("deploy"), dict):
        _fail("result envelope is missing served/deploy artifact identities")
    for identity in (artifacts["served"], artifacts["deploy"]):
        if not SHA256_RE.fullmatch(str(identity.get("sha256", ""))):
            _fail("result envelope has an invalid manifest digest")
        for item in identity.get("artifacts", {}).values():
            if not isinstance(item, dict) or not SHA256_RE.fullmatch(str(item.get("sha256", ""))):
                _fail("result envelope has an invalid guest artifact digest")

    headers = envelope.get("headers")
    if not isinstance(headers, dict) or headers.get("required") != REQUIRED_HEADERS:
        _fail("result envelope has incomplete browser header controls")
    _validate_string_safety(envelope)


def _build_envelope(repo: Path, mode: str, dirty: list[str]) -> dict[str, object]:
    head = _git(repo, "rev-parse", "HEAD")
    if not COMMIT_RE.fullmatch(head):
        _fail(f"candidate HEAD is not a full commit hash: {head!r}")
    contract, ledger_hash, references = _validate_baseline_contract(repo)
    served_path = repo / SERVED_MANIFEST_REL
    deploy_path = repo / DEPLOY_MANIFEST_REL
    served = _validate_manifest(served_path, repo)
    deploy = _validate_manifest(deploy_path, repo)
    served_roles = set(served["artifacts"])
    deploy_roles = set(deploy["artifacts"])
    if served_roles != deploy_roles:
        _fail(f"served/deploy manifest role mismatch: {sorted(served_roles)} vs {sorted(deploy_roles)}")
    for role in sorted(served_roles):
        left = served["artifacts"][role]
        right = deploy["artifacts"][role]
        if left["sha256"] != right["sha256"] or left["size"] != right["size"]:
            _fail(f"served/deploy artifact identity mismatch for {role}")

    headers = _validate_headers(repo / HEADERS_REL, repo)
    envelope: dict[str, object] = {
        "schema_version": 1,
        "schema": "e4-level4-capstone-result-v1",
        "mode": mode,
        "candidate": {
            "commit": head,
            "working_tree": "clean" if not dirty else "self-test-only: allowed deploy-local files",
        },
        "build": {
            "profile": "release",
            "commands": ["make web-build", "make web-dist"],
            "flags": {
                "wasm": "wasm-pack build crates/wasm --target web",
                "native": "cargo build --release -p wasm-vm-cli",
                "guest": "-static -O2 -g0 -march=rv64gc -mabi=lp64d",
                "environment": "RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG/CARGO_*/WASM_VM_* unset",
            },
        },
        "baseline": {
            "name": contract["name"],
            "label": contract["baseline"],
            "contract": {
                "path": BASELINE_REL.as_posix(),
                "sha256": _file_sha256(repo / BASELINE_REL),
            },
            "ledger": {
                "path": LEDGER_REL.as_posix(),
                "sha256": ledger_hash,
                "schema_version": 1,
            },
            "rows": references,
        },
        "controls": {
            "browser": {
                "runner": "Playwright",
                "project": "chromium",
                "cross_origin_isolated": True,
                "worker": "whole-machine worker",
            },
            "jit": {
                "query": "?jit=1&jitThreshold=512&jitResidency=repack-off&jalr=1&region=1",
                "enabled": True,
                "threshold": 512,
                "residency": "repack-off",
                "jalr": True,
                "region": True,
            },
            "interpreter": {
                "query": "?jit=0",
                "enabled": False,
                "threshold": None,
                "residency": None,
                "jalr": True,
                "region": True,
            },
        },
        "fresh_profile": {
            "required": True,
            "context": "new Playwright browser context per sample",
            "persistent_profile": False,
            "origin_data": "clear cookies, storage, IndexedDB, OPFS, and Cache Storage per sample",
            "translation_cache": "new machine/worker per sample; no warmup",
            "warmup": False,
            "sample_policy": "record every sample and report the median; never select the best run",
        },
        "headers": headers,
        "artifacts": {
            "served": served,
            "deploy": deploy,
        },
    }
    validate_envelope(envelope)
    return envelope


def _expect_rejection(name: str, callback) -> dict[str, str]:
    try:
        callback()
    except ContractError:
        return {"name": name, "status": "rejected"}
    _fail(f"self-test expected rejection but accepted: {name}")
    raise AssertionError("unreachable")


def _self_test_dirty_candidate() -> dict[str, str]:
    with tempfile.TemporaryDirectory(prefix="capstone-e4-git-") as directory:
        repo = Path(directory)
        subprocess.run(["git", "init", "-q", str(repo)], check=True, capture_output=True)
        (repo / "tracked.txt").write_text("clean\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(repo), "add", "tracked.txt"], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(repo),
                "-c",
                "user.name=capstone-self-test",
                "-c",
                "user.email=capstone-self-test@example.invalid",
                "commit",
                "-q",
                "-m",
                "fixture",
            ],
            check=True,
            capture_output=True,
        )
        (repo / "candidate.txt").write_text("uncommitted\n", encoding="utf-8")
        return _expect_rejection("uncommitted candidate", lambda: check_clean(repo))


def _self_test_baseline_tampering(repo: Path) -> list[dict[str, str]]:
    ledger = _read_json(repo / LEDGER_REL)
    if not isinstance(ledger, dict) or not isinstance(ledger.get("entries"), list):
        _fail("cannot build baseline tamper fixtures")
    results: list[dict[str, str]] = []
    cases = [
        ("baseline score tamper", lambda entry: entry.__setitem__("score", 0.0), 0),
        ("baseline commit tamper", lambda entry: entry.__setitem__("commit", "0" * 40), 0),
        (
            "baseline build-flag tamper",
            lambda entry: entry["config"].__setitem__("flags", "-static -O0"),
            1,
        ),
    ]
    for name, mutate, index in cases:
        changed = copy.deepcopy(ledger)
        mutate(changed["entries"][index])
        with tempfile.NamedTemporaryFile("w", suffix=".json", prefix="capstone-e4-ledger-", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(changed, handle, indent=2, sort_keys=True)
            handle.write("\n")
        try:
            results.append(
                _expect_rejection(
                    name,
                    lambda temporary=temporary: _validate_baseline_contract(repo, ledger_path=temporary),
                )
            )
        finally:
            temporary.unlink(missing_ok=True)

    changed = copy.deepcopy(ledger)
    changed["entries"].pop(0)
    with tempfile.NamedTemporaryFile("w", suffix=".json", prefix="capstone-e4-ledger-", delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(changed, handle, indent=2, sort_keys=True)
        handle.write("\n")
    try:
        results.append(
            _expect_rejection(
                "missing baseline row",
                lambda: _validate_baseline_contract(repo, ledger_path=temporary),
            )
        )
    finally:
        temporary.unlink(missing_ok=True)
    return results


def _self_test_artifact_tampering() -> list[dict[str, str]]:
    with tempfile.TemporaryDirectory(prefix="capstone-e4-artifact-") as directory:
        root = Path(directory)
        dist = root / "dist"
        dist.mkdir()
        artifact = dist / "boot.bin"
        artifact.write_bytes(b"capstone artifact bytes\n")
        digest = _file_sha256(artifact)
        manifest = dist / "artifacts.json"

        def write_manifest(declared_digest: str) -> None:
            manifest.write_text(
                json.dumps(
                    {
                        "generated": "self-test",
                        "artifacts": {
                            "bootSnapshot": {
                                "url": "boot.bin",
                                "sha256": declared_digest,
                                "size": artifact.stat().st_size,
                            }
                        },
                    },
                    sort_keys=True,
                ),
                encoding="utf-8",
            )

        write_manifest(digest)
        results = [
            _expect_rejection(
                "deploy manifest bad digest",
                lambda: _write_and_validate_bad_manifest(write_manifest, manifest, root),
            )
        ]
        write_manifest(digest)
        artifact.write_bytes(b"tampered artifact bytes\n")
        results.append(_expect_rejection("artifact byte tamper", lambda: _validate_manifest(manifest, root)))
        return results


def _write_and_validate_bad_manifest(write_manifest, manifest: Path, repo: Path) -> None:
    write_manifest("0" * 64)
    _validate_manifest(manifest, repo)


def _write_output(repo: Path, output: str | None, envelope: dict[str, object]) -> None:
    rendered = json.dumps(envelope, indent=2, sort_keys=True) + "\n"
    if output is None or output == "-":
        sys.stdout.write(rendered)
        return
    path = Path(output)
    if not path.is_absolute():
        path = repo / path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rendered, encoding="utf-8")
    sys.stdout.write(rendered)


def cmd_self_test(repo: Path, output: str | None) -> int:
    check_environment()
    dirty = check_clean(repo, SELF_TEST_ALLOWED_DIRTY)
    envelope = _build_envelope(repo, "self-test", dirty)
    checks: list[dict[str, str]] = [
        {"name": "schema and live inputs", "status": "accepted"},
        {"name": "dirty candidate", **_self_test_dirty_candidate()},
    ]
    checks.extend(_self_test_baseline_tampering(repo))
    checks.extend(_self_test_artifact_tampering())
    warm = copy.deepcopy(envelope)
    warm["fresh_profile"]["persistent_profile"] = True
    checks.append(_expect_rejection("warmed browser profile", lambda: validate_envelope(warm)))
    envelope["self_test"] = {
        "checks": checks,
        "note": "All rejection cases are temporary fixtures; no benchmark result is claimed.",
    }
    validate_envelope(envelope)
    _write_output(repo, output, envelope)
    return 0


def cmd_prepare(repo: Path, output: str | None) -> int:
    check_environment()
    dirty = check_clean(repo)
    envelope = _build_envelope(repo, "prepare", dirty)
    _write_output(repo, output, envelope)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--self-test", action="store_true", help="run the deterministic validator self-test")
    group.add_argument("--prepare", action="store_true", help="validate a clean candidate and emit its envelope")
    parser.add_argument("--output", help="also write the JSON envelope to this relative path (or - for stdout)")
    args = parser.parse_args(argv)
    try:
        if args.self_test:
            return cmd_self_test(REPO, args.output)
        return cmd_prepare(REPO, args.output)
    except ContractError as exc:
        print(f"capstone_e4: FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
