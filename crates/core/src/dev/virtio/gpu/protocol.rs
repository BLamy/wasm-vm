//! Little-endian virtio-gpu control protocol types (virtio spec 1.2 §5.7).
//!
//! These types intentionally use explicit byte encoding instead of host-layout casts.  The same
//! methods therefore produce identical fixtures on native and wasm32 targets.

/// `VIRTIO_GPU_CMD_GET_DISPLAY_INFO`.
pub const CMD_GET_DISPLAY_INFO: u32 = 0x0100;
/// `VIRTIO_GPU_CMD_RESOURCE_CREATE_2D`.
pub const CMD_RESOURCE_CREATE_2D: u32 = 0x0101;
/// `VIRTIO_GPU_CMD_RESOURCE_ATTACH_BACKING`.
pub const CMD_RESOURCE_ATTACH_BACKING: u32 = 0x0102;
/// `VIRTIO_GPU_CMD_RESOURCE_DETACH_BACKING`.
pub const CMD_RESOURCE_DETACH_BACKING: u32 = 0x0103;
/// Successful `GET_DISPLAY_INFO` response.
pub const RESP_OK_DISPLAY_INFO: u32 = 0x1101;
/// Successful command with no response payload.
pub const RESP_OK_NODATA: u32 = 0x1100;
/// Generic unsupported/malformed-command response (used by E5-T01c).
pub const RESP_ERR_UNSPEC: u32 = 0x1200;
/// Resource command errors (virtio-gpu spec §5.7.6.4).
pub const RESP_ERR_OUT_OF_MEMORY: u32 = 0x1201;
pub const RESP_ERR_INVALID_RESOURCE_ID: u32 = 0x1203;
pub const RESP_ERR_INVALID_PARAMETER: u32 = 0x1205;
/// Request/response fence flag.
pub const FLAG_FENCE: u32 = 1 << 0;

/// Virtio-gpu 2D resource formats supported by the host shadow store.
pub const FORMAT_B8G8R8A8_UNORM: u32 = 1;
pub const FORMAT_B8G8R8X8_UNORM: u32 = 2;
pub const FORMAT_A8R8G8B8_UNORM: u32 = 3;
pub const FORMAT_X8R8G8B8_UNORM: u32 = 4;
pub const FORMAT_R8G8B8A8_UNORM: u32 = 67;
pub const FORMAT_R8G8B8X8_UNORM: u32 = 68;

/// Whether a format is one of the six 32-bit formats accepted for 2D resources.
pub const fn is_supported_format(format: u32) -> bool {
    matches!(
        format,
        FORMAT_B8G8R8A8_UNORM
            | FORMAT_B8G8R8X8_UNORM
            | FORMAT_A8R8G8B8_UNORM
            | FORMAT_X8R8G8B8_UNORM
            | FORMAT_R8G8B8A8_UNORM
            | FORMAT_R8G8B8X8_UNORM
    )
}

/// Number of display modes carried by `virtio_gpu_resp_display_info`.
pub const DISPLAY_MODE_COUNT: usize = 16;
/// Wire size of `virtio_gpu_ctrl_hdr`.
pub const CTRL_HDR_SIZE: usize = 24;
/// Wire size of `virtio_gpu_resource_create_2d`.
pub const RESOURCE_CREATE_2D_SIZE: usize = CTRL_HDR_SIZE + 16;
/// Wire size of the fixed part of `virtio_gpu_resource_attach_backing`.
pub const RESOURCE_ATTACH_BACKING_HEADER_SIZE: usize = CTRL_HDR_SIZE + 8;
/// Wire size of `virtio_gpu_resource_detach_backing`.
pub const RESOURCE_DETACH_BACKING_SIZE: usize = CTRL_HDR_SIZE + 8;
/// Wire size of one `virtio_gpu_mem_entry`.
pub const RESOURCE_MEM_ENTRY_SIZE: usize = 16;
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

/// `virtio_gpu_resource_create_2d`, encoded with an explicit little-endian layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceCreate2d {
    pub header: CtrlHeader,
    pub resource_id: u32,
    pub format: u32,
    pub width: u32,
    pub height: u32,
}

impl ResourceCreate2d {
    /// Decode a complete CREATE_2D request; short input is rejected before any field access.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < RESOURCE_CREATE_2D_SIZE {
            return None;
        }
        Some(Self {
            header: CtrlHeader::from_bytes(&bytes[..CTRL_HDR_SIZE])?,
            resource_id: u32::from_le_bytes(bytes[24..28].try_into().ok()?),
            format: u32::from_le_bytes(bytes[28..32].try_into().ok()?),
            width: u32::from_le_bytes(bytes[32..36].try_into().ok()?),
            height: u32::from_le_bytes(bytes[36..40].try_into().ok()?),
        })
    }

    /// Encode the exact 40-byte request layout.
    pub fn to_bytes(self) -> [u8; RESOURCE_CREATE_2D_SIZE] {
        let mut out = [0u8; RESOURCE_CREATE_2D_SIZE];
        out[..CTRL_HDR_SIZE].copy_from_slice(&self.header.to_bytes());
        out[24..28].copy_from_slice(&self.resource_id.to_le_bytes());
        out[28..32].copy_from_slice(&self.format.to_le_bytes());
        out[32..36].copy_from_slice(&self.width.to_le_bytes());
        out[36..40].copy_from_slice(&self.height.to_le_bytes());
        out
    }
}

/// Fixed header of `virtio_gpu_resource_attach_backing`; entries follow immediately afterward.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceAttachBacking {
    pub header: CtrlHeader,
    pub resource_id: u32,
    pub nents: u32,
}

impl ResourceAttachBacking {
    /// Decode the fixed 32-byte attach header.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < RESOURCE_ATTACH_BACKING_HEADER_SIZE {
            return None;
        }
        Some(Self {
            header: CtrlHeader::from_bytes(&bytes[..CTRL_HDR_SIZE])?,
            resource_id: u32::from_le_bytes(bytes[24..28].try_into().ok()?),
            nents: u32::from_le_bytes(bytes[28..32].try_into().ok()?),
        })
    }

    /// Encode the fixed attach header.
    pub fn to_bytes(self) -> [u8; RESOURCE_ATTACH_BACKING_HEADER_SIZE] {
        let mut out = [0u8; RESOURCE_ATTACH_BACKING_HEADER_SIZE];
        out[..CTRL_HDR_SIZE].copy_from_slice(&self.header.to_bytes());
        out[24..28].copy_from_slice(&self.resource_id.to_le_bytes());
        out[28..32].copy_from_slice(&self.nents.to_le_bytes());
        out
    }
}

/// One guest-physical scatter-gather entry following an attach header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceMemEntry {
    pub addr: u64,
    pub length: u32,
    pub padding: u32,
}

impl ResourceMemEntry {
    /// Decode one complete little-endian memory entry.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < RESOURCE_MEM_ENTRY_SIZE {
            return None;
        }
        Some(Self {
            addr: u64::from_le_bytes(bytes[0..8].try_into().ok()?),
            length: u32::from_le_bytes(bytes[8..12].try_into().ok()?),
            padding: u32::from_le_bytes(bytes[12..16].try_into().ok()?),
        })
    }

    /// Encode one memory entry without relying on host struct layout.
    pub fn to_bytes(self) -> [u8; RESOURCE_MEM_ENTRY_SIZE] {
        let mut out = [0u8; RESOURCE_MEM_ENTRY_SIZE];
        out[0..8].copy_from_slice(&self.addr.to_le_bytes());
        out[8..12].copy_from_slice(&self.length.to_le_bytes());
        out[12..16].copy_from_slice(&self.padding.to_le_bytes());
        out
    }
}

/// `virtio_gpu_resource_detach_backing`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceDetachBacking {
    pub header: CtrlHeader,
    pub resource_id: u32,
    pub padding: u32,
}

impl ResourceDetachBacking {
    /// Decode the complete 32-byte detach request.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < RESOURCE_DETACH_BACKING_SIZE {
            return None;
        }
        Some(Self {
            header: CtrlHeader::from_bytes(&bytes[..CTRL_HDR_SIZE])?,
            resource_id: u32::from_le_bytes(bytes[24..28].try_into().ok()?),
            padding: u32::from_le_bytes(bytes[28..32].try_into().ok()?),
        })
    }

    /// Encode the complete detach request.
    pub fn to_bytes(self) -> [u8; RESOURCE_DETACH_BACKING_SIZE] {
        let mut out = [0u8; RESOURCE_DETACH_BACKING_SIZE];
        out[..CTRL_HDR_SIZE].copy_from_slice(&self.header.to_bytes());
        out[24..28].copy_from_slice(&self.resource_id.to_le_bytes());
        out[28..32].copy_from_slice(&self.padding.to_le_bytes());
        out
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
