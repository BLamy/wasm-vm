//! The virtio-gpu identity/configuration boundary (Epic 5, E5-T01a).
//!
//! The device is enumerable through virtio-mmio, exposes the fixed virtio-gpu configuration
//! registers, and keeps the protocol wire formats in [`protocol`]. E5-T02a adds the first
//! host-owned resource store and CREATE_2D command; later slices add backing and presentation.

pub mod edid;
pub mod protocol;
pub mod resources;

use alloc::boxed::Box;
use alloc::rc::Rc;
use alloc::vec::Vec;
use core::cell::RefCell;

use super::VirtioDevice;
use super::mmio::VirtioMmio;
use super::queue::{DescriptorChain, Virtqueue};
use crate::bus::Bus;
use crate::mmio::SystemBus;

pub use protocol::Rect;

/// One presentation event captured by [`TestSink`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FlushRecord {
    pub scanout: Option<u32>,
    pub rect: Rect,
    pub resource_width: u32,
    pub resource_height: u32,
    pub crc32: u32,
}

/// In-memory presentation sink for deterministic native and wasm tests.
#[derive(Clone, Default)]
pub struct TestSink {
    records: Rc<RefCell<Vec<FlushRecord>>>,
}

impl TestSink {
    /// Construct an empty recording sink.
    pub fn new() -> Self {
        Self::default()
    }

    /// Return an owned snapshot so callers cannot mutate the sink's records through an alias.
    pub fn records(&self) -> Vec<FlushRecord> {
        self.records.borrow().clone()
    }

    /// Number of flushes recorded so far.
    pub fn len(&self) -> usize {
        self.records.borrow().len()
    }

    /// Whether no flushes have been recorded yet.
    pub fn is_empty(&self) -> bool {
        self.records.borrow().is_empty()
    }
}

impl FrameSink for TestSink {
    fn flush(
        &mut self,
        scanout: Option<u32>,
        rect: Rect,
        resource_width: u32,
        resource_height: u32,
        pixels: &[u32],
    ) {
        self.records.borrow_mut().push(FlushRecord {
            scanout,
            rect,
            resource_width,
            resource_height,
            crc32: crc32_pixels(pixels),
        });
    }
}

/// CRC-32/IEEE of a resource-sized pixel view in deterministic little-endian byte order.
fn crc32_pixels(pixels: &[u32]) -> u32 {
    let mut crc = 0xffff_ffff;
    for pixel in pixels {
        for byte in pixel.to_le_bytes() {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                let mask = 0u32.wrapping_sub(crc & 1);
                crc = (crc >> 1) ^ (0xedb8_8320 & mask);
            }
        }
    }
    !crc
}

/// Core-to-host presentation boundary for a flushed resource rectangle.
///
/// The core passes native-endian host shadow pixels only after all guest-memory validation and
/// transfer work has completed. `scanout` is `Some(id)` when the resource is currently bound to
/// that scanout and `None` for a legal flush of an unbound resource. Browser-specific color
/// conversion and presentation scheduling belong to the sink implementation, not this trait.
pub trait FrameSink {
    /// Publish one validated damage rectangle and its resource-sized pixel view.
    fn flush(
        &mut self,
        scanout: Option<u32>,
        rect: Rect,
        resource_width: u32,
        resource_height: u32,
        pixels: &[u32],
    );
}

/// Headless sink used by default and by native boot paths that do not present a window.
#[derive(Debug, Default)]
pub struct NullSink;

impl FrameSink for NullSink {
    fn flush(
        &mut self,
        _scanout: Option<u32>,
        _rect: Rect,
        _resource_width: u32,
        _resource_height: u32,
        _pixels: &[u32],
    ) {
    }
}

/// Virtio device type assigned to a GPU (virtio spec 1.2 §5.7).
pub const VIRTIO_GPU_DEVICE_ID: u32 = 16;
/// `VIRTIO_GPU_F_EDID`: the device implements the GET_EDID command.
pub const VIRTIO_GPU_F_EDID: u64 = 1 << 1;
/// `VIRTIO_GPU_EVENT_DISPLAY`: the display configuration changed.
pub const VIRTIO_GPU_EVENT_DISPLAY: u32 = 1 << 0;
/// Initial virtual canvas width.
pub const DEFAULT_DISPLAY_WIDTH: u32 = 1280;
/// Initial virtual canvas height.
pub const DEFAULT_DISPLAY_HEIGHT: u32 = 800;
/// Initial virtual canvas refresh rate.
pub const DEFAULT_DISPLAY_REFRESH_HZ: u32 = edid::DEFAULT_REFRESH_HZ;
/// The initial device has one scanout; later display work may make this configurable.
pub const DEFAULT_NUM_SCANOUTS: u32 = 1;
/// E5-T01a exposes no 3D capsets.
pub const DEFAULT_NUM_CAPSETS: u32 = 0;

const CONFIG_LEN: usize = 16;

/// Shared state between the transport-facing device and the run-loop service.
pub struct GpuState {
    events_read: u32,
    display_width: u32,
    display_height: u32,
    display_refresh_hz: u32,
    edid: [u8; edid::EDID_BLOCK_SIZE],
    config_irq_pending: bool,
    kicked: bool,
    reset_pending: bool,
    /// Host-owned 2D resource store. Backing entries are added by E5-T02b.
    pub resources: resources::ResourceMap,
    /// Resource currently bound to scanout 0, if any. SET_SCANOUT is owned by E5-T03;
    /// RESOURCE_UNREF clears this before dropping a bound resource.
    pub scanout_resource: Option<u32>,
    /// Core-to-host presentation boundary. The default is [`NullSink`], so a headless device
    /// never allocates or calls into browser-specific code.
    pub frame_sink: Box<dyn FrameSink>,
    /// Number of valid GET_DISPLAY_INFO requests completed by the service.
    pub commands_served: u64,
}

impl GpuState {
    fn new(sink: Box<dyn FrameSink>) -> Self {
        Self {
            events_read: 0,
            display_width: DEFAULT_DISPLAY_WIDTH,
            display_height: DEFAULT_DISPLAY_HEIGHT,
            display_refresh_hz: DEFAULT_DISPLAY_REFRESH_HZ,
            edid: edid::edid_for(
                DEFAULT_DISPLAY_WIDTH,
                DEFAULT_DISPLAY_HEIGHT,
                DEFAULT_DISPLAY_REFRESH_HZ,
            ),
            config_irq_pending: false,
            kicked: false,
            reset_pending: false,
            resources: resources::ResourceMap::new(),
            scanout_resource: None,
            frame_sink: sink,
            commands_served: 0,
        }
    }

    /// Current width and height advertised in pmode 0 and the preferred EDID timing.
    pub fn display_size(&self) -> (u32, u32) {
        (self.display_width, self.display_height)
    }

    /// Current preferred refresh rate in hertz.
    pub fn display_refresh_hz(&self) -> u32 {
        self.display_refresh_hz
    }

    /// Copy the current EDID base block for host-side inspection.
    pub fn edid(&self) -> [u8; edid::EDID_BLOCK_SIZE] {
        self.edid
    }

    /// Apply a host display-size change and coalesce its config interrupt until the guest clears
    /// `EVENT_DISPLAY`.  The final dimensions/EDID are always retained even when several changes
    /// arrive before the transport gets a chance to signal the first one.
    pub fn set_display(&mut self, width: u32, height: u32) {
        let width = width.clamp(1, edid::MAX_EDID_DIMENSION);
        let height = height.clamp(1, edid::MAX_EDID_DIMENSION);
        let already_pending = self.events_read & VIRTIO_GPU_EVENT_DISPLAY != 0;
        self.display_width = width;
        self.display_height = height;
        self.display_refresh_hz = DEFAULT_DISPLAY_REFRESH_HZ;
        self.edid = edid::edid_for(width, height, self.display_refresh_hz);
        self.events_read |= VIRTIO_GPU_EVENT_DISPLAY;
        if !already_pending {
            self.config_irq_pending = true;
        }
    }

    fn raise_event(&mut self, bits: u32) {
        if bits & VIRTIO_GPU_EVENT_DISPLAY != 0 && self.events_read & VIRTIO_GPU_EVENT_DISPLAY == 0
        {
            self.config_irq_pending = true;
        }
        self.events_read |= bits;
    }

    fn take_config_irq(&mut self) -> bool {
        let pending = self.config_irq_pending;
        self.config_irq_pending = false;
        pending
    }

    fn reset(&mut self) {
        self.events_read = 0;
        self.display_width = DEFAULT_DISPLAY_WIDTH;
        self.display_height = DEFAULT_DISPLAY_HEIGHT;
        self.display_refresh_hz = DEFAULT_DISPLAY_REFRESH_HZ;
        self.edid = edid::edid_for(
            DEFAULT_DISPLAY_WIDTH,
            DEFAULT_DISPLAY_HEIGHT,
            DEFAULT_DISPLAY_REFRESH_HZ,
        );
        self.config_irq_pending = false;
        self.kicked = false;
        self.resources = resources::ResourceMap::new();
        self.scanout_resource = None;
        self.reset_pending = true;
    }
}

/// A minimal virtio-gpu device.  Queue state remains owned by the generic virtio-mmio transport;
/// [`service`] owns the deferred guest-memory work at a free bus boundary.
pub struct VirtioGpu {
    state: Rc<RefCell<GpuState>>,
}

impl VirtioGpu {
    /// Construct the default single-scanout, no-capset device.
    pub fn new() -> Self {
        Self::new_with_state().0
    }

    /// Construct the transport device and the run-loop handle that services its queues.
    pub fn new_with_state() -> (Self, Rc<RefCell<GpuState>>) {
        Self::new_with_sink_state(Box::new(NullSink))
    }

    /// Construct a device using an injected core presentation sink.
    pub fn new_with_sink(sink: Box<dyn FrameSink>) -> Self {
        Self::new_with_sink_state(sink).0
    }

    /// Construct a device and shared state using an injected core presentation sink.
    pub fn new_with_sink_state(sink: Box<dyn FrameSink>) -> (Self, Rc<RefCell<GpuState>>) {
        let state = Rc::new(RefCell::new(GpuState::new(sink)));
        (
            Self {
                state: Rc::clone(&state),
            },
            state,
        )
    }

    /// Replace the presentation sink while retaining the device's shared state.
    pub fn set_frame_sink(&mut self, sink: Box<dyn FrameSink>) {
        self.state.borrow_mut().frame_sink = sink;
    }

    /// Current display event bits, exposed for the later hotplug slice and tests.
    pub fn events_read(&self) -> u32 {
        self.state.borrow().events_read
    }

    /// Shared host handle for a GPU installed into a virtio-mmio slot.
    pub fn state_handle(&self) -> Rc<RefCell<GpuState>> {
        Rc::clone(&self.state)
    }

    /// Current display dimensions advertised by GET_DISPLAY_INFO and the preferred EDID timing.
    pub fn display_size(&self) -> (u32, u32) {
        self.state.borrow().display_size()
    }

    /// Copy the current preferred EDID base block.
    pub fn edid(&self) -> [u8; edid::EDID_BLOCK_SIZE] {
        self.state.borrow().edid()
    }

    /// Change the host-visible virtual display mode.  The transport latches one config interrupt
    /// at its next boundary; repeated changes before `events_clear` update the final mode without
    /// creating an interrupt storm.
    pub fn set_display(&mut self, width: u32, height: u32) {
        self.state.borrow_mut().set_display(width, height);
    }

    /// Raise display event bits without exposing host pointers to the transport.
    pub fn raise_event(&mut self, bits: u32) {
        self.state.borrow_mut().raise_event(bits);
    }

    fn config_bytes(&self) -> [u8; CONFIG_LEN] {
        let mut out = [0u8; CONFIG_LEN];
        out[0..4].copy_from_slice(&self.events_read().to_le_bytes());
        // `events_clear` is a write-one-to-clear register.  It has no latched read value.
        out[8..12].copy_from_slice(&DEFAULT_NUM_SCANOUTS.to_le_bytes());
        out[12..16].copy_from_slice(&DEFAULT_NUM_CAPSETS.to_le_bytes());
        out
    }
}

impl Default for VirtioGpu {
    fn default() -> Self {
        Self::new()
    }
}

impl VirtioDevice for VirtioGpu {
    fn device_id(&self) -> u32 {
        VIRTIO_GPU_DEVICE_ID
    }

    fn device_features(&self) -> u64 {
        VIRTIO_GPU_F_EDID
    }

    fn num_queues(&self) -> u32 {
        // controlq (queue 0) and cursorq (queue 1); cursor commands are added by E5-T15.
        2
    }

    fn queue_notify(&mut self, queue: u32) {
        let _ = queue;
        // Bus is borrowed while the MMIO write is being handled.  Defer queue walking until the
        // run-loop boundary, when guest RAM can be borrowed safely.
        self.state.borrow_mut().kicked = true;
    }

    fn config_read(&mut self, offset: u64, width: u8) -> u64 {
        let bytes = self.config_bytes();
        let mut value = 0u64;
        // The transport only calls this with 1/2/4/8, but bounding the loop keeps a direct
        // backend call harmless as well: no shift can exceed the u64 result width.
        for i in 0..usize::from(width.min(8)) {
            let Some(index) = offset
                .checked_add(i as u64)
                .and_then(|n| usize::try_from(n).ok())
            else {
                continue;
            };
            if let Some(byte) = bytes.get(index) {
                value |= u64::from(*byte) << (i * 8);
            }
        }
        value
    }

    fn config_write(&mut self, offset: u64, width: u8, value: u64) {
        // The only writable field in the initial config surface is `events_clear` at offset 4.
        // Model partial writes byte-for-byte so the transport's width-preserving config policy
        // cannot accidentally clear neighboring fields.
        let mut clear = 0u32;
        for i in 0..usize::from(width.min(8)) {
            let Some(index) = offset.checked_add(i as u64) else {
                continue;
            };
            if (4..8).contains(&index) {
                let shift = i * 8;
                clear |= (((value >> shift) & 0xff) as u32) << ((index as usize - 4) * 8);
            }
        }
        let mut state = self.state.borrow_mut();
        state.events_read &= !clear;
        if clear & VIRTIO_GPU_EVENT_DISPLAY != 0 {
            state.config_irq_pending = false;
        }
    }

    fn reset(&mut self) {
        self.state.borrow_mut().reset();
    }

    fn take_config_irq(&mut self) -> bool {
        self.state.borrow_mut().take_config_irq()
    }
}

/// Sum readable descriptor lengths without narrowing a hostile `u32` segment length.
fn readable_len(chain: &DescriptorChain) -> Option<u64> {
    let mut total = 0u64;
    for segment in chain.readable() {
        total = total.checked_add(u64::from(segment.len))?;
    }
    Some(total)
}

/// Read a small fixed-size window at a byte offset in the readable descriptor stream. This keeps
/// split headers/entries independent of descriptor boundaries and never allocates based on guest
/// supplied lengths.
fn read_readable_at<const N: usize>(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    start: u64,
) -> Option<[u8; N]> {
    let end = start.checked_add(N as u64)?;
    if end > readable_len(chain)? {
        return None;
    }

    let mut skip = start;
    let mut copied = 0usize;
    let mut bytes = [0u8; N];
    for segment in chain.readable() {
        let segment_len = u64::from(segment.len);
        if skip >= segment_len {
            skip -= segment_len;
            continue;
        }
        let available = segment_len - skip;
        let take = available.min((N - copied) as u64);
        for offset in 0..take {
            let guest_addr = segment.addr.checked_add(skip.checked_add(offset)?)?;
            bytes[copied] = bus.load8(guest_addr).ok()?;
            copied += 1;
        }
        skip = 0;
        if copied == N {
            return Some(bytes);
        }
    }
    None
}

/// Read exactly the first control header from a chain's readable descriptors. This bounded read
/// supports headers split at any byte boundary without allocating based on a hostile descriptor
/// length; payload commands are owned by later GPU slices.
fn read_header(chain: &DescriptorChain, bus: &mut SystemBus) -> Option<protocol::CtrlHeader> {
    read_readable_at::<{ protocol::CTRL_HDR_SIZE }>(chain, bus, 0)
        .and_then(|bytes| protocol::CtrlHeader::from_bytes(&bytes))
}

/// Read a bounded request prefix from readable descriptors. Queue validation has already
/// checked each segment's address/range; this helper additionally bounds the amount copied so a
/// hostile descriptor cannot turn a malformed command into an unbounded host allocation.
fn read_request<const N: usize>(chain: &DescriptorChain, bus: &mut SystemBus) -> Option<[u8; N]> {
    read_readable_at::<N>(chain, bus, 0)
}

/// Write a response prefix across all device-writable descriptors. A short tail is truncated at
/// its validated capacity; no byte beyond the provided descriptors is ever addressed.
fn write_prefix(chain: &DescriptorChain, bus: &mut SystemBus, response: &[u8]) -> Result<u32, ()> {
    let mut written = 0usize;
    for segment in chain.writable() {
        for offset in 0..segment.len as usize {
            if written == response.len() {
                return Ok(written as u32);
            }
            bus.store8(segment.addr + offset as u64, response[written])
                .map_err(|_| ())?;
            written += 1;
        }
    }
    Ok(written as u32)
}

fn response_header(request: protocol::CtrlHeader, ty: u32) -> protocol::CtrlHeader {
    protocol::CtrlHeader {
        ty,
        flags: request.flags & protocol::FLAG_FENCE,
        fence_id: if request.flags & protocol::FLAG_FENCE != 0 {
            request.fence_id
        } else {
            0
        },
        ctx_id: request.ctx_id,
        ring_idx: request.ring_idx,
        padding: [0; 3],
    }
}

/// Decode a negotiated GET_EDID request and return the scanout-indexed current base block.
fn get_edid(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    slot: &Rc<RefCell<VirtioMmio>>,
    state: &Rc<RefCell<GpuState>>,
) -> Result<[u8; edid::EDID_BLOCK_SIZE], u32> {
    let request = read_request::<{ protocol::GET_EDID_REQUEST_SIZE }>(chain, bus)
        .and_then(|bytes| protocol::GetEdid::from_bytes(&bytes))
        .ok_or(protocol::RESP_ERR_INVALID_PARAMETER)?;
    if !slot.borrow().driver_has_feature(VIRTIO_GPU_F_EDID) {
        return Err(protocol::RESP_ERR_UNSPEC);
    }
    if request.scanout_id >= DEFAULT_NUM_SCANOUTS {
        return Err(protocol::RESP_ERR_INVALID_SCANOUT_ID);
    }
    Ok(state.borrow().edid())
}

fn create_error_response(error: resources::CreateError) -> u32 {
    match error {
        resources::CreateError::InvalidResourceId => protocol::RESP_ERR_INVALID_RESOURCE_ID,
        resources::CreateError::InvalidParameter => protocol::RESP_ERR_INVALID_PARAMETER,
        resources::CreateError::OutOfMemory => protocol::RESP_ERR_OUT_OF_MEMORY,
    }
}

fn backing_error_response(error: resources::BackingError) -> u32 {
    match error {
        resources::BackingError::InvalidResourceId => protocol::RESP_ERR_INVALID_RESOURCE_ID,
        resources::BackingError::InvalidParameter => protocol::RESP_ERR_INVALID_PARAMETER,
        resources::BackingError::OutOfMemory => protocol::RESP_ERR_OUT_OF_MEMORY,
    }
}

fn unref_error_response(error: resources::UnrefError) -> u32 {
    match error {
        resources::UnrefError::InvalidResourceId => protocol::RESP_ERR_INVALID_RESOURCE_ID,
        resources::UnrefError::InvalidParameter => protocol::RESP_ERR_INVALID_PARAMETER,
    }
}

/// Why a SET_SCANOUT request was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScanoutError {
    InvalidResourceId,
    InvalidParameter,
}

fn scanout_error_response(error: ScanoutError) -> u32 {
    match error {
        ScanoutError::InvalidResourceId => protocol::RESP_ERR_INVALID_RESOURCE_ID,
        ScanoutError::InvalidParameter => protocol::RESP_ERR_INVALID_PARAMETER,
    }
}

fn transfer_error_response(error: resources::TransferError) -> u32 {
    match error {
        resources::TransferError::InvalidResourceId => protocol::RESP_ERR_INVALID_RESOURCE_ID,
        resources::TransferError::InvalidParameter => protocol::RESP_ERR_INVALID_PARAMETER,
        resources::TransferError::OutOfMemory => protocol::RESP_ERR_OUT_OF_MEMORY,
    }
}

/// Why a RESOURCE_FLUSH request was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FlushError {
    InvalidResourceId,
    InvalidParameter,
}

fn flush_error_response(error: FlushError) -> u32 {
    match error {
        FlushError::InvalidResourceId => protocol::RESP_ERR_INVALID_RESOURCE_ID,
        FlushError::InvalidParameter => protocol::RESP_ERR_INVALID_PARAMETER,
    }
}

/// Check a rectangle with widened arithmetic so an overflowing guest coordinate cannot wrap into
/// the resource. Zero-sized rectangles are valid at an edge; the command still binds the resource.
fn rect_within(rect: Rect, resource_width: u32, resource_height: u32) -> bool {
    u64::from(rect.x) + u64::from(rect.width) <= u64::from(resource_width)
        && u64::from(rect.y) + u64::from(rect.height) <= u64::from(resource_height)
}

/// Bind or disable a scanout without mutating the previous binding on a rejected request.
fn set_scanout(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    state: &Rc<RefCell<GpuState>>,
) -> Result<(), ScanoutError> {
    let request = read_request::<{ protocol::SET_SCANOUT_SIZE }>(chain, bus)
        .and_then(|bytes| protocol::SetScanout::from_bytes(&bytes))
        .ok_or(ScanoutError::InvalidParameter)?;
    if request.scanout_id >= DEFAULT_NUM_SCANOUTS {
        return Err(ScanoutError::InvalidParameter);
    }

    // Virtio uses resource id 0 to disable output. Its rectangle is ignored because there is no
    // resource against which to validate it; this also accepts the driver's usual zero rectangle.
    if request.resource_id == 0 {
        state.borrow_mut().scanout_resource = None;
        return Ok(());
    }

    {
        let state_ref = state.borrow();
        let resource = state_ref
            .resources
            .get(request.resource_id)
            .ok_or(ScanoutError::InvalidResourceId)?;
        if !rect_within(request.rect, resource.width, resource.height) {
            return Err(ScanoutError::InvalidParameter);
        }
    }

    state.borrow_mut().scanout_resource = Some(request.resource_id);
    Ok(())
}

/// Decode a transfer request and copy its rectangle through the resource's checked SG reader.
fn transfer_to_host_2d(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    state: &Rc<RefCell<GpuState>>,
) -> Result<(), resources::TransferError> {
    let request = read_request::<{ protocol::TRANSFER_TO_HOST_2D_SIZE }>(chain, bus)
        .and_then(|bytes| protocol::TransferToHost2d::from_bytes(&bytes))
        .ok_or(resources::TransferError::InvalidParameter)?;
    state.borrow_mut().resources.transfer_to_host_2d(
        request.resource_id,
        request.rect,
        request.offset,
        bus,
    )
}

/// Validate a damage rectangle and publish the resource-sized host shadow through the sink.
fn resource_flush(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    state: &Rc<RefCell<GpuState>>,
) -> Result<(), FlushError> {
    let request = read_request::<{ protocol::RESOURCE_FLUSH_SIZE }>(chain, bus)
        .and_then(|bytes| protocol::ResourceFlush::from_bytes(&bytes))
        .ok_or(FlushError::InvalidParameter)?;
    let mut state_ref = state.borrow_mut();
    let GpuState {
        resources,
        scanout_resource,
        frame_sink,
        ..
    } = &mut *state_ref;
    let scanout = (*scanout_resource == Some(request.resource_id)).then_some(0);
    let resource = resources
        .get(request.resource_id)
        .ok_or(FlushError::InvalidResourceId)?;
    if !rect_within(request.rect, resource.width, resource.height) {
        return Err(FlushError::InvalidParameter);
    }
    frame_sink.flush(
        scanout,
        request.rect,
        resource.width,
        resource.height,
        &resource.host_pixels,
    );
    Ok(())
}

/// Decode and validate an attach request before publishing any part of its backing list.
fn attach_backing(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    state: &Rc<RefCell<GpuState>>,
) -> Result<(), resources::BackingError> {
    let header = read_request::<{ protocol::RESOURCE_ATTACH_BACKING_HEADER_SIZE }>(chain, bus)
        .and_then(|bytes| protocol::ResourceAttachBacking::from_bytes(&bytes))
        .ok_or(resources::BackingError::InvalidParameter)?;
    if state.borrow().resources.get(header.resource_id).is_none() {
        return Err(resources::BackingError::InvalidResourceId);
    }

    let nents = u64::from(header.nents);
    if header.nents > resources::MAX_BACKING_ENTRIES {
        return Err(resources::BackingError::InvalidParameter);
    }
    let entries_bytes = nents
        .checked_mul(protocol::RESOURCE_MEM_ENTRY_SIZE as u64)
        .ok_or(resources::BackingError::InvalidParameter)?;
    let request_bytes = (protocol::RESOURCE_ATTACH_BACKING_HEADER_SIZE as u64)
        .checked_add(entries_bytes)
        .ok_or(resources::BackingError::InvalidParameter)?;
    if request_bytes > readable_len(chain).ok_or(resources::BackingError::InvalidParameter)? {
        return Err(resources::BackingError::InvalidParameter);
    }
    let entry_count = usize::try_from(nents).map_err(|_| resources::BackingError::OutOfMemory)?;

    // Decode into private storage. The resource is only mutated after every entry passes its
    // non-zero/range checks, so a late bad entry cannot leave a partial backing list behind.
    let mut backing = alloc::vec::Vec::new();
    backing
        .try_reserve_exact(entry_count)
        .map_err(|_| resources::BackingError::OutOfMemory)?;
    for index in 0..entry_count {
        let offset = (protocol::RESOURCE_ATTACH_BACKING_HEADER_SIZE as u64)
            .checked_add(
                (index as u64)
                    .checked_mul(protocol::RESOURCE_MEM_ENTRY_SIZE as u64)
                    .ok_or(resources::BackingError::InvalidParameter)?,
            )
            .ok_or(resources::BackingError::InvalidParameter)?;
        let bytes = read_readable_at::<{ protocol::RESOURCE_MEM_ENTRY_SIZE }>(chain, bus, offset)
            .ok_or(resources::BackingError::InvalidParameter)?;
        let entry = protocol::ResourceMemEntry::from_bytes(&bytes)
            .ok_or(resources::BackingError::InvalidParameter)?;
        if entry.length == 0 || !bus.ram().ram_contains(entry.addr, u64::from(entry.length)) {
            return Err(resources::BackingError::InvalidParameter);
        }
        backing.push((entry.addr, entry.length));
    }
    state
        .borrow_mut()
        .resources
        .attach_backing(header.resource_id, backing)
        .map_err(|_| resources::BackingError::InvalidResourceId)
}

fn detach_backing(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    state: &Rc<RefCell<GpuState>>,
) -> Result<(), resources::BackingError> {
    let request = read_request::<{ protocol::RESOURCE_DETACH_BACKING_SIZE }>(chain, bus)
        .and_then(|bytes| protocol::ResourceDetachBacking::from_bytes(&bytes))
        .ok_or(resources::BackingError::InvalidParameter)?;
    state
        .borrow_mut()
        .resources
        .detach_backing(request.resource_id)
        .map_err(|_| resources::BackingError::InvalidResourceId)
}

/// Unref a resource, clearing scanout 0 before releasing its host-owned pixels.
fn unref_resource(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    state: &Rc<RefCell<GpuState>>,
) -> Result<(), resources::UnrefError> {
    let request = read_request::<{ protocol::RESOURCE_UNREF_SIZE }>(chain, bus)
        .and_then(|bytes| protocol::ResourceUnref::from_bytes(&bytes))
        .ok_or(resources::UnrefError::InvalidParameter)?;
    let mut state = state.borrow_mut();
    if state.resources.get(request.resource_id).is_none() {
        return Err(resources::UnrefError::InvalidResourceId);
    }
    if state.scanout_resource == Some(request.resource_id) {
        // Clear the binding first: dropping the returned Resource below must never leave a
        // scanout id pointing at freed host pixels.
        state.scanout_resource = None;
    }
    let _ = state.resources.remove(request.resource_id)?;
    Ok(())
}

/// Service the virtio-gpu control queue after a deferred QueueNotify kick.
///
/// A short request is consumed with a zero-length used entry. Unsupported commands receive the
/// fixed 24-byte `RESP_ERR_UNSPEC` response; both paths preserve ring progress for the next chain.
pub fn service(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<GpuState>>,
    bus: &mut SystemBus,
) {
    // Host APIs retain only the GPU state handle.  Let the transport turn a pending state change
    // into its latched config interrupt before queue work (or an early no-kick return) is handled.
    slot.borrow_mut().sync_backend_config_irq();
    {
        let mut state = state.borrow_mut();
        if state.reset_pending {
            state.reset_pending = false;
            *vq = None;
        }
        if !state.kicked {
            return;
        }
        state.kicked = false;
    }

    let queue_state = *slot.borrow().queue(0);
    if !queue_state.ready {
        *vq = None;
        return;
    }
    if vq.is_none() {
        match Virtqueue::new(&queue_state, 256) {
            Ok(queue) => *vq = Some(queue),
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                return;
            }
        }
    }

    let queue = vq.as_mut().expect("queue was constructed above");
    let mut delivered_work = false;
    loop {
        let chain = match queue.pop(bus) {
            Ok(Some(chain)) => chain,
            Ok(None) => break,
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                *vq = None;
                return;
            }
        };

        let written = match read_header(&chain, bus) {
            Some(request) if request.ty == protocol::CMD_GET_DISPLAY_INFO => {
                let (width, height) = state.borrow().display_size();
                let response = protocol::DisplayInfoResponse::new_with_mode(
                    response_header(request, protocol::RESP_OK_DISPLAY_INFO),
                    width,
                    height,
                )
                .to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => {
                        state.borrow_mut().commands_served += 1;
                        written
                    }
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            Some(request) if request.ty == protocol::CMD_GET_EDID => {
                let result = get_edid(&chain, bus, slot, state);
                let written = match result {
                    Ok(edid) => {
                        let response = protocol::EdidResponse {
                            header: response_header(request, protocol::RESP_OK_EDID),
                            edid,
                        }
                        .to_bytes();
                        write_prefix(&chain, bus, &response)
                    }
                    Err(response_type) => {
                        let response = response_header(request, response_type).to_bytes();
                        write_prefix(&chain, bus, &response)
                    }
                };
                match written {
                    Ok(written) => written,
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            Some(request) if request.ty == protocol::CMD_RESOURCE_CREATE_2D => {
                let response_type =
                    match read_request::<{ protocol::RESOURCE_CREATE_2D_SIZE }>(&chain, bus)
                        .and_then(|bytes| protocol::ResourceCreate2d::from_bytes(&bytes))
                    {
                        Some(create) => match state.borrow_mut().resources.create(
                            create.resource_id,
                            create.format,
                            create.width,
                            create.height,
                        ) {
                            Ok(_) => protocol::RESP_OK_NODATA,
                            Err(error) => create_error_response(error),
                        },
                        None => protocol::RESP_ERR_INVALID_PARAMETER,
                    };
                let response = response_header(request, response_type).to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => written,
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            Some(request) if request.ty == protocol::CMD_RESOURCE_ATTACH_BACKING => {
                let response_type = match attach_backing(&chain, bus, state) {
                    Ok(()) => protocol::RESP_OK_NODATA,
                    Err(error) => backing_error_response(error),
                };
                let response = response_header(request, response_type).to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => written,
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            Some(request) if request.ty == protocol::CMD_RESOURCE_DETACH_BACKING => {
                let response_type = match detach_backing(&chain, bus, state) {
                    Ok(()) => protocol::RESP_OK_NODATA,
                    Err(error) => backing_error_response(error),
                };
                let response = response_header(request, response_type).to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => written,
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            Some(request) if request.ty == protocol::CMD_RESOURCE_UNREF => {
                let response_type = match unref_resource(&chain, bus, state) {
                    Ok(()) => protocol::RESP_OK_NODATA,
                    Err(error) => unref_error_response(error),
                };
                let response = response_header(request, response_type).to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => written,
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            Some(request) if request.ty == protocol::CMD_SET_SCANOUT => {
                let response_type = match set_scanout(&chain, bus, state) {
                    Ok(()) => protocol::RESP_OK_NODATA,
                    Err(error) => scanout_error_response(error),
                };
                let response = response_header(request, response_type).to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => written,
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            Some(request) if request.ty == protocol::CMD_TRANSFER_TO_HOST_2D => {
                let response_type = match transfer_to_host_2d(&chain, bus, state) {
                    Ok(()) => protocol::RESP_OK_NODATA,
                    Err(error) => transfer_error_response(error),
                };
                let response = response_header(request, response_type).to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => written,
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            Some(request) if request.ty == protocol::CMD_RESOURCE_FLUSH => {
                let response_type = match resource_flush(&chain, bus, state) {
                    Ok(()) => protocol::RESP_OK_NODATA,
                    Err(error) => flush_error_response(error),
                };
                let response = response_header(request, response_type).to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => written,
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            Some(request) => {
                let response = response_header(request, protocol::RESP_ERR_UNSPEC).to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => written,
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            _ => 0,
        };

        if queue.push_used(bus, chain.head, written).is_err() {
            slot.borrow_mut().protocol_violation();
            *vq = None;
            return;
        }
        delivered_work = true;
    }

    if delivered_work && queue.interrupt_needed(bus) {
        slot.borrow_mut().raise_used_irq();
    }
}

#[cfg(test)]
mod tests {
    use alloc::rc::Rc;
    use core::cell::RefCell;

    use super::*;
    use crate::bus::Bus;
    use crate::dev::virtio::mmio::{INT_CONFIG_CHANGE, QueueState, VirtioMmio};
    use crate::mmio::{MmioDevice, SystemBus, Width};
    use crate::platform::virt::DRAM_BASE;
    use crate::ram::Ram;
    use protocol::{
        CMD_GET_EDID, CMD_RESOURCE_FLUSH, CMD_SET_SCANOUT, CMD_TRANSFER_TO_HOST_2D, CTRL_HDR_SIZE,
        CtrlHeader, DISPLAY_INFO_RESPONSE_SIZE, DISPLAY_MODE_COUNT, DISPLAY_MODE_SIZE,
        DisplayInfoResponse, DisplayMode, EDID_RESPONSE_SIZE, GET_EDID_REQUEST_SIZE,
        RESOURCE_FLUSH_SIZE, RESP_ERR_INVALID_SCANOUT_ID, RESP_ERR_UNSPEC, RESP_OK_DISPLAY_INFO,
        RESP_OK_EDID, Rect, ResourceFlush, SET_SCANOUT_SIZE, SetScanout, TRANSFER_TO_HOST_2D_SIZE,
        TransferToHost2d,
    };

    const CONFIG_SPACE: u64 = 0x100;
    const DEVICE_FEATURES: u64 = 0x010;
    const DEVICE_FEATURES_SEL: u64 = 0x014;
    const DRIVER_FEATURES: u64 = 0x020;
    const DRIVER_FEATURES_SEL: u64 = 0x024;
    const QUEUE_SEL: u64 = 0x030;
    const QUEUE_NUM_MAX: u64 = 0x034;
    const STATUS: u64 = 0x070;
    const DEVICE_ID: u64 = 0x008;
    const STATUS_ACKNOWLEDGE: u32 = 1;
    const STATUS_DRIVER: u32 = 2;
    const STATUS_FEATURES_OK: u32 = 8;
    const STATUS_NEEDS_RESET: u32 = 64;

    const DESC: u64 = DRAM_BASE + 0x1000;
    const AVAIL: u64 = DRAM_BASE + 0x2000;
    const USED: u64 = DRAM_BASE + 0x3000;
    const REQUEST: u64 = DRAM_BASE + 0x4000;
    const RESPONSE: u64 = DRAM_BASE + 0x5000;

    fn write_desc(bus: &mut SystemBus, index: u64, addr: u64, len: u32, flags: u16, next: u16) {
        let base = DESC + 16 * index;
        bus.store64(base, addr).unwrap();
        bus.store32(base + 8, len).unwrap();
        bus.store16(base + 12, flags).unwrap();
        bus.store16(base + 14, next).unwrap();
    }

    fn write_bytes(bus: &mut SystemBus, addr: u64, bytes: &[u8]) {
        for (offset, byte) in bytes.iter().copied().enumerate() {
            bus.store8(addr + offset as u64, byte).unwrap();
        }
    }

    fn scanout_request(resource_id: u32, scanout_id: u32, rect: Rect) -> [u8; SET_SCANOUT_SIZE] {
        SetScanout {
            header: CtrlHeader {
                ty: CMD_SET_SCANOUT,
                ..CtrlHeader::default()
            },
            rect,
            scanout_id,
            resource_id,
        }
        .to_bytes()
    }

    fn flush_request(resource_id: u32, rect: Rect) -> [u8; RESOURCE_FLUSH_SIZE] {
        ResourceFlush {
            header: CtrlHeader {
                ty: CMD_RESOURCE_FLUSH,
                ..CtrlHeader::default()
            },
            rect,
            resource_id,
            padding: 0,
        }
        .to_bytes()
    }

    fn edid_request(scanout_id: u32) -> [u8; GET_EDID_REQUEST_SIZE] {
        protocol::GetEdid {
            header: CtrlHeader {
                ty: CMD_GET_EDID,
                ..CtrlHeader::default()
            },
            scanout_id,
        }
        .to_bytes()
    }

    fn queue_for_test(
        bus: &mut SystemBus,
        descriptors: &[(u64, u32, u16, u16)],
    ) -> (
        Rc<RefCell<VirtioMmio>>,
        Rc<RefCell<GpuState>>,
        Option<Virtqueue>,
    ) {
        for (index, &(addr, len, flags, next)) in descriptors.iter().enumerate() {
            write_desc(bus, index as u64, addr, len, flags, next);
        }
        bus.store16(AVAIL, 0).unwrap();
        bus.store16(AVAIL + 2, 1).unwrap();
        bus.store16(AVAIL + 4, 0).unwrap();
        bus.store16(USED, 0).unwrap();
        let (device, state) = VirtioGpu::new_with_state();
        let queue_size = descriptors.len().max(8).next_power_of_two();
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        slot.borrow_mut().set_queue_for_test(
            0,
            QueueState {
                num: queue_size as u32,
                ready: true,
                desc: DESC,
                driver: AVAIL,
                device: USED,
            },
        );
        (slot, state, None)
    }

    fn set_avail_heads(bus: &mut SystemBus, heads: &[u16]) {
        bus.store16(AVAIL + 2, heads.len() as u16).unwrap();
        for (index, head) in heads.iter().copied().enumerate() {
            bus.store16(AVAIL + 4 + 2 * index as u64, head).unwrap();
        }
    }

    fn response_type(bus: &mut SystemBus, addr: u64) -> u32 {
        bus.load32(addr).unwrap()
    }

    /// Independent test-only CRC-32/IEEE reference, intentionally written with a branch rather
    /// than reusing the production sink's branchless implementation.
    fn reference_crc32(pixels: &[u32]) -> u32 {
        let mut crc = 0xffff_ffff;
        for pixel in pixels {
            for byte in pixel.to_le_bytes() {
                crc ^= u32::from(byte);
                for _ in 0..8 {
                    crc = if crc & 1 == 0 {
                        crc >> 1
                    } else {
                        (crc >> 1) ^ 0xedb8_8320
                    };
                }
            }
        }
        !crc
    }

    fn golden_pattern(index: usize, width: u32, height: u32) -> alloc::vec::Vec<u32> {
        let mut pixels = alloc::vec::Vec::with_capacity((width * height) as usize);
        for y in 0..height {
            for x in 0..width {
                let pixel = match index {
                    0 => 0x1122_3344,
                    1 => {
                        if (x + y) % 2 == 0 {
                            0xff00_00ff
                        } else {
                            0xff00_ff00
                        }
                    }
                    2 => 0x1000_0000 | ((x * 0x19) << 16) | ((y * 0x27) << 8) | (x + y),
                    3 => {
                        if x == y || x + y + 1 == width {
                            0xffff_ff00
                        } else {
                            0x0012_3456
                        }
                    }
                    _ => 0x5500_0000 | ((x * 0x31) ^ (y * 0x17)),
                };
                pixels.push(pixel);
            }
        }
        pixels
    }

    const GOLDEN_RECTS: [Rect; 5] = [
        Rect {
            x: 0,
            y: 0,
            width: 7,
            height: 5,
        },
        Rect {
            x: 2,
            y: 1,
            width: 3,
            height: 2,
        },
        Rect {
            x: 1,
            y: 0,
            width: 5,
            height: 3,
        },
        Rect {
            x: 0,
            y: 2,
            width: 7,
            height: 2,
        },
        Rect {
            x: 4,
            y: 3,
            width: 3,
            height: 2,
        },
    ];

    const GOLDEN_CRC32: [u32; 5] = [
        0x2d06_8e19,
        0x80e3_df97,
        0xcafe_b5cb,
        0x74f3_ca70,
        0x4b09_d24f,
    ];

    const GOLDEN_BACKING_LENGTHS: [&[u32]; 5] = [
        &[140],
        &[17, 123],
        &[7, 13, 29, 91],
        &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20],
        &[64, 76],
    ];

    fn read32(slot: &mut VirtioMmio, offset: u64) -> u32 {
        slot.read(offset, Width::B4).unwrap() as u32
    }

    fn write32(slot: &mut VirtioMmio, offset: u64, value: u32) {
        slot.write(offset, Width::B4, u64::from(value)).unwrap();
    }

    fn negotiate_gpu_edid(slot: &mut VirtioMmio) {
        write32(slot, STATUS, STATUS_ACKNOWLEDGE | STATUS_DRIVER);
        write32(slot, DRIVER_FEATURES_SEL, 0);
        write32(slot, DRIVER_FEATURES, VIRTIO_GPU_F_EDID as u32);
        write32(slot, DRIVER_FEATURES_SEL, 1);
        write32(slot, DRIVER_FEATURES, 1);
        write32(
            slot,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_FEATURES_OK,
        );
        assert_ne!(read32(slot, STATUS) & STATUS_FEATURES_OK, 0);
    }

    #[test]
    fn gpu_protocol_wire_fixtures() {
        let header = CtrlHeader {
            ty: RESP_OK_DISPLAY_INFO,
            flags: 0xA1B2_C3D4,
            fence_id: 0x1122_3344_5566_7788,
            ctx_id: 0x0102_0304,
            ring_idx: 0x05,
            padding: [0x06, 0x07, 0x08],
        };
        assert_eq!(
            header.to_bytes(),
            [
                0x01, 0x11, 0x00, 0x00, // type
                0xD4, 0xC3, 0xB2, 0xA1, // flags
                0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, // fence_id
                0x04, 0x03, 0x02, 0x01, // ctx_id
                0x05, 0x06, 0x07, 0x08, // ring_idx + padding
            ]
        );
        assert_eq!(CtrlHeader::from_bytes(&header.to_bytes()), Some(header));

        let response = DisplayInfoResponse::new(header);
        let bytes = response.to_bytes();
        assert_eq!(bytes.len(), DISPLAY_INFO_RESPONSE_SIZE);
        assert_eq!(CTRL_HDR_SIZE, 24);
        assert_eq!(DISPLAY_MODE_SIZE, 24);
        assert_eq!(DISPLAY_MODE_COUNT, 16);
        assert_eq!(&bytes[..CTRL_HDR_SIZE], &header.to_bytes());

        // Every pmode is compared independently against the little-endian wire fixture: only
        // scanout 0 is enabled, and its rectangle is exactly 1280x800 at the origin.
        for index in 0..DISPLAY_MODE_COUNT {
            let start = CTRL_HDR_SIZE + index * DISPLAY_MODE_SIZE;
            let end = start + DISPLAY_MODE_SIZE;
            let expected = if index == 0 {
                [
                    0x00, 0x00, 0x00, 0x00, // x
                    0x00, 0x00, 0x00, 0x00, // y
                    0x00, 0x05, 0x00, 0x00, // width = 1280
                    0x20, 0x03, 0x00, 0x00, // height = 800
                    0x01, 0x00, 0x00, 0x00, // enabled
                    0x00, 0x00, 0x00, 0x00, // flags
                ]
            } else {
                [0u8; DISPLAY_MODE_SIZE]
            };
            assert_eq!(&bytes[start..end], expected.as_slice(), "pmode {index}");
        }
        assert_eq!(DisplayInfoResponse::from_bytes(&bytes), Some(response));
    }

    #[test]
    fn gpu_mmio_identity_features_and_config() {
        let mut slot = VirtioMmio::new(Box::new(VirtioGpu::new()));
        assert_eq!(read32(&mut slot, DEVICE_ID), VIRTIO_GPU_DEVICE_ID);

        write32(&mut slot, STATUS, STATUS_ACKNOWLEDGE | STATUS_DRIVER);
        write32(&mut slot, DEVICE_FEATURES_SEL, 0);
        assert_eq!(
            read32(&mut slot, DEVICE_FEATURES),
            VIRTIO_GPU_F_EDID as u32,
            "EDID offered"
        );
        write32(&mut slot, DEVICE_FEATURES_SEL, 1);
        assert_eq!(read32(&mut slot, DEVICE_FEATURES), 1, "VERSION_1 offered");

        write32(&mut slot, DRIVER_FEATURES_SEL, 1);
        write32(&mut slot, DRIVER_FEATURES, 1);
        write32(
            &mut slot,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_FEATURES_OK,
        );
        assert_ne!(read32(&mut slot, STATUS) & STATUS_FEATURES_OK, 0);

        // Queue 0 is controlq and queue 1 is cursorq; no third queue is exposed.
        write32(&mut slot, QUEUE_SEL, 0);
        assert_eq!(read32(&mut slot, QUEUE_NUM_MAX), 256);
        write32(&mut slot, QUEUE_SEL, 1);
        assert_eq!(read32(&mut slot, QUEUE_NUM_MAX), 256);
        write32(&mut slot, QUEUE_SEL, 2);
        assert_eq!(read32(&mut slot, QUEUE_NUM_MAX), 0);

        assert_eq!(slot.read(CONFIG_SPACE, Width::B4).unwrap(), 0);
        assert_eq!(slot.read(CONFIG_SPACE + 4, Width::B4).unwrap(), 0);
        assert_eq!(slot.read(CONFIG_SPACE + 8, Width::B4).unwrap(), 1);
        assert_eq!(slot.read(CONFIG_SPACE + 12, Width::B4).unwrap(), 0);
        assert_eq!(slot.read(CONFIG_SPACE + 8, Width::B8).unwrap(), 1);
    }

    #[test]
    fn unsupported_feature_does_not_mutate_config() {
        let mut slot = VirtioMmio::new(Box::new(VirtioGpu::new()));
        write32(&mut slot, STATUS, STATUS_ACKNOWLEDGE | STATUS_DRIVER);
        write32(&mut slot, DRIVER_FEATURES_SEL, 0);
        write32(&mut slot, DRIVER_FEATURES, 1); // device offers no bit 0
        write32(
            &mut slot,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_FEATURES_OK,
        );
        assert_eq!(read32(&mut slot, STATUS) & STATUS_FEATURES_OK, 0);
        assert_eq!(slot.read(CONFIG_SPACE + 8, Width::B4).unwrap(), 1);
        assert_eq!(slot.read(CONFIG_SPACE + 12, Width::B4).unwrap(), 0);
    }

    #[test]
    fn display_event_clear_is_write_one_to_clear() {
        let mut gpu = VirtioGpu::new();
        gpu.raise_event(0b1011);
        assert_eq!(gpu.events_read(), 0b1011);
        gpu.config_write(4, 1, 0b0001);
        assert_eq!(gpu.events_read(), 0b1010);
    }

    #[test]
    fn set_display_updates_mode_and_coalesces_config_interrupts() {
        let (mut gpu, state) = VirtioGpu::new_with_state();
        gpu.set_display(1025, 777);
        assert_eq!(gpu.display_size(), (1025, 777));
        assert_eq!(gpu.events_read(), VIRTIO_GPU_EVENT_DISPLAY);
        assert_eq!(gpu.edid(), state.borrow().edid());

        // The device can be installed after a host resize.  The transport consumes the pending
        // request once, even though the state handle remains usable after installation.
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(gpu))));
        let generation = read32(&mut slot.borrow_mut(), 0x0fc);
        assert!(slot.borrow_mut().sync_backend_config_irq());
        assert_eq!(
            read32(&mut slot.borrow_mut(), 0x060) & INT_CONFIG_CHANGE,
            INT_CONFIG_CHANGE
        );
        assert_eq!(read32(&mut slot.borrow_mut(), 0x0fc), generation + 1);

        // A second host change before the guest clears EVENT_DISPLAY updates the advertised final
        // state but does not create a second config interrupt.
        state.borrow_mut().set_display(1367, 901);
        assert_eq!(state.borrow().display_size(), (1367, 901));
        assert!(!slot.borrow_mut().sync_backend_config_irq());
        assert_eq!(read32(&mut slot.borrow_mut(), 0x0fc), generation + 1);
        assert_eq!(
            read32(&mut slot.borrow_mut(), CONFIG_SPACE),
            VIRTIO_GPU_EVENT_DISPLAY
        );

        // ACK the transport interrupt, clear only EVENT_DISPLAY, then prove the next resize arms
        // exactly one fresh config notification.
        write32(&mut slot.borrow_mut(), 0x064, INT_CONFIG_CHANGE);
        write32(
            &mut slot.borrow_mut(),
            CONFIG_SPACE + 4,
            VIRTIO_GPU_EVENT_DISPLAY,
        );
        assert_eq!(read32(&mut slot.borrow_mut(), CONFIG_SPACE), 0);
        state.borrow_mut().set_display(1441, 901);
        assert!(slot.borrow_mut().sync_backend_config_irq());
        assert_eq!(read32(&mut slot.borrow_mut(), 0x0fc), generation + 2);
        assert_eq!(state.borrow().display_size(), (1441, 901));
    }

    #[test]
    fn set_display_stress_preserves_final_mode_and_bounds_config_irqs() {
        let (gpu, state) = VirtioGpu::new_with_state();
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(gpu))));
        let mut irq_count = 0u32;
        let mut final_size = (0, 0);

        for index in 0..1_000u32 {
            final_size = (640 + index % 3_000, 480 + index % 2_000);
            state.borrow_mut().set_display(final_size.0, final_size.1);
            if slot.borrow_mut().sync_backend_config_irq() {
                irq_count += 1;
            }
            assert_eq!(
                read32(&mut slot.borrow_mut(), 0x060) & INT_CONFIG_CHANGE,
                INT_CONFIG_CHANGE,
                "resize {index} must be observable before its clear"
            );
            write32(&mut slot.borrow_mut(), 0x064, INT_CONFIG_CHANGE);
            write32(
                &mut slot.borrow_mut(),
                CONFIG_SPACE + 4,
                VIRTIO_GPU_EVENT_DISPLAY,
            );
            assert_eq!(read32(&mut slot.borrow_mut(), CONFIG_SPACE), 0);
        }

        assert_eq!(irq_count, 1_000, "one clear permits one fresh config IRQ");
        assert_eq!(state.borrow().display_size(), final_size);
        assert_eq!(
            state.borrow().edid(),
            edid::edid_for(final_size.0, final_size.1, DEFAULT_DISPLAY_REFRESH_HZ)
        );
        assert_eq!(read32(&mut slot.borrow_mut(), 0x060), 0);
    }

    #[test]
    fn get_edid_requires_negotiation_and_is_scanout_indexed() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = edid_request(0);
        write_bytes(&mut bus, REQUEST, &request);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, GET_EDID_REQUEST_SIZE as u32, 1, 1),
                (RESPONSE, EDID_RESPONSE_SIZE as u32, 2, 0),
            ],
        );
        state.borrow_mut().set_display(1281, 801);
        negotiate_gpu_edid(&mut slot.borrow_mut());
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();
        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load32(RESPONSE).unwrap(), RESP_OK_EDID);
        assert_eq!(bus.load16(USED + 2).unwrap(), 1);
        assert_eq!(
            bus.load32(USED + 8).unwrap(),
            EDID_RESPONSE_SIZE as u32,
            "full EDID response written"
        );
        let mut bytes = [0u8; EDID_RESPONSE_SIZE];
        for (offset, byte) in bytes.iter_mut().enumerate() {
            *byte = bus.load8(RESPONSE + offset as u64).unwrap();
        }
        let response = protocol::EdidResponse::from_bytes(&bytes).unwrap();
        assert_eq!(response.header.ty, RESP_OK_EDID);
        assert_eq!(response.edid, state.borrow().edid());
        assert_eq!(
            response
                .edid
                .iter()
                .fold(0u8, |sum, byte| sum.wrapping_add(*byte)),
            0
        );

        // Out-of-range scanouts are rejected after negotiation, without exposing another block.
        let invalid = edid_request(1);
        write_bytes(&mut bus, REQUEST + 0x100, &invalid);
        bus.store16(AVAIL + 2, 2).unwrap();
        bus.store16(AVAIL + 4 + 2, 1).unwrap();
        write32(&mut slot.borrow_mut(), 0x050, 0);
        // Reuse the same queue with descriptor 1 as request and descriptor 2 as the short response.
        write_desc(
            &mut bus,
            1,
            REQUEST + 0x100,
            GET_EDID_REQUEST_SIZE as u32,
            1,
            2,
        );
        write_desc(&mut bus, 2, RESPONSE + 0x100, CTRL_HDR_SIZE as u32, 2, 0);
        service(&slot, &mut vq, &state, &mut bus);
        assert_eq!(
            bus.load32(RESPONSE + 0x100).unwrap(),
            RESP_ERR_INVALID_SCANOUT_ID
        );
    }

    #[test]
    fn get_edid_without_feature_returns_unspec() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = edid_request(0);
        write_bytes(&mut bus, REQUEST, &request);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, GET_EDID_REQUEST_SIZE as u32, 1, 1),
                (RESPONSE, EDID_RESPONSE_SIZE as u32, 2, 0),
            ],
        );
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();
        service(&slot, &mut vq, &state, &mut bus);
        assert_eq!(bus.load32(RESPONSE).unwrap(), RESP_ERR_UNSPEC);
        assert_eq!(bus.load32(USED + 8).unwrap(), CTRL_HDR_SIZE as u32);
    }

    #[test]
    fn virtio_gpu_display_info_contiguous_fenced() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = CtrlHeader {
            ty: protocol::CMD_GET_DISPLAY_INFO,
            flags: protocol::FLAG_FENCE,
            fence_id: 0xCAFE_BABE_1122_3344,
            ctx_id: 0x1020_3040,
            ring_idx: 3,
            padding: [0xAA, 0xBB, 0xCC],
        };
        write_bytes(&mut bus, REQUEST, &request.to_bytes());
        let (slot, state, mut vq) =
            queue_for_test(&mut bus, &[(REQUEST, 24, 1, 1), (RESPONSE, 408, 2, 0)]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 1, "used ring published");
        assert_eq!(bus.load32(USED + 4).unwrap(), 0, "head returned");
        assert_eq!(bus.load32(USED + 8).unwrap(), 408, "full response written");
        let mut bytes = [0u8; DISPLAY_INFO_RESPONSE_SIZE];
        for (offset, byte) in bytes.iter_mut().enumerate() {
            *byte = bus.load8(RESPONSE + offset as u64).unwrap();
        }
        let response = DisplayInfoResponse::from_bytes(&bytes).unwrap();
        assert_eq!(response.header.ty, protocol::RESP_OK_DISPLAY_INFO);
        assert_eq!(response.header.flags, protocol::FLAG_FENCE);
        assert_eq!(response.header.fence_id, request.fence_id);
        assert_eq!(response.header.ctx_id, request.ctx_id);
        assert_eq!(response.header.ring_idx, request.ring_idx);
        assert_eq!(response.header.padding, [0; 3]);
        assert_eq!(response.modes[0].width, 1280);
        assert_eq!(response.modes[0].height, 800);
        assert_eq!(response.modes[0].enabled, 1);
        assert!(
            response.modes[1..]
                .iter()
                .all(|mode| *mode == DisplayMode::default())
        );
        assert_eq!(state.borrow().commands_served, 1);
        assert!(slot.borrow().irq_level(), "used-ring interrupt raised");
    }

    #[test]
    fn gpu_resources_create_wire_fixture_is_little_endian() {
        let request = protocol::ResourceCreate2d {
            header: CtrlHeader {
                ty: protocol::CMD_RESOURCE_CREATE_2D,
                flags: 0x1122_3344,
                fence_id: 0x0102_0304_0506_0708,
                ctx_id: 0xA1B2_C3D4,
                ring_idx: 5,
                padding: [6, 7, 8],
            },
            resource_id: 0x1020_3040,
            format: protocol::FORMAT_R8G8B8X8_UNORM,
            width: 0x5060_7080,
            height: 0x90A0_B0C0,
        };
        let expected = [
            0x01, 0x01, 0x00, 0x00, // type
            0x44, 0x33, 0x22, 0x11, // flags
            0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, // fence_id
            0xD4, 0xC3, 0xB2, 0xA1, // ctx_id
            0x05, 0x06, 0x07, 0x08, // ring_idx + padding
            0x40, 0x30, 0x20, 0x10, // resource_id
            0x44, 0x00, 0x00, 0x00, // format 68
            0x80, 0x70, 0x60, 0x50, // width
            0xC0, 0xB0, 0xA0, 0x90, // height
        ];
        assert_eq!(request.to_bytes(), expected);
        assert_eq!(
            protocol::ResourceCreate2d::from_bytes(&expected),
            Some(request)
        );
    }

    #[test]
    fn gpu_resources_create_controlq_dispatches_and_returns_spec_errors() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let valid = protocol::ResourceCreate2d {
            header: CtrlHeader {
                ty: protocol::CMD_RESOURCE_CREATE_2D,
                flags: protocol::FLAG_FENCE,
                fence_id: 0x0102_0304_0506_0708,
                ctx_id: 9,
                ring_idx: 2,
                padding: [0xA, 0xB, 0xC],
            },
            resource_id: 41,
            format: protocol::FORMAT_B8G8R8X8_UNORM,
            width: 4,
            height: 3,
        };
        let invalid = protocol::ResourceCreate2d {
            header: CtrlHeader {
                ty: protocol::CMD_RESOURCE_CREATE_2D,
                ..CtrlHeader::default()
            },
            resource_id: 42,
            format: 99,
            width: 4,
            height: 3,
        };
        write_bytes(&mut bus, REQUEST, &valid.to_bytes());
        write_bytes(&mut bus, REQUEST + 0x100, &invalid.to_bytes());
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, 40, 1, 1),
                (RESPONSE, 24, 2, 0),
                (REQUEST + 0x100, 40, 1, 3),
                (RESPONSE + 0x100, 24, 2, 0),
            ],
        );
        set_avail_heads(&mut bus, &[0, 2]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 2);
        assert_eq!(bus.load32(USED + 8).unwrap(), 24);
        assert_eq!(bus.load32(USED + 16).unwrap(), 24);
        let mut valid_response = [0u8; CTRL_HDR_SIZE];
        for (offset, byte) in valid_response.iter_mut().enumerate() {
            *byte = bus.load8(RESPONSE + offset as u64).unwrap();
        }
        let valid_header = CtrlHeader::from_bytes(&valid_response).unwrap();
        assert_eq!(valid_header.ty, protocol::RESP_OK_NODATA);
        assert_eq!(valid_header.flags, protocol::FLAG_FENCE);
        assert_eq!(valid_header.fence_id, valid.header.fence_id);

        let mut invalid_response = [0u8; CTRL_HDR_SIZE];
        for (offset, byte) in invalid_response.iter_mut().enumerate() {
            *byte = bus.load8(RESPONSE + 0x100 + offset as u64).unwrap();
        }
        assert_eq!(
            CtrlHeader::from_bytes(&invalid_response).unwrap().ty,
            protocol::RESP_ERR_INVALID_PARAMETER
        );
        let state = state.borrow();
        assert_eq!(state.resources.len(), 1);
        let resource = state.resources.get(41).unwrap();
        assert_eq!(resource.format, valid.format);
        assert_eq!(resource.host_pixels.len(), 12);
        assert!(resource.backing.is_empty());
        assert_eq!(state.resources.accounted_bytes(), 48);
    }

    #[test]
    fn gpu_resources_backing_controlq_validates_entries_atomically() {
        fn attach_bytes(
            header: protocol::ResourceAttachBacking,
            entries: &[protocol::ResourceMemEntry],
        ) -> alloc::vec::Vec<u8> {
            let mut bytes = alloc::vec::Vec::new();
            bytes.extend_from_slice(&header.to_bytes());
            for entry in entries {
                bytes.extend_from_slice(&entry.to_bytes());
            }
            bytes
        }

        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let valid_entries = [
            protocol::ResourceMemEntry {
                addr: DRAM_BASE + 0x80_000,
                length: 16,
                padding: 0,
            },
            protocol::ResourceMemEntry {
                addr: DRAM_BASE + 0x90_000,
                length: 32,
                padding: 0,
            },
        ];
        let valid_request = attach_bytes(
            protocol::ResourceAttachBacking {
                header: CtrlHeader {
                    ty: protocol::CMD_RESOURCE_ATTACH_BACKING,
                    flags: protocol::FLAG_FENCE,
                    fence_id: 0x55AA,
                    ..CtrlHeader::default()
                },
                resource_id: 1,
                nents: valid_entries.len() as u32,
            },
            &valid_entries,
        );
        let invalid_request = attach_bytes(
            protocol::ResourceAttachBacking {
                header: CtrlHeader {
                    ty: protocol::CMD_RESOURCE_ATTACH_BACKING,
                    ..CtrlHeader::default()
                },
                resource_id: 2,
                nents: 1,
            },
            &[protocol::ResourceMemEntry {
                addr: DRAM_BASE + (1 << 20) as u64 - 8,
                length: 16,
                padding: 0,
            }],
        );
        let zero_request = attach_bytes(
            protocol::ResourceAttachBacking {
                header: CtrlHeader {
                    ty: protocol::CMD_RESOURCE_ATTACH_BACKING,
                    ..CtrlHeader::default()
                },
                resource_id: 2,
                nents: 0,
            },
            &[],
        );
        let huge_request = attach_bytes(
            protocol::ResourceAttachBacking {
                header: CtrlHeader {
                    ty: protocol::CMD_RESOURCE_ATTACH_BACKING,
                    ..CtrlHeader::default()
                },
                resource_id: 2,
                nents: 0x1000_0000,
            },
            &[],
        );
        write_bytes(&mut bus, REQUEST, &valid_request);
        write_bytes(&mut bus, REQUEST + 0x100, &invalid_request);
        write_bytes(&mut bus, REQUEST + 0x200, &zero_request);
        write_bytes(&mut bus, REQUEST + 0x300, &huge_request);
        let descriptors = [
            (REQUEST, valid_request.len() as u32, 1, 1),
            (RESPONSE, 24, 2, 0),
            (REQUEST + 0x100, invalid_request.len() as u32, 1, 3),
            (RESPONSE + 0x100, 24, 2, 0),
            (REQUEST + 0x200, zero_request.len() as u32, 1, 5),
            (RESPONSE + 0x200, 24, 2, 0),
            (REQUEST + 0x300, huge_request.len() as u32, 1, 7),
            (RESPONSE + 0x300, 24, 2, 0),
        ];
        let (slot, state, mut vq) = queue_for_test(&mut bus, &descriptors);
        state
            .borrow_mut()
            .resources
            .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 2, 2)
            .unwrap();
        state
            .borrow_mut()
            .resources
            .create(2, protocol::FORMAT_B8G8R8X8_UNORM, 2, 2)
            .unwrap();
        set_avail_heads(&mut bus, &[0, 2, 4, 6]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 4);
        for (index, response) in [
            RESPONSE,
            RESPONSE + 0x100,
            RESPONSE + 0x200,
            RESPONSE + 0x300,
        ]
        .into_iter()
        .enumerate()
        {
            assert_eq!(
                bus.load32(response).unwrap(),
                match index {
                    0 | 2 => protocol::RESP_OK_NODATA,
                    _ => protocol::RESP_ERR_INVALID_PARAMETER,
                }
            );
            assert_eq!(bus.load32(USED + 8 + 8 * index as u64).unwrap(), 24);
        }
        let state = state.borrow();
        assert_eq!(
            state.resources.get(1).unwrap().backing,
            [(DRAM_BASE + 0x80_000, 16), (DRAM_BASE + 0x90_000, 32),]
        );
        assert!(state.resources.get(2).unwrap().backing.is_empty());
    }

    #[test]
    fn gpu_resources_backing_rejects_address_overflow_and_truncated_sglists() {
        fn attach_bytes(
            header: protocol::ResourceAttachBacking,
            entries: &[protocol::ResourceMemEntry],
        ) -> alloc::vec::Vec<u8> {
            let mut bytes = alloc::vec::Vec::new();
            bytes.extend_from_slice(&header.to_bytes());
            for entry in entries {
                bytes.extend_from_slice(&entry.to_bytes());
            }
            bytes
        }

        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let overflow_request = attach_bytes(
            protocol::ResourceAttachBacking {
                header: CtrlHeader {
                    ty: protocol::CMD_RESOURCE_ATTACH_BACKING,
                    ..CtrlHeader::default()
                },
                resource_id: 1,
                nents: 1,
            },
            &[protocol::ResourceMemEntry {
                addr: u64::MAX,
                length: 1,
                padding: 0,
            }],
        );
        let truncated_request = attach_bytes(
            protocol::ResourceAttachBacking {
                header: CtrlHeader {
                    ty: protocol::CMD_RESOURCE_ATTACH_BACKING,
                    ..CtrlHeader::default()
                },
                resource_id: 2,
                nents: 2,
            },
            &[protocol::ResourceMemEntry {
                addr: DRAM_BASE,
                length: 1,
                padding: 0,
            }],
        );
        write_bytes(&mut bus, REQUEST, &overflow_request);
        write_bytes(&mut bus, REQUEST + 0x100, &truncated_request);
        let descriptors = [
            (REQUEST, overflow_request.len() as u32, 1, 1),
            (RESPONSE, 24, 2, 0),
            (REQUEST + 0x100, truncated_request.len() as u32, 1, 3),
            (RESPONSE + 0x100, 24, 2, 0),
        ];
        let (slot, state, mut vq) = queue_for_test(&mut bus, &descriptors);
        state
            .borrow_mut()
            .resources
            .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 2, 2)
            .unwrap();
        state
            .borrow_mut()
            .resources
            .create(2, protocol::FORMAT_B8G8R8X8_UNORM, 2, 2)
            .unwrap();
        set_avail_heads(&mut bus, &[0, 2]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 2);
        assert_eq!(
            bus.load32(RESPONSE).unwrap(),
            protocol::RESP_ERR_INVALID_PARAMETER
        );
        assert_eq!(
            bus.load32(RESPONSE + 0x100).unwrap(),
            protocol::RESP_ERR_INVALID_PARAMETER
        );
        let state = state.borrow();
        assert!(state.resources.get(1).unwrap().backing.is_empty());
        assert!(state.resources.get(2).unwrap().backing.is_empty());
    }

    #[test]
    fn gpu_resources_backing_split_attach_then_detach_controlq() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let attach = {
            let header = protocol::ResourceAttachBacking {
                header: CtrlHeader {
                    ty: protocol::CMD_RESOURCE_ATTACH_BACKING,
                    ..CtrlHeader::default()
                },
                resource_id: 1,
                nents: 1,
            };
            let mut bytes = alloc::vec::Vec::new();
            bytes.extend_from_slice(&header.to_bytes());
            bytes.extend_from_slice(
                &protocol::ResourceMemEntry {
                    addr: DRAM_BASE + 0xA0_000,
                    length: 64,
                    padding: 0,
                }
                .to_bytes(),
            );
            bytes
        };
        let detach = protocol::ResourceDetachBacking {
            header: CtrlHeader {
                ty: protocol::CMD_RESOURCE_DETACH_BACKING,
                ..CtrlHeader::default()
            },
            resource_id: 1,
            padding: 0,
        }
        .to_bytes();
        write_bytes(&mut bus, REQUEST, &attach);
        write_bytes(&mut bus, REQUEST + 0x100, &detach);
        let descriptors = [
            (REQUEST, 32, 1, 1),
            (REQUEST + 32, 16, 1, 2),
            (RESPONSE, 24, 2, 0),
            (REQUEST + 0x100, 32, 1, 4),
            (RESPONSE + 0x100, 24, 2, 0),
        ];
        let (slot, state, mut vq) = queue_for_test(&mut bus, &descriptors);
        state
            .borrow_mut()
            .resources
            .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 2, 2)
            .unwrap();
        set_avail_heads(&mut bus, &[0, 3]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 2);
        assert_eq!(bus.load32(RESPONSE).unwrap(), protocol::RESP_OK_NODATA);
        assert_eq!(
            bus.load32(RESPONSE + 0x100).unwrap(),
            protocol::RESP_OK_NODATA
        );
        assert!(state.borrow().resources.get(1).unwrap().backing.is_empty());
    }

    #[test]
    fn gpu_resources_lifecycle_unref_clears_scanout_and_is_idempotently_rejected() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let unref = |resource_id| {
            protocol::ResourceUnref {
                header: CtrlHeader {
                    ty: protocol::CMD_RESOURCE_UNREF,
                    ..CtrlHeader::default()
                },
                resource_id,
                padding: 0,
            }
            .to_bytes()
        };
        let first = unref(1);
        let second = unref(1);
        let malformed = CtrlHeader {
            ty: protocol::CMD_RESOURCE_UNREF,
            ..CtrlHeader::default()
        }
        .to_bytes();
        write_bytes(&mut bus, REQUEST, &first);
        write_bytes(&mut bus, REQUEST + 0x100, &second);
        write_bytes(&mut bus, REQUEST + 0x200, &malformed);
        let descriptors = [
            (REQUEST, 32, 1, 1),
            (RESPONSE, 24, 2, 0),
            (REQUEST + 0x100, 32, 1, 3),
            (RESPONSE + 0x100, 24, 2, 0),
            (REQUEST + 0x200, 24, 1, 5),
            (RESPONSE + 0x200, 24, 2, 0),
        ];
        let (slot, state, mut vq) = queue_for_test(&mut bus, &descriptors);
        state
            .borrow_mut()
            .resources
            .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 8, 4)
            .unwrap();
        state
            .borrow_mut()
            .resources
            .attach_backing(1, alloc::vec![(DRAM_BASE + 0xB0_000, 128)])
            .unwrap();
        state.borrow_mut().scanout_resource = Some(1);
        assert_eq!(state.borrow().resources.accounted_bytes(), 128);
        set_avail_heads(&mut bus, &[0, 2, 4]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 3);
        assert_eq!(bus.load32(RESPONSE).unwrap(), protocol::RESP_OK_NODATA);
        assert_eq!(
            bus.load32(RESPONSE + 0x100).unwrap(),
            protocol::RESP_ERR_INVALID_RESOURCE_ID
        );
        assert_eq!(
            bus.load32(RESPONSE + 0x200).unwrap(),
            protocol::RESP_ERR_INVALID_PARAMETER
        );
        let state = state.borrow();
        assert!(state.resources.is_empty());
        assert_eq!(state.resources.accounted_bytes(), 0);
        assert_eq!(state.scanout_resource, None);
    }

    #[test]
    fn gpu_resources_lifecycle_device_reset_releases_resource_state() {
        let (mut gpu, state) = VirtioGpu::new_with_state();
        state.borrow_mut().set_display(1921, 1081);
        state
            .borrow_mut()
            .resources
            .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 4, 4)
            .unwrap();
        state.borrow_mut().scanout_resource = Some(1);

        VirtioDevice::reset(&mut gpu);

        let state = state.borrow();
        assert!(state.resources.is_empty());
        assert_eq!(state.resources.accounted_bytes(), 0);
        assert_eq!(state.scanout_resource, None);
        assert_eq!(
            state.display_size(),
            (DEFAULT_DISPLAY_WIDTH, DEFAULT_DISPLAY_HEIGHT)
        );
        assert_eq!(
            state.edid(),
            edid::edid_for(1280, 800, DEFAULT_DISPLAY_REFRESH_HZ)
        );
        assert_eq!(state.events_read, 0);
    }

    #[test]
    fn virtio_gpu_display_info_split_header_unfenced() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = CtrlHeader {
            ty: protocol::CMD_GET_DISPLAY_INFO,
            flags: 0,
            fence_id: 0xDEAD_BEEF,
            ctx_id: 7,
            ring_idx: 1,
            padding: [9, 8, 7],
        };
        write_bytes(&mut bus, REQUEST, &request.to_bytes());
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, 12, 1, 1),
                (REQUEST + 12, 12, 1, 2),
                (RESPONSE, 408, 2, 0),
            ],
        );
        state.borrow_mut().set_display(1601, 901);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 1);
        assert_eq!(bus.load32(USED + 8).unwrap(), 408);
        let mut bytes = [0u8; DISPLAY_INFO_RESPONSE_SIZE];
        for (offset, byte) in bytes.iter_mut().enumerate() {
            *byte = bus.load8(RESPONSE + offset as u64).unwrap();
        }
        let response = DisplayInfoResponse::from_bytes(&bytes).unwrap();
        assert_eq!(
            response.header.flags, 0,
            "unfenced response has no fence flag"
        );
        assert_eq!(
            response.header.fence_id, 0,
            "unfenced response has no fence id"
        );
        assert_eq!(response.header.ctx_id, request.ctx_id);
        assert_eq!(response.modes[0].width, 1601);
        assert_eq!(response.modes[0].height, 901);
        assert_eq!(state.borrow().commands_served, 1);
    }

    #[test]
    fn virtio_gpu_display_info_short_tail_is_bounded() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = CtrlHeader {
            ty: protocol::CMD_GET_DISPLAY_INFO,
            ..CtrlHeader::default()
        };
        write_bytes(&mut bus, REQUEST, &request.to_bytes());
        for offset in 0..64u64 {
            bus.store8(RESPONSE + 32 + offset, 0xA5).unwrap();
        }
        let (slot, state, mut vq) =
            queue_for_test(&mut bus, &[(REQUEST, 24, 1, 1), (RESPONSE, 32, 2, 0)]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 1);
        assert_eq!(bus.load32(USED + 8).unwrap(), 32, "tail truncates safely");
        for offset in 0..64u64 {
            assert_eq!(
                bus.load8(RESPONSE + 32 + offset).unwrap(),
                0xA5,
                "write escaped short tail at byte {offset}"
            );
        }
    }

    #[test]
    fn virtio_gpu_malformed_requests_make_progress_and_recover() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        const ERROR_RESPONSE: u64 = RESPONSE;
        const SHORT_RESPONSE: u64 = RESPONSE + 0x400;
        const VALID_RESPONSE: u64 = RESPONSE + 0x800;

        let unknown = CtrlHeader {
            ty: 0xDEAD,
            flags: protocol::FLAG_FENCE,
            fence_id: 0x1111,
            ctx_id: 1,
            ring_idx: 2,
            padding: [1, 2, 3],
        };
        let short = [protocol::CMD_GET_DISPLAY_INFO as u8];
        let valid = CtrlHeader {
            ty: protocol::CMD_GET_DISPLAY_INFO,
            ..CtrlHeader::default()
        };
        write_bytes(&mut bus, REQUEST, &unknown.to_bytes());
        write_bytes(&mut bus, REQUEST + 0x100, &short);
        write_bytes(&mut bus, REQUEST + 0x200, &valid.to_bytes());
        for offset in 0..408u64 {
            bus.store8(SHORT_RESPONSE + offset, 0xCC).unwrap();
        }

        // Chain 0: unsupported command + writable error response.
        // Chain 2: one-byte request + writable buffer (must be consumed without writing).
        // Chain 4: valid request with no writable descriptors (must still advance the ring).
        // Chain 5: valid request proving the queue remains usable afterward.
        let descriptors = [
            (REQUEST, 24, 1, 1),
            (ERROR_RESPONSE, 24, 2, 0),
            (REQUEST + 0x100, 1, 1, 3),
            (SHORT_RESPONSE, 408, 2, 0),
            (REQUEST + 0x200, 24, 0, 0),
            (REQUEST + 0x200, 24, 1, 6),
            (VALID_RESPONSE, 408, 2, 0),
        ];
        let (slot, state, mut vq) = queue_for_test(&mut bus, &descriptors);
        set_avail_heads(&mut bus, &[0, 2, 4, 5]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 4, "all four chains consumed");
        assert_eq!(bus.load32(USED + 8).unwrap(), 24, "error response length");
        assert_eq!(bus.load32(USED + 16).unwrap(), 0, "short request length");
        assert_eq!(bus.load32(USED + 24).unwrap(), 0, "no writable tail length");
        assert_eq!(bus.load32(USED + 32).unwrap(), 408, "valid response length");
        let error = [
            bus.load8(ERROR_RESPONSE).unwrap(),
            bus.load8(ERROR_RESPONSE + 1).unwrap(),
            bus.load8(ERROR_RESPONSE + 2).unwrap(),
            bus.load8(ERROR_RESPONSE + 3).unwrap(),
        ];
        assert_eq!(u32::from_le_bytes(error), protocol::RESP_ERR_UNSPEC);
        for offset in 0..408u64 {
            assert_eq!(
                bus.load8(SHORT_RESPONSE + offset).unwrap(),
                0xCC,
                "short request wrote at byte {offset}"
            );
        }
        let mut valid_bytes = [0u8; DISPLAY_INFO_RESPONSE_SIZE];
        for (offset, byte) in valid_bytes.iter_mut().enumerate() {
            *byte = bus.load8(VALID_RESPONSE + offset as u64).unwrap();
        }
        let valid_response = DisplayInfoResponse::from_bytes(&valid_bytes).unwrap();
        assert_eq!(valid_response.header.ty, protocol::RESP_OK_DISPLAY_INFO);
        assert_eq!(valid_response.modes[0].enabled, 1);
        assert_eq!(valid_response.modes[0].width, 1280);
        assert_eq!(state.borrow().commands_served, 2);
    }

    #[test]
    fn virtio_gpu_malformed_guest_address_is_rejected_without_write() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        write_bytes(
            &mut bus,
            REQUEST,
            &CtrlHeader {
                ty: protocol::CMD_GET_DISPLAY_INFO,
                ..CtrlHeader::default()
            }
            .to_bytes(),
        );
        let end_straddling = DRAM_BASE + (1 << 20) as u64 - 8;
        let (slot, state, mut vq) =
            queue_for_test(&mut bus, &[(REQUEST, 24, 1, 1), (end_straddling, 24, 2, 0)]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert!(vq.is_none(), "bad descriptor drops the cached queue view");
        assert_ne!(
            read32(&mut slot.borrow_mut(), STATUS) & STATUS_NEEDS_RESET,
            0
        );
        assert_eq!(state.borrow().commands_served, 0);
        assert_eq!(bus.load16(USED + 2).unwrap(), 0, "no stale used entry");
    }

    #[test]
    fn gpu_scanout_binding_wire_fixture_is_little_endian() {
        let request = SetScanout {
            header: CtrlHeader {
                ty: CMD_SET_SCANOUT,
                flags: 0x1122_3344,
                fence_id: 0x0102_0304_0506_0708,
                ctx_id: 0xA1B2_C3D4,
                ring_idx: 9,
                padding: [0x0A, 0x0B, 0x0C],
            },
            rect: Rect {
                x: 0x1020_3040,
                y: 0x5060_7080,
                width: 0x90A0_B0C0,
                height: 0xD0E0_F000,
            },
            scanout_id: 2,
            resource_id: 0x1122_3344,
        };
        let expected = [
            0x05, 0x01, 0x00, 0x00, // type
            0x44, 0x33, 0x22, 0x11, // flags
            0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, // fence_id
            0xD4, 0xC3, 0xB2, 0xA1, // ctx_id
            0x09, 0x0A, 0x0B, 0x0C, // ring_idx + padding
            0x40, 0x30, 0x20, 0x10, // rect.x
            0x80, 0x70, 0x60, 0x50, // rect.y
            0xC0, 0xB0, 0xA0, 0x90, // rect.width
            0x00, 0xF0, 0xE0, 0xD0, // rect.height
            0x02, 0x00, 0x00, 0x00, // scanout_id
            0x44, 0x33, 0x22, 0x11, // resource_id
        ];
        assert_eq!(request.to_bytes(), expected);
        assert_eq!(SetScanout::from_bytes(&expected), Some(request));
    }

    #[test]
    fn gpu_scanout_binding_controlq_binds_existing_resource() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = scanout_request(
            1,
            0,
            Rect {
                x: 0,
                y: 0,
                width: 4,
                height: 3,
            },
        );
        write_bytes(&mut bus, REQUEST, &request);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, SET_SCANOUT_SIZE as u32, 1, 1),
                (RESPONSE, 24, 2, 0),
            ],
        );
        state
            .borrow_mut()
            .resources
            .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 4, 3)
            .unwrap();
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 1);
        assert_eq!(bus.load32(RESPONSE).unwrap(), protocol::RESP_OK_NODATA);
        assert_eq!(state.borrow().scanout_resource, Some(1));
    }

    #[test]
    fn gpu_scanout_binding_split_request_is_parsed_across_descriptors() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = scanout_request(
            1,
            0,
            Rect {
                x: 1,
                y: 1,
                width: 2,
                height: 2,
            },
        );
        write_bytes(&mut bus, REQUEST, &request);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, 16, 1, 1),
                (REQUEST + 16, (SET_SCANOUT_SIZE - 16) as u32, 1, 2),
                (RESPONSE, 24, 2, 0),
            ],
        );
        state
            .borrow_mut()
            .resources
            .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 4, 4)
            .unwrap();
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 1);
        assert_eq!(bus.load32(RESPONSE).unwrap(), protocol::RESP_OK_NODATA);
        assert_eq!(state.borrow().scanout_resource, Some(1));
    }

    #[test]
    fn gpu_scanout_binding_zero_resource_disables_scanout() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = scanout_request(
            0,
            0,
            Rect {
                x: u32::MAX,
                y: u32::MAX,
                width: u32::MAX,
                height: u32::MAX,
            },
        );
        write_bytes(&mut bus, REQUEST, &request);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, SET_SCANOUT_SIZE as u32, 1, 1),
                (RESPONSE, 24, 2, 0),
            ],
        );
        state.borrow_mut().scanout_resource = Some(7);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load32(RESPONSE).unwrap(), protocol::RESP_OK_NODATA);
        assert_eq!(state.borrow().scanout_resource, None);
    }

    #[test]
    fn gpu_scanout_binding_short_request_is_bounded() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = CtrlHeader {
            ty: CMD_SET_SCANOUT,
            ..CtrlHeader::default()
        };
        write_bytes(&mut bus, REQUEST, &request.to_bytes());
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[(REQUEST, CTRL_HDR_SIZE as u32, 1, 1), (RESPONSE, 24, 2, 0)],
        );
        state.borrow_mut().scanout_resource = Some(9);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(
            bus.load32(RESPONSE).unwrap(),
            protocol::RESP_ERR_INVALID_PARAMETER
        );
        assert_eq!(state.borrow().scanout_resource, Some(9));
    }

    #[test]
    fn gpu_scanout_binding_rejects_bad_scanout_and_rect_without_mutation() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let bad_scanout = scanout_request(
            1,
            DEFAULT_NUM_SCANOUTS,
            Rect {
                x: 0,
                y: 0,
                width: 4,
                height: 3,
            },
        );
        let extreme_scanout = scanout_request(
            1,
            u32::MAX,
            Rect {
                x: 0,
                y: 0,
                width: 4,
                height: 3,
            },
        );
        let unknown_resource = scanout_request(
            u32::MAX,
            0,
            Rect {
                x: 0,
                y: 0,
                width: 4,
                height: 3,
            },
        );
        let bad_rect = scanout_request(
            1,
            0,
            Rect {
                x: u32::MAX,
                y: u32::MAX,
                width: u32::MAX,
                height: u32::MAX,
            },
        );
        write_bytes(&mut bus, REQUEST, &bad_scanout);
        write_bytes(&mut bus, REQUEST + 0x100, &extreme_scanout);
        write_bytes(&mut bus, REQUEST + 0x200, &unknown_resource);
        write_bytes(&mut bus, REQUEST + 0x300, &bad_rect);
        let descriptors = [
            (REQUEST, SET_SCANOUT_SIZE as u32, 1, 1),
            (RESPONSE, 24, 2, 0),
            (REQUEST + 0x100, SET_SCANOUT_SIZE as u32, 1, 3),
            (RESPONSE + 0x100, 24, 2, 0),
            (REQUEST + 0x200, SET_SCANOUT_SIZE as u32, 1, 5),
            (RESPONSE + 0x200, 24, 2, 0),
            (REQUEST + 0x300, SET_SCANOUT_SIZE as u32, 1, 7),
            (RESPONSE + 0x300, 24, 2, 0),
        ];
        let (slot, state, mut vq) = queue_for_test(&mut bus, &descriptors);
        state
            .borrow_mut()
            .resources
            .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 4, 3)
            .unwrap();
        state.borrow_mut().scanout_resource = Some(1);
        set_avail_heads(&mut bus, &[0, 2, 4, 6]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 4);
        assert_eq!(
            bus.load32(RESPONSE).unwrap(),
            protocol::RESP_ERR_INVALID_PARAMETER
        );
        assert_eq!(
            bus.load32(RESPONSE + 0x100).unwrap(),
            protocol::RESP_ERR_INVALID_PARAMETER
        );
        assert_eq!(
            bus.load32(RESPONSE + 0x200).unwrap(),
            protocol::RESP_ERR_INVALID_RESOURCE_ID
        );
        assert_eq!(
            bus.load32(RESPONSE + 0x300).unwrap(),
            protocol::RESP_ERR_INVALID_PARAMETER
        );
        assert_eq!(state.borrow().scanout_resource, Some(1));
    }

    #[test]
    fn gpu_flush_wire_fixture_is_little_endian() {
        let request = ResourceFlush {
            header: CtrlHeader {
                ty: CMD_RESOURCE_FLUSH,
                flags: 0x1122_3344,
                fence_id: 0x0102_0304_0506_0708,
                ctx_id: 0xA1B2_C3D4,
                ring_idx: 9,
                padding: [0x0A, 0x0B, 0x0C],
            },
            rect: Rect {
                x: 0x1020_3040,
                y: 0x5060_7080,
                width: 0x90A0_B0C0,
                height: 0xD0E0_F000,
            },
            resource_id: 0x1122_3344,
            padding: 0xAABB_CCDD,
        };
        let expected = [
            0x07, 0x01, 0x00, 0x00, // type
            0x44, 0x33, 0x22, 0x11, // flags
            0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, // fence_id
            0xD4, 0xC3, 0xB2, 0xA1, // ctx_id
            0x09, 0x0A, 0x0B, 0x0C, // ring_idx + padding
            0x40, 0x30, 0x20, 0x10, // rect.x
            0x80, 0x70, 0x60, 0x50, // rect.y
            0xC0, 0xB0, 0xA0, 0x90, // rect.width
            0x00, 0xF0, 0xE0, 0xD0, // rect.height
            0x44, 0x33, 0x22, 0x11, // resource_id
            0xDD, 0xCC, 0xBB, 0xAA, // padding
        ];
        assert_eq!(request.to_bytes(), expected);
        assert_eq!(ResourceFlush::from_bytes(&expected), Some(request));
        assert_eq!(ResourceFlush::from_bytes(&expected[..47]), None);
    }

    #[test]
    fn gpu_transfer_wire_fixture_is_little_endian() {
        let request = TransferToHost2d {
            header: CtrlHeader {
                ty: CMD_TRANSFER_TO_HOST_2D,
                flags: 0x1122_3344,
                fence_id: 0x0102_0304_0506_0708,
                ctx_id: 0xA1B2_C3D4,
                ring_idx: 9,
                padding: [0x0A, 0x0B, 0x0C],
            },
            rect: Rect {
                x: 1,
                y: 2,
                width: 3,
                height: 4,
            },
            offset: 0x0102_0304_0506_0708,
            resource_id: 0x1122_3344,
            padding: 0xAABB_CCDD,
        };
        let expected = [
            0x06, 0x01, 0x00, 0x00, // type
            0x44, 0x33, 0x22, 0x11, // flags
            0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, // fence_id
            0xD4, 0xC3, 0xB2, 0xA1, // ctx_id
            0x09, 0x0A, 0x0B, 0x0C, // ring_idx + padding
            0x01, 0x00, 0x00, 0x00, // rect.x
            0x02, 0x00, 0x00, 0x00, // rect.y
            0x03, 0x00, 0x00, 0x00, // rect.width
            0x04, 0x00, 0x00, 0x00, // rect.height
            0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, // offset
            0x44, 0x33, 0x22, 0x11, // resource_id
            0xDD, 0xCC, 0xBB, 0xAA, // padding
        ];
        assert_eq!(request.to_bytes(), expected);
        assert_eq!(TransferToHost2d::from_bytes(&expected), Some(request));
    }

    #[test]
    fn gpu_transfer_controlq_copies_sg_rows_and_echoes_fence() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let source_addr = DRAM_BASE + 0x60_000;
        let source: alloc::vec::Vec<u8> = (0..8u32)
            .flat_map(|pixel| (0xCAFE_0000 | pixel).to_le_bytes())
            .collect();
        bus.ram_mut().write_slice(source_addr, &source).unwrap();
        let request = TransferToHost2d {
            header: CtrlHeader {
                ty: CMD_TRANSFER_TO_HOST_2D,
                flags: protocol::FLAG_FENCE,
                fence_id: 0x0123_4567_89AB_CDEF,
                ..CtrlHeader::default()
            },
            rect: Rect {
                x: 1,
                y: 0,
                width: 2,
                height: 2,
            },
            offset: 0,
            resource_id: 1,
            padding: 0,
        }
        .to_bytes();
        write_bytes(&mut bus, REQUEST, &request);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, TRANSFER_TO_HOST_2D_SIZE as u32, 1, 1),
                (RESPONSE, 24, 2, 0),
            ],
        );
        state
            .borrow_mut()
            .resources
            .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 4, 2)
            .unwrap();
        state
            .borrow_mut()
            .resources
            .attach_backing(1, alloc::vec![(source_addr, 7), (source_addr + 7, 25)])
            .unwrap();
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        let mut response = [0u8; CTRL_HDR_SIZE];
        for (offset, byte) in response.iter_mut().enumerate() {
            *byte = bus.load8(RESPONSE + offset as u64).unwrap();
        }
        let response = CtrlHeader::from_bytes(&response).unwrap();
        assert_eq!(response.ty, protocol::RESP_OK_NODATA);
        assert_eq!(response.flags, protocol::FLAG_FENCE);
        assert_eq!(response.fence_id, 0x0123_4567_89AB_CDEF);
        assert_eq!(bus.load16(USED + 2).unwrap(), 1);
        let state = state.borrow();
        let pixels = &state.resources.get(1).unwrap().host_pixels;
        assert_eq!(pixels[1], 0xCAFE_0001);
        assert_eq!(pixels[2], 0xCAFE_0002);
        assert_eq!(pixels[5], 0xCAFE_0005);
        assert_eq!(pixels[6], 0xCAFE_0006);
        assert_eq!(pixels[0], 0);
        assert_eq!(pixels[3], 0);
        assert_eq!(pixels[4], 0);
        assert_eq!(pixels[7], 0);
    }

    #[test]
    fn gpu_flush_controlq_calls_test_sink_with_resource_crc() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let rect = Rect {
            x: 1,
            y: 0,
            width: 1,
            height: 2,
        };
        let request = ResourceFlush {
            header: CtrlHeader {
                ty: CMD_RESOURCE_FLUSH,
                flags: protocol::FLAG_FENCE,
                fence_id: 0x0123_4567_89AB_CDEF,
                ctx_id: 7,
                ring_idx: 2,
                ..CtrlHeader::default()
            },
            rect,
            resource_id: 1,
            padding: 0,
        }
        .to_bytes();
        write_bytes(&mut bus, REQUEST, &request);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, RESOURCE_FLUSH_SIZE as u32, 1, 1),
                (RESPONSE, 24, 2, 0),
            ],
        );
        let sink = TestSink::new();
        {
            let mut state_ref = state.borrow_mut();
            let resource = state_ref
                .resources
                .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 2, 2)
                .unwrap();
            resource.host_pixels.copy_from_slice(&[
                0x0102_0304,
                0xAABB_CCDD,
                0x1122_3344,
                0x5566_7788,
            ]);
            state_ref.frame_sink = Box::new(sink.clone());
        }
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        let mut response_bytes = [0u8; CTRL_HDR_SIZE];
        for (offset, byte) in response_bytes.iter_mut().enumerate() {
            *byte = bus.load8(RESPONSE + offset as u64).unwrap();
        }
        let response = CtrlHeader::from_bytes(&response_bytes).unwrap();
        assert_eq!(response.ty, protocol::RESP_OK_NODATA);
        assert_eq!(response.flags, protocol::FLAG_FENCE);
        assert_eq!(response.fence_id, 0x0123_4567_89AB_CDEF);
        assert_eq!(response.ctx_id, 7);
        assert_eq!(response.ring_idx, 2);
        assert_eq!(response_type(&mut bus, RESPONSE), protocol::RESP_OK_NODATA);
        assert_eq!(sink.len(), 1);
        assert_eq!(
            sink.records(),
            [FlushRecord {
                scanout: None,
                rect,
                resource_width: 2,
                resource_height: 2,
                crc32: reference_crc32(&[0x0102_0304, 0xAABB_CCDD, 0x1122_3344, 0x5566_7788,]),
            }]
        );
    }

    #[test]
    fn gpu_flush_default_null_sink_accepts_headless_path() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = flush_request(
            1,
            Rect {
                x: 0,
                y: 0,
                width: 2,
                height: 2,
            },
        );
        write_bytes(&mut bus, REQUEST, &request);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, RESOURCE_FLUSH_SIZE as u32, 1, 1),
                (RESPONSE, 24, 2, 0),
            ],
        );
        state
            .borrow_mut()
            .resources
            .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 2, 2)
            .unwrap();
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(response_type(&mut bus, RESPONSE), protocol::RESP_OK_NODATA);
    }

    #[test]
    fn gpu_flush_after_scanout_disable_forwards_old_resource_without_binding() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let disable = scanout_request(
            0,
            0,
            Rect {
                x: u32::MAX,
                y: u32::MAX,
                width: u32::MAX,
                height: u32::MAX,
            },
        );
        let rect = Rect {
            x: 0,
            y: 1,
            width: 2,
            height: 1,
        };
        let flush = flush_request(1, rect);
        write_bytes(&mut bus, REQUEST, &disable);
        write_bytes(&mut bus, REQUEST + 0x100, &flush);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, SET_SCANOUT_SIZE as u32, 1, 1),
                (RESPONSE, 24, 2, 0),
                (REQUEST + 0x100, RESOURCE_FLUSH_SIZE as u32, 1, 3),
                (RESPONSE + 0x100, 24, 2, 0),
            ],
        );
        let sink = TestSink::new();
        {
            let mut state_ref = state.borrow_mut();
            state_ref
                .resources
                .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 2, 2)
                .unwrap();
            state_ref.scanout_resource = Some(1);
            state_ref.frame_sink = Box::new(sink.clone());
        }
        set_avail_heads(&mut bus, &[0, 2]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(response_type(&mut bus, RESPONSE), protocol::RESP_OK_NODATA);
        assert_eq!(
            response_type(&mut bus, RESPONSE + 0x100),
            protocol::RESP_OK_NODATA
        );
        assert_eq!(state.borrow().scanout_resource, None);
        assert_eq!(
            sink.records(),
            alloc::vec![FlushRecord {
                scanout: None,
                rect,
                resource_width: 2,
                resource_height: 2,
                crc32: reference_crc32(&[0, 0, 0, 0]),
            }]
        );
    }

    #[test]
    fn gpu_flush_rejects_unknown_short_and_out_of_bounds_requests_without_sink_event() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let unknown = flush_request(
            99,
            Rect {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
        );
        let outside = flush_request(
            1,
            Rect {
                x: 2,
                y: 0,
                width: 1,
                height: 1,
            },
        );
        let overflow = flush_request(
            1,
            Rect {
                x: u32::MAX,
                y: u32::MAX,
                width: 1,
                height: 1,
            },
        );
        let short = flush_request(
            1,
            Rect {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
        );
        write_bytes(&mut bus, REQUEST, &unknown);
        write_bytes(&mut bus, REQUEST + 0x100, &outside);
        write_bytes(&mut bus, REQUEST + 0x200, &overflow);
        write_bytes(&mut bus, REQUEST + 0x300, &short);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, RESOURCE_FLUSH_SIZE as u32, 1, 1),
                (RESPONSE, 24, 2, 0),
                (REQUEST + 0x100, RESOURCE_FLUSH_SIZE as u32, 1, 3),
                (RESPONSE + 0x100, 24, 2, 0),
                (REQUEST + 0x200, RESOURCE_FLUSH_SIZE as u32, 1, 5),
                (RESPONSE + 0x200, 24, 2, 0),
                (REQUEST + 0x300, (RESOURCE_FLUSH_SIZE - 1) as u32, 1, 7),
                (RESPONSE + 0x300, 24, 2, 0),
            ],
        );
        let sink = TestSink::new();
        {
            let mut state_ref = state.borrow_mut();
            state_ref
                .resources
                .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 2, 2)
                .unwrap();
            state_ref.frame_sink = Box::new(sink.clone());
        }
        set_avail_heads(&mut bus, &[0, 2, 4, 6]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(
            response_type(&mut bus, RESPONSE),
            protocol::RESP_ERR_INVALID_RESOURCE_ID
        );
        for offset in [0x100, 0x200, 0x300] {
            assert_eq!(
                response_type(&mut bus, RESPONSE + offset),
                protocol::RESP_ERR_INVALID_PARAMETER
            );
        }
        assert_eq!(sink.len(), 0);
    }

    #[test]
    fn gpu_flush_after_unref_rejects_old_resource_without_sink_event() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let unref = protocol::ResourceUnref {
            header: CtrlHeader {
                ty: protocol::CMD_RESOURCE_UNREF,
                ..CtrlHeader::default()
            },
            resource_id: 1,
            padding: 0,
        }
        .to_bytes();
        let flush = flush_request(
            1,
            Rect {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
        );
        write_bytes(&mut bus, REQUEST, &unref);
        write_bytes(&mut bus, REQUEST + 0x100, &flush);
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, protocol::RESOURCE_UNREF_SIZE as u32, 1, 1),
                (RESPONSE, 24, 2, 0),
                (REQUEST + 0x100, RESOURCE_FLUSH_SIZE as u32, 1, 3),
                (RESPONSE + 0x100, 24, 2, 0),
            ],
        );
        let sink = TestSink::new();
        {
            let mut state_ref = state.borrow_mut();
            state_ref
                .resources
                .create(1, protocol::FORMAT_B8G8R8A8_UNORM, 2, 2)
                .unwrap();
            state_ref.scanout_resource = Some(1);
            state_ref.frame_sink = Box::new(sink.clone());
        }
        set_avail_heads(&mut bus, &[0, 2]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(response_type(&mut bus, RESPONSE), protocol::RESP_OK_NODATA);
        assert_eq!(
            response_type(&mut bus, RESPONSE + 0x100),
            protocol::RESP_ERR_INVALID_RESOURCE_ID
        );
        assert_eq!(state.borrow().scanout_resource, None);
        assert_eq!(sink.len(), 0);
    }

    #[test]
    fn gpu_flush_golden_five_patterns_match_independent_reference() {
        const WIDTH: u32 = 7;
        const HEIGHT: u32 = 5;
        let full_rect = Rect {
            x: 0,
            y: 0,
            width: WIDTH,
            height: HEIGHT,
        };

        for (index, &damage) in GOLDEN_RECTS.iter().enumerate() {
            let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
            let source_addr = DRAM_BASE + 0x60_000;
            let pattern = golden_pattern(index, WIDTH, HEIGHT);
            let source: alloc::vec::Vec<u8> = pattern
                .iter()
                .flat_map(|pixel| pixel.to_le_bytes())
                .collect();
            bus.ram_mut().write_slice(source_addr, &source).unwrap();

            let lengths = GOLDEN_BACKING_LENGTHS[index];
            let mut entries = alloc::vec::Vec::new();
            let mut source_offset = 0usize;
            for &length in lengths {
                entries.push(protocol::ResourceMemEntry {
                    addr: source_addr + source_offset as u64,
                    length,
                    padding: 0,
                });
                source_offset += length as usize;
            }
            assert_eq!(source_offset, source.len(), "pattern {index} backing");

            let create = protocol::ResourceCreate2d {
                header: CtrlHeader {
                    ty: protocol::CMD_RESOURCE_CREATE_2D,
                    ..CtrlHeader::default()
                },
                resource_id: 1,
                format: protocol::FORMAT_B8G8R8A8_UNORM,
                width: WIDTH,
                height: HEIGHT,
            }
            .to_bytes()
            .to_vec();
            let mut attach = protocol::ResourceAttachBacking {
                header: CtrlHeader {
                    ty: protocol::CMD_RESOURCE_ATTACH_BACKING,
                    ..CtrlHeader::default()
                },
                resource_id: 1,
                nents: entries.len() as u32,
            }
            .to_bytes()
            .to_vec();
            for entry in entries {
                attach.extend_from_slice(&entry.to_bytes());
            }
            let scanout = scanout_request(1, 0, full_rect).to_vec();
            let transfer = TransferToHost2d {
                header: CtrlHeader {
                    ty: CMD_TRANSFER_TO_HOST_2D,
                    ..CtrlHeader::default()
                },
                rect: damage,
                offset: 0,
                resource_id: 1,
                padding: 0,
            }
            .to_bytes()
            .to_vec();
            let flush = flush_request(1, damage).to_vec();
            let requests = alloc::vec![create, attach, scanout, transfer, flush];

            let mut descriptors = alloc::vec::Vec::new();
            for (command, request) in requests.iter().enumerate() {
                let offset = command as u64 * 0x200;
                let request_addr = REQUEST + offset;
                let response_addr = RESPONSE + offset;
                write_bytes(&mut bus, request_addr, request);
                descriptors.push((
                    request_addr,
                    request.len() as u32,
                    1,
                    (command * 2 + 1) as u16,
                ));
                descriptors.push((response_addr, 24, 2, 0));
            }
            let (slot, state, mut vq) = queue_for_test(&mut bus, &descriptors);
            let sink = TestSink::new();
            state.borrow_mut().frame_sink = Box::new(sink.clone());
            set_avail_heads(&mut bus, &[0, 2, 4, 6, 8]);
            slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

            service(&slot, &mut vq, &state, &mut bus);

            for command in 0..requests.len() {
                assert_eq!(
                    response_type(&mut bus, RESPONSE + command as u64 * 0x200),
                    protocol::RESP_OK_NODATA,
                    "pattern {index} command {command}"
                );
            }
            assert_eq!(state.borrow().scanout_resource, Some(1));

            let mut expected = alloc::vec![0u32; pattern.len()];
            for row in damage.y..damage.y + damage.height {
                for column in damage.x..damage.x + damage.width {
                    let pixel = (row * WIDTH + column) as usize;
                    expected[pixel] = pattern[pixel];
                }
            }
            assert_eq!(
                reference_crc32(&expected),
                GOLDEN_CRC32[index],
                "reference fixture {index}"
            );
            let mut mutated = expected.clone();
            mutated[(damage.y * WIDTH + damage.x) as usize] ^= 1;
            assert_ne!(
                reference_crc32(&mutated),
                GOLDEN_CRC32[index],
                "mutated fixture {index} must fail"
            );
            assert_eq!(
                sink.records(),
                alloc::vec![FlushRecord {
                    scanout: Some(0),
                    rect: damage,
                    resource_width: WIDTH,
                    resource_height: HEIGHT,
                    crc32: GOLDEN_CRC32[index],
                }],
                "sink record {index}"
            );

            // Guest backing is not the sink's pixel view: mutating the source after TRANSFER and
            // FLUSH cannot alter either the host shadow or the already-owned record.
            let original = bus.load8(source_addr).unwrap();
            bus.store8(source_addr, original ^ 0xff).unwrap();
            assert_eq!(sink.records()[0].crc32, GOLDEN_CRC32[index]);
            assert_eq!(
                state
                    .borrow()
                    .resources
                    .get(1)
                    .unwrap()
                    .host_pixels
                    .as_ref(),
                expected.as_slice()
            );
        }
    }
}
