#!/bin/sh
# Chrome and everything it spawns at macOS background priority (PRIO_DARWIN_BG: efficiency cores,
# reduced frequency) — a stand-in for a slower host than this M4 Max.
exec /usr/sbin/taskpolicy -b "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$@"
