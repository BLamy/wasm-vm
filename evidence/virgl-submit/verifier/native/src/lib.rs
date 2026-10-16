// Existing acceptance is replayed for exact-source native coverage; the tests
// below add independent cached-instruction and page-boundary correctness checks.
#[cfg(test)]
#[path = "../../../../../crates/core/tests/virtio_gpu_submit3d.rs"]
mod worker_acceptance;
#[cfg(test)]
#[path = "../../../../../crates/core/tests/virtio_gpu_control3d.rs"]
mod prior_control_acceptance;

#[cfg(test)]
mod independent {
    use wasm_vm_core::{Machine, RunOutcome, bus::{Bus, BusFault}, platform::virt};

    #[test]
    fn bulk_dma_invalidates_a_saved_middle_page_instruction() {
        for start_delta in [1u64, 17, 4093] {
            let mut machine = Machine::new(1024 * 1024);
            machine.set_block_cache(true);
            let code = virt::DRAM_BASE + 0x4300;
            // addi x5,x5,1; addi x6,x6,1; jal x0,-8
            for (i, word) in [0x0012_8293u32, 0x0013_0313, 0xff9f_f06f].into_iter().enumerate() {
                machine.bus_mut().store32(code + (i * 4) as u64, word).unwrap();
            }
            machine.hart_mut().regs.pc = code;
            assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
            assert_eq!(machine.hart().regs.read(5), 1);
            assert_eq!(machine.hart().regs.pc, code + 4);
            let start = virt::DRAM_BASE + 0x2000 + start_delta;
            let mut bytes = vec![0u8; 0x5000];
            machine.bus_mut().ram().read_slice(start, &mut bytes).unwrap();
            let at = (code + 4 - start) as usize;
            // The changed instruction is on a middle frame, not a span endpoint.
            bytes[at..at + 4].copy_from_slice(&0x00b3_0313u32.to_le_bytes());
            machine.bus_mut().write_ram_slice(start, &bytes).unwrap();
            let logged = machine.bus_mut().code_write_log_mut().clone();
            assert!(logged.contains(&((code + 4) >> 12)));
            assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
            assert_eq!(machine.hart().regs.read(6), 11, "saved cached instruction must be discarded");
            println!("INDEPENDENT_SMC start={start:#x} changed={:#x} frames={logged:?} x6={} digest={}", code + 4, machine.hart().regs.read(6), machine.snapshot().hex_digest());
        }
    }

    #[test]
    fn absent_gpu_dma_is_structured_failure() {
        use wasm_vm_core::dev::virtio::gpu::{control3d::{Control3dId,Control3dError},submit3d::*};
        let mut machine=Machine::new(65536);
        let exchange=Submit3dExchange{key:Submit3dKey{epoch:1,sequence:1},exchange_sequence:1,backing:Submit3dBacking{resource:Control3dId{id:1,generation:1},generation:1},rows:Submit3dRows{offset:0,row_bytes:1,row_stride:1,row_count:1}};
        assert_eq!(machine.submit3d_gather(&exchange),Err(Control3dError::InvalidParameter));
        assert_eq!(machine.submit3d_scatter(&exchange,&[1]),Err(Control3dError::InvalidParameter));
    }

    #[test]
    fn bulk_dma_literal_endpoints_and_rejection_are_failure_atomic() {
        let mut machine = Machine::new(0x10000);
        machine.bus_mut().arm_code_write_tracking(true);
        let base = virt::DRAM_BASE;
        for (offset, len, expected) in [(0xfffu64, 2usize, vec![base >> 12, (base >> 12) + 1]), (0x2000, 0x2000, vec![(base >> 12) + 2, (base >> 12) + 3]), (0x4000, 0, vec![])] {
            machine.bus_mut().code_write_log_mut().clear();
            let bytes: Vec<_> = (0..len).map(|i| ((i * 19 + 3) % 251) as u8).collect();
            machine.bus_mut().write_ram_slice(base + offset, &bytes).unwrap();
            assert_eq!(*machine.bus_mut().code_write_log_mut(), expected);
            let mut actual = vec![0; len]; machine.bus_mut().ram().read_slice(base + offset, &mut actual).unwrap(); assert_eq!(actual, bytes);
        }
        for address in [base - 1, base + 0xffff, u64::MAX] {
            let before = machine.snapshot().hex_digest();
            let log = machine.bus_mut().code_write_log_mut().clone();
            assert_eq!(machine.bus_mut().write_ram_slice(address, &[0x79; 2]), Err(BusFault::Access));
            assert_eq!(machine.snapshot().hex_digest(), before);
            assert_eq!(*machine.bus_mut().code_write_log_mut(), log);
        }
    }
}
