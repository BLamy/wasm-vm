# Exact worker cost after failed physical input

Desktop responsiveness remains unsolved. R2 repairs R1's observation protocol;
it does not repair the desktop. Recording head:
`8ad5886126ddf062403455e266471d83e0e7feee`.

The physical command completes Enter at 02:35:41.466Z. The owned-page host-input
fence acknowledges at 41.468Z without changing the original deadline. The nonce
is still absent at 02:37:41.467Z. The actual failure image is the same empty Foot
prompt as the initial image. No guest input or display mutation occurs after
the fixed failure; only five existing read-only RPC methods and serial replies
are observed. The single owned Chrome closes normally.

## Measured host time

The 30-second sample begins after the failure image, at 02:37:41.575Z, and ends
at 02:38:11.612Z. Raw `desktop/worker-cpu.json` contains 20,007 samples in a
2,743-node tree and 30,024,349 weighted microseconds. Its SHA256 is
`a6e8f0c8189b783efc4e293f6001df4d9e559e3ca814bd5097ae394b781146b2`.
The exact same-origin worker target is EC12272BE98DC07E46B0DAA8C04B34C7.

| Function | Self time | Share of all weighted samples |
|---|---:|---:|
| `Machine::run` | 3,903,577 us | 13.0014% |
| `Hart::execute` | 2,240,711 us | 7.4630% |
| `BlockCache::flush_page` | 1,992,562 us | 6.6365% |
| `mmu::translate_cached` | 1,496,316 us | 4.9837% |
| `Machine::try_jit_block` | 1,204,127 us | 4.0105% |
| `Machine::next_micro_op` | 1,084,118 us | 3.6108% |

`runTick` includes 94.2563% of sampled time. `Machine::try_jit_block` includes
44.2560%, and `BrowserExecutor::execute_with_budget` includes 28.9813%.
Inclusive shares overlap; they must not be summed. Raw graph nodes retain
function indices/URLs; `symbolized/cpu-summary.json` contains the full name
map, section digests and rankings. All eleven executable/non-custom sections
of the offline named companion are byte-equal to the release, with 1,911 names.
The companion is never served or executed. Dynamic JIT frames remain anonymous.

## Limits and next bounded investigation

This later interval measures substantial emulator execution, not a continuous
trace of the preceding input failure or proof that any sampled function causes
the blocked desktop. Even deleting `flush_page` would remove at most its sampled
6.64% share in this interval; such a change is not a demonstrated responsiveness
remedy and would risk instruction coherency.

The next bounded experiment should prepare one fully rendered 640×400 warm
desktop before a fresh restore and the unchanged physical-input deadline.
T03r proved actual mode adoption, but its final image was black and its own
verdict requires a visible application in the selected mode for the next trial.
A separate finite preparation phase may finish that modeset; it must not be
counted as the later input trial or extend its 300s startup/120s readback. Keep
the current runtime, renderer and admission settings fixed, pair all RAM/disk
artifacts, and require actual dimensions, visible Foot, independent nonce and
visible typed response. A prewarmed or smaller image alone is no success claim.

R1 remains refuted for its three post-verdict tablet RPCs. Its original 30
artifacts are unchanged and pinned by `worker-cost-gates-r2/r1-preserved.json`.
The original 70 tests, exact-worker browser test and symbol-identity checks
carry for unchanged boundaries. R2 adds 13 passing affected recorder checks,
one real Chrome input-fence regression and two syntax checks. Original serial
logs retain their exact CR/escape bytes rather than being whitespace-normalized.
