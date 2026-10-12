/* SPDX-License-Identifier: MIT */
#ifndef VIRGL_STANDARD_GUARD_H
#define VIRGL_STANDARD_GUARD_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define STANDARD_IO 32u
#define STANDARD_GENERIC 16u
#define STANDARD_CONSTANTS 512u
#define STANDARD_SAMPLERS 16u
#define STANDARD_DEPTH 32u
#define STANDARD_UNIFORM_SLOTS 12u
#define STANDARD_UNIFORM_VECTORS 1024u

enum standard_file { STD_IN, STD_OUT, STD_TEMP, STD_CONST, STD_IMM,
                     STD_SAMP, STD_SVIEW, STD_ADDR, STD_SV, STD_FILES };
enum standard_semantic { STD_ATTRIBUTE, STD_POSITION, STD_GENERIC, STD_COLOR,
                         STD_VERTEXID, STD_INSTANCEID, STD_PSIZE, STD_PCOORD };
enum standard_sampler_return { STD_SAMPLE_FLOAT, STD_SAMPLE_SINT, STD_SAMPLE_UINT };
enum standard_texture_target { STD_TEXTURE_2D, STD_TEXTURE_3D, STD_TEXTURE_CUBE, STD_TEXTURE_ARRAY };
struct standard_io {
   uint8_t semantic, sid, mask, writes, flat;
};
/* Independent of profile/raw_ir: this is structural metadata, never a word,
 * range, liveness, precision, or private-draw certificate. */
struct standard_profile {
   int stage;
   uint8_t declared[STD_FILES][STANDARD_CONSTANTS];
   struct standard_io input[STANDARD_IO], output[STANDARD_IO], system[2];
   uint16_t instructions, constants, immediates;
   uint16_t used_samplers, queried_levels;
   /* Size queries do not choose comparison semantics. Keep original use and
    * the upstream last-instruction type separate from the native type. */
   uint16_t shadow_views, shadow_samples, ordinary_samples, shadow_queries;
   uint16_t shadow_samplers, upstream_shadow_samplers;
   uint8_t sampler_returns[STANDARD_SAMPLERS];
   uint8_t sampler_targets[STANDARD_SAMPLERS];
   /* Host color formats select outputs; shader text cannot select these bits. */
   uint8_t signed_colors, unsigned_colors;
   /* Host-derived vertex format types, never TGSI/guest shader keys. */
   uint16_t signed_inputs, unsigned_inputs;
   uint16_t packed_signed_inputs, packed_normalized_inputs;
   /* A distinct host-selected facet admits dimensional constant banks. The
    * legacy facets keep both flags zero and retain their original grammar. */
   uint32_t uniform_declared[STANDARD_UNIFORM_SLOTS][STANDARD_UNIFORM_VECTORS / 32];
   uint16_t uniform_counts[STANDARD_UNIFORM_SLOTS + 1];
   bool uniform_buffers, buffer_zero, texture_operations, integer_images, instance_base, shadow_textures, dimensional_textures;
   uint8_t properties, broadcast;
};

static inline bool standard_has_instance_id(const struct standard_profile *p)
{
   if (p->stage) return false;
   for (unsigned i = 0; i < 2; ++i)
      if (p->declared[STD_SV][i] && p->system[i].semantic == STD_INSTANCEID) return true;
   return false;
}

static inline const char *standard_attribute_type(const struct standard_profile *p, unsigned index)
{
   return p->signed_inputs & (1u << index) ? "ivec4" :
          p->unsigned_inputs & (1u << index) ? "uvec4" : "vec4";
}

static inline const char *standard_color_type(const struct standard_profile *p, unsigned index)
{
   return p->signed_colors & (1u << index) ? "ivec4" :
          p->unsigned_colors & (1u << index) ? "uvec4" : "vec4";
}

static inline const char *standard_sampler_type(const struct standard_profile *p, unsigned index)
{
   if (p->shadow_textures && (p->shadow_samplers & (1u << index))) return "sampler2DShadow";
   if (p->dimensional_textures) {
      static const char *const types[3][4] = {
         {"sampler2D", "sampler3D", "samplerCube", "sampler2DArray"},
         {"isampler2D", "isampler3D", "isamplerCube", "isampler2DArray"},
         {"usampler2D", "usampler3D", "usamplerCube", "usampler2DArray"}
      };
      return types[p->sampler_returns[index]][p->sampler_targets[index]];
   }
   return p->integer_images && p->sampler_returns[index] == STD_SAMPLE_SINT ? "isampler2D" :
          p->integer_images && p->sampler_returns[index] == STD_SAMPLE_UINT ? "usampler2D" : "sampler2D";
}

/* Copies one bounded line at a time, consumes all characters, and validates
 * numbers and grammar BEFORE the upstream text parser sees the original text. */
const char *standard_validate(struct standard_profile *p, const char *text, size_t length);
bool standard_match(struct standard_profile *vertex, const struct standard_profile *fragment);
/* Numeric sources preceding the final checked sampler, or zero. */
unsigned standard_texture_sources(unsigned opcode);
#endif
