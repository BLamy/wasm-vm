//! Little-endian virtio-gpu control protocol types (virtio spec 1.2 §5.7).
//!
//! These types intentionally use explicit byte encoding instead of host-layout casts.  The same
//! methods therefore produce identical fixtures on native and wasm32 targets.

/// `VIRTIO_GPU_CMD_GET_DISPLAY_INFO`.
pub const CMD_GET_DISPLAY_INFO: u32 = 0x0100;
/// Successful `GET_DISPLAY_INFO` response.
pub const RESP_OK_DISPLAY_INFO: u32 = 0x1101;
/// Generic unsupported/malformed-command response (used by E5-T01c).
pub const RESP_ERR_UNSPEC: u32 = 0x1200;
/// Request/response fence flag.
pub const FLAG_FENCE: u32 = 1 << 0;

/// Number of display modes carried by `virtio_gpu_resp_display_info`.
pub const DISPLAY_MODE_COUNT: usize = 16;
/// Wire size of `virtio_gpu_ctrl_hdr`.
pub const CTRL_HDR_SIZE: usize = 24;
/// Wire size of one `virtio_gpu_display_one`.
pub const DISPLAY_MODE_SIZE: usize = 24;
/// Wire size of `virtio_gpu_resp_display_info`.
pub const DISPLAY_INFO_RESPONSE_SIZE: usize =
    CTRL_HDR_SIZE + DISPLAY_MODE_COUNT * DISPLAY_MODE_SIZE;

/// `virtio_gpu_ctrl_hdr`, encoded as le32/le32/le64/le32/u8/u8[3].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CtrlHeader {
    pub ty: u32,
    pub flags: u32,
    pub fence_id: u64,
    pub ctx_id: u32,
    pub ring_idx: u8,
    pub padding: [u8; 3],
}

impl CtrlHeader {
    /// Encode the header into its exact 24-byte wire representation.
    pub fn to_bytes(self) -> [u8; CTRL_HDR_SIZE] {
        let mut out = [0u8; CTRL_HDR_SIZE];
        out[0..4].copy_from_slice(&self.ty.to_le_bytes());
        out[4..8].copy_from_slice(&self.flags.to_le_bytes());
        out[8..16].copy_from_slice(&self.fence_id.to_le_bytes());
        out[16..20].copy_from_slice(&self.ctx_id.to_le_bytes());
        out[20] = self.ring_idx;
        out[21..24].copy_from_slice(&self.padding);
        out
    }

    /// Decode a complete header; short input is rejected without indexing it.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < CTRL_HDR_SIZE {
            return None;
        }
        Some(Self {
            ty: u32::from_le_bytes(bytes[0..4].try_into().ok()?),
            flags: u32::from_le_bytes(bytes[4..8].try_into().ok()?),
            fence_id: u64::from_le_bytes(bytes[8..16].try_into().ok()?),
            ctx_id: u32::from_le_bytes(bytes[16..20].try_into().ok()?),
            ring_idx: bytes[20],
            padding: [bytes[21], bytes[22], bytes[23]],
        })
    }
}

/// One entry in `virtio_gpu_resp_display_info.pmodes`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DisplayMode {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub enabled: u32,
    pub flags: u32,
}

impl DisplayMode {
    /// Encode one display mode into its exact 24-byte wire representation.
    pub fn to_bytes(self) -> [u8; DISPLAY_MODE_SIZE] {
        let mut out = [0u8; DISPLAY_MODE_SIZE];
        out[0..4].copy_from_slice(&self.x.to_le_bytes());
        out[4..8].copy_from_slice(&self.y.to_le_bytes());
        out[8..12].copy_from_slice(&self.width.to_le_bytes());
        out[12..16].copy_from_slice(&self.height.to_le_bytes());
        out[16..20].copy_from_slice(&self.enabled.to_le_bytes());
        out[20..24].copy_from_slice(&self.flags.to_le_bytes());
        out
    }

    /// Decode one complete display mode; short input is rejected.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < DISPLAY_MODE_SIZE {
            return None;
        }
        Some(Self {
            x: u32::from_le_bytes(bytes[0..4].try_into().ok()?),
            y: u32::from_le_bytes(bytes[4..8].try_into().ok()?),
            width: u32::from_le_bytes(bytes[8..12].try_into().ok()?),
            height: u32::from_le_bytes(bytes[12..16].try_into().ok()?),
            enabled: u32::from_le_bytes(bytes[16..20].try_into().ok()?),
            flags: u32::from_le_bytes(bytes[20..24].try_into().ok()?),
        })
    }
}

/// `virtio_gpu_resp_display_info`: a response header plus sixteen display modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DisplayInfoResponse {
    pub header: CtrlHeader,
    pub modes: [DisplayMode; DISPLAY_MODE_COUNT],
}

impl DisplayInfoResponse {
    /// Build the initial one-scanout response.  Later modes remain disabled and zeroed.
    pub fn new(header: CtrlHeader) -> Self {
        let mut modes = [DisplayMode::default(); DISPLAY_MODE_COUNT];
        modes[0] = DisplayMode {
            width: 1280,
            height: 800,
            enabled: 1,
            ..DisplayMode::default()
        };
        Self { header, modes }
    }

    /// Encode the complete response into the exact 408-byte wire representation.
    pub fn to_bytes(self) -> [u8; DISPLAY_INFO_RESPONSE_SIZE] {
        let mut out = [0u8; DISPLAY_INFO_RESPONSE_SIZE];
        out[0..CTRL_HDR_SIZE].copy_from_slice(&self.header.to_bytes());
        for (index, mode) in self.modes.iter().enumerate() {
            let start = CTRL_HDR_SIZE + index * DISPLAY_MODE_SIZE;
            out[start..start + DISPLAY_MODE_SIZE].copy_from_slice(&mode.to_bytes());
        }
        out
    }

    /// Decode the complete response; every header and mode boundary is checked before access.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < DISPLAY_INFO_RESPONSE_SIZE {
            return None;
        }
        let header = CtrlHeader::from_bytes(&bytes[0..CTRL_HDR_SIZE])?;
        let mut modes = [DisplayMode::default(); DISPLAY_MODE_COUNT];
        for (index, mode) in modes.iter_mut().enumerate() {
            let start = CTRL_HDR_SIZE + index * DISPLAY_MODE_SIZE;
            *mode = DisplayMode::from_bytes(&bytes[start..start + DISPLAY_MODE_SIZE])?;
        }
        Some(Self { header, modes })
    }
}

/// Names matching the C/UAPI structures are useful at the queue boundary and keep call sites
/// self-documenting without making the Rust field names depend on C keywords.
pub type VirtioGpuCtrlHdr = CtrlHeader;
pub type VirtioGpuDisplayOne = DisplayMode;
pub type VirtioGpuRespDisplayInfo = DisplayInfoResponse;
