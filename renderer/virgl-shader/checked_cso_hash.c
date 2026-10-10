/* SPDX-License-Identifier: MIT
 * The pinned sanity checker's three hash tables share its bounded scratch arena. */
#include "checked_tgsi_heap.h"
#include "util/u_memory.h"
#undef MALLOC
#undef FREE
#define MALLOC(bytes) bridge_tgsi_scratch_malloc(bytes)
#define FREE(pointer) bridge_tgsi_scratch_free(pointer)
#include "vendor/src/gallium/auxiliary/cso_cache/cso_hash.c"
