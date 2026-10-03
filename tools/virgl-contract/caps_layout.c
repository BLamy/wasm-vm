/*
 * Print the pinned VirGL capset ABI, not a renderer capability profile.
 *
 * From the repository root:
 *   cc -std=c11 -Wall -Wextra -Werror tools/virgl-contract/caps_layout.c -o /tmp/virgl-caps-layout
 *   /tmp/virgl-caps-layout
 *
 * Boolean masks are measured from individual C bit assignments rather than
 * inferred from declaration order. Video bitfield masks are measured likewise.
 */
#include <float.h>
#include <inttypes.h>
#include <limits.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "../../renderer/virgl-shader/vendor/src/virgl_hw.h"

_Static_assert(CHAR_BIT == 8, "VirGL wire bytes must contain eight bits");
_Static_assert(sizeof(uint32_t) == 4, "VirGL wire words must contain four bytes");
_Static_assert(sizeof(float) == 4 && FLT_RADIX == 2 && FLT_MANT_DIG == 24 &&
                   FLT_MAX_EXP == 128,
               "VirGL float fields require binary32");
_Static_assert(sizeof(struct virgl_caps_bool_set1) == 4,
               "VirGL boolean set must occupy one wire word");
_Static_assert(sizeof(struct virgl_video_caps) == 16,
               "VirGL video caps must occupy four wire words");

struct field_layout {
    const char *name;
    size_t offset;
    size_t size;
    size_t alignment;
};

#define FIELD(type, member, member_type)                                      \
    { #member, offsetof(struct type, member),                                \
      sizeof(((struct type *)0)->member), _Alignof(member_type) }
#define COUNT(items) (sizeof(items) / sizeof((items)[0]))

static const struct field_layout format_fields[] = {
    FIELD(virgl_supported_format_mask, bitmask, uint32_t),
};

static const struct field_layout v1_fields[] = {
    FIELD(virgl_caps_v1, max_version, uint32_t),
    FIELD(virgl_caps_v1, sampler, struct virgl_supported_format_mask),
    FIELD(virgl_caps_v1, render, struct virgl_supported_format_mask),
    FIELD(virgl_caps_v1, depthstencil, struct virgl_supported_format_mask),
    FIELD(virgl_caps_v1, vertexbuffer, struct virgl_supported_format_mask),
    FIELD(virgl_caps_v1, bset, struct virgl_caps_bool_set1),
    FIELD(virgl_caps_v1, glsl_level, uint32_t),
    FIELD(virgl_caps_v1, max_texture_array_layers, uint32_t),
    FIELD(virgl_caps_v1, max_streamout_buffers, uint32_t),
    FIELD(virgl_caps_v1, max_dual_source_render_targets, uint32_t),
    FIELD(virgl_caps_v1, max_render_targets, uint32_t),
    FIELD(virgl_caps_v1, max_samples, uint32_t),
    FIELD(virgl_caps_v1, prim_mask, uint32_t),
    FIELD(virgl_caps_v1, max_tbo_size, uint32_t),
    FIELD(virgl_caps_v1, max_uniform_blocks, uint32_t),
    FIELD(virgl_caps_v1, max_viewports, uint32_t),
    FIELD(virgl_caps_v1, max_texture_gather_components, uint32_t),
};

static const struct field_layout v2_fields[] = {
    FIELD(virgl_caps_v2, v1, struct virgl_caps_v1),
    FIELD(virgl_caps_v2, min_aliased_point_size, float),
    FIELD(virgl_caps_v2, max_aliased_point_size, float),
    FIELD(virgl_caps_v2, min_smooth_point_size, float),
    FIELD(virgl_caps_v2, max_smooth_point_size, float),
    FIELD(virgl_caps_v2, min_aliased_line_width, float),
    FIELD(virgl_caps_v2, max_aliased_line_width, float),
    FIELD(virgl_caps_v2, min_smooth_line_width, float),
    FIELD(virgl_caps_v2, max_smooth_line_width, float),
    FIELD(virgl_caps_v2, max_texture_lod_bias, float),
    FIELD(virgl_caps_v2, max_geom_output_vertices, uint32_t),
    FIELD(virgl_caps_v2, max_geom_total_output_components, uint32_t),
    FIELD(virgl_caps_v2, max_vertex_outputs, uint32_t),
    FIELD(virgl_caps_v2, max_vertex_attribs, uint32_t),
    FIELD(virgl_caps_v2, max_shader_patch_varyings, uint32_t),
    FIELD(virgl_caps_v2, min_texel_offset, int32_t),
    FIELD(virgl_caps_v2, max_texel_offset, int32_t),
    FIELD(virgl_caps_v2, min_texture_gather_offset, int32_t),
    FIELD(virgl_caps_v2, max_texture_gather_offset, int32_t),
    FIELD(virgl_caps_v2, texture_buffer_offset_alignment, uint32_t),
    FIELD(virgl_caps_v2, uniform_buffer_offset_alignment, uint32_t),
    FIELD(virgl_caps_v2, shader_buffer_offset_alignment, uint32_t),
    FIELD(virgl_caps_v2, capability_bits, uint32_t),
    FIELD(virgl_caps_v2, sample_locations, uint32_t),
    FIELD(virgl_caps_v2, max_vertex_attrib_stride, uint32_t),
    FIELD(virgl_caps_v2, max_shader_buffer_frag_compute, uint32_t),
    FIELD(virgl_caps_v2, max_shader_buffer_other_stages, uint32_t),
    FIELD(virgl_caps_v2, max_shader_image_frag_compute, uint32_t),
    FIELD(virgl_caps_v2, max_shader_image_other_stages, uint32_t),
    FIELD(virgl_caps_v2, max_image_samples, uint32_t),
    FIELD(virgl_caps_v2, max_compute_work_group_invocations, uint32_t),
    FIELD(virgl_caps_v2, max_compute_shared_memory_size, uint32_t),
    FIELD(virgl_caps_v2, max_compute_grid_size, uint32_t),
    FIELD(virgl_caps_v2, max_compute_block_size, uint32_t),
    FIELD(virgl_caps_v2, max_texture_2d_size, uint32_t),
    FIELD(virgl_caps_v2, max_texture_3d_size, uint32_t),
    FIELD(virgl_caps_v2, max_texture_cube_size, uint32_t),
    FIELD(virgl_caps_v2, max_combined_shader_buffers, uint32_t),
    FIELD(virgl_caps_v2, max_atomic_counters, uint32_t),
    FIELD(virgl_caps_v2, max_atomic_counter_buffers, uint32_t),
    FIELD(virgl_caps_v2, max_combined_atomic_counters, uint32_t),
    FIELD(virgl_caps_v2, max_combined_atomic_counter_buffers, uint32_t),
    FIELD(virgl_caps_v2, host_feature_check_version, uint32_t),
    FIELD(virgl_caps_v2, supported_readback_formats, struct virgl_supported_format_mask),
    FIELD(virgl_caps_v2, scanout, struct virgl_supported_format_mask),
    FIELD(virgl_caps_v2, capability_bits_v2, uint32_t),
    FIELD(virgl_caps_v2, max_video_memory, uint32_t),
    FIELD(virgl_caps_v2, renderer, char),
    FIELD(virgl_caps_v2, max_anisotropy, float),
    FIELD(virgl_caps_v2, max_texture_samplers, uint32_t),
    FIELD(virgl_caps_v2, supported_multisample_formats, struct virgl_supported_format_mask),
    FIELD(virgl_caps_v2, max_const_buffer_size, uint32_t),
    FIELD(virgl_caps_v2, num_video_caps, uint32_t),
    FIELD(virgl_caps_v2, video_caps, struct virgl_video_caps),
    FIELD(virgl_caps_v2, max_uniform_block_size, uint32_t),
    FIELD(virgl_caps_v2, max_tcs_outputs, uint32_t),
    FIELD(virgl_caps_v2, max_tes_outputs, uint32_t),
    FIELD(virgl_caps_v2, max_shader_storage_blocks, uint32_t),
};

static uint32_t read_le32(const void *storage)
{
    const unsigned char *bytes = storage;
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
           ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static void print_structure(const char *name, size_t size, size_t alignment,
                            const struct field_layout *fields, size_t count)
{
    printf("    \"%s\": {\n", name);
    printf("      \"size\": %zu,\n      \"alignment\": %zu,\n", size, alignment);
    puts("      \"fields\": {");
    for (size_t i = 0; i < count; ++i) {
        printf("        \"%s\": {\"offset\": %zu, \"size\": %zu, \"alignment\": %zu}%s\n",
               fields[i].name, fields[i].offset, fields[i].size,
               fields[i].alignment, i + 1 == count ? "" : ",");
    }
    printf("      }\n    }");
}

static void print_boolean_set(void)
{
    struct virgl_caps_bool_set1 bits;
    const char *separator = "";
    puts("    \"virgl_caps_bool_set1\": {");
    printf("      \"size\": %zu,\n      \"alignment\": %zu,\n",
           sizeof(bits), _Alignof(struct virgl_caps_bool_set1));
    puts("      \"bit_masks\": {");
#define BOOLEAN(member)                                                       \
    do {                                                                     \
        memset(&bits, 0, sizeof(bits));                                       \
        bits.member = 1;                                                     \
        printf("%s        \"%s\": %" PRIu32, separator, #member, read_le32(&bits)); \
        separator = ",\n";                                                   \
    } while (0)
    BOOLEAN(indep_blend_enable);
    BOOLEAN(indep_blend_func);
    BOOLEAN(cube_map_array);
    BOOLEAN(shader_stencil_export);
    BOOLEAN(conditional_render);
    BOOLEAN(start_instance);
    BOOLEAN(primitive_restart);
    BOOLEAN(blend_eq_sep);
    BOOLEAN(instanceid);
    BOOLEAN(vertex_element_instance_divisor);
    BOOLEAN(seamless_cube_map);
    BOOLEAN(occlusion_query);
    BOOLEAN(timer_query);
    BOOLEAN(streamout_pause_resume);
    BOOLEAN(texture_multisample);
    BOOLEAN(fragment_coord_conventions);
    BOOLEAN(depth_clip_disable);
    BOOLEAN(seamless_cube_map_per_texture);
    BOOLEAN(ubo);
    BOOLEAN(color_clamping);
    BOOLEAN(poly_stipple);
    BOOLEAN(mirror_clamp);
    BOOLEAN(texture_query_lod);
    BOOLEAN(has_fp64);
    BOOLEAN(has_tessellation_shaders);
    BOOLEAN(has_indirect_draw);
    BOOLEAN(has_sample_shading);
    BOOLEAN(has_cull);
    BOOLEAN(conditional_render_inverted);
    BOOLEAN(derivative_control);
    BOOLEAN(polygon_offset_clamp);
    BOOLEAN(transform_feedback_overflow_query);
#undef BOOLEAN
    printf("\n      }\n    }");
}

static void print_video_field(const char *name, const void *storage,
                              const char *separator)
{
    const unsigned char *bytes = storage;
    printf("%s        \"%s\": [", separator, name);
    for (size_t i = 0; i < sizeof(struct virgl_video_caps) / 4; ++i)
        printf("%s%" PRIu32, i == 0 ? "" : ", ", read_le32(bytes + i * 4));
    printf("]");
}

static void print_video_caps(void)
{
    struct virgl_video_caps bits;
    const char *separator = "";
    puts("    \"virgl_video_caps\": {");
    printf("      \"size\": %zu,\n      \"alignment\": %zu,\n",
           sizeof(bits), _Alignof(struct virgl_video_caps));
    puts("      \"bit_masks_by_word\": {");
#define VIDEO(member, maximum)                                                \
    do {                                                                     \
        memset(&bits, 0, sizeof(bits));                                       \
        bits.member = maximum;                                               \
        print_video_field(#member, &bits, separator);                         \
        separator = ",\n";                                                   \
    } while (0)
    VIDEO(profile, UINT8_MAX);
    VIDEO(entrypoint, UINT8_MAX);
    VIDEO(max_level, UINT8_MAX);
    VIDEO(stacked_frames, UINT8_MAX);
    VIDEO(max_width, UINT16_MAX);
    VIDEO(max_height, UINT16_MAX);
    VIDEO(prefered_format, UINT16_MAX);
    VIDEO(max_macroblocks, UINT16_MAX);
    VIDEO(npot_texture, 1);
    VIDEO(supports_progressive, 1);
    VIDEO(supports_interlaced, 1);
    VIDEO(prefers_interlaced, 1);
    VIDEO(max_temporal_layers, UINT8_MAX);
    VIDEO(reserved, (UINT32_C(1) << 20) - 1);
#undef VIDEO
    printf("\n      }\n    }");
}

int main(void)
{
    const uint32_t endian_probe = 1;
    if (read_le32(&endian_probe) != 1) {
        fputs("capset layout probe requires a little-endian C ABI\n", stderr);
        return 1;
    }

    puts("{");
    puts("  \"schema\": \"virgl-capset-wire-layout-v1\",");
    puts("  \"header\": \"renderer/virgl-shader/vendor/src/virgl_hw.h\",");
    puts("  \"byte_order\": \"little-endian\",");
    puts("  \"structures\": {");
    print_structure("virgl_supported_format_mask", sizeof(struct virgl_supported_format_mask),
                    _Alignof(struct virgl_supported_format_mask), format_fields, COUNT(format_fields));
    puts(",");
    print_boolean_set();
    puts(",");
    print_structure("virgl_caps_v1", sizeof(struct virgl_caps_v1),
                    _Alignof(struct virgl_caps_v1), v1_fields, COUNT(v1_fields));
    puts(",");
    print_video_caps();
    puts(",");
    print_structure("virgl_caps_v2", sizeof(struct virgl_caps_v2),
                    _Alignof(struct virgl_caps_v2), v2_fields, COUNT(v2_fields));
    puts("\n  }\n}");
    return ferror(stdout) ? 1 : 0;
}
