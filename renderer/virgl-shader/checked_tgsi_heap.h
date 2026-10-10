/* SPDX-License-Identifier: MIT */
#ifndef WASM_VM_CHECKED_TGSI_HEAP_H
#define WASM_VM_CHECKED_TGSI_HEAP_H
#include <stdbool.h>
#include <stddef.h>
/* The pinned sanity checker assumes successful allocations. Its entire scratch
 * lifetime is one bounded transaction, including the pinned hash implementation. */
#ifndef BRIDGE_TGSI_SCRATCH_BYTES
#define BRIDGE_TGSI_SCRATCH_BYTES 262144u
#endif
#define BRIDGE_TGSI_UNIFORM_SCRATCH_BYTES 2097152u
void bridge_tgsi_scratch_begin(void);
void bridge_tgsi_scratch_begin_uniform(void);
void *bridge_tgsi_scratch_malloc(size_t bytes);
void bridge_tgsi_scratch_free(void *pointer);
bool bridge_tgsi_scratch_failed(void);
#endif
