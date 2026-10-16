# Guest timekeeping

The guest's monotonic timer (`mtime`, the `time` CSR and Linux clocksource) is
independent of the goldfish RTC. The RTC reads host `Date.now()` for civil time;
changing a monotonic clock policy never derives it from the RTC. Linux normally
seeds its civil clock from the RTC at boot and then advances it using its chosen
clocksource, so guest `date` can drift with the execution policy.

## Monotonic clock modes

| Mode | Busy execution | Idle `WFI` | Host input |
|---|---|---|---|
| `icount` | One tick per configured number of retired instructions | May jump to the nearest armed timer deadline when no pending device work forbids it | None |
| `paced-icount` | Same retirement count and divider as ICount | Deadline jumps are capped by elapsed monotonic host time | `performance.now()` through the native clock adapter |
| `wall` | Elapsed monotonic host time | No deterministic deadline fast-forward | `performance.now()` through the native clock adapter |

The machine timebase is 10 MHz. The default instruction divider is 10; production
Omarchy boots use an explicit divider of 64. Switching the divider or selecting a
host-paced policy preserves the current decimal `mtime`; it does not reset time.
The browser API returns `mtime` as a string to preserve all 64 bits.

ICount remains the deterministic native/Wasm replay policy. Its idle jump is a
function of guest state, so idle virtual time can advance much faster than host
time. Pending keyboard, network and GPU work can suppress that jump. A finite
input RPC completing does not prove that Linux or a Wayland client consumed it.

Paced ICount adds a ceiling only to idle deadline jumps. It never forces busy
time to follow host time, slows instruction retirement, or samples the host clock
on the busy path. Busy retirement can therefore put `mtime` ahead of the idle
ceiling; the ceiling cannot move time backward. The host epoch is private and is
not serialized in a guest snapshot. This mode retains the ordinary ICount JIT
path. Wall mode instead uses the conservative wall-clock JIT policy.

## Production keyboard policy

Accelerated Omarchy starts in ICount64. Its `paced-on-keyboard` policy selects
`paced-icount` immediately before staging the first eligible original EV_KEY
make (PC105 key codes 1–248). A lock reconciliation make can be first, including
while booting or explicitly paused. This is not a desktop-ready or trusted-DOM
attestation. The loader verifies the actual selected mode, unchanged `mtime`,
divider and timebase before publishing that make. Failed selection stops the
controller; later events cannot bypass it.

Explicit `wall-on-keyboard` remains supported, as do directly selected `wall`
and `paced-icount`. Software guests and callers omitting the interactive policy
keep their existing boot clocks. The policy does not change keyboard repeat
settings, input event ordering, typing delays or snapshot formats. Native paced
clock verification is separate from successful stock desktop input acceptance.

## Pause and background behavior

Explicit pause stops execution. Resume rebases the selected host-paced clock
before scheduling, excluding the paused host interval. ICount has no host-time
debt to discard. The RTC continues to read real civil time across a pause.

The display scheduler can keep the guest running while the page is hidden and
present on its bounded background timer. Hidden is therefore distinct from an
explicit controller pause. A resumed paced-clock observation can include both
host-paced idle ticks and busy retirement ticks; evidence must bound both rather
than assuming every tick represents elapsed host time.

Historical E2-T23 measurements of `sleep 2`, accelerated idle and civil-clock
drift describe the earlier ICount implementation and are not performance or
interactive responsiveness guarantees for the current accelerated desktop.
