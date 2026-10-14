/* Independent pinned C ABI construction, consumed by the Rust capability test. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "../../renderer/virgl-shader/vendor/src/virgl_hw.h"
static void bit(struct virgl_supported_format_mask *mask, unsigned format) {
    mask->bitmask[format / 32] |= UINT32_C(1) << (format % 32);
}
int main(void) {
    uint32_t endian = 1;
    if (*(unsigned char *)&endian != 1 || sizeof(struct virgl_caps_v2) != 1408) return 2;
    struct virgl_caps_v2 caps = {0};
    caps.v1.max_version = 2;
    bit(&caps.v1.sampler, 2); bit(&caps.v1.sampler, 16); bit(&caps.v1.sampler, 67);
    bit(&caps.v1.render, 2); bit(&caps.v1.render, 67);
    bit(&caps.v1.depthstencil, 16);
    bit(&caps.v1.vertexbuffer, 28); bit(&caps.v1.vertexbuffer, 67);
    caps.v1.bset.primitive_restart = 1;
    caps.v1.bset.blend_eq_sep = 1;
    caps.v1.bset.instanceid = 1;
    caps.v1.bset.vertex_element_instance_divisor = 1;
    caps.v1.bset.seamless_cube_map = 1;
    caps.v1.bset.streamout_pause_resume = 1;
    caps.v1.bset.fragment_coord_conventions = 1;
    caps.v1.bset.ubo = 1;
    caps.v1.glsl_level = 130;
    caps.v1.max_texture_array_layers = 1024;
    caps.v1.max_streamout_buffers = 4;
    caps.v1.max_render_targets = 4;
    caps.v1.max_samples = 1;
    caps.v1.prim_mask = 127;
    caps.v1.max_uniform_blocks = 13;
    caps.v1.max_viewports = 1;
    caps.min_aliased_point_size = caps.max_aliased_point_size = 1.0f;
    caps.min_smooth_point_size = caps.max_smooth_point_size = 1.0f;
    caps.min_aliased_line_width = caps.max_aliased_line_width = 1.0f;
    caps.min_smooth_line_width = caps.max_smooth_line_width = 1.0f;
    caps.max_vertex_outputs = 16;
    caps.max_vertex_attribs = 16;
    caps.min_texel_offset = -8;
    caps.max_texel_offset = 7;
    caps.uniform_buffer_offset_alignment = 256;
    caps.max_vertex_attrib_stride = 255;
    caps.max_texture_2d_size = 8192;
    caps.max_texture_3d_size = 256;
    caps.max_texture_cube_size = 4096;
    caps.host_feature_check_version = 22;
    caps.supported_readback_formats = caps.v1.sampler;
    bit(&caps.scanout, 1); bit(&caps.scanout, 2); bit(&caps.scanout, 67);
    caps.max_video_memory = 128;
    strcpy(caps.renderer, "wasm-vm WebGL2 VirGL");
    caps.max_anisotropy = 1.0f;
    caps.max_texture_samplers = 16;
    caps.max_const_buffer_size[0] = caps.max_const_buffer_size[1] = 8192;
    caps.max_uniform_block_size = 16384;
    return fwrite(&caps, 1, sizeof(caps), stdout) == sizeof(caps) ? 0 : 3;
}
