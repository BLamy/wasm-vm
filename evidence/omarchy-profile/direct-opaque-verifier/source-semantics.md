# Pinned source semantics

Inspected independently before the trial at Hyprland commit
`efb50993780079460b0cbed1363e2166a2de1d9f`.

- The [legacy dispatcher, lines 698–707](https://github.com/hyprwm/Hyprland/blob/efb50993780079460b0cbed1363e2166a2de1d9f/src/config/legacy/DispatcherTranslator.cpp#L698)
  resolves the selected window and directly invokes `Actions::setProp`.
- [ConfigActions.cpp, lines 710–730 and 757–760](https://github.com/hyprwm/Hyprland/blob/efb50993780079460b0cbed1363e2166a2de1d9f/src/config/shared/actions/ConfigActions.cpp#L710)
  changes the six opacity fields and the opaque/RGBX properties synchronously.
  Each operation still updates decorations and recalculates active workspace
  layouts at lines 799–807; this route is not a field-only write or a proven
  speed improvement.
- [HyprCtl.cpp, lines 1208–1229](https://github.com/hyprwm/Hyprland/blob/efb50993780079460b0cbed1363e2166a2de1d9f/src/debug/HyprCtl.cpp#L1208)
  executes batch members in sequence, separating replies with three newlines.
  Lines 1443–1454 and 1483–1488 read the same properties. Lines 1913–2006
  gate global reload work on the refresh flag, which this batch omits.

The fixed order therefore gives positional meaning to normal-format values.
Swaps among identical true/unit values cannot be distinguished from text
alone; the exact command and sequential source semantics bind their names.
Exit zero alone is insufficient because dispatcher failures are reply text.

Source content was read through the web tool. A local HTTP download was
unavailable under network sandboxing; no network permission was requested.
These immutable primary-source links are the source citations.

## R1 correction

The initial legacy-route inference above is refuted by the actual guest.
The omitted caller branch at HyprCtl.cpp:1043–1056 dispatches through Lua
when that configuration manager is active. R1's raw replies demonstrate
exactly this branch. The direct setter internals remain applicable once
invoked through the correct Lua action; legacy command syntax does not
reach them in this guest. See `findings.md` F1.
