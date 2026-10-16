/* SPDX-License-Identifier: MIT — original VirGL stream-output layout words. */
#include "standard_guard.h"
#include <string.h>

const char *standard_stream_output_validate(struct standard_profile *p,
   const uint32_t *words, size_t word_count, uint32_t capture_buffer)
{
   if (capture_buffer >= STANDARD_STREAM_BUFFERS || (!words && word_count))
      return "invalid-input";
   struct standard_stream_output result = {.enabled = true,
      .capture_buffer = (uint8_t)capture_buffer};
   if (!word_count) {
      p->stream_output = result;
      return NULL;
   }
   uint32_t count = words[0];
   if (count > STANDARD_STREAM_OUTPUTS) return "limit-exceeded";
   if (word_count != (count ? 5u + 2u * count : 1u)) return "invalid-input";
   if (count && p->stage) return "unsupported-feature";
   if (!count) {
      p->stream_output = result;
      return NULL;
   }
   for (unsigned i = 0; i < STANDARD_STREAM_BUFFERS; ++i) {
      if (words[1 + i] > UINT16_MAX) return "invalid-input";
      result.strides[i] = (uint16_t)words[1 + i];
   }
   unsigned components[STANDARD_STREAM_BUFFERS] = {0};
   for (unsigned i = 0; i < count; ++i) {
      uint32_t packed = words[5 + 2 * i];
      unsigned reg = packed & 255u, start = (packed >> 8) & 3u,
         num = (packed >> 10) & 7u, buffer = (packed >> 13) & 7u,
         destination = packed >> 16;
      if (reg >= STANDARD_IO || !num || num > 4 || start + num > 4 ||
          buffer >= STANDARD_STREAM_BUFFERS) return "invalid-input";
      if (words[6 + 2 * i]) return "unsupported-feature";
      unsigned mask = ((1u << num) - 1u) << start;
      if (!p->declared[STD_OUT][reg] ||
          (p->output[reg].mask & mask) != mask) return "unsupported-feature";
      if (!result.strides[buffer] || destination + num > result.strides[buffer])
         return "invalid-input";
      for (unsigned j = 0; j < i; ++j) {
         const struct standard_stream_output_entry *old = &result.outputs[j];
         if (old->output_buffer == buffer &&
             destination < (unsigned)old->destination_offset + old->num_components &&
             old->destination_offset < destination + num) return "invalid-input";
      }
      if (components[buffer] + num > STANDARD_STREAM_COMPONENTS)
         return "limit-exceeded";
      components[buffer] += num;
      result.outputs[i] = (struct standard_stream_output_entry){
         .register_index = (uint8_t)reg, .start_component = (uint8_t)start,
         .num_components = (uint8_t)num, .output_buffer = (uint8_t)buffer,
         .destination_offset = (uint16_t)destination};
   }
   result.count = (uint16_t)count;
   p->stream_output = result;
   return NULL;
}
bool standard_stream_output_captured(const struct standard_profile *p,
                                    unsigned register_index)
{
   for (unsigned i = 0; i < p->stream_output.count; ++i)
      if (p->stream_output.outputs[i].register_index == register_index) return true;
   return false;
}
