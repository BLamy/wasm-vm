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
   uint16_t used_samplers;
   /* Host-derived vertex format types, never TGSI/guest shader keys. */
   uint16_t signed_inputs, unsigned_inputs;
   uint16_t packed_signed_inputs, packed_normalized_inputs;
   /* A distinct host-selected facet admits dimensional constant banks. The
    * legacy facets keep both flags zero and retain their original grammar. */
   uint32_t uniform_declared[STANDARD_UNIFORM_SLOTS][STANDARD_UNIFORM_VECTORS / 32];
   uint16_t uniform_counts[STANDARD_UNIFORM_SLOTS + 1];
   bool uniform_buffers, buffer_zero;
   uint8_t properties, broadcast;
};

static inline const char *standard_attribute_type(const struct standard_profile *p, unsigned index)
{
   return p->signed_inputs & (1u << index) ? "ivec4" :
          p->unsigned_inputs & (1u << index) ? "uvec4" : "vec4";
}

/* Copies one bounded line at a time, consumes all characters, and validates
 * numbers and grammar BEFORE the upstream text parser sees the original text. */
const char *standard_validate(struct standard_profile *p, const char *text, size_t length);
bool standard_match(struct standard_profile *vertex, const struct standard_profile *fragment);
#endif
