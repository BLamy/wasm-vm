#!/usr/bin/env bash
# E5-T36a gates, run from the repo root at the head under test.
set -uo pipefail
cd "$(dirname "$0")/../.."
echo "head $(git rev-parse HEAD); web changes outside the commit: $(git status --porcelain -- web ':!web/tasks.json' ':!web/dist' | wc -l | tr -d ' ')"
echo '$ cd web && node --test tests/e5-t36-cursor-hotspot.test.mjs tests/e5-t15b-cursor-sink.test.mjs tests/e5-t15c-cursor-mode.test.mjs tests/e5-t15d-cursor-integration.test.mjs'
(cd web && node --test tests/e5-t36-cursor-hotspot.test.mjs tests/e5-t15b-cursor-sink.test.mjs tests/e5-t15c-cursor-mode.test.mjs tests/e5-t15d-cursor-integration.test.mjs 2>&1 | grep -E "^(✔|✖)|^ℹ (tests|pass|fail)")
echo '$ cmp of the shipped copies with their sources'
for f in src/sink/cursor-hotspot.js src/sink/cursor-controller.js; do cmp "web/$f" "web/dist/$f" && echo "web/dist/$f == web/$f"; done
echo '$ cd web && node --test --test-timeout=120000 tests/*.test.mjs   (names of failing tests, against the list before the pacing and cursor tasks)'
(cd web && node --test --test-timeout=120000 tests/*.test.mjs 2>&1) > /tmp/e5t36a-web-run.txt
grep -E "^ℹ (tests|pass|fail)" /tmp/e5t36a-web-run.txt
grep -E "^✖ " /tmp/e5t36a-web-run.txt | sed -E 's/ \([0-9.]+ms\)$//' | LC_ALL=C sort -u > /tmp/e5t36a-web-after.txt
LC_ALL=C sort -u evidence/e5-t36a/web-unit-failing-before.txt > /tmp/e5t36a-web-before.txt
echo "failing now: $(grep -c . /tmp/e5t36a-web-after.txt) lines; failing before: $(grep -c . /tmp/e5t36a-web-before.txt) lines (each list has one header line)"
echo "difference (< only before, > only now):"; diff /tmp/e5t36a-web-before.txt /tmp/e5t36a-web-after.txt; echo "diff rc=$?"
echo GATES_DONE
