/* SPDX-License-Identifier: MIT
 * Compile the pinned checker unchanged; cancel its scratch transaction before
 * an unchecked upstream allocation can ever return NULL to that checker. */
#include "checked_tgsi_heap.h"
#include <setjmp.h>
#include <stdint.h>
#include <stdlib.h>
#include "util/u_memory.h"

static unsigned char *scratch;
static size_t scratch_used;
static bool scratch_failed;
static jmp_buf exhausted;

void bridge_tgsi_scratch_begin(void) { scratch_failed = false; }
bool bridge_tgsi_scratch_failed(void) { return scratch_failed; }
void *bridge_tgsi_scratch_malloc(size_t bytes)
{
   if (!scratch) return malloc(bytes);
   const size_t alignment = _Alignof(max_align_t);
   size_t aligned = (scratch_used + alignment - 1) / alignment * alignment;
   if (aligned > BRIDGE_TGSI_SCRATCH_BYTES || bytes > BRIDGE_TGSI_SCRATCH_BYTES - aligned) {
      scratch_failed = true;
      longjmp(exhausted, 1);
   }
   void *result = scratch + aligned;
   scratch_used = aligned + bytes;
   return result;
}
void bridge_tgsi_scratch_free(void *pointer)
{
   if (!scratch) free(pointer);
}

#undef MALLOC
#undef FREE
#define MALLOC(bytes) bridge_tgsi_scratch_malloc(bytes)
#define FREE(pointer) bridge_tgsi_scratch_free(pointer)
#define tgsi_sanity_check upstream_tgsi_sanity_check
#include "vendor/src/gallium/auxiliary/tgsi/tgsi_sanity.c"
#undef tgsi_sanity_check

bool tgsi_sanity_check(const struct tgsi_token *tokens)
{
   scratch_failed = false;
   scratch_used = 0;
   scratch = malloc(BRIDGE_TGSI_SCRATCH_BYTES);
   if (!scratch) { scratch_failed = true; return false; }
   volatile bool valid = false;
   if (!setjmp(exhausted)) valid = upstream_tgsi_sanity_check(tokens);
   free(scratch);
   scratch = NULL;
   return valid;
}
