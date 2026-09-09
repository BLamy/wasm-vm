#!/usr/bin/env python3
"""Deterministic adversarial tests for validate-deploy-artifacts.py."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


HELPER = Path(__file__).with_name("validate-deploy-artifacts.py")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_manifest(path: Path, entries: dict[str, dict[str, object]]) -> None:
    path.write_text(json.dumps({"artifacts": entries}, sort_keys=True) + "\n", encoding="utf-8")


def run(root: Path, manifest: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(HELPER), "--root", str(root), "--manifest", str(manifest), *extra],
        text=True,
        capture_output=True,
        check=False,
    )


def staging_run(root: Path, manifests: list[Path], *extra: str) -> subprocess.CompletedProcess[str]:
    command = [sys.executable, str(HELPER), "--root", str(root)]
    for manifest in manifests:
        command.extend(("--manifest", str(manifest)))
    command.extend(extra)
    return subprocess.run(command, text=True, capture_output=True, check=False)


def expect_failure(result: subprocess.CompletedProcess[str], needle: str) -> None:
    assert result.returncode != 0, result
    assert needle in result.stderr, result.stderr


def staging_fixture() -> None:
    """Exercise exact rewrites, schema-level URLs, binding, pruning, and encoded paths."""

    with tempfile.TemporaryDirectory(prefix="deploy-staging-test-") as temporary:
        root = Path(temporary)
        dist = root / "dist"
        release = root / "releases"
        kernel = release / "kernel"
        chunked = release / "chunked-alpine"
        kernel.mkdir(parents=True)
        chunked.mkdir(parents=True)
        dist.mkdir()

        first = b"A"
        second = b"B"
        first_path = kernel / "a.bin"
        second_path = kernel / "axbin"
        first_path.write_bytes(first)
        second_path.write_bytes(second)
        (chunked / "manifest.json").write_text("{}\n", encoding="utf-8")
        (chunked / "boot-profile.json").write_text("{}\n", encoding="utf-8")

        first_sha = digest(first)
        second_sha = digest(second)
        manifest = dist / "artifacts.json"
        manifest.write_text(
            json.dumps(
                {
                    "artifacts": {
                "first": {"url": "releases/kernel/a.bin", "sha256": first_sha, "size": 1},
                "second": {"url": "releases/kernel/axbin", "sha256": second_sha, "size": 1},
                    },
                    "chunked": {
                    "base": "releases/chunked-alpine/manifest.json",
                    "profile": "releases/chunked-alpine/boot-profile.json",
                    },
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

        preflight = run(root, manifest, "--reject-remote", "--print-records")
        assert preflight.returncode == 0, preflight.stderr
        assert "releases/kernel/a.bin\t" in preflight.stdout
        assert "releases/kernel/axbin\t" in preflight.stdout
        staged_chunked = dist / "releases" / "chunked-alpine"
        staged_chunked.parent.mkdir(parents=True)
        shutil.copytree(chunked, staged_chunked)

        r2 = "https://r2.example.test"
        rewrite = [
            ("releases/kernel/a.bin", f"{r2}/sha256/{first_sha}/releases/kernel/a.bin"),
            ("releases/kernel/axbin", f"{r2}/sha256/{second_sha}/releases/kernel/axbin"),
            ("releases/chunked-alpine/manifest.json", f"{r2}/chunked-alpine/manifest.json"),
            ("releases/chunked-alpine/boot-profile.json", f"{r2}/chunked-alpine/boot-profile.json"),
        ]
        for old, new in rewrite:
            result = run(root, manifest, "--rewrite-reference", old, new)
            assert result.returncode == 0, result.stderr
        shutil.rmtree(staged_chunked)

        queue = root / "r2-queue.tsv"
        queue.write_text(
            f"{first_path}\tsha256/{first_sha}/releases/kernel/a.bin\t1\t{first_sha}\n"
            f"{second_path}\tsha256/{second_sha}/releases/kernel/axbin\t1\t{second_sha}\n",
            encoding="utf-8",
        )
        postflight = staging_run(
            dist,
            [manifest],
            "--reject-local-prefix",
            "releases/kernel/",
            "--reject-local-prefix",
            "releases/chunked-alpine/",
            "--binding-file",
            str(queue),
            "--binding-root",
            str(root),
            "--r2-base",
            r2,
        )
        assert postflight.returncode == 0, postflight.stderr
        final = json.loads(manifest.read_text(encoding="utf-8"))
        assert final["artifacts"]["first"]["url"].endswith(f"{first_sha}/releases/kernel/a.bin")
        assert final["artifacts"]["second"]["url"].endswith(f"{second_sha}/releases/kernel/axbin")
        assert final["chunked"]["base"] == f"{r2}/chunked-alpine/manifest.json"
        assert final["chunked"]["profile"] == f"{r2}/chunked-alpine/boot-profile.json"

        encoded_manifest = dist / "encoded.json"
        write_manifest(
            encoded_manifest,
            {
                "snapshot": {
                    "url": "releases/boot-snapshot/%2e%2e/kernel/payload.bin",
                    "sha256": first_sha,
                    "size": 1,
                }
            },
        )
        expect_failure(
            run(root, encoded_manifest, "--reject-remote"),
            "percent-encoded local paths are not allowed",
        )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="deploy-artifacts-test-") as temporary:
        root = Path(temporary)
        release = root / "releases"
        release.mkdir()
        payload = b"kernel bytes\n"
        artifact = release / "kernel.bin"
        artifact.write_bytes(payload)
        expected_sha = digest(payload)
        expected_size = len(payload)
        manifest = root / "artifacts.json"
        write_manifest(
            manifest,
            {
                "kernel": {"url": "releases/kernel.bin", "sha256": expected_sha, "size": expected_size},
                # A remote entry is deliberately excluded from the local byte check. The deploy
                # script verifies it through public R2 before Pages upload.
                "remote": {
                    "url": "https://objects.example.test/releases/initramfs.gz",
                    "sha256": "0" * 64,
                    "size": 9,
                },
            },
        )

        result = run(root, manifest, "--print-records")
        assert result.returncode == 0, result.stderr
        assert f"releases/kernel.bin\t{expected_sha}\t{expected_size}" in result.stdout
        assert "skipped remote" in result.stderr

        mutated = json.loads(manifest.read_text(encoding="utf-8"))
        mutated["artifacts"]["kernel"]["sha256"] = "1" * 64
        write_manifest(manifest, mutated["artifacts"])
        expect_failure(run(root, manifest), "SHA-256 mismatch")

        mutated["artifacts"]["kernel"]["sha256"] = expected_sha
        mutated["artifacts"]["kernel"]["size"] = expected_size + 1
        write_manifest(manifest, mutated["artifacts"])
        expect_failure(run(root, manifest), "size mismatch")

        mutated["artifacts"]["kernel"]["size"] = expected_size
        mutated["artifacts"]["kernel"]["url"] = "releases/missing.bin"
        write_manifest(manifest, mutated["artifacts"])
        expect_failure(run(root, manifest), "local artifact is missing")

        mutated["artifacts"]["kernel"]["url"] = "releases/kernel.bin"
        mutated["artifacts"]["escape"] = {
            "url": "../outside.bin",
            "sha256": expected_sha,
            "size": expected_size,
        }
        write_manifest(manifest, mutated["artifacts"])
        expect_failure(run(root, manifest), "escapes local root")

        # An omitted optional manifest is not an error: deploy-cloudflare.sh passes only the
        # optional manifests that exist, while a present manifest remains strict.
        write_manifest(manifest, {"kernel": {"url": "releases/kernel.bin", "sha256": expected_sha, "size": expected_size}})
        optional = root / "artifacts-alpine.json"
        result = run(root, manifest)
        assert result.returncode == 0, result.stderr
        assert not optional.exists()

        # A remote reference cannot silently become a local preflight bypass.
        write_manifest(
            manifest,
            {"remote": {"url": "https://objects.example.test/a", "sha256": "0" * 64, "size": 1}},
        )
        expect_failure(run(root, manifest, "--reject-remote"), "remote URL is not allowed")

    staging_fixture()
    print("validate-deploy-artifacts tests passed")


if __name__ == "__main__":
    main()
