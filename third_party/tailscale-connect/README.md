# Pinned Tailscale Connect runtime

E3-T17 builds the browser IPN from `https://github.com/BLamy/tailscale.git` at immutable commit
`0c78282d89c9c0af8e31d460a61bc5517d54c769` (the `almostnode-browser-connect` line). That source
pins the Tailscale-patched Go toolchain at `c803676bcc7f2b195b167a53d49d728045cd9b36`.

`patches/0001-generic-netconn-streams.patch` adds bounded generic TCP/UDP sessions to the public JS bridge.
The transport uses `dialTCP` / `dialUDP`; it does not use the whole-body `ipn.fetch` API. Run
`./third_party/tailscale-connect/build.sh` from any checkout to rebuild `web/tailscale-connect/`.
The script creates its own temporary source checkout and therefore has no dependency on an adjacent
`almostnode` or Tailscale checkout.

The upstream source and the produced artifact are BSD-3-Clause licensed. The required notice is in
`LICENSE` beside this file.
