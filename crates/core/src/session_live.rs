//! Live owned-provider control with capture disabled. These counters measure actual
//! execution work; they are not a SessionClock, event cursor, or replayable checkpoint.
use crate::Machine;
#[cfg(not(feature = "zicsr-stub"))]
use crate::session_clock::SessionError;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LiveWork {
    pub transitions: u64,
    pub retired: u64,
    pub idle_transitions: u64,
    #[cfg(not(feature = "zicsr-stub"))]
    pub(crate) idle_pending: bool,
}

impl Machine {
    pub fn live_unrecorded_work(&self) -> Option<LiveWork> {
        self.live_unrecorded
    }

    pub fn recorder_dirty_tracking(&self) -> bool {
        self.bus.ram().recorder_dirty_tracking()
    }

    #[cfg(feature = "virgl-renderer")]
    pub fn enable_live_unrecorded_gpu_transport(
        &mut self,
    ) -> Result<(), crate::dev::virtio::gpu::control3d::Control3dError> {
        use crate::dev::virtio::gpu::control3d::Control3dError;
        if self
            .live_unrecorded
            .is_none_or(|work| work.transitions != 0)
            || self.session_gpu.is_some()
        {
            return Err(Control3dError::InvalidParameter);
        }
        let state = self
            .gpu
            .as_ref()
            .ok_or(Control3dError::InvalidParameter)?
            .0
            .clone();
        state.borrow_mut().enable_owned_live_transport()
    }

    /// Original-request capabilities authorize the caller. No logical result tape or payload
    /// hash/history is constructed: ordinary checked DMA still validates every row and generation.
    #[cfg(feature = "virgl-renderer")]
    pub fn live_unrecorded_gpu_dma(
        &mut self,
        exchange: &crate::dev::virtio::gpu::submit3d::Submit3dExchange,
        output: Option<&[u8]>,
        layers: Option<(u32, u32)>,
    ) -> Result<alloc::vec::Vec<u8>, crate::dev::virtio::gpu::control3d::Control3dError> {
        use crate::dev::virtio::gpu::{self, control3d::Control3dError};
        if self.live_unrecorded.is_none()
            || self.session_gpu.is_some()
            || !self.host_ingress_gate.allows_host()
        {
            return Err(Control3dError::InvalidParameter);
        }
        let (state, _, _, index) = self.gpu.as_ref().ok_or(Control3dError::InvalidParameter)?;
        let bytes = gpu::submit3d_dma(
            &self.virtio[*index].0,
            state,
            &mut self.bus,
            exchange,
            output,
            layers,
        )?;
        if output.is_none() && layers.is_none() {
            state.borrow_mut().mirror_legacy_input(exchange, &bytes)?;
        }
        Ok(bytes)
    }

    #[cfg(not(feature = "zicsr-stub"))]
    pub(crate) fn start_live_unrecorded(&mut self) -> Result<(), SessionError> {
        if self.live_unrecorded.is_some()
            || self.session_clock.is_some()
            || self.session_sources_active()
        {
            return Err(SessionError::AlreadyActive);
        }
        if self.guest_clock_mode() != crate::time::TimeMode::ICount {
            return Err(SessionError::UnsupportedScheduling);
        }
        self.bus
            .ram_mut()
            .disable_recorder_dirty_tracking()
            .map_err(|_| SessionError::PendingUndrained)?;
        self.live_unrecorded = Some(LiveWork::default());
        Ok(())
    }

    pub(crate) fn live_work_budget(&self, requested: u64) -> u64 {
        self.live_unrecorded.map_or(requested, |work| {
            requested
                .min(u64::MAX - work.transitions)
                .min(u64::MAX - work.retired)
        })
    }

    #[cfg(not(feature = "zicsr-stub"))]
    pub(crate) fn prepare_live_work(&mut self) -> Result<bool, SessionError> {
        if self.live_unrecorded.is_some()
            && self.guest_clock_mode() != crate::time::TimeMode::ICount
        {
            return Err(SessionError::UnsupportedScheduling);
        }
        let Some(work) = self.live_unrecorded.as_mut() else {
            return Ok(false);
        };
        if work.transitions == u64::MAX {
            return Err(SessionError::TransitionExhausted);
        }
        if work.retired == u64::MAX {
            return Err(SessionError::RetiredExhausted);
        }
        let idle = core::mem::take(&mut work.idle_pending);
        if idle && !self.external_wake_io_pending() {
            self.sync_clint();
            self.sync_sbi_timer();
            let before = self.clint_mtime();
            self.wfi_fast_forward();
            if self.clint_mtime() != before {
                self.advance_live_work(1, 0);
                self.live_unrecorded.as_mut().unwrap().idle_transitions += 1;
                return Ok(true);
            }
        }
        Ok(false)
    }

    #[cfg(not(feature = "zicsr-stub"))]
    #[inline]
    pub(crate) fn advance_live_work(&mut self, transitions: u64, retired: u64) {
        if let Some(work) = self.live_unrecorded.as_mut() {
            work.transitions = work
                .transitions
                .checked_add(transitions)
                .expect("reserved live work span");
            work.retired = work
                .retired
                .checked_add(retired)
                .expect("reserved live retire span");
        }
    }
}

#[cfg(all(test, not(feature = "zicsr-stub")))]
mod tests {
    use super::*;
    use crate::{
        RunOutcome,
        bus::Bus,
        csr::{CsrOp, Priv},
        platform::virt,
        session_devices::{BaseDisk, CompletionStatus, DeviceError, PayloadRef},
        session_network::{NetworkError, NetworkEvent, SendResult},
    };

    fn program(words: &[u32], off: bool, optimized: bool) -> Machine {
        let mut machine = Machine::new(1 << 20);
        machine.hart.regs.pc = virt::DRAM_BASE;
        for (index, word) in words.iter().enumerate() {
            machine
                .bus
                .store32(virt::DRAM_BASE + index as u64 * 4, *word)
                .unwrap();
        }
        machine.set_block_cache(optimized);
        machine.set_interrupt_batching(optimized);
        if off {
            machine.start_live_unrecorded().unwrap();
        }
        machine
    }

    #[test]
    fn live_work_counts_real_tail_retires_across_chunk_partitions() {
        let words = [0x00108093, 0x00210113, 0x00318193, 0xff5ff06f];
        for optimized in [false, true] {
            let mut off = program(&words, true, optimized);
            let mut ordinary = program(&words, false, optimized);
            let mut total = 0;
            for amount in [1, 17, 63, 4096, 1337] {
                assert!(matches!(off.run(amount), RunOutcome::MaxInstrs));
                assert!(matches!(ordinary.run(amount), RunOutcome::MaxInstrs));
                total += amount;
                let work = off.live_unrecorded_work().unwrap();
                assert_eq!((work.transitions, work.retired), (total, total));
                assert_eq!(off.snapshot(), ordinary.snapshot());
            }
            if optimized {
                assert!(
                    off.replay_tail_ops > 0,
                    "the optimized retirement tail must really execute"
                );
            }
        }
    }

    #[test]
    fn live_work_counts_interrupt_exception_sbi_and_escaping_attempts() {
        let mut interrupted = program(&[0x00108093], true, false);
        interrupted.enable_clint(10).borrow_mut().mtimecmp = 0;
        interrupted
            .hart
            .csr
            .access(0x305, CsrOp::Write, virt::DRAM_BASE + 64, false, true, 0)
            .unwrap();
        interrupted
            .hart
            .csr
            .access(0x304, CsrOp::Write, 1 << 7, false, true, 0)
            .unwrap();
        interrupted.hart.csr.mstatus |= 1 << 3;
        assert!(matches!(interrupted.run(1), RunOutcome::MaxInstrs));
        assert_eq!(interrupted.hart.regs.pc, virt::DRAM_BASE + 64);
        assert_eq!(
            (
                interrupted.live_unrecorded.unwrap().transitions,
                interrupted.live_unrecorded.unwrap().retired
            ),
            (1, 0)
        );
        let mut trapped = program(&[0x00000073], true, false);
        trapped
            .hart
            .csr
            .access(0x305, CsrOp::Write, virt::DRAM_BASE + 64, false, true, 0)
            .unwrap();
        assert!(matches!(trapped.run(1), RunOutcome::MaxInstrs));
        assert_eq!(
            (
                trapped.live_unrecorded.unwrap().transitions,
                trapped.live_unrecorded.unwrap().retired
            ),
            (1, 0)
        );
        let mut sbi = program(&[0x00000073, 0x00108093], true, false);
        sbi.enable_builtin_sbi();
        sbi.hart
            .csr
            .access(0x3b0, CsrOp::Write, u64::MAX, false, true, 0)
            .unwrap();
        sbi.hart
            .csr
            .access(0x3a0, CsrOp::Write, 0x1f, false, true, 0)
            .unwrap();
        sbi.hart.csr.mode = Priv::S;
        sbi.hart.regs.write(17, 0x10);
        assert!(matches!(sbi.run(2), RunOutcome::MaxInstrs));
        assert_eq!(
            (
                sbi.live_unrecorded.unwrap().transitions,
                sbi.live_unrecorded.unwrap().retired
            ),
            (2, 1)
        );
        let mut escaping = program(&[0x00000073], true, false);
        assert!(matches!(escaping.run(10), RunOutcome::Trapped(_)));
        assert_eq!(
            (
                escaping.live_unrecorded.unwrap().transitions,
                escaping.live_unrecorded.unwrap().retired
            ),
            (1, 0)
        );
    }

    #[test]
    fn live_idle_is_a_separate_real_work_slot_before_the_next_instruction() {
        let mut machine = program(&[0x10500073, 0x00108093], true, false);
        machine.enable_clint(10);
        machine.enable_builtin_sbi();
        machine.sbi_state.stimecmp = 7;
        machine.run(1);
        assert_eq!(
            (
                machine.live_unrecorded.unwrap().transitions,
                machine.live_unrecorded.unwrap().retired
            ),
            (1, 1)
        );
        machine.run(1);
        let work = machine.live_unrecorded.unwrap();
        assert_eq!(
            (work.transitions, work.retired, work.idle_transitions),
            (2, 1, 1)
        );
        assert_eq!(machine.hart.regs.pc, virt::DRAM_BASE + 4);
        assert_eq!(machine.clint_mtime(), 7);
        machine.run(1);
        assert_eq!(
            (
                machine.live_unrecorded.unwrap().transitions,
                machine.live_unrecorded.unwrap().retired
            ),
            (3, 2)
        );
    }

    #[test]
    fn live_counter_exhaustion_and_history_misuse_refuse_before_mutation() {
        let mut machine = program(&[0x00108093, 0xffdff06f], true, true);
        machine.live_unrecorded.as_mut().unwrap().transitions = u64::MAX - 3;
        assert!(matches!(machine.run(1000), RunOutcome::MaxInstrs));
        assert_eq!(machine.live_unrecorded.unwrap().transitions, u64::MAX);
        assert_eq!(machine.live_unrecorded.unwrap().retired, 3);
        let before = machine.snapshot();
        assert!(matches!(
            machine.run(1),
            RunOutcome::SessionStopped(SessionError::TransitionExhausted)
        ));
        assert_eq!(machine.snapshot(), before);
        assert_eq!(
            machine.start_session_clock(1),
            Err(SessionError::AlreadyActive)
        );
        assert_eq!(
            machine.start_session_clock_with_sources(machine.source_policy(), None),
            Err(SessionError::AlreadyActive)
        );
        assert_eq!(
            machine.save_session_resume(),
            Err(crate::resume::SnapshotError::UnrecordedControl)
        );
        assert_eq!(
            machine.load_session_resume(&[]),
            Err(crate::resume::SnapshotError::UnrecordedControl)
        );
        assert_eq!(
            machine.seed_session_ram_from_full_resume(&[]),
            Err(crate::resume::SnapshotError::UnrecordedControl)
        );
        assert_eq!(
            machine.apply_session_ram_delta_chunk(&[]),
            Err(crate::ram::RamDeltaError::NotCapturing)
        );
        assert!(!machine.recorder_dirty_tracking());
        assert!(machine.bus.ram_mut().begin_dirty_epoch().is_err());
        assert!(!machine.session_sources_active());
        assert_eq!(
            machine.take_session_deliveries(),
            Err(SessionError::Inactive)
        );
        assert_eq!(machine.snapshot(), before);
    }

    #[test]
    fn live_owned_device_and_network_leases_apply_without_a_recorder() {
        let data = alloc::vec![0x5a;4096];
        let base = BaseDisk {
            identity: [7; 32],
            sectors: 8,
            chunk_bytes: 4096,
            chunks: alloc::vec![PayloadRef::of(&data).unwrap()],
        };
        let mut off = program(&[0x00000013], true, false);
        off.enable_session_devices(Some(base.clone()), false, false, false)
            .unwrap();
        off.enable_session_network(false).unwrap();
        let block = off.blk.as_ref().unwrap().0.clone();
        let mut bytes = [0u8; 512];
        assert!(matches!(
            block.borrow_mut().backend.read(0, &mut bytes),
            Err(crate::block::BlockError::WouldBlock { .. })
        ));
        let request = off.session_device_requests().unwrap().remove(0);
        let lease = off.lease_session_device(request.id).unwrap();
        off.complete_session_device(&lease, CompletionStatus::Supplied, 0, data.clone())
            .unwrap();
        block.borrow_mut().backend.read(0, &mut bytes).unwrap();
        assert_eq!(bytes, [0x5a; 512]);
        assert_eq!(off.session_device_cursor(), Ok(1));
        let mut other = program(&[0x00000013], true, false);
        other
            .enable_session_devices(Some(base), false, false, false)
            .unwrap();
        assert_eq!(
            other.complete_session_device(&lease, CompletionStatus::Supplied, 0, data),
            Err(DeviceError::StaleLease)
        );
        off.net
            .as_ref()
            .unwrap()
            .0
            .borrow_mut()
            .backend
            .tx(&[0x33; 64]);
        let request = off.session_network_requests().unwrap().remove(0);
        let lease = off.lease_session_network(Some(request.id)).unwrap();
        off.complete_session_network(
            &lease,
            NetworkEvent::Send {
                request,
                result: SendResult::Sent,
            },
        )
        .unwrap();
        assert!(off.session_network_requests().unwrap().is_empty());
        assert_eq!(off.session_network_cursor(), Ok(1));
        other.enable_session_network(false).unwrap();
        let foreign = other.lease_session_network(None).unwrap();
        assert_eq!(
            off.complete_session_network(&foreign, NetworkEvent::Pending(false)),
            Err(NetworkError::StaleLease)
        );
        assert_eq!(off.session_position(), None);
        assert_eq!(off.take_session_deliveries(), Err(SessionError::Inactive));
        assert_eq!(off.live_unrecorded.unwrap().transitions, 0);
    }
    #[test]
    fn live_keyboard_wake_prevents_a_timer_jump_before_the_next_host_frame() {
        use crate::dev::virtio::input::EV_KEY;
        let mut machine = program(&[0x10500073, 0x00108093], true, false);
        machine.enable_clint(10);
        machine.enable_builtin_sbi();
        machine.sbi_state.stimecmp = 7;
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        machine.enable_virtio_keyboard();
        assert!(
            machine
                .keyboard_input()
                .unwrap()
                .borrow_mut()
                .inject_event(EV_KEY, 30, 1)
        );
        assert!(matches!(machine.run(2), RunOutcome::MaxInstrs));
        let work = machine.live_unrecorded_work().unwrap();
        assert_eq!(
            (work.transitions, work.retired, work.idle_transitions),
            (2, 2, 0)
        );
        assert_eq!(
            machine.clint_mtime(),
            0,
            "host keyboard frame must precede the idle timer jump"
        );
        assert_eq!(machine.hart.regs.pc, virt::DRAM_BASE + 8);
    }

    #[test]
    fn live_guest_trace_and_code_write_coherence_do_not_depend_on_dirty_history() {
        use crate::trace::{HashSink, TraceRecord, TraceSink, fmt_canonical};
        use core::fmt::Write;
        #[derive(Default)]
        struct EvidenceSink {
            hash: HashSink,
            text: alloc::string::String,
        }
        impl TraceSink for EvidenceSink {
            fn retire(&mut self, record: &TraceRecord) {
                self.hash.retire(record);
                writeln!(self.text, "{}", fmt_canonical(record)).unwrap();
            }
        }
        let words = [0x00108093, 0x00210113, 0xff9ff06f];
        let mut live = program(&words, true, false);
        let mut recorded = program(&words, false, false);
        recorded.start_session_clock(1).unwrap();
        let mut live_trace = EvidenceSink::default();
        let mut record_trace = EvidenceSink::default();
        live.run_traced(4096, &mut live_trace);
        recorded.run_traced(4096, &mut record_trace);
        assert_eq!(live_trace.hash.retired(), 4096);
        assert_eq!(live_trace.hash.hash(), record_trace.hash.hash());
        assert_eq!(live_trace.text, record_trace.text);
        assert_eq!(live.snapshot(), recorded.snapshot());
        println!(
            "E9_LIVE_GUEST_TRACE retired={} hash={:016x} ram={} pc={:016x}",
            live_trace.hash.retired(),
            live_trace.hash.hash(),
            live.snapshot().hex_digest(),
            live.hart.regs.pc
        );
        #[cfg(feature = "std")]
        if let Some(directory) = std::env::var_os("E9_UNRECORDED_TRACE_DIR") {
            let directory = std::path::PathBuf::from(directory);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("off.trace"), &live_trace.text).unwrap();
            std::fs::write(directory.join("record.trace"), &record_trace.text).unwrap();
            std::fs::write(
                directory.join("architectural-digest.txt"),
                live.snapshot().hex_digest(),
            )
            .unwrap();
        }
        let mut cached = program(&[0x00100093, 0xffdff06f], true, true);
        cached.run(2);
        assert_eq!(cached.hart.regs.read(1), 1);
        cached.bus.store32(virt::DRAM_BASE, 0x00200093).unwrap();
        cached.run(2);
        assert_eq!(
            cached.hart.regs.read(1),
            2,
            "CPU/host stores must still invalidate decoded code"
        );
        cached
            .bus
            .write_ram_slice(virt::DRAM_BASE, &0x00300093u32.to_le_bytes())
            .unwrap();
        cached.run(1);
        assert_eq!(
            cached.hart.regs.read(1),
            3,
            "DMA stores must still invalidate decoded code"
        );
        assert!(!cached.recorder_dirty_tracking());
        assert!(cached.bus.ram_mut().begin_dirty_epoch().is_err());
    }
}
