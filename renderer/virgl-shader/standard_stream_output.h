/* SPDX-License-Identifier: MIT */
#ifndef VIRGL_STANDARD_STREAM_OUTPUT_H
#define VIRGL_STANDARD_STREAM_OUTPUT_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define STANDARD_STREAM_OUTPUTS 128u
#define STANDARD_STREAM_BUFFERS 4u
#define STANDARD_STREAM_COMPONENTS 64u

struct standard_stream_output_entry {
   uint16_t destination_offset;
   uint8_t register_index, start_component, num_components, output_buffer;
};
struct standard_stream_output {
   bool enabled;
   uint8_t capture_buffer;
   uint16_t count, strides[STANDARD_STREAM_BUFFERS];
   struct standard_stream_output_entry outputs[STANDARD_STREAM_OUTPUTS];
};
struct standard_profile;
/* Original shader word5, followed by four strides and two words per output.
 * A null/empty input selects the original zero-output header. */
const char *standard_stream_output_validate(struct standard_profile *profile,
   const uint32_t *words, size_t word_count, uint32_t capture_buffer);
bool standard_stream_output_captured(const struct standard_profile *profile,
                                    unsigned register_index);
#endif
