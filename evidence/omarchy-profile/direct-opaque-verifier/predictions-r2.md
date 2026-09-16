# Corrective R2 prediction

Written 2026-09-16 04:51:23 UTC, before inspecting any R2 guest evidence.
Frozen corrected head: `141bdd5a055aa3f03592f127246a8b6e131f9125`.

R1's P1 failure is preserved in `findings.md`. R2 changes only the eight
write expressions to the Lua dispatcher-object syntax. I predict that
the fixed command now reaches `Actions::setProp` through the pinned Lua
bindings, and its raw reply contains eight `ok` acknowledgments followed
by the eight expected values and active Foot JSON. A timeout or any
different reply still cannot establish configuration or physical input.

The other P2–P8 predictions and original deadlines remain unchanged.
HELD pure parser, input-auditor, fence, runtime and cleanup results carry
forward when their exact source and evidence hashes are unchanged. The
new actual raw response and any physical input/images must still be
independently audited; no timing or desktop success is inferred from the
source correction.

Independent source chain:
[HyprCtl.cpp:1043](https://github.com/hyprwm/Hyprland/blob/efb50993780079460b0cbed1363e2166a2de1d9f/src/debug/HyprCtl.cpp#L1043)
wraps the expression in `hl.dispatch`.
[LuaBindingsToplevel.cpp:325](https://github.com/hyprwm/Hyprland/blob/efb50993780079460b0cbed1363e2166a2de1d9f/src/config/lua/bindings/LuaBindingsToplevel.cpp#L325)
executes the dispatcher object.
[LuaBindingsDispatchers.cpp:955](https://github.com/hyprwm/Hyprland/blob/efb50993780079460b0cbed1363e2166a2de1d9f/src/config/lua/bindings/LuaBindingsDispatchers.cpp#L955)
builds the property closure, and its line 598 calls `Actions::setProp`.
The same file registers it under `hl.dsp.window` at lines 1261/1291.
[LuaBindingsInternal.cpp:291](https://github.com/hyprwm/Hyprland/blob/efb50993780079460b0cbed1363e2166a2de1d9f/src/config/lua/bindings/LuaBindingsInternal.cpp#L291)
resolves the supplied selector. The official
[0.55 dispatcher reference](https://wiki.hypr.land/0.55.0/Configuring/Basics/Dispatchers/#window)
defines `activewindow` as a window selector.
