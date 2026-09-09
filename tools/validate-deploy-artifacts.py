#!/usr/bin/env python3
"""Validate the local bytes named by deploy-time artifact manifests.

Remote URLs are intentionally not fetched here: deploy-cloudflare.sh verifies those
objects independently through their public R2 URL before it uploads Pages. This
helper only answers the local question, using the manifest's declared size and
SHA-256 without modifying either the manifest or the artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit


SHA256_HEX = 64
PERCENT_ESCAPE = re.compile(r"%[0-9a-fA-F]{2}")
CONTROL_CHARACTER = re.compile(r"[\x00-\x1f\x7f]")


class ValidationError(Exception):
    """A manifest or local artifact failed the deployment contract."""


def _error(message: str) -> ValidationError:
    return ValidationError(message)


def _load_manifest(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise _error(f"{path}: cannot read JSON: {exc}") from exc
    if not isinstance(value, dict) or not isinstance(value.get("artifacts"), dict):
        raise _error(f"{path}: expected an object with an artifacts object")
    return value


def _local_path(root: Path, url: str, manifest: Path, role: str) -> Path | None:
    if CONTROL_CHARACTER.search(url):
        raise _error(f"{manifest}:{role}: URL contains a control character: {url!r}")
    parsed = urlsplit(url)
    if parsed.scheme or url.startswith("/") or url.startswith("//"):
        return None
    if parsed.query or parsed.fragment:
        raise _error(f"{manifest}:{role}: local URL must not contain a query or fragment: {url!r}")
    if PERCENT_ESCAPE.search(parsed.path):
        raise _error(
            f"{manifest}:{role}: percent-encoded local paths are not allowed: {url!r}"
        )
    if "\\" in parsed.path:
        raise _error(f"{manifest}:{role}: local URL contains a backslash: {url!r}")
    relative = Path(parsed.path)
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise _error(f"{manifest}:{role}: artifact URL escapes local root: {url!r}") from exc
    if any(part in ("", ".", "..") for part in parsed.path.split("/")):
        raise _error(f"{manifest}:{role}: local URL contains a dot or empty path segment: {url!r}")
    return candidate


def _validate_entry(manifest: Path, role: str, entry: object) -> tuple[str, str, int]:
    if not isinstance(entry, dict):
        raise _error(f"{manifest}:{role}: expected an artifact object")
    url = entry.get("url")
    sha256 = entry.get("sha256")
    size = entry.get("size")
    if not isinstance(url, str) or not url:
        raise _error(f"{manifest}:{role}: missing non-empty url")
    if not isinstance(sha256, str) or len(sha256) != SHA256_HEX:
        raise _error(f"{manifest}:{role}: sha256 must be a 64-character hex digest")
    try:
        int(sha256, 16)
    except ValueError as exc:
        raise _error(f"{manifest}:{role}: sha256 must be a 64-character hex digest") from exc
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise _error(f"{manifest}:{role}: size must be a non-negative integer")
    return url, sha256.lower(), size


def _iter_strings(value: object):
    if isinstance(value, dict):
        for child in value.values():
            yield from _iter_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_strings(child)
    elif isinstance(value, str):
        yield value


def _release_urls(value: object) -> list[str]:
    urls = []
    seen: set[str] = set()
    for candidate in _iter_strings(value):
        parsed = urlsplit(candidate)
        if not parsed.scheme and not candidate.startswith(("/", "//")) and parsed.path.startswith("releases/"):
            if candidate not in seen:
                seen.add(candidate)
                urls.append(candidate)
    return urls


def _load_manifests(manifests: list[Path]) -> list[tuple[Path, dict]]:
    loaded = []
    for manifest in manifests:
        resolved = manifest.resolve()
        if not resolved.is_file():
            raise _error(f"{resolved}: manifest does not exist")
        loaded.append((resolved, _load_manifest(resolved)))
    return loaded


def _rewrite_value(value: object, old: str, new: str) -> tuple[object, int]:
    if isinstance(value, dict):
        rewritten = {}
        count = 0
        for key, child in value.items():
            rewritten_child, child_count = _rewrite_value(child, old, new)
            rewritten[key] = rewritten_child
            count += child_count
        return rewritten, count
    if isinstance(value, list):
        rewritten = []
        count = 0
        for child in value:
            rewritten_child, child_count = _rewrite_value(child, old, new)
            rewritten.append(rewritten_child)
            count += child_count
        return rewritten, count
    if value == old:
        return new, 1
    return value, 0


def rewrite_manifests(manifests: list[Path], old: str, new: str) -> int:
    """Replace exact JSON string values, never regular-expression substrings."""

    total = 0
    for manifest, value in _load_manifests(manifests):
        rewritten, count = _rewrite_value(value, old, new)
        if count:
            manifest.write_text(
                json.dumps(rewritten, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            total += count
    if total == 0:
        raise _error(f"rewrite reference not found: {old!r}")
    return total


def verify_bindings(
    manifests: list[Path], binding_file: Path, binding_root: Path, r2_base: str
) -> None:
    """Ensure every queued object has the exact URL, digest, and size in final manifests."""

    try:
        raw_records = binding_file.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise _error(f"{binding_file}: cannot read binding file: {exc}") from exc

    queued: dict[str, tuple[str, int, str]] = {}
    for line_number, line in enumerate(raw_records, 1):
        fields = line.split("\t")
        if len(fields) != 4 or any(CONTROL_CHARACTER.search(field) for field in fields):
            raise _error(f"{binding_file}:{line_number}: malformed binding record")
        source, key, size_text, sha = fields
        try:
            size = int(size_text)
        except ValueError as exc:
            raise _error(f"{binding_file}:{line_number}: invalid size") from exc
        if len(sha) != SHA256_HEX or not re.fullmatch(r"[0-9a-fA-F]{64}", sha):
            raise _error(f"{binding_file}:{line_number}: invalid SHA-256")
        source_path = Path(source).resolve()
        try:
            relative = source_path.relative_to(binding_root.resolve()).as_posix()
        except ValueError as exc:
            raise _error(f"{binding_file}:{line_number}: source escapes binding root") from exc
        queued[relative] = (r2_base.rstrip("/") + "/" + key, size, sha.lower())

    entries = []
    for manifest, value in _load_manifests(manifests):
        for role, entry in value["artifacts"].items():
            url, sha, size = _validate_entry(manifest, str(role), entry)
            entries.append((manifest, str(role), url, sha, size))

    expected_urls = {record[0] for record in queued.values()}
    for relative, (expected_url, expected_size, expected_sha) in queued.items():
        matches = [
            entry
            for entry in entries
            if entry[2] == expected_url and entry[3] == expected_sha and entry[4] == expected_size
        ]
        if not matches:
            raise _error(
                f"queued artifact {relative} is not bound to exact final URL/digest/size: {expected_url}"
            )

    for manifest, role, url, _sha, _size in entries:
        if url.startswith(r2_base.rstrip("/") + "/") and url not in expected_urls:
            raise _error(f"{manifest}:{role}: final R2 URL has no queued binding: {url}")


def validate_manifests(
    root: Path,
    manifests: list[Path],
    *,
    reject_remote: bool = False,
    quiet: bool = False,
    reject_local_prefixes: tuple[str, ...] = (),
) -> list[tuple[str, str, int]]:
    """Validate local entries and return unique ``(url, sha256, size)`` records."""

    records: dict[str, tuple[str, int]] = {}
    for manifest, value in _load_manifests(manifests):
        for role, entry in value["artifacts"].items():
            url, expected_sha, expected_size = _validate_entry(manifest, str(role), entry)
            artifact = _local_path(root, url, manifest, str(role))
            if artifact is None:
                if reject_remote:
                    raise _error(
                        f"{manifest}:{role}: remote URL is not allowed before local staging: {url}"
                    )
                print(f"[artifact-check] skipped remote {manifest.name}:{role} -> {url}", file=sys.stderr)
                continue

            previous = records.get(url)
            if previous is not None and previous != (expected_sha, expected_size):
                raise _error(
                    f"{manifest}:{role}: conflicting declarations for {url}: "
                    f"{previous[0]}/{previous[1]} vs {expected_sha}/{expected_size}"
                )
            records[url] = (expected_sha, expected_size)
            if not artifact.is_file():
                raise _error(f"{manifest}:{role}: local artifact is missing: {artifact}")

            actual_size = artifact.stat().st_size
            if actual_size != expected_size:
                raise _error(
                    f"{manifest}:{role}: size mismatch for {artifact}: "
                    f"expected {expected_size}, got {actual_size}"
                )
            digest = hashlib.sha256()
            with artifact.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            actual_sha = digest.hexdigest()
            if actual_sha != expected_sha:
                raise _error(
                    f"{manifest}:{role}: SHA-256 mismatch for {artifact}: "
                    f"expected {expected_sha}, got {actual_sha}"
                )
            if not quiet:
                print(
                    f"[artifact-check] exact {manifest.name}:{role} "
                    f"({expected_size} bytes, {expected_sha})"
                )

        for role, url in enumerate(_release_urls(value)):
            artifact = _local_path(root, url, manifest, f"release-url-{role}")
            if artifact is None:
                continue
            if any(url.startswith(prefix) for prefix in reject_local_prefixes):
                raise _error(
                    f"{manifest}: local release URL remains under a pruned tree: {url}"
                )
            if not artifact.is_file():
                raise _error(f"{manifest}: local release URL is missing: {artifact}")

    return [(url, sha, size) for url, (sha, size) in records.items()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="root used to resolve local manifest URLs")
    parser.add_argument(
        "--manifest", type=Path, action="append", required=True, help="artifact manifest to validate"
    )
    parser.add_argument(
        "--reject-remote",
        action="store_true",
        help="fail if any manifest entry is remote instead of skipping it",
    )
    parser.add_argument(
        "--print-records",
        action="store_true",
        help="emit unique local entries as URL<TAB>SHA256<TAB>SIZE for a deploy script",
    )
    parser.add_argument(
        "--print-release-urls",
        action="store_true",
        help="emit unique local releases/ URL strings found anywhere in each manifest",
    )
    parser.add_argument(
        "--reject-local-prefix",
        action="append",
        default=[],
        help="fail if a local release URL starts with this pruned-tree prefix",
    )
    parser.add_argument(
        "--rewrite-reference",
        nargs=2,
        action="append",
        metavar=("OLD", "NEW"),
        help="replace an exact JSON string value in every manifest",
    )
    parser.add_argument("--binding-file", type=Path, help="queued R2 records to bind to final manifests")
    parser.add_argument("--binding-root", type=Path, help="root used to relativize queued source paths")
    parser.add_argument("--r2-base", help="public R2 base used by --binding-file")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    if not root.is_dir():
        print(f"artifact-check: local root does not exist: {root}", file=sys.stderr)
        return 2
    try:
        if args.rewrite_reference:
            for old, new in args.rewrite_reference:
                rewrite_manifests(args.manifest, old, new)
            return 0
        records = validate_manifests(
            root,
            args.manifest,
            reject_remote=args.reject_remote,
            quiet=args.print_records or args.print_release_urls,
            reject_local_prefixes=tuple(args.reject_local_prefix),
        )
        if args.binding_file:
            if not args.binding_root or not args.r2_base:
                raise _error("--binding-file requires --binding-root and --r2-base")
            verify_bindings(args.manifest, args.binding_file, args.binding_root, args.r2_base)
    except ValidationError as exc:
        print(f"artifact-check: ERROR: {exc}", file=sys.stderr)
        return 1
    if args.print_records:
        for url, sha, size in records:
            print(f"{url}\t{sha}\t{size}")
    if args.print_release_urls:
        seen: set[str] = set()
        for _manifest, value in _load_manifests(args.manifest):
            for url in _release_urls(value):
                if url not in seen:
                    seen.add(url)
                    print(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
