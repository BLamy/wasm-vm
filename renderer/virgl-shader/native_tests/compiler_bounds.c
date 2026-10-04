/* SPDX-License-Identifier: MIT
 * Test-only same-TU access measures owned arenas and writers. All language
 * witnesses and faults enter the public production bridge API. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
static unsigned attempts, fail_at;
static unsigned bounds_case, bounds_site;
static size_t allocation_sizes[64];
static char *case_texts[4096];
static unsigned case_lengths[4096];
static void *compiler_bounds_calloc(size_t count, size_t bytes);
#define calloc compiler_bounds_calloc
#include "../bridge.c"
#include "../raw_bits.c"
#undef calloc
static void *compiler_bounds_calloc(size_t count, size_t bytes)
{
   if (attempts < 64) allocation_sizes[attempts] = count * bytes;
   ++attempts;
   if (attempts == fail_at) return NULL;
   return calloc(count, bytes);
}
static void bounds_require(int value, const char *why)
{
   if (!value) { fprintf(stderr, "compiler-bounds case=%u site=%u: %s\n", bounds_case, bounds_site, why); exit(1); }
}
static uint32_t read_u32(void)
{
   unsigned char b[4]; bounds_require(fread(b, 1, 4, stdin) == 4, "complete uint32 input");
   return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
static int accepted(const char *result)
{
   size_t length = strnlen(result, BRIDGE_MAX_PAIR_RESULT);
   bounds_require(length < BRIDGE_MAX_PAIR_RESULT, "NUL terminated bounded JSON");
   if (strstr(result, "\"ok\":false"))
      bounds_require(!strstr(result, "\"glsl\":") && !strstr(result, "\"vertex\":"), "no partial rejected source");
   return !strncmp(result, "{\"ok\":true,", 11);
}
static void writer_limits(void)
{
   struct writer w = {.text = calloc(BRIDGE_MAX_GLSL + 1, 1), .used = BRIDGE_MAX_GLSL - 1};
   bounds_require(w.text != NULL, "writer allocation");
   emit(&w, "%s", "x");
   bounds_require(!w.overflow && w.used == BRIDGE_MAX_GLSL && w.text[BRIDGE_MAX_GLSL] == 0, "exact GLSL limit and terminator");
   emit(&w, "%s", "x"); bounds_require(w.overflow && w.used == BRIDGE_MAX_GLSL, "GLSL one-past fails without extending allocation");
   free(w.text);
   char *controls = malloc(BRIDGE_MAX_GLSL + 1);
   bounds_require(controls != NULL, "JSON witness allocation");
   memset(controls, 1, BRIDGE_MAX_GLSL); controls[BRIDGE_MAX_GLSL] = 0;
   begin_response(false); json_string(controls);
   bounds_require(!response_overflow && response_used == BRIDGE_MAX_GLSL * 6 + 2, "worst six-byte JSON encoding fits");
   bounds_require(!memcmp(response, "\"\\u0001", 7), "literal escaped prefix");
   size_t single = response_used;
   begin_response(true); json_string(controls); json_string(controls);
   bounds_require(!response_overflow && response_used == BRIDGE_MAX_GLSL * 12 + 4, "both worst-case stage strings fit pair");
   size_t pair = response_used;
   begin_response(false); response_capacity = 128; json_string(controls);
   bounds_require(response_overflow && response_used < 128, "short JSON fails bounded");
   bounds_require(strstr(error("translation-error", "JSON output exceeded its bound."), "\"ok\":false") != NULL && !response_overflow, "short JSON structured rejection");
   free(controls); begin_response(false);
   printf("WRITERS {\"glslLimit\":%u,\"singleWorstEscapedBytes\":%zu,\"pairWorstEscapedBytes\":%zu,\"shortCapacity\":128,\"status\":\"passed\"}\n", BRIDGE_MAX_GLSL, single, pair);
}
int main(void)
{
   writer_limits();
   printf("LAYOUT {\"ir\":%zu,\"profile\":%zu,\"flow\":%zu,\"frame\":%zu,\"raster\":%zu,\"conversion\":%zu,\"pairConversions\":%zu,\"singleResponse\":%zu,\"pairResponse\":%zu,\"rasterQueue\":%u,\"laneBits\":16,\"pcBits\":16}\n",
      sizeof(struct raw_ir), sizeof(struct profile), sizeof(struct flow_context), sizeof(struct flow_frame), sizeof(struct raster_analysis), sizeof(struct conversion), 2 * sizeof(struct conversion), sizeof(single_response), sizeof(pair_response), RASTER_QUEUE);
   char magic[4]; bounds_require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VGB2", 4), "fixture format");
   unsigned cases = read_u32(); bounds_require(cases > 0 && cases < 4096, "bounded fixture count");
   for (unsigned i = 0; i < cases; ++i) {
      bounds_case = i; bounds_site = 0;
      unsigned stage = read_u32(), ok = read_u32(), length = read_u32();
      bounds_require(stage < 2 && ok < 2 && length <= BRIDGE_MAX_TEXT + 1, "bounded fixture input");
      char *text = malloc(length + 1); bounds_require(text != NULL, "fixture ownership");
      case_texts[i] = text; case_lengths[i] = length;
      bounds_require(fread(text, 1, length, stdin) == length, "complete fixture"); text[length] = 0;
      attempts = fail_at = 0;
      const char *result = bridge_translate((int)stage, text, length);
      bounds_require(accepted(result) == (int)ok, "literal fixture admission");
      char *baseline = strdup(result); bounds_require(baseline != NULL, "owned JSON copy");
      unsigned allocations = attempts; bounds_require(allocations <= 64, "bounded allocation observations");
      printf("CASE %u %s\n", i, baseline);
      fflush(stdout);
      if (ok) for (unsigned site = 1; site <= allocations; ++site) {
         bounds_site = site;
         size_t bytes = allocation_sizes[site - 1]; attempts = 0; fail_at = site;
         result = bridge_translate((int)stage, text, length); fail_at = 0;
         bounds_require(attempts >= site && !accepted(result), "each owned allocation failure rejects");
         printf("FAULT %u %u %zu %s\n", i, site, bytes, result);
         attempts = 0; bounds_require(!strcmp(bridge_translate((int)stage, text, length), baseline), "exact recovery after allocation failure");
      }
      bounds_require(!strcmp(bridge_translate((int)stage, text, length), baseline), "repeat call retains literal output");
      free(baseline);
   }
   unsigned pairs = read_u32(); bounds_require(pairs <= 256, "bounded pair fixture count");
   for (unsigned i = 0; i < pairs; ++i) {
      bounds_case = i; bounds_site = 0;
      unsigned v = read_u32(), f = read_u32(), ok = read_u32();
      bounds_require(v < cases && f < cases && ok < 2, "pair fixture identities");
      attempts = fail_at = 0;
      const char *result = bridge_translate_pair(case_texts[v], case_lengths[v], case_texts[f], case_lengths[f]);
      bounds_require(accepted(result) == (int)ok, "literal paired admission");
      char *baseline = strdup(result); bounds_require(baseline != NULL, "owned pair baseline");
      unsigned allocations = attempts; bounds_require(allocations <= 64, "bounded pair allocations");
      printf("PAIR %u %s\n", i, baseline); fflush(stdout);
      if (ok) for (unsigned site = 1; site <= allocations; ++site) {
         bounds_site = site; size_t bytes = allocation_sizes[site-1]; attempts = 0; fail_at = site;
         result = bridge_translate_pair(case_texts[v], case_lengths[v], case_texts[f], case_lengths[f]); fail_at = 0;
         bounds_require(attempts >= site && !accepted(result), "each pair allocation failure rejects");
         printf("PAIRFAULT %u %u %zu %s\n", i, site, bytes, result);
         attempts = 0; bounds_require(!strcmp(bridge_translate_pair(case_texts[v], case_lengths[v], case_texts[f], case_lengths[f]), baseline), "exact paired allocation recovery");
      }
      free(baseline);
   }
   for (unsigned i = 0; i < cases; ++i) free(case_texts[i]);
   bounds_require(fgetc(stdin) == EOF && !ferror(stdin), "no trailing input");
   puts("STATUS passed"); return 0;
}
