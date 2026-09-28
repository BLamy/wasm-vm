# Verifier audit adjustments

The first raw audit stopped on an overly broad verifier assertion forbidding
every `setDisplay` call. The unchanged demo normally advertises its original
1280×800 display during startup. Raw worker event 1 does exactly that at
04:24:32.094Z; event 5 acknowledges `true`. No smaller resolution or later
mode change was requested. The task requires original resolution and prohibits
a sweep, so this was an auditor error, not a product finding or a changed
prediction. The audit now requires exactly one original-size startup request
and its successful response before the opaque configuration begins.

The next comparison exposed an independent parser formatting difference: the
first regex excluded the newline immediately before the END marker, while the
documented RPC parser deliberately retains that newline in `stdout`. The raw
serial response contains it. The independent regex now includes all bytes
between marker lines and only normalizes CRLF to LF; no timeout/error text is
trimmed, substituted, or interpreted as properties.
