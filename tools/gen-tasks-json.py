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
import subprocess
import sys
from collections import defaultdict

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


# ── Evidence-chain timeline: when the AI actually worked on each ticket ──────
# Real dates come from git — commits that TOUCH a ticket's file or NAME its id in
# the subject — plus the dated entries inside each task's verification log. This
# is what the Gantt view plots on a real calendar.
def build_git_activity():
    """One `git log` pass → (by_file: path→[commit], commits: [commit]).

    Each commit is {hash, date (YYYY-MM-DD), subject, files:[...]}.
    Records use \\x01 as the commit sentinel and \\x1f as the field separator so
    subjects containing any normal punctuation parse cleanly.
    """
    try:
        out = subprocess.run(
            ["git", "-C", REPO, "log", "--all", "--date=short",
             "--format=\x01%H\x1f%ad\x1f%s", "--name-only"],
            capture_output=True, text=True, check=True).stdout
    except Exception as e:  # no git / not a repo → timeline is simply empty
        print(f"[gen-tasks-json] git activity unavailable: {e}", file=sys.stderr)
        return {}, []
    commits, by_file, cur = [], defaultdict(list), None
    for line in out.split("\n"):
        if line.startswith("\x01"):
            h, d, s = line[1:].split("\x1f", 2)
            cur = {"hash": h[:9], "date": d, "subject": s, "files": [], "ntask": 0}
            commits.append(cur)
        elif line.strip() and cur is not None:
            f = line.strip()
            cur["files"].append(f)
            by_file[f].append(cur)
            if f.startswith("tasks/epic-") and f.endswith(".md"):
                cur["ntask"] += 1
    return by_file, commits


# A commit touching more than this many task files is a bulk sweep (the initial
# import, a mass regroom) — it doesn't represent focused work on any one ticket, so
# file-touch attribution ignores it. Naming the id in the subject still counts.
BULK_TASKFILE_THRESHOLD = 4


def ticket_activity(tid, tfile, evidence_text, by_file, commits, git_min, git_max):
    """Distinct dates the AI worked on one ticket, oldest first.

    Each entry: {date, commits (count that day), labels (up to 4 commit subjects)}.
    A commit counts when it either NAMES the exact id in its subject (a trailing
    letter/digit means a different sub-ticket, so `E3-T12` never matches `E3-T12a`),
    or TOUCHES the ticket file in a non-bulk commit. Dated lines in the ticket's
    verification-log sections are added as evidence markers.
    """
    events = {}

    def add(date, subject):
        e = events.setdefault(date, {"date": date, "commits": 0, "labels": []})
        if subject is not None:
            e["commits"] += 1
            if len(e["labels"]) < 4:
                e["labels"].append(subject)

    seen = set()
    for c in by_file.get(tfile, []):
        if c["ntask"] <= BULK_TASKFILE_THRESHOLD:
            seen.add(c["hash"])
            add(c["date"], c["subject"])
    idre = re.compile(re.escape(tid) + r"(?![0-9A-Za-z])")
    for c in commits:
        if c["hash"] in seen:
            continue
        if idre.search(c["subject"]):
            add(c["date"], c["subject"])
    # Dated entries recorded in the ticket's own verification/adversarial sections,
    # clamped to the real git window (planning dates written into a log can predate
    # the repo — those aren't real work and would skew the timeline axis).
    for m in re.finditer(r"\b(\d{4}-\d{2}-\d{2})\b", evidence_text or ""):
        dt = m.group(1)
        if git_min and (dt < git_min or dt > git_max):
            continue
        add(dt, None)
    return sorted(events.values(), key=lambda e: e["date"])


def main():
    by_file, commits = build_git_activity()
    git_dates = [c["date"] for c in commits]
    git_min = min(git_dates) if git_dates else None
    git_max = max(git_dates) if git_dates else None
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
            tfile = os.path.join("tasks", entry, fn)
            evidence_text = "\n".join([
                extract_section(body, "Verification log"),
                extract_section(body, "Adversarial verification"),
            ])
            activity = ticket_activity(fm.get("id"), tfile, evidence_text, by_file, commits, git_min, git_max)
            tasks.append({
                "id": fm.get("id"),
                "epic": str(fm.get("epic", epic_key)),
                "epicKey": epic_key,
                "title": fm.get("title", ""),
                "priority": int(fm["priority"]) if str(fm.get("priority", "")).isdigit() else None,
                "status": fm.get("status", "pending"),
                "depends_on": fm.get("depends_on", []) if isinstance(fm.get("depends_on"), list) else [],
                "decomposed_into": fm.get("decomposed_into", []) if isinstance(fm.get("decomposed_into"), list) else [],
                "estimate": fm.get("estimate", ""),
                "capstone": bool(fm.get("capstone", False)),
                "goal": extract_section(body, "Goal"),
                "criteria": crit,
                "criteriaTotal": len(crit),
                "criteriaDone": sum(1 for c in crit if c["checked"]),
                "verificationLog": extract_section(body, "Verification log"),
                "adversarial": extract_section(body, "Adversarial verification"),
                "file": tfile,
                "activity": activity,
                "firstActivity": activity[0]["date"] if activity else None,
                "lastActivity": activity[-1]["date"] if activity else None,
                "commitCount": sum(e["commits"] for e in activity),
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
    all_dates = [e["date"] for t in tasks for e in t["activity"]]
    activity_range = {"start": min(all_dates), "end": max(all_dates)} if all_dates else None
    payload = {
        "generated": "tools/gen-tasks-json.py",
        "headline": headline,
        "epics": epics_meta,
        "activityRange": activity_range,
        "tasks": tasks,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {OUT}: {len(tasks)} tasks across {len(epics_meta)} epics", file=sys.stderr)


if __name__ == "__main__":
    main()
