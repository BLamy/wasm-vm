# Omarchy lean-session worker run — in progress

Frozen image tools: `0fbca4d5976b193449f16324727b933d4329d15a`.
This is an interim run record, not a verification verdict or production claim.

## Candidate and provenance

- Image: `target/omarchy-profile-r2.ext4`, 4,294,967,296 bytes,
  SHA-256 `47584cba39876ee958ea8fa39d3432488277d230abb2997b5999e54b8defe13e`.
- Chunks: `target/omarchy-profile-chunks-r2`, 32,768 × 131,072 bytes, split.
  Manifest SHA-256 `1e52e69755ce3a1c29ee7ec33e2269e9133671c06a2829deea8c885cfc5d07cd`.
- `build-receipt-r2.json` SHA-256
  `127a222650542b5e63c8979a017141aa7dfc169ab08ee7fd032301d13f1f57af`.
- `build-commands-r2.log` SHA-256
  `410bb82aefbd5f542becbd479d34990af1ab95ab5407c0ac9f33b4cbc074a7e5`.
- Tooling image `wasm-vm-omarchy-image:profile`, image ID `6df4c3fafd2d`.
  Container `wasm-vm-omarchy-profile-20260909-v3` uses `--network none`,
  `--cap-add SYS_ADMIN`, `--security-opt apparmor=unconfined`, read-only
  package input and tool mounts, and a separate output volume. No original
  VM or private disk is mounted in this builder.

The first attempt failed its first temporary mount and produced no receipt.
The mount diagnostic identified `move_mount` returning EACCES under Docker's
AppArmor profile. A temporary mount/unmount pre-check passed in v3 before the
fresh r2 build. No cache command or integrity check was bypassed.

```sh
docker exec wasm-vm-omarchy-profile-20260909-v3 python3 /tools/build-omarchy-image.py \
  /input/assembled-r3 /work/candidate-r2 \
  --selection /input/package-selection.json \
  --overlays /tools/omarchy-reviewed-source-overlays.json
target/release/wasm-vm chunk target/omarchy-profile-r2.ext4 \
  --out target/omarchy-profile-chunks-r2 --chunk-size 131072 --layout split
python3 tools/image/verify-omarchy-image.py --image target/omarchy-profile-r2.ext4 \
  --manifest target/omarchy-profile-chunks-r2/manifest.json --receipt
```

The generated root contains linker cache 74,427 bytes, hardware database
13,881,936 bytes, journal catalog 296,184 bytes, and both real systemd update
stamps. The copied session script matches source SHA-256
`1729868d64c77e38058af4cfb7a59bf953582bf9918da50951a3fac05d1e405f`.

## Tool tests

`python3 -m unittest discover -s tools/image -p 'test_*.py'`:

- Linux root: 105 tests, OK, one APFS-only skip (`tests-linux-r2.log`).
- macOS: 105 tests, OK, 16 explicit Linux/identity/platform skips
  (`tests-macos-r2.log`). Actual uid-1000 success and uid-0/1001 rejection are
  exercised by Linux subprocess credentials, not a mocked `id` command.

## QEMU pre-check only

`qemu-r2.log` records a fresh APFS copy `target/omarchy-profile-qemu-r2.ext4`
with the exact candidate bytes, kernel 6.6.63, 2 GiB RAM, modern virtio-mmio,
virtio GPU, keyboard, RNG, and no network adapter. The process was stopped after
the pre-check; this disk is not a publication source.

Observed Hyprland PID267, Quickshell PID304 running the packaged Omarchy shell,
and Foot PID303, mapped/visible/accepting input at 1256×750. The generic account
was uid/gid1000 with no additional groups. Both upstream user-completion markers
were absent; the separate demo marker was present. hvc0 was masked/inactive;
no cache-generation boot job or fcitx startup failure was observed.

Known pre-existing platform limitation: xdg-document-portal cannot mount because
this kernel has no `/dev/fuse`; PipeWire is not bundled in this selected profile.
Neither warning is a missing executable introduced by this change. This record
does not claim those optional facilities work. QEMU is not wasm-vm acceptance.

## Actual wasm-vm run

Completed on a separate fresh copy, not the canonical image:

```sh
target/release/wasm-vm boot --kernel releases/kernel/6.6.63/Image \
  --drive file=target/omarchy-profile-native-r2.ext4 \
  --append 'console=ttyS0 earlycon=sbi root=/dev/vda rw rootwait loglevel=6 systemd.show_status=1' \
  --ram-mib 2048 --max-instrs 20000000000 --block-cache --interrupt-batching \
  --virtio-rng --no-reboot --keyboard-proof \
  --gpu-trace evidence/omarchy-profile/native-gpu-r2.txt \
  --evidence evidence/omarchy-profile/native-digest-r2.txt
```

Serial recording: `native-r2.log`. No JIT or profile-stop-at-login flag is used.
The native attempt ended at MaxInstrs, without Hyprland, Quickshell, Foot, or
keyboard acceptance. It recorded 19,998,924,219 retirements, trace FNV-64
`be4d44eece2a6fa2`, and state SHA-256
`bcc19abe7fb5ef85b9eec01e2cd58f99417cc0683b02b41b0490da79caa69b15`.

The stopped test disk's journal was extracted with debugfs into the isolated
builder. The package-owned RISC-V journalctl read it through QEMU user mode:

```sh
docker exec -e QEMU_LD_PREFIX=/work/candidate-r2/root \
  wasm-vm-omarchy-profile-20260909-v3 \
  /work/candidate-r2/root/usr/bin/journalctl \
  --directory=/work/native-journal-r2/journal/4516e5df4c41414e9fb5d785c087771f \
  --no-pager -o short-monotonic _UID=1000
```

Output: `native-user-journal-r2.log`, SHA-256
`31b144618a94f58fb511aff416ab4dfe131173dedf0c10c55f1e066a0c1c8c0e`.
UWSM requested a user-manager reload at 145.701629 guest-seconds; its D-Bus
call returned NoReply at 170.721454. Systemd completed the reload at
180.635973, reporting 34,886 ms. This diagnoses a real startup deadline race;
it does not establish desktop readiness. No package timeout has been patched.

## Browser attempts and publication layout

The first browser attempt (`browser-r2`) failed before boot because 2048 MiB
guest RAM cannot be allocated by this wasm32 build. The fresh 1024 MiB retry
(`browser-r2-1024m`) passed allocation and proved UID 1000/home, then failed on
the packaged hyprctl's malformed empty-instance JSON. QEMU user-mode execution
of the same package independently emitted the same `]` output with no instance.
The harness first checks for a live Hyprland process before requesting JSON.
A later startup run demonstrated that the process can precede the instance
interface: even the guarded query can return the exact negative `]` result.
The current harness treats only that known result as no instance; other
malformed JSON still fails, and positive desktop readiness remains separate.

The unchanged candidate has also been split into 16,384 logical 256 KiB chunks
at `target/omarchy-profile-chunks-r2-256k`. Streaming verification passed:
`integrity-r2-256k.json`, manifest SHA-256
`ec1bc2601b104cfb6d6875c091377ccfd0654d5b6aab71c6a08ae37263f1c391`.
This layout fits the existing Pages file-count limit with the web application;
the original 128 KiB split exceeded that limit. Nothing has been published yet.

There are 10,535 unique 256 KiB chunk objects. Read-only `wrangler pages project
list` confirmed access to the existing `wasm-vm` project at `wasm-vm.pages.dev`.

## Explicit browser boot configuration trials

The existing deterministic clock option admits an explicit divider of 64 with
the unchanged 10 MHz timebase (640 million busy retirements per guest-second).
This changes the CPU/timer ratio, not a package's D-Bus deadline. The native
divider-10 failure remains a failure. Clock-option tests pass 21/21 in
`clock-option-tests-r3.log`; these are not a substitute for the actual boot.

`browser-r2-div64` used frozen harness `95927a1d` and the same clean image, with
1 GiB RAM and divider 64. Its real xterm bridge answered terminal queries. It
reached the non-root user manager, but Plymouth quit/wait had not completed and
Hyprland was absent. The coordinator stopped that diagnostic Chrome process;
its closed-page result is explained in `browser-r2-div64/abort.md`. The original
harness bytes are retained in `frozen-harness-95927a1d.mjs`.

The packaged `plymouth-start.service` explicitly supports
`ConditionKernelCommandLine=!plymouth.enable=0`. `plymouth-quit.service` has a
20-second guest deadline, and SDDM orders itself after it. The next fresh test
therefore selects the supported splash-disable argument, with no image edits:

```sh
node tools/verify/omarchy-browser-session.mjs \
  --image target/omarchy-profile-r2.ext4 \
  --image-sha256 47584cba39876ee958ea8fa39d3432488277d230abb2997b5999e54b8defe13e \
  --chunks target/omarchy-profile-chunks-r2-256k \
  --manifest-sha256 ec1bc2601b104cfb6d6875c091377ccfd0654d5b6aab71c6a08ae37263f1c391 \
  --out evidence/omarchy-profile/browser-r2-div64-nosplash \
  --ram-mib 1024 --icount-divider 64 \
  --bootargs 'root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0' \
  --keyboard auto --timeout-ms 2400000 --probe-timeout-ms 240000
```

Frozen harness: `9e279e2b7bee79cd6845c762ddde6fcd57c18456`, SHA-256
`c1e5eefb7d374c9666d6e58d47110f0db405cf8e4c78dfd3d4f6cb033dffcbde`.
Its stricter shell predicate requires the exact package path and owning PID,
rejects options after `--`, and requires positive surface geometry. Focused
tests pass (`harness-self-test-r4.log`); Daybreak's previously recorded helper
false positives are closed.

That no-splash run started SDDM and reached the graphical target. Probe 15
found a Hyprland process but its interface was not yet discoverable; the
literal `]` negative result stopped the harness at 1,195,316 ms. Failure state
SHA-256 `e95c692d1d3a92061241f1cc260793fe0554a249127d161c06f711c961b17cea`;
source image and manifest unchanged. No desktop or keyboard claim was made.

The new cold run uses output directory `browser-r2-div64-nosplash-r2`, the same
arguments plus `--control-stdin`, and frozen harness
`297b003ca1f1104dd539b9e79e023622b06bb9c1`, SHA-256
`6e6e112fd975debd7768c721da14e01685d442e6bda76abc663172bebe082192`.
It treats the known absent-interface output as absence and retains strict
positive desktop predicates. Optional JSON-line serial diagnostics are recorded
and serialized with automatic probes; control closes and the queue drains
before a successful snapshot. Diagnostic commands must not manufacture an
acceptance state.

That run reached the real Hyprland instance (PID 478), package Quickshell (PID
603, `quickshell -n -p /usr/share/omarchy/shell`), Foot (PID 596), and the own
setup marker with upstream completion markers absent. The recorded reload
completed in 5,459 guest-ms instead of the native run's 34,886 ms; UWSM then
started the compositor successfully. Read-only manual probes are in the same
`events.jsonl` and serial recording as the automatic probes.

The 2,400,000 ms host diagnostic cap expired before mapped Foot, a shell
surface, and physical keyboard acceptance. Final capture: 41,518,097,356 retired
instructions; 412 display frames; 43 sampled colors; state SHA-256
`57e90975fa01b7aab64856328b88c2b380efddaba439b91c312b3fc04a62690a`.
`guest.png` shows the real gray compositor background and pointer, not the
requested completed desktop. No browser, worker, or presentation error occurred,
and source image/manifest stayed unchanged. Total slice CPU time was 2,392,136.7
ms; chunk fetch waits totaled 4,592.5 ms. This is incomplete acceptance, not a
successful desktop or a measured fast-start claim. The read-only host sample
`chrome-sample.txt` identifies the busy browser worker but has no guest symbols.

`browser-r2-div64-nosplash-long` now runs the same frozen harness, image, clock,
and bootargs with `--timeout-ms 7200000 --probe-timeout-ms 300000`. An attempted
600000 ms probe setting was rejected by CLI validation before any output
directory or browser was created; the corrected command uses the supported
limit. This longer cold run is pending, not accepted.
