# E5-T18e partial audit through 26 cases — no task verdict

The completed desktop/launcher evidence for cold-01 through cold-24 and both
cache-enabled cases is HELD. Actual warm HTTP-cache reuse remains NEEDS EVIDENCE.
The final cold-25 case and final report/end-of-run checks remain unaudited.

This increment independently audited only cold-13 through cold-24 and warm-reload.
The earlier 13 cases carry HELD after checking that all 52 of their JSON, PNG and
UART files still match their recorded hashes. The frozen source binding is still
`0e41e0d9f9fa9ccc3277867fc0146d5c4d856959e92b5de947bd52ded7a149c2`, executed at
`9ed9e0d1c57daf64f6362193bc30b79482dd3258`; main remains
`8de49f979b8b20595b871fcdb90f0af36af0116a`. All 30 clone sources and all 14 runtime
files match, with only the previously reviewed playbook differing in main.

## New completed-case checks

All 26 new PNG hashes match their records. Decoding each canvas again reproduces
the recorded framebuffer hash exactly. All 13 new desktops contain the exact
94-pixel cursor at (480,160); all 13 Terminal records have accepted launches,
large visible changes, instruction progress, distinct guest-state digests, and
empty browser/presentation error arrays. Original UART lengths match the emitted
byte counts. No boot or regression suite was rerun.

The eight new screenshot variants were each visually inspected through their
representatives: cold-13.png, cold-13-terminal.png, cold-14.png,
cold-14-terminal.png, cold-15.png, cold-16-terminal.png, cold-20.png and
cold-20-terminal.png. Each desktop has patterned wallpaper, a dark top panel,
the launcher, and the guest arrow; each terminal has the foot title bar, controls,
client body, and a shell prompt. The warm-reload PNGs are byte-identical to the
inspected cold-15 desktop and cold-14 terminal, respectively.

Together with the carried first batch, 26 cases now have 52 independently matched
PNG/framebuffer bindings, 26 exact cursor checks, and 52 distinct recorded guest
state digests. No independent replay of guest memory is claimed.

## Cache observations and timing qualification

The raw records contain:

| Recorded label | Boot-to-desktop | cacheDisabled | cacheHits |
|---|---:|---|---:|
| warm-prime | 827.701 seconds | false | 0 |
| warm-reload | 886.730 seconds | false | 0 |

The producer at `tools/verify/e5-t18e-desktop-bringup.mjs:128` creates a CDP session
for the page and at line 137 counts `Network.requestServedFromCache` events.
The record therefore supplies a zero count from that observer, alongside the
cache-enabled configuration. It does not independently establish populated HTTP
cache or actual response reuse. This audit does not determine whether zero means
no reuse occurred or the observer did not report it. The separate nested
`desktopFrame.fetchStats.cache.hits` value in warm-reload is 39178326; that internal
block-cache statistic must not be substituted for HTTP-cache evidence.

Warm-reload's successful boot, visible Terminal and measured elapsed time are HELD.
Its characterization as a boot using an actually warm HTTP cache is NEEDS EVIDENCE.
No cache effectiveness or speedup inference is made from the two elapsed times.

The second batch's 12 cold boots took 883.454–900.662 seconds, mean 889.880 seconds.
Across the 24 audited cold boots, the range is 816.430–900.662 seconds and the mean
is 860.314 seconds. These are partial values under the recorded concurrent load,
not the final 25-boot summary.

## Durable coverage and remaining work

`partial-second13.json` preserves the new per-case digests, decoded-frame results,
and exact acceptance-log line citations. `partial-through26.json` binds both audit
parts, records the hash-only carry-forward of prior evidence, and separates the
HELD desktop results from the missing actual-warm-cache proof. The unchanged
23/23 unit-test recording, prior integrity attacks, failure drills, and T18a-d
results remain HELD.

The page.reload branch now has a completed record and direct visual evidence.
Cold-25, final 27-case aggregation, final timing summary, and end-of-run integrity/
cleanup remain NEEDS EVIDENCE. No task verdict, status, queue or commit was changed;
no clone source or producer evidence was modified.
