# P5 concrete source predictions — before recorded output

Source freeze: `02c79f5672c3f1a08a3429f7b32dce4e051a41ec`; original P0–P8 plan remains unchanged.
Derived from the setup/handler encoders in `crates/core/tests/support/plic_sparse_cases.rs`
and unchanged CSR trap/MRET and snapshot definitions. No raw gate log or Main oracle file
has been opened for this derivation. The coordinator already supplied its expected digest
and checkpoints; this is independent source arithmetic, not a claim those values were unseen.

The 16 words at RAM offset0 are:
`00000297 10028293 30529073 80000313 30432073 00800313 30032073 0c0002b7
00700313 0662ae23 0c0022b7 80000337 0062a023 0c2002b7 0002a023 0000006f`.
The five words at offset0x100 are:
`0c2002b7 0042a503 00a2a223 00050593 30200073`.

AUIPC uses PC0x80000000, so x5 becomes0x80000100 before MTVEC is written; unlike
LUI0x80000 this does not sign-extend the handler address outside RAM. The CSR instructions
enable MEIE and MIE. The three setup stores write priority31=7 at0x0c00007c,
enable0=0x80000000 at0x0c002000 and threshold0=0 at0x0c200000. The LUI into x6
sign-extends to0xffffffff80000000; SW deliberately stores only its low32 bits.

| Stop | Predicted exact state |
| --- | --- |
| Setup,16 retired | PC0x8000003c (the already-retired self-JAL), x5=0x0c200000, x6=0xffffffff80000000; source31 enabled, priority7, threshold0 |
| Device raises31; one interrupt slot | PC0x80000100, MEPC0x8000003c, MCAUSE0x800000000000000b, modeM, MSTATUS0x0000000a00001880; still16 retire records |
| Two handler instructions | PC0x80000108, x10=31, claim count31=1/all others0, pending31=0; trace now18 records |
| Device deasserts31; remaining three instructions | completion store31 at0x0c200004, x11=31, MRET returnsPC0x8000003c/modeM; MSTATUS0x0000000a00000088, MCYCLE=MINSTRET=21, pending31=0, count31 remains1 |

Trap stacks prior MIE into MPIE and prior modeM into MPP, clearing MIE; MRET restores
MIE, leaves MPIE set and resets MPP toU while returning to the saved M mode. Fixed
RV64 SXL/UXL supply0xa00000000. No guest instruction retires for the interrupt slot.
Canonical trace must contain the 16 setup PCs0x80000000..0x8000003c followed by five
handler PCs0x80000100..0x80000110, in that order. Only the three setup stores, claim
load and completion store touch MMIO; the claim load returns31 once. Guest instructions
do not modify RAM after fixture loading. Device-level deassertion is legitimate fixture
authority, not surgery on a pending bit.

The digest covers exactly65536 initially-zero RAM bytes with these little-endian words
inserted at the two offsets. Recompute SHA-256 from those literal bytes without emulator
or test-output imports. Expected coordinator value to check is
`c055e21cdc4ae3b9a55ddee3919d9bbc6fe2d7340a5830370a4aa3d79f6bc891`.
`snapshot().hex_digest()` hashes RAM only: it does NOT prove registers, CSRs, mode,
device state, or diagnostic counters. Their explicit assertions and recorded checkpoints
are separate proof obligations; this task claims neither full CPU serialization nor JIT
counter parity.
