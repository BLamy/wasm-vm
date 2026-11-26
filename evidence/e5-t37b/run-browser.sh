#!/usr/bin/env bash
# E5-T37b browser evidence: the committed bundle (tools/serve-dist.sh 8125), fresh page load per
# run, paced (default) and unpaced (?pace=0) interleaved. Idle is sampled LAST, after the click
# and type scenarios: Chrome's own delayed start-up work runs on guest time, so under the paced
# clock it takes its real 30-60 s after the desktop appears (see early-idle/ for that window).
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=evidence/e5-t37b
run() {
  local label=$1 query=$2
  local args=(--url http://127.0.0.1:8125 --app /app.html --scenarios click,type,idle --n 8 --idle-s 30 --label "$label" --out "$OUT/browser-$label.json")
  [ -z "$query" ] || args+=(--query "$query")
  node tools/perf/desktop-latency.mjs "${args[@]}" > "$OUT/browser-$label.log" 2>&1
  echo "$label rc=$?"
}
for round in "$@"; do
  run "paced-$round" ""
  run "unpaced-$round" "&pace=0"
done
python3 - "$OUT" "$@" <<'PY'
import json, sys
out, rounds = sys.argv[1], sys.argv[2:]
for mode in ("paced", "unpaced"):
    for r in rounds:
        d = json.load(open(f"{out}/browser-{mode}-{r}.json"))
        s = d["scenarios"]; i = s["idle"]
        print(f"{mode}-{r}: idle inSlice {i['inSlicePct']}% guest {i['guestSecondsPerSecond']} s/s {i['mips']} MIPS sleeps {i['idleSleeps']} wakes {i['idleWakes']} clock {i['clockMode']} | "
              f"click median {s['click']['resultMs']['median']} (min {s['click']['resultMs']['min']}, max {s['click']['resultMs']['max']}, n {s['click']['resultMs']['n']}) | "
              f"key echo median {s['type']['echoMs']['median']} (n {s['type']['echoMs']['n']})")
PY
