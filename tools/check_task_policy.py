#!/usr/bin/env python3
"""Fail fast when the task board violates the active-lane or sizing policy."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TASKS = ROOT / "tasks"
ACTIVE = {"in-progress", "in_progress", "implemented", "evidence-needed", "refuted"}
RISKS = {"low", "medium", "high"}
LARGE = {"M", "L", "XL"}


def frontmatter(path: Path) -> dict[str, str]:
    match = re.match(r"\A---\n(.*?)\n---\n", path.read_text(encoding="utf-8"), re.DOTALL)
    if not match:
        return {}
    result: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            result[key.strip()] = value.split("#", 1)[0].strip()
    return result


def main() -> int:
    errors: list[str] = []
    active: list[tuple[Path, dict[str, str]]] = []
    for path in sorted(TASKS.glob("epic-*/E*-T*.md")):
        meta = frontmatter(path)
        if meta.get("status") in ACTIVE:
            active.append((path, meta))

    if len(active) > 1:
        labels = ", ".join(meta.get("id", path.name) for path, meta in active)
        errors.append(f"only one task may occupy the active lane; found: {labels}")

    for path, meta in active:
        task_id = meta.get("id", path.name)
        risk = meta.get("risk")
        if risk not in RISKS:
            errors.append(f"{task_id}: active task needs risk: low | medium | high")
        if meta.get("estimate") in LARGE:
            text = path.read_text(encoding="utf-8")
            if meta.get("decomposition") != "approved" or "## Execution slices" not in text:
                errors.append(
                    f"{task_id}: {meta.get('estimate')} task must be split into S tasks before "
                    "activation (or document an approved atomic exception with Execution slices)"
                )

    if errors:
        for error in errors:
            print(f"task-policy: ERROR: {error}", file=sys.stderr)
        return 1
    current = active[0][1].get("id") if active else "none"
    print(f"task-policy: OK (active={current})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
