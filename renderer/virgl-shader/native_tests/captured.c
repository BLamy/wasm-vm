/* SPDX-License-Identifier: MIT
 * Native ASan/UBSan acceptance for the two unmodified captured bodies.
 * native.py hashes the input files and feeds the shared negative JSON fixture
 * as a bounded binary stream. No TGSI normalization occurs on the positive path.
 */
#include "bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RESULT_CAP (BRIDGE_MAX_GLSL * 2 + 16384)
static unsigned calls, recoveries, negative_cases, positive_cases;
static char *captured[2], *baseline[2];
static size_t captured_length[2];
static const char *current_case = "initialization";

static void require(int condition, const char *why)
{
   if (!condition) {
      fprintf(stderr, "FAIL case=%s call=%u: %s\n", current_case, calls, why);
      exit(1);
   }
}

static const char *translate(int stage, const char *text, size_t length)
{
   ++calls;
   const char *result = bridge_translate(stage, text, length);
   require(result && strnlen(result, RESULT_CAP) < RESULT_CAP, "bounded result");
   require(!strncmp(result, "{\"ok\":true,", 11) || !strncmp(result, "{\"ok\":false,", 12), "structured result");
   return result;
}

static void recover(void)
{
   for (int stage = 0; stage < 2; ++stage) {
      const char *result = translate(stage, captured[stage], captured_length[stage]);
      require(!strcmp(result, baseline[stage]), "captured VS/FS conversion changed after attack");
      ++recoveries;
   }
}

static void accepts(int stage, const char *text)
{
   const char *result = translate(stage, text, strlen(text));
   require(strstr(result, "\"ok\":true,") && strstr(result, "#version 300 es"), "valid bounded grammar rejected");
   ++positive_cases;
   recover();
}

static void rejects(int stage, const char *text, size_t length)
{
   const char *result = translate(stage, text, length);
   require(strstr(result, "\"ok\":false,") != NULL, "invalid bounded grammar accepted");
   require(strstr(result, "\"code\":\"parse-error\"") || strstr(result, "\"code\":\"unsupported-feature\""),
           "invalid grammar must fail in the guard before upstream translation");
   ++negative_cases;
   recover();
}

static uint32_t random32(uint32_t *state)
{
   uint32_t value = *state;
   value ^= value << 13; value ^= value >> 17; value ^= value << 5;
   return *state = value;
}

static uint32_t read_u32(void)
{
   unsigned char bytes[4];
   require(fread(bytes, 1, sizeof(bytes), stdin) == sizeof(bytes), "complete fixture integer");
   return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
          ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static void shared_negative_cases(void)
{
   char magic[4], name[160], text[BRIDGE_MAX_TEXT + 1];
   require(fread(magic, 1, sizeof(magic), stdin) == sizeof(magic) && !memcmp(magic, "VGC1", 4), "fixture stream version");
   uint32_t count = read_u32();
   require(count > 0 && count <= 1024, "fixture case count bound");
   for (uint32_t i = 0; i < count; ++i) {
      uint32_t stage = read_u32(), name_length = read_u32(), text_length = read_u32();
      require(stage < 2 && name_length > 0 && name_length < sizeof(name) && text_length <= BRIDGE_MAX_TEXT, "fixture entry bounds");
      require(fread(name, 1, name_length, stdin) == name_length, "complete fixture name");
      require(fread(text, 1, text_length, stdin) == text_length, "complete fixture shader");
      name[name_length] = 0; text[text_length] = 0;
      current_case = name;
      rejects((int)stage, text, text_length);
      printf("negative=%s rejected recovery=2\n", name);
   }
   current_case = "fixture-end";
   require(fgetc(stdin) == EOF && !ferror(stdin), "no unconsumed fixture bytes");
}

static void positive_boundaries(void)
{
   char text[2048];
   current_case = "all-bounded-temp-ranges";
   for (unsigned first = 0; first < 8; ++first) for (unsigned last = first; last < 8; ++last) {
      snprintf(text, sizeof(text), "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL TEMP[%u..%u]\n"
               "MOV TEMP[%u], IN[0]\nMOV TEMP[%u], TEMP[%u]\nMOV OUT[0], TEMP[%u]\nEND\n",
               first, last, first, last, first, last);
      accepts(0, text);
   }
   printf("positive=temp-ranges count=36 singleton-and-endpoint-use=true\n");
   current_case = "all-four-component-swizzles";
   static const char lanes[] = "xyzw";
   for (unsigned swizzle = 0; swizzle < 256; ++swizzle) {
      snprintf(text, sizeof(text), "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0].%c%c%c%c\nEND\n",
               lanes[(swizzle >> 6) & 3], lanes[(swizzle >> 4) & 3], lanes[(swizzle >> 2) & 3], lanes[swizzle & 3]);
      accepts(0, text);
   }
   printf("positive=source-swizzles count=256\n");
   current_case = "finite-uint32-float-bit-boundaries";
   /* +/-zero, +/-one, +/-1e6, and the smallest +/-normal float. These
    * words are literal IEEE-754 binary32 boundary oracles, not translator output. */
   const uint32_t words[] = {0u, 2147483648u, 1065353216u, 3212836864u,
                            1232348160u, 3379831808u, 8388608u, 2155872256u};
   for (size_t i = 0; i < sizeof(words) / sizeof(words[0]); ++i) {
      snprintf(text, sizeof(text), "VERT\nDCL OUT[0], POSITION\nIMM[0] UINT32 {%u, %u, %u, %u}\nMOV OUT[0], IMM[0]\nEND\n",
               words[i], words[i], words[i], words[i]);
      accepts(0, text);
   }
   printf("positive=uint32-float-boundaries count=8\n");
   current_case = "masked-out-components-and-disjoint-ranges";
   accepts(0, "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1].xy, GENERIC[0]\n"
           "DCL TEMP[0..3]\nDCL TEMP[4..7]\nMOV TEMP[7], IN[0].wzyx\n"
           "MOV OUT[0].xy, TEMP[7].xyxx\nMOV OUT[0].z, TEMP[7].zzzz\n"
           "MOV OUT[0].w, TEMP[7].wwww\nMOV OUT[1].xy, IN[0].yxyx\nEND\n");
   current_case = "two-component-generic-safe-read";
   accepts(1, "FRAG\nDCL IN[0].xy, GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nMOV OUT[0], IN[0].xyyy\nEND\n");
   printf("positive=component-masks count=2\n");
}

static void truncation_and_mutation(void)
{
   unsigned truncations = 0, prefix_accepted = 0, mutation_accepted = 0, mutation_rejected = 0;
   char buffer[BRIDGE_MAX_TEXT + 1];
   current_case = "every-captured-byte-truncation";
   for (int stage = 0; stage < 2; ++stage) {
      const char *end = strstr(captured[stage], ": END");
      require(end != NULL, "captured terminal END marker exists");
      size_t complete = (size_t)(end - captured[stage]) + strlen(": END");
      for (size_t length = 0; length < captured_length[stage]; ++length) {
         const char *result = translate(stage, captured[stage], length);
         int accepted = strstr(result, "\"ok\":true,") != NULL;
         require(accepted == (length >= complete), "truncation accepts only a complete terminal END");
         prefix_accepted += (unsigned)accepted;
         ++truncations;
         recover();
      }
   }
   printf("truncations=%u complete_end_prefixes_accepted=%u recovery=%u\n", truncations, prefix_accepted, truncations * 2);
   const uint32_t seeds[] = {0x18a9e24du, 0x4c907fb3u, 0xc31e7d82u, 0x9b4260a5u};
   for (size_t seed = 0; seed < sizeof(seeds) / sizeof(seeds[0]); ++seed) {
      uint32_t state = seeds[seed];
      current_case = "captured-byte-mutation";
      for (unsigned i = 0; i < 2048; ++i) {
         int stage = (int)(random32(&state) & 1);
         size_t length = captured_length[stage];
         memcpy(buffer, captured[stage], length);
         for (unsigned changes = 1 + random32(&state) % 8; changes; --changes) {
            size_t offset = random32(&state) % length;
            char value = (char)(random32(&state) & 255);
            buffer[offset] = value;
         }
         const char *result = translate(stage, buffer, length);
         if (strstr(result, "\"ok\":true,")) ++mutation_accepted; else ++mutation_rejected;
         recover();
      }
      printf("seed=%08x captured_mutations=2048 recovery=4096 passed\n", seeds[seed]);
   }
   printf("mutations_accepted=%u mutations_rejected=%u\n", mutation_accepted, mutation_rejected);
}

int main(int argc, char **argv)
{
   require(argc == 3, "usage: captured-test vertex-corpus-path fragment-corpus-path < case-stream");
   for (int stage = 0; stage < 2; ++stage) {
      FILE *file = fopen(argv[stage + 1], "rb");
      require(file != NULL, "open hash-checked captured shader");
      captured[stage] = malloc(BRIDGE_MAX_TEXT + 1);
      require(captured[stage] != NULL, "allocate captured shader");
      captured_length[stage] = fread(captured[stage], 1, BRIDGE_MAX_TEXT + 1, file);
      require(captured_length[stage] > 0 && captured_length[stage] <= BRIDGE_MAX_TEXT && !ferror(file) && feof(file), "read whole bounded captured shader");
      require(fclose(file) == 0, "close captured shader");
      captured[stage][captured_length[stage]] = 0;
      const char *result = translate(stage, captured[stage], captured_length[stage]);
      require(strstr(result, "\"ok\":true,") && strstr(result, "#version 300 es"), "unmodified captured shader accepted");
      require(strstr(result, "\"profile\":\"virgl-webgl2-straight-line-v3\"") != NULL, "versioned component metadata");
      require(strstr(result, "\"semantic\":\"GENERIC\",\"semanticIndex\":0,\"componentMask\":3") != NULL,
              "captured generic declaration retains exactly xy");
      require(strstr(result, stage ? "\"semantic\":\"COLOR\",\"semanticIndex\":0,\"componentMask\":15,\"writtenMask\":15"
                                   : "\"semantic\":\"POSITION\",\"semanticIndex\":0,\"componentMask\":15,\"writtenMask\":15") != NULL,
              "captured position/color has complete declared and written components");
      if (!stage)
         require(strstr(result, "\"semantic\":\"GENERIC\",\"semanticIndex\":0,\"componentMask\":3,\"writtenMask\":3") != NULL,
                 "captured generic output writes exactly xy");
      baseline[stage] = strdup(result);
      require(baseline[stage] != NULL, "retain captured result for recovery oracle");
      printf("captured_stage=%d bytes=%zu accepted=true\n", stage, captured_length[stage]);
   }
   shared_negative_cases();
   positive_boundaries();
   truncation_and_mutation();
   for (int stage = 0; stage < 2; ++stage) { free(captured[stage]); free(baseline[stage]); }
   printf("PASS calls=%u positive_boundaries=%u negative_boundaries=%u exact_captured_recoveries=%u sanitizer_suite=true\n",
          calls, positive_cases, negative_cases, recoveries);
   return 0;
}
