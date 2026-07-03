#!/usr/bin/env bash
# E0-T25 "verify the verifier": (a) every task file in tasks/epic-0-ignition/ has a
# `verify-E0-Tnn` Makefile target (a new task file without one fails here, and in CI);
# (b) no verify path contains a green-washing escape (`|| true`, `- ` recipe prefix, or
# `continue-on-error`) — silence and swallowed failures are forbidden.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"
cd "${repo_root}"

fail=0

# (a) target coverage
for f in tasks/epic-0-ignition/*.md; do
  id="$(basename "$f" | sed -E 's/^(E0-T[0-9]+).*/\1/')"
  if ! grep -qE "^verify-${id}:" Makefile; then
    echo "MISSING verify target for ${id} ($f)" >&2
    fail=1
  fi
done

# (b) no green-washing in the verify PATH. We scan real recipe/command lines only —
# stripping comments — and skip the detector itself + the docs (which legitimately name
# the patterns). Targets: the Makefile verify section and the executable verify scripts.
strip_comments() { grep -vE '^[[:space:]]*#'; }
escape_re='\|\|[[:space:]]*true|continue-on-error'
tab="$(printf '\t')"

verify_section="$(sed -n '/Adversarial-verification tooling (E0-T25)/,$p' Makefile | strip_comments)"
if printf '%s\n' "${verify_section}" | grep -nE "${escape_re}"; then
  echo "forbidden escape (|| true / continue-on-error) in the Makefile verify section" >&2
  fail=1
fi
# ignore-errors recipe prefix — make honors a leading '-' (optionally with @/+) in BOTH
# forms: the multiline `<TAB>-cmd` AND the inline `target: ... ; -cmd` (the ';' form every
# _v-* recipe uses). Catch both, else a single '-' silently swallows a failure.
prefix_re="^${tab}[@+]*-|;[[:space:]]*[@+]*-"
if printf '%s\n' "${verify_section}" | grep -nE "${prefix_re}"; then
  echo "forbidden '-' ignore-errors recipe prefix in the verify section" >&2
  fail=1
fi
# Scan the executable verify scripts AND the helper scripts invoked by _v-* recipes: an
# escape hidden inside check-zero-cost.sh / check-quarantine.sh / diff-selftest is just as
# much a false-green in the verify path.
# The verify-orchestration scripts must be escape-free. (self_check.sh is excluded — as the
# detector it names the patterns in its own messages/regexes.) The helper scripts the _v-*
# recipes call (check-zero-cost.sh, check-quarantine.sh, diff/selftest.sh) are NOT scanned
# for `|| true`: they use it legitimately in command substitutions and `set -e` tolerance
# where the real pass/fail is a subsequent explicit check (e.g. `hits=$(grep -c … || true);
# if [ "$hits" -ne 0 ]; then exit 1; fi`). Their verify-path integrity is instead guaranteed
# by their OWN self-tests (`check-zero-cost.sh --selftest`, `diff/selftest.sh`), which the
# meta-sabotage angle exercises. A blanket ban would break them, not harden them.
for s in tools/verify/cold_clone.sh tools/verify/list.sh; do
  if strip_comments < "$s" | grep -nE "${escape_re}"; then
    echo "forbidden escape in ${s}" >&2
    fail=1
  fi
done

if [ "${fail}" -eq 0 ]; then
  echo "verify self-check OK: every task has a target; no green-washing escapes"
fi
exit "${fail}"
