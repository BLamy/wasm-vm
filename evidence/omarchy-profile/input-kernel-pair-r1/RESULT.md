# AR: new-kernel desktop pair prepared; keyboard response remains untested

Native cold-boot head: c2cbcfd0d0d8b18ccc0d109363eca370c2dbf847.
Final browser/guard head: 21b77bb028996ed0a5450e289d4690eb820aab4d.
See NATIVE-RESULT.md and native/run.json for the actual cold boot and hashes.

The recorded browser restores that native pair using unchanged AO WASM
36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916.
Its read-only running-kernel notes check succeeds before direct property writes.
The synchronous property batch confirms all eight opaque/RGBX/opacity settings
and active Foot PID473/address0x55558518d650 at[12,38], size[1256,750].
The original1280x800 presentation advances from2 to3 after that acknowledgment.

I personally inspected desktop/desktop.png and desktop/prepared-desktop.png
under browser/: both show the readable empty Foot prompt and package bar at
1280x800. The prepared image SHA256 is
a3b201ce2e00db5602df2b55f51b687af5524ce3d5f02dabb47487eb1de2e27b.
This is visible preparation evidence, not a typed application response.

The new frame is recorded at22:05:31.248Z, within the original900-second
preparation budget. Guest sync returns exit0 at22:05:34.454Z, before persistence
and paused coherent export. Export ends22:06:46.332Z, within its180-second budget.
The pair has matching R3 base digest and generation48, 2750 disk blocks, and
restoreDecision=resume. Owned browser cleanup closes normally; zero unexpected
browser errors, zero physical key events and no nonce writer are recorded.

| Artifact | Compressed bytes | SHA256 |
|---|---:|---|
| RAM snapshot |205400326|265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8|
| Disk delta |1285559|1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c|

Artifacts: target/omarchy-input-kernel-prepared-pair-r1.
Browser report digest:667d7d1528dab2bfa1198faf6d64a530cdf18ed26ffba79602650105cf0d7809.
Browser wrapper receipt digest:577f33d7ecc5b29b161c436dbfcc1be11e3676ff1293bf45b71738f2954f4180.

Command (DEVELOPER_DIR=/Library/Developer/CommandLineTools, Node24):

```
node tools/verify/omarchy-prepare-input-kernel.mjs evidence/omarchy-profile/input-kernel-pair-r1/browser target/omarchy-input-kernel-prepared-pair-r1 evidence/omarchy-profile/input-kernel-pair-r1/native/run.json
```

The final affected suite passes41 tests (affected-tests-r4.log). Preserved earlier
failures: misplaced notes check caught by the actual-route test, subsequently
corrected before any browser launch; r3 loopback selftest denied by the shell
sandbox (EPERM), rerun with local loopback permission in r4. The critic's original
and fixed cleanup/identity-key-override attacks are separately retained. No
runtime behavior changed after the native happy recording; incremental harness
proof covers those fixes. No unchanged broad gauntlet is re-claimed here.

AR awaits its independent final verdict. AS must restore this exact pair with
AO recycling enabled, original deadlines and no profiler/tracer, then prove the
physical nonce and a visible typed command plus returned prompt. Q stays gated.
