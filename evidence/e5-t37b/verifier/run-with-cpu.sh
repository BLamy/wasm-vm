#!/bin/zsh
# Verifier: one benchmark load with an OS-level CPU-time sampler beside it.
#   run-with-cpu.sh <label> <query-or-empty> [url]
cd "$(dirname "$0")/../../.." || exit 1   # repo root (the script lives in evidence/e5-t37b/verifier/)
label=$1; query=$2; url=${3:-http://127.0.0.1:8125}
out=evidence/e5-t37b/verifier
( while :; do print -r -- "T $(date +%s.%N | cut -c1-14)"; ps -Ao pid,ppid,cputime,command | grep -E "Google Chrome|wasm-vm boot|mediaanalysisd|Spotify Helper \(Renderer\)" | grep -v grep | cut -c1-230; sleep 1; done ) > $out/cpu-$label.samples 2>/dev/null &
sampler=$!
{ echo "load before: $(uptime)"; } > $out/browser-$label.log
args=(--url $url --app /app.html --scenarios click,type,idle --n 8 --idle-s 30 --label $label --out $out/browser-$label.json)
[[ -z $query ]] || args+=(--query "$query")
node tools/perf/desktop-latency.mjs "${args[@]}" >> $out/browser-$label.log 2>&1
rc=$?
kill $sampler 2>/dev/null
echo "load after: $(uptime)" >> $out/browser-$label.log
echo "$label rc=$rc"
