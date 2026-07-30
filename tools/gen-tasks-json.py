#!/usr/bin/env python3
"""Generate web/tasks.json from the /tasks folder — the single source of truth for the roadmap.

Parses every task file under tasks/epic-*/ (markdown with YAML frontmatter + sections) and emits
a single web/tasks.json array. Also reads tasks/QUEUE.md for the epic ordering and the overall
"N / M verified" headline.

Regenerate after editing any task file:

    python3 tools/gen-tasks-json.py        # or:  make tasks-json

No third-party deps — hand-rolled frontmatter + section parsing so it runs anywhere Python 3 does.
"""

import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TASKS_DIR = os.path.join(REPO, "tasks")
OUT = os.path.join(REPO, "web", "tasks.json")

# Human titles for the epics (fallback derives from folder name).
EPIC_TITLES = {
    "0": "Ignition",
    "1": "The Machine",
    "2": "First Light",
    "3": "Civilization",
    "3.5": "OCI Workloads",
    "3.6": "Live Pull",
    "3.75": "Pico Lab",
    "4": "Acceleration",
    "5": "The Window",
    "6": "Transcendence",
    "7": "Babel",
    "8": "Chrome in Chrome",
}


def parse_frontmatter(text):
    """Return (dict, body) splitting a leading --- ... --- YAML block."""
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.DOTALL)
    if not m:
        return {}, text
    raw, body = m.group(1), m.group(2)
    fm = {}
    for line in raw.splitlines():
        if not line.strip() or ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            fm[key] = [x.strip().strip("'\"") for x in inner.split(",") if x.strip()] if inner else []
        elif val.lower() in ("true", "false"):
            fm[key] = val.lower() == "true"
        else:
            fm[key] = val.strip("'\"")
    return fm, body


def extract_section(body, name):
    """Return the text of a `## name` section, up to the next `## ` heading."""
    pat = re.compile(r"^##\s+" + re.escape(name) + r"\s*$(.*?)(?=^##\s|\Z)", re.DOTALL | re.MULTILINE)
    m = pat.search(body)
    return m.group(1).strip() if m else ""


def parse_criteria(section):
    """Parse a checkbox list into [{text, checked}]."""
    items = []
    for m in re.finditer(r"^\s*[-*]\s*\[([ xX])\]\s*(.+?)(?=^\s*[-*]\s*\[|\Z)", section, re.DOTALL | re.MULTILINE):
        checked = m.group(1).lower() == "x"
        text = re.sub(r"\s+", " ", m.group(2).strip())
        items.append({"text": text, "checked": checked})
    return items


def main():
    tasks = []
    epic_order = []
    for entry in sorted(os.listdir(TASKS_DIR)):
        epic_path = os.path.join(TASKS_DIR, entry)
        if not (os.path.isdir(epic_path) and entry.startswith("epic-")):
            continue
        mnum = re.match(r"epic-([0-9.]+)-", entry)
        epic_key = mnum.group(1) if mnum else entry
        epic_order.append(epic_key)
        for fn in sorted(os.listdir(epic_path)):
            if not fn.endswith(".md") or fn.lower() in ("readme.md",):
                continue
            with open(os.path.join(epic_path, fn), encoding="utf-8") as fh:
                text = fh.read()
            fm, body = parse_frontmatter(text)
            if not fm.get("id"):
                continue
            crit = parse_criteria(extract_section(body, "Acceptance criteria"))
            tasks.append({
                "id": fm.get("id"),
                "epic": str(fm.get("epic", epic_key)),
                "epicKey": epic_key,
                "title": fm.get("title", ""),
                "priority": int(fm["priority"]) if str(fm.get("priority", "")).isdigit() else None,
                "status": fm.get("status", "pending"),
                "depends_on": fm.get("depends_on", []) if isinstance(fm.get("depends_on"), list) else [],
                "estimate": fm.get("estimate", ""),
                "capstone": bool(fm.get("capstone", False)),
                "goal": extract_section(body, "Goal"),
                "criteria": crit,
                "criteriaTotal": len(crit),
                "criteriaDone": sum(1 for c in crit if c["checked"]),
                "verificationLog": extract_section(body, "Verification log"),
                "adversarial": extract_section(body, "Adversarial verification"),
                "file": os.path.join("tasks", entry, fn),
            })

    # Overall headline from QUEUE.md, if present.
    headline = None
    qpath = os.path.join(TASKS_DIR, "QUEUE.md")
    if os.path.exists(qpath):
        with open(qpath, encoding="utf-8") as fh:
            qm = re.search(r"\*\*(\d+)\s*/\s*(\d+)\s*tasks verified", fh.read())
            if qm:
                headline = {"verified": int(qm.group(1)), "total": int(qm.group(2))}

    epics_meta = [{"key": k, "title": EPIC_TITLES.get(k, k)} for k in epic_order]
    payload = {
        "generated": "tools/gen-tasks-json.py",
        "headline": headline,
        "epics": epics_meta,
        "tasks": tasks,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {OUT}: {len(tasks)} tasks across {len(epics_meta)} epics", file=sys.stderr)


if __name__ == "__main__":
    main()
