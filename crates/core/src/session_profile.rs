//! Fixed full-system software profile for exact RV64 Linux sessions. The browser and native
//! acceptance path install the same guest topology before either boot or resume.
use alloc::{boxed::Box, rc::Rc};
use core::cell::RefCell;

use crate::{
    Machine,
    dev::{rtc::WallClock, uart16550::Uart16550, virtio::rng::EntropySource},
    session_clock::SessionError,
    session_devices::{BaseDisk, DeviceError},
    session_network::NetworkError,
    time::TimeMode,
};

pub const RAM_BYTES: usize = 256 << 20;
pub const AGENT_SLOT: usize = crate::platform::virt::VIRTIO_COUNT as usize - 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileError {
    Unsupported,
    Clock(SessionError),
    Device(DeviceError),
    Network(NetworkError),
}

impl Machine {
    /// Install the production software device map, with every asynchronous block, agent and
    /// network result owned by the session boundary. No host transport is opened here. The
    /// caller must install the source tape (record or replay), then boot or restore before run.
    pub fn install_full_software_session(
        &mut self,
        base: BaseDisk,
        rtc: Box<dyn WallClock>,
        entropy: Box<dyn EntropySource>,
        core_hash: [u8; 32],
        replay: bool,
    ) -> Result<Rc<RefCell<Uart16550>>, ProfileError> {
        if self.ram_len() != RAM_BYTES
            || self.guest_clock_mode() != TimeMode::ICount
            || self.session_position().is_some()
        {
            return Err(ProfileError::Unsupported);
        }
        base.validate().map_err(ProfileError::Device)?;
        self.set_snapshot_identity(core_hash, base.identity);
        self.enable_clint(10);
        self.enable_plic();
        self.enable_rtc(rtc);
        self.enable_syscon();
        let uart = self.enable_uart16550();
        self.start_session_clock(1).map_err(ProfileError::Clock)?;
        self.enable_session_devices_at(Some(base), true, false, replay, AGENT_SLOT)
            .map_err(ProfileError::Device)?;
        self.enable_session_network(replay)
            .map_err(ProfileError::Network)?;
        self.enable_virtio_rng(entropy);
        self.enable_virtio_keyboard();
        if let Some(keyboard) = self.keyboard_input() {
            keyboard.borrow_mut().set_pending_event_budget(
                crate::dev::virtio::input::keyboard::INTERACTIVE_PENDING_EVENT_BUDGET,
            );
        }
        self.enable_virtio_pointer();
        self.enable_virtio_snd();
        if self
            .enable_virtio_gpu(Box::new(crate::dev::virtio::gpu::NullSink))
            .is_none()
        {
            return Err(ProfileError::Unsupported);
        }
        self.enable_builtin_sbi();
        if replay {
            self.host_ingress_gate.begin_replay();
        }
        Ok(uart)
    }
}
