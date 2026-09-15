//! Shared, deterministic architectural fixture for native and browser executors.
//! Raw encodings pass through the real decoder; expected values come from the
//! existing interpreter plus explicit move/boxing assertions, not JIT helpers.
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

pub fn fp(funct7: u32, funct3: u32, rd: u32, rs1: u32, rs2: u32) -> u32 {
    (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | 0x53
}

pub fn block(phys: u64, words: &[u32]) -> DecodedBlock {
    DecodedBlock::new(
        phys,
        words
            .iter()
            .map(|&raw| MicroOp {
                raw,
                len: 4,
                instr: decode(raw).expect("actual legal encoding"),
            })
            .collect(),
        words.len() as u64 * 4,
    )
}

pub fn set_fs(hart: &mut Hart, fs: u64) {
    hart.csr
        .access(MSTATUS, CsrOp::Write, fs << 13, false, false, 0)
        .unwrap();
}

fn copy_hart(source: &Hart) -> Hart {
    Hart {
        regs: source.regs.clone(),
        fregs: source.fregs.clone(),
        csr: source.csr.clone(),
        ..Hart::default()
    }
}

#[derive(Debug, PartialEq, Eq)]
struct State {
    x: [u64; 32],
    f: [u64; 32],
    pc: u64,
    fflags: u8,
    frm: u8,
    mstatus: u64,
}
fn state(hart: &mut Hart) -> State {
    State {
        x: core::array::from_fn(|r| hart.regs.read(r as u8)),
        f: core::array::from_fn(|r| hart.fregs.read_raw(r as u8)),
        pc: hart.regs.pc,
        fflags: hart.csr.fflags,
        frm: hart.csr.frm,
        mstatus: hart.csr.read(MSTATUS),
    }
}

fn compare(
    executor: &mut dyn CompiledBlockExecutor,
    decoded: &DecodedBlock,
    got: &mut Hart,
) -> u64 {
    let mut want = copy_hart(got);
    let mut oracle_bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut jit_bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut trap = None;
    let mut retired = 0;
    for op in &decoded.ops {
        match want.exec_oracle(
            &mut oracle_bus,
            op.instr,
            u64::from(op.len),
            u64::from(op.raw),
        ) {
            Ok(_) => retired += 1,
            Err(fault) => {
                trap = Some(fault);
                break;
            }
        }
    }
    let exit = executor
        .execute(decoded.phys_start, got, &mut jit_bus)
        .expect("selected block compiled");
    let actual_trap = if exit.code == ExitCode::IllegalInstruction {
        Some(Trap {
            cause: Exception::IllegalInstruction,
            tval: exit.exit_info,
        })
    } else {
        exit.trap
    };
    assert_eq!(actual_trap, trap, "precise cause and original raw bits");
    if trap.is_none() {
        assert_eq!(exit.code, ExitCode::Fallthrough);
    }
    if exit.retired != 0 {
        assert_eq!(exit.retired, retired);
    }
    assert_eq!(exit.next_pc, want.regs.pc, "virtual fault/success PC");
    got.regs.pc = exit.next_pc; // Dispatch owns PC commit, not the executor.
    let actual = state(got);
    assert_eq!(
        actual,
        state(&mut want),
        "all architectural registers and FP CSRs"
    );
    // Reproducible guest-state digest, excluding the host-only identity/version.
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for word in actual.x.into_iter().chain(actual.f).chain([
        actual.pc,
        u64::from(actual.fflags),
        u64::from(actual.frm),
        actual.mstatus,
        retired,
        trap.map_or(0, |t| t.tval),
    ]) {
        for byte in word.to_le_bytes() {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
        }
    }
    hash
}

pub fn directed(executor: &mut dyn CompiledBlockExecutor) {
    // f0/f31, every sign operation, rd=rs1/rs2/both, raw moves in both directions,
    // and x0 discarded writes are interleaved with a changing integer prefix.
    let words = [
        0x00128293,
        fp(0x10, 0, 0, 1, 2),
        fp(0x10, 1, 31, 0, 31),
        fp(0x10, 2, 1, 1, 0),
        fp(0x70, 0, 0, 0, 0),
        fp(0x78, 0, 0, 0, 0),
        fp(0x70, 0, 3, 31, 0),
        fp(0x78, 0, 31, 3, 0),
        fp(0x10, 0, 31, 31, 31),
    ];
    let mixed = block(DRAM_BASE, &words);
    let raw_move = block(
        DRAM_BASE + 0x100,
        &[fp(0x70, 0, 0, 1, 0), fp(0x70, 0, 3, 1, 0)],
    );
    let write_move = block(DRAM_BASE + 0x200, &[fp(0x78, 0, 0, 1, 0)]);
    let fault = block(
        DRAM_BASE + 0x300,
        &[
            0x00128293,
            fp(0x78, 0, 0, 5, 0),
            0x00012303,
            fp(0x78, 0, 31, 1, 0),
        ],
    );
    for decoded in [&mixed, &raw_move, &write_move, &fault] {
        executor.install(decoded);
        assert!(executor.is_compiled(decoded.phys_start));
    }
    for fs in [1, 2] {
        let mut hart = Hart::default();
        hart.regs.write(1, 0x7fa0_1234);
        hart.fregs.write_raw(0, 0xffff_ffff_7fa0_1234);
        set_fs(&mut hart, fs);
        hart.csr.fflags = 9;
        hart.csr.frm = 7;
        hart.regs.pc = DRAM_BASE + 0x200;
        compare(executor, &write_move, &mut hart);
        assert_eq!(hart.fregs.read_raw(0), 0xffff_ffff_7fa0_1234);
        assert_eq!(hart.csr.fs(), 3, "same-value FP write must still dirty FS");
        assert_eq!(hart.csr.fflags, 9);
        assert_eq!(hart.csr.frm, 7);
    }
    let corners = [
        0x00000000_u64,
        0x80000000,
        0x00000001,
        0x007fffff,
        0x00800000,
        0x3f800000,
        0x7f7fffff,
        0x7f800000,
        0xff800000,
        0x7fc01234,
        0x7f800001,
        0xffc00001,
        0xff800001,
        0xffffffff,
    ];
    let mut digest = 0_u64;
    let mut cases = 0;
    for fs in 0..=3 {
        for frm in 0..=7 {
            for (index, &bits) in corners.iter().enumerate() {
                let mut hart = Hart::default();
                for register in 0..32_u8 {
                    let low = corners[(index + register as usize) % corners.len()];
                    let value = if register % 3 == 0 {
                        low
                    } else {
                        0xffff_ffff_0000_0000 | low
                    };
                    hart.fregs.write_raw(register, value);
                    hart.regs
                        .write(register, bits ^ (u64::from(register) << 32));
                }
                // rs2 is an unmapped fault address only in the faulting fixture.
                hart.regs.write(2, 0xdead_beec);
                set_fs(&mut hart, fs);
                hart.csr.fflags = (index as u8) & 31;
                hart.csr.frm = frm;
                for decoded in [&mixed, &raw_move, &write_move, &fault] {
                    hart.regs.pc = 0x4000_0000 + decoded.phys_start - DRAM_BASE;
                    digest = digest.rotate_left(1) ^ compare(executor, decoded, &mut hart);
                    cases += 1;
                }
            }
        }
    }
    // Varied seeds produce malformed boxes and arbitrary payloads beyond corners.
    for seed in [1_u64, 0xd1ce_f00d, 0x1234_5678_9abc_def0] {
        let mut random = seed;
        let mut hart = Hart::default();
        set_fs(&mut hart, 2);
        for _ in 0..64 {
            for register in 0..32_u8 {
                random ^= random << 13;
                random ^= random >> 7;
                random ^= random << 17;
                let bits = if register & 1 == 0 {
                    random
                } else {
                    random | 0xffff_ffff_0000_0000
                };
                hart.fregs.write_raw(register, bits);
                hart.regs.write(register, random);
            }
            hart.regs.pc = 0x5000_0000;
            digest = digest.rotate_left(1) ^ compare(executor, &mixed, &mut hart);
            cases += 1;
        }
    }
    assert_eq!(cases, 1984);
    eprintln!("FP_MOVES cases={cases} guest_state_fnv64={digest:016x}");
}

pub fn handoff_reuse(executor: &mut dyn CompiledBlockExecutor) {
    let decoded = block(DRAM_BASE, &[fp(0x70, 0, 3, 1, 0)]);
    executor.install(&decoded);
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut hart = Hart::default();
    for bits in [0x80000001_u64, 0x7fc01234, 0xff800123, 0x12345678] {
        // Replace at the SAME address, using the SAME numeric FPR write count.
        hart.fregs = Default::default();
        hart.fregs.write_raw(1, bits);
        set_fs(&mut hart, 2);
        hart.regs.pc = DRAM_BASE;
        executor.execute(DRAM_BASE, &mut hart, &mut bus).unwrap();
        assert_eq!(hart.regs.read(3), bits as u32 as i32 as i64 as u64);
        assert_eq!(hart.csr.fs(), 2, "read-only FMV.X.W preserves FS");

        // Isolate identity from numeric version: the preceding read-only move
        // left the cached FPR version at one. Replace only that register file.
        let previous_stamp = hart.fregs.jit_version();
        let integer_version = hart.regs.jit_version();
        let replacement = bits ^ 0x40000000;
        hart.fregs = Default::default();
        hart.fregs.write_raw(1, replacement);
        assert_eq!(hart.fregs.jit_version().1, previous_stamp.1);
        assert_ne!(hart.fregs.jit_version().0, previous_stamp.0);
        assert_eq!(hart.regs.jit_version(), integer_version);
        hart.regs.pc = DRAM_BASE;
        executor.execute(DRAM_BASE, &mut hart, &mut bus).unwrap();
        assert_eq!(
            hart.regs.read(3),
            replacement as u32 as i32 as i64 as u64,
            "equal numeric FPR versions cannot alias different register files"
        );

        // Changing only FS must refresh control even when both register-bank
        // versions match the state committed by the preceding compiled call.
        set_fs(&mut hart, 0);
        hart.regs.pc = DRAM_BASE;
        let before_disabled = state(&mut hart);
        let exit = executor.execute(DRAM_BASE, &mut hart, &mut bus).unwrap();
        assert_eq!(exit.code, ExitCode::IllegalInstruction);
        assert_eq!(exit.exit_info, u64::from(fp(0x70, 0, 3, 1, 0)));
        assert_eq!(exit.next_pc, DRAM_BASE);
        assert_eq!(exit.retired, 0);
        assert_eq!(state(&mut hart), before_disabled);
        set_fs(&mut hart, 2);

        // An interpreted FP-only mutation must invalidate retained FPR bytes.
        hart.regs.write(1, bits ^ 0xffffffff);
        hart.exec_oracle(
            &mut bus,
            decode(fp(0x78, 0, 1, 1, 0)).unwrap(),
            4,
            u64::from(fp(0x78, 0, 1, 1, 0)),
        )
        .unwrap();
        hart.regs.pc = DRAM_BASE;
        executor.execute(DRAM_BASE, &mut hart, &mut bus).unwrap();
        assert_eq!(
            hart.regs.read(3),
            (bits as u32 ^ 0xffffffff) as i32 as i64 as u64
        );
        assert_eq!(hart.fregs.read_raw(1) >> 32, 0xffffffff);
    }
    eprintln!("FP_MOVES handoff equal-version replacements=4 CSR-only FS-Off rechecks=4");
}

pub fn runloop(mut executor: Box<dyn CompiledBlockExecutor>) {
    use wasm_vm_core::bus::Bus;
    use wasm_vm_core::csr::{MCAUSE, MEPC, MTVAL, MTVEC};
    use wasm_vm_core::{Machine, RunOutcome};
    let programs = [
        [0x00128293, fp(0x10, 1, 0, 1, 2), 0x00100073],
        [fp(0x78, 0, 0, 5, 0), 0x00012303, 0x00100073],
    ];
    for words in &programs {
        executor.install(&block(
            DRAM_BASE + (words == &programs[1]) as u64 * 0x100,
            words,
        ));
    }
    let mut machine = Machine::new(64 * 1024);
    for (i, words) in programs.iter().enumerate() {
        for (j, word) in words.iter().enumerate() {
            machine
                .bus_mut()
                .store32(DRAM_BASE + i as u64 * 0x100 + j as u64 * 4, *word)
                .unwrap();
        }
    }
    machine
        .bus_mut()
        .store32(DRAM_BASE + 0x400, 0x30002073)
        .unwrap();
    machine
        .hart_mut()
        .csr
        .access(MTVEC, CsrOp::Write, DRAM_BASE + 0x400, false, false, 0)
        .unwrap();
    machine.set_block_cache(true);
    machine.set_interrupt_batching(true);
    machine.set_hotness_threshold(1);
    machine.set_executor(executor);
    machine.set_jit(true);
    for (index, words) in programs.iter().enumerate() {
        let pc = DRAM_BASE + index as u64 * 0x100;
        // One warm run populates core block metadata; the target is explicitly installed above.
        set_fs(machine.hart_mut(), 2);
        machine.hart_mut().regs.pc = pc;
        machine.run(3);
        machine.hart_mut().regs.pc = pc;
        machine.hart_mut().regs.write(5, 41);
        machine.hart_mut().regs.write(2, 0xdead_beec);
        machine.hart_mut().fregs.write_raw(0, 0x123456789abcdef0);
        machine.hart_mut().csr.fflags = 9;
        machine.hart_mut().csr.frm = 7;
        set_fs(machine.hart_mut(), if index == 0 { 0 } else { 2 });
        let before = machine.executor().unwrap().executed_blocks();
        let retired = machine.executor().unwrap().retired_via_jit();
        assert_eq!(machine.run(3), RunOutcome::MaxInstrs);
        assert!(
            machine.executor().unwrap().executed_blocks() > before,
            "precise trap must actually run compiled code"
        );
        assert_eq!(
            machine.executor().unwrap().retired_via_jit() - retired,
            1,
            "only the exact prefix retires through JIT"
        );
        assert_eq!(machine.hart_mut().csr.read(MEPC), pc + 4);
        assert_eq!(
            machine.hart_mut().csr.read(MCAUSE),
            if index == 0 { 2 } else { 5 }
        );
        assert_eq!(
            machine.hart_mut().csr.read(MTVAL),
            if index == 0 {
                u64::from(words[1])
            } else {
                0xdead_beec
            }
        );
        assert_eq!(
            machine.hart().regs.read(5),
            if index == 0 { 42 } else { 41 }
        );
        assert_eq!(
            machine.hart().fregs.read_raw(0),
            if index == 0 {
                0x123456789abcdef0
            } else {
                0xffffffff00000029
            }
        );
        assert_eq!(machine.hart().csr.fflags, 9);
        assert_eq!(machine.hart().csr.frm, 7);
        assert_eq!(machine.hart().csr.fs(), if index == 0 { 0 } else { 3 });
        eprintln!(
            "FP_MOVES precise prefix=1 pc={:016x} cause={} tval={:016x}",
            pc + 4,
            machine.hart_mut().csr.read(MCAUSE),
            machine.hart_mut().csr.read(MTVAL)
        );
    }
}
