# Browser keyboard input

The Demo terminal has an explicit keyboard-capture mode. The indicator in the terminal bar says
`Keyboard: captured` or `Keyboard: browser`, and the adjacent button changes the mode. Capture is
enabled by default when the page loads.

## Captured input

In capture mode, ordinary `keydown` and `keyup` events that reach the terminal host are prevented
from performing a browser default and are sent to the guest's virtio-input keyboard using their
physical `KeyboardEvent.code` (for example, `KeyA`, `Digit1`, and `Backquote`). The guest's own
layout maps those physical keys to characters; the browser's current locale is not copied into the
guest. Modifier prefixes are held until their dependent key arrives, so a rapid `Shift+A` or
`Ctrl+C` still has the ordering `modifier down`, `key down`, `key up`, `modifier up`.

The live xterm textarea is a deliberate compatibility boundary: printable ASCII letters and Space
are left for xterm's keypress/input conversion, and xterm cancels them after emitting the serial
byte. This keeps the existing getty editor byte-exact while captured non-xterm guest surfaces use
the ordinary `preventDefault()` decision.

Browser auto-repeat does not create additional guest make events. IME/composition events and the
229 IME key code remain available to the browser. Dead keys are identified by physical code, not by
the localized `key` label.

The serial shell also retains its existing xterm input path. This is why typing a command at the
guest getty continues to use the terminal's normal text editing and UTF-8 serial behavior while
the same physical transitions are observable by the virtio keyboard device.

## Reserved view-toggle chord

`Ctrl+Alt+Backquote` is reserved for the host view-toggle router used by the T08 chrome. The
keyboard policy recognizes it before forwarding the trigger to the guest, stops page handlers, and
does not call `preventDefault()`. T08 may consume the `wvm:reserved-view-toggle` event to change
views. The prefix modifiers are discarded as part of the reserved chord, so no part of the chord is
sent to the guest keyboard.

## Passed-through browser shortcuts

The following are intentionally passed through: no `preventDefault()` is called and no guest key
frames are emitted.

- `Ctrl+W`, `Ctrl+T`, and `Ctrl+N` (browser tab/window actions vary by browser and platform).
- `Cmd+Q` and `Cmd+Tab` on macOS (`Meta+Q` and `Meta+Tab` in DOM terminology).
- `F11`, which is normally owned by browser fullscreen handling.

Capture-off mode applies the same browser-first rule to every terminal-host keystroke: it does not
prevent defaults and does not forward events to the guest keyboard. The serial terminal can still
receive input through its normal focused xterm path when the browser supplies it.

## Focus and lock-state recovery

The demo keeps a physical-code ledger for transitions that the guest believes are held. A window
blur, hidden-document transition, pointer-lock loss, or reserved view toggle releases that ledger
in dependent-key-first order. The terminal bar's **Release keys** control is an intentional panic
boundary with the same idempotent behavior; a later physical `keyup` is logged as an orphan and
does not emit a second guest break. Retiring or restarting the Linux controller clears the page
ledger without sending RPCs to the stopped controller.

When a key event arrives after recovery, modifier state is reconciled before the event is sent to
the guest. A modifier is re-pressed only when that event's `getModifierState()` still reports it
physically down; a stale host release therefore cannot create a phantom Ctrl/Alt/Shift/Meta. The
guest's CapsLock and NumLock LED feedback is polled from the virtio-input status sink. If it
differs from the host's lock state, one synthetic down/up pair is sent and held pending until guest
feedback catches up, preventing repeated lock toggles from oscillating.

The compact debug surface shows currently-held physical codes and modifier/lock repair counts.
It is diagnostic UI, not a promise that the browser can intercept OS-owned shortcuts. Chrome,
Edge, macOS, extensions, kiosk shells, and browser UI may consume a shortcut before the page sees
it; those controls remain covered by the passthrough and browser-limit policy above.

## Pointer mode and wheel input

The terminal surface exposes both guest pointer devices. Absolute mode is the default: each
`pointermove` is mapped from the element's current CSS `getBoundingClientRect()` to the tablet's
inclusive `0..32767` `ABS_X`/`ABS_Y` range. Backing-canvas pixels and `devicePixelRatio` are not
inputs to that calculation, so CSS scaling does not introduce an offset. Primary, secondary,
auxiliary, back, and forward buttons map to `BTN_LEFT`, `BTN_RIGHT`, `BTN_MIDDLE`, `BTN_SIDE`, and
`BTN_EXTRA`; the surface captures the pointer and suppresses its context menu while a frame is
owned by the guest.

The mode control requests Pointer Lock with `unadjustedMovement: true`. Relative mode forwards
only `movementX`/`movementY` as mouse `REL_X`/`REL_Y` deltas and never synthesizes an absolute
cursor jump. A denied or lost lock, Escape, blur, hidden-document transition, reserved view
toggle, pointer cancel, or explicit mode exit releases every held pointer button and returns to
absolute mode. The visible debug chip reports the mode, lock state, held-button count, frame count,
and wheel remainders.

Wheel normalization is deterministic and per-axis. A PIXEL event contributes one normalized unit
per CSS pixel; 120 units emit one detent. A LINE event contributes 40 units per line, so three
lines emit one detent. A PAGE event is one detent. Vertical browser `deltaY > 0` (down/natural
scroll) becomes evdev `REL_WHEEL = -1` because evdev positive means up/away; horizontal `deltaX > 0`
becomes `REL_HWHEEL = +1`. Fractional remainders stay below one detent and each emitted frame has
exactly one input sync terminator. Oversized host deltas are bounded before accumulation.

## Browser and OS limits

Web content cannot guarantee interception of shortcuts consumed before a page event is delivered.
In particular, Chrome/Edge may close a tab or window for `Ctrl+W`, reserve `Ctrl+T`/`Ctrl+N`, and
macOS may consume `Cmd+Q`/`Cmd+Tab`; `F11` may be handled by the browser or the operating system.
Those controls are documented as passthrough rather than promised guest input.

Firefox-style quick-find (commonly `/`) is preventable when its `keydown` reaches the terminal host
in capture mode, but a browser, extension, kiosk shell, or operating system that consumes the key
before dispatch cannot be overridden by this page. Use capture-off when browser navigation or
search should own the keyboard.

Pointer Lock is likewise a browser permission boundary: it requires a user gesture in browsers
that enforce that policy, and an iframe or permissions policy may deny it. The fallback is
intentional and safe: the bridge stays in absolute mode, releases any button it owns, and keeps
the terminal usable without a lock. Pointer capture is scoped to the terminal element and is
released on button-up/cancel or focus loss; it cannot make events delivered after a browser or OS
has already terminated the page.
