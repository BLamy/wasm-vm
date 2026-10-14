//! Explicit little-endian VirGL v2 capabilities for the qualified host profile.
//! Offsets are the pinned C ABI in renderer/virgl-contract/capset-layout.json.
//! No native struct layout, pointer, host-endian dump or guest-provided bitset
//! participates in the wire representation.
use alloc::{vec, vec::Vec};

pub const CAPSET_ID: u32 = 2;
pub const CAPSET_VERSION: u32 = 2;
pub const CAPSET_BYTES: usize = 1408;

#[derive(Clone, Debug)]
pub struct HostLimits {
    pub texture_2d: u32,
    pub texture_3d: u32,
    pub texture_cube: u32,
    pub array_layers: u32,
    pub varying_vectors: u32,
    pub vertex_attributes: u32,
    pub uniform_block_bytes: u32,
    pub uniform_alignment: u32,
    pub vertex_samplers: u32,
    pub fragment_samplers: u32,
    pub vertex_constant_vectors: u32,
    pub fragment_constant_vectors: u32,
    pub feedback_components: u32,
}

#[derive(Clone, Debug, Default)]
pub struct FormatMask([u32; 16]);
impl FormatMask {
    pub fn insert(&mut self, format: u32) -> Result<(), &'static str> {
        if format >= 512 {
            return Err("Format is outside the pinned capset mask");
        }
        self.0[format as usize / 32] |= 1 << (format % 32);
        Ok(())
    }
    fn write(&self, out: &mut [u8], offset: usize) {
        for (i, value) in self.0.iter().enumerate() {
            word(out, offset + i * 4, *value);
        }
    }
}

#[derive(Clone, Debug)]
pub struct QualifiedCapabilities {
    limits: HostLimits,
    sampler: FormatMask,
    render: FormatMask,
    depth: FormatMask,
    vertex: FormatMask,
    renderer: Vec<u8>,
}
fn word(out: &mut [u8], at: usize, value: u32) {
    out[at..at + 4].copy_from_slice(&value.to_le_bytes());
}
impl QualifiedCapabilities {
    /// The host must first qualify the real renderer. This constructor checks
    /// the bounded profile floor and receives only individually qualified roles.
    pub fn new(
        limits: HostLimits,
        sampler: FormatMask,
        render: FormatMask,
        depth: FormatMask,
        vertex: FormatMask,
        renderer: &str,
    ) -> Result<Self, &'static str> {
        if limits.texture_2d < 2048
            || limits.texture_3d < 256
            || limits.texture_cube < 2048
            || limits.array_layers < 256
            || limits.varying_vectors < 16
            || limits.vertex_attributes < 16
            || limits.uniform_block_bytes < 16384
            || limits.uniform_alignment == 0
            || !limits.uniform_alignment.is_power_of_two()
            || limits.vertex_samplers < 16
            || limits.fragment_samplers < 16
            || limits.vertex_constant_vectors < 512
            || limits.fragment_constant_vectors < 512
            || limits.feedback_components < 64
        {
            return Err("Host does not meet the selected renderer floor");
        }
        if renderer.is_empty()
            || renderer.len() > 63
            || !renderer.is_ascii()
            || renderer.as_bytes().contains(&0)
        {
            return Err("Invalid bounded renderer identity");
        }
        Ok(Self {
            limits,
            sampler,
            render,
            depth,
            vertex,
            renderer: renderer.as_bytes().to_vec(),
        })
    }
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = vec![0; CAPSET_BYTES];
        word(&mut out, 0, CAPSET_VERSION);
        self.sampler.write(&mut out, 4);
        self.render.write(&mut out, 68);
        self.depth.write(&mut out, 132);
        self.vertex.write(&mut out, 196);
        // Only verified primitive restart, separate blend equations, instance ID,
        // divisors, seamless cube sampling, stream pause/resume, fragment position
        // conventions and uniform buffers. Query/indirect/MSAA/geometry/compute
        // and independent blend capabilities stay absent.
        let features = (1 << 6)
            | (1 << 7)
            | (1 << 8)
            | (1 << 9)
            | (1 << 10)
            | (1 << 13)
            | (1 << 15)
            | (1 << 18);
        word(&mut out, 260, features);
        word(&mut out, 264, 130); // Converted GLSL130 / ESSL300 shader semantics.
        word(&mut out, 268, self.limits.array_layers.min(2048));
        word(&mut out, 272, 4);
        word(&mut out, 280, 4);
        word(&mut out, 284, 1);
        word(
            &mut out,
            288,
            (0..=6).fold(0, |mask, mode| mask | 1 << mode),
        );
        word(&mut out, 296, 13);
        word(&mut out, 300, 1);
        for at in [308, 312, 316, 320, 324, 328, 332, 336] {
            word(&mut out, at, 1.0f32.to_bits());
        }
        word(&mut out, 352, self.limits.varying_vectors.min(16));
        word(&mut out, 356, 16);
        word(&mut out, 364, (-8i32) as u32);
        word(&mut out, 368, 7);
        word(&mut out, 384, self.limits.uniform_alignment);
        word(&mut out, 428, 255);
        word(&mut out, 484, self.limits.texture_2d.min(16384));
        word(&mut out, 488, self.limits.texture_3d.min(2048));
        word(&mut out, 492, self.limits.texture_cube.min(16384));
        word(&mut out, 556, 22); // Avoid historical implicit query/stream assumptions.
        self.sampler.write(&mut out, 560);
        let mut scanout = FormatMask::default();
        for format in [1, 2, 67] {
            scanout.insert(format).expect("pinned scanout format");
        }
        scanout.write(&mut out, 624);
        word(&mut out, 692, 128); // Selected GPU budget, MiB.
        out[696..696 + self.renderer.len()].copy_from_slice(&self.renderer);
        word(&mut out, 760, 1.0f32.to_bits());
        word(&mut out, 764, 16);
        // Gallium stage order: vertex, fragment, geometry, tess-control,
        // tess-evaluation, compute. Unsupported stages remain all zero.
        for stage in 0..2 {
            word(&mut out, 832 + stage * 4, 8192);
        }
        word(&mut out, 1372, self.limits.uniform_block_bytes.min(16384));
        out
    }
}
