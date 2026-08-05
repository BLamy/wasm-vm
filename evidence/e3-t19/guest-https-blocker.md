# E3-T19 guest HTTPS blocker — 2026-07-22

An earlier 2026-07-21 composed Tailscale exit-node run completed HTTPS successfully and is preserved
in `guest-https-tailscale.txt`. Two subsequent exact-head runs reached Alpine login and DHCP with the
rebuilt VM and a fresh single-use Headscale key each time, but could not repeat that result.

Stable observations:

- `random: crng init done` at guest time `2.196615`;
- ext4 root mounted and OpenRC reached getty;
- `eth0` held `10.0.2.15/24`;
- provider status reached `Running` with the exit node explicitly selected;
- the earlier run returned rc=0, while both later runs returned rc=1 and
  `Connection reset by peer` for `timeout 180 wget -qO /dev/null https://1.1.1.1/`;
- wall time was 20.5 minutes and 14.2 minutes respectively.

The second run included an experimental transport shim that held fragmented ClientHello bytes until
the complete first TLS record was available before dialing. Its focused tests passed, but the live
result remained identical, so the shim was removed. Entropy and first-record timing are therefore
not sufficient fixes. The one earlier success plus two later failures identifies a timing race, not
absolute impossibility; E3-T19 remains blocked because acceptance requires reliable Tailscale and
relay HTTPS proof, which awaits JIT coverage of the real Alpine TLS path.

The latest Playwright trace is
`web/test-results/e3-t19-guest-https-clean-c-99aec-xplicitly-selected-provider/trace.zip` (local,
not committed because it contains a full browser execution recording).
