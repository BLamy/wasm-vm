/* SPDX-License-Identifier: MIT
 * Fresh critic: inject only the scratch arena malloc, through unchanged source.
 * Compile checked_tgsi_sanity.c with -Dmalloc=critic_scratch_malloc for this test. */
#include "../bridge.h"
#include "../checked_tgsi_heap.h"
#include "cso_cache/cso_hash.h"
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static bool fail_arena;
static unsigned cancellations, recoveries;
void *critic_scratch_malloc(size_t bytes)
{
   if (fail_arena && bytes == BRIDGE_TGSI_SCRATCH_BYTES) {
      fail_arena = false;
      ++cancellations;
      return NULL;
   }
   return malloc(bytes);
}
static void need(bool value, const char *why)
{
   if (!value) { fprintf(stderr, "scratch-boundary: %s\n", why); exit(1); }
}
static const char vertex[] = "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL CONST[0..127]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], CONST[127]\n2: END\n";
static const char fragment[] = "FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n";
static char single[BRIDGE_MAX_RESULT], pair[BRIDGE_MAX_PAIR_RESULT];
int main(void)
{
   /* Out-of-transaction hash allocations retain the pinned malloc/free path. */
   void *outside = bridge_tgsi_scratch_malloc(31);
   need(outside != NULL, "ordinary allocation");
   memset(outside, 0x5a, 31); bridge_tgsi_scratch_free(outside);
   for (unsigned phase = 0; phase < 3; ++phase) {
      struct cso_hash *hash = cso_hash_create(); need(hash != NULL, "outside hash");
      for (unsigned i = 0; i < 64; ++i) {
         cso_hash_insert(hash, i, (void *)(size_t)(i + 1));
         need(cso_hash_iter_data(cso_hash_find(hash, i)) == (void *)(size_t)(i + 1), "pinned rehash");
      }
      cso_hash_delete(hash);
   }
   const char *result = bridge_translate(0, vertex, sizeof(vertex) - 1);
   need(strstr(result, "\"ok\":true") != NULL && !bridge_tgsi_scratch_failed(), "healthy single");
   strcpy(single, result);
   result = bridge_translate_pair(vertex, sizeof(vertex) - 1, fragment, sizeof(fragment) - 1);
   need(strstr(result, "\"ok\":true") != NULL && !bridge_tgsi_scratch_failed(), "healthy pair");
   strcpy(pair, result);
   for (unsigned i = 0; i < 12; ++i) {
      fail_arena = true;
      result = i % 2 ? bridge_translate_pair(vertex, sizeof(vertex) - 1, fragment, sizeof(fragment) - 1) :
         bridge_translate(0, vertex, sizeof(vertex) - 1);
      need(!fail_arena && bridge_tgsi_scratch_failed(), "failure reached actual scratch allocation");
      need(strstr(result, "\"ok\":false") && strstr(result, "\"code\":\"translation-error\"") &&
         !strstr(result, "\"glsl\":") && !strstr(result, "\"vertex\":"), "complete typed cancellation");
      result = i % 2 ? bridge_translate_pair(vertex, sizeof(vertex) - 1, fragment, sizeof(fragment) - 1) :
         bridge_translate(0, vertex, sizeof(vertex) - 1);
      need(!strcmp(result, i % 2 ? pair : single) && !bridge_tgsi_scratch_failed(), "byte-identical recovery");
      ++recoveries;
   }
   need(cancellations == 12 && recoveries == 12, "all schedules completed");
   printf("{\"status\":\"passed\",\"initialArenaFailures\":%u,\"byteIdenticalRecoveries\":%u,\"outsideHashSchedules\":3}\n", cancellations, recoveries);
   return 0;
}
