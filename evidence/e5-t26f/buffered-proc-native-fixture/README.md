# Native capture-fixture visibility diagnosis

Diagnostic only, 2026-09-08. The original 83/84 result is retained separately in
[`../buffered-proc-busybox.log`](../buffered-proc-busybox.log). No helper, image,
browser, or acceptance change was made for this investigation.

## Observed boundary

One fresh scratch replay of four tiny containers reproduced a host/container
visibility mismatch **before sourcing or calling the unchanged helper**:

| Input operation | Host size / bytes | Container stat + od before helper | Helper status / bytes |
| --- | --- | --- | --- |
| Create `reused.data` empty | 0 / empty | 0 / empty | 0 / empty |
| Rewrite same host inode to `pipe_read` | 9 / `706970655f72656164` | **0 / empty** | 0 / empty |
| Create new `unique-empty.data` | 0 / empty | 0 / empty | 0 / empty |
| Create new `unique-pipe.data` | 9 / `706970655f72656164` | 9 / `706970655f72656164` | 0 / `706970655f72656164` |

The reused host inode was 34749046 in both host observations; the container
reported inode 16904 and the previous zero size in both containers. Inode numbers
are not compared across namespaces. The rewrite was observed on the host at
15:14:19.613 UTC. [check.json](check.json) records actual timestamps, hashes,
sizes, inodes, bytes and helper results; [check.log](check.log) retains exact
commands and output, including the pre-helper stat/od checks.

This establishes that this failure can arise upstream of `e5_capture`: the
container's ordinary file readers also received the old empty view. It does not
identify the specific Colima/shared-filesystem cache implementation responsible,
nor make a claim about real proc files or guest timing.

## Narrow correction and checks

Only the existing five-vector capture test changed: each vector now creates its
own `capture-N.data` once with `flag: "wx"`. No sleeps, cache flushing, helper
changes, output substitutions, or relaxed assertions. A unique file avoids the
rapid host rewrite between separate containers.

Commands executed from the repository root:

```sh
node evidence/e5-t26f/buffered-proc-native-fixture/check.mjs
node --test --test-name-pattern='capture preserves EOF' tools/verify/e5-t26f-resident-aplay.test.mjs
E5_T26F_RESIDENT_TEST_DOCKER=1 node --test --test-name-pattern='capture preserves EOF' tools/verify/e5-t26f-resident-aplay.test.mjs
```

The focused Mac and actual BusyBox tests each passed **1 test, all 5 vectors**;
raw output is [focused-mac.log](focused-mac.log) and
[focused-busybox.log](focused-busybox.log). No full 84-test rerun was performed;
the coordinator owns the final recording.

All containers used cached image
`sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc`,
`--pull=never --network=none --cpus=1 --memory=128m --pids-limit=32 --rm`,
and only their owned scratch/fixture directory mounted at its absolute path.
Scratch inputs and the unchanged helper copy are retained under `scratch-*`.
The production helper remains SHA256
`324e0acddd88bd2d41b0310444e32e2262dedd3129132240134dac857d4eec2e`.
