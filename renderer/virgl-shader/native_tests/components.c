/* SPDX-License-Identifier: MIT
 * E6-T12e1: unchanged original TGSI and shared literal boundary cases.
 * The Python runner hashes all inputs; C checks sanitizer-visible bounds,
 * rejection before upstream, and exact four-original recovery after attacks.
 */
#include "bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ORIGINALS 4u
#define RESULT_CAP (BRIDGE_MAX_GLSL * 2 + 16384)
static const int stages[ORIGINALS] = {1, 1, 0, 0};
static char *original[ORIGINALS], *baseline[ORIGINALS];
static size_t lengths[ORIGINALS];
static unsigned calls, recoveries, boundaries;
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
   for (unsigned i = 0; i < ORIGINALS; ++i) {
      const char *result = translate(stages[i], original[i], lengths[i]);
      require(!strcmp(result, baseline[i]), "exact original translation changed after attack");
      ++recoveries;
   }
}
static uint32_t read_u32(void)
{
   unsigned char b[4];
   require(fread(b, 1, 4, stdin) == 4, "complete fixture integer");
   return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
static void shared_cases(void)
{
   char magic[4], name[160], text[BRIDGE_MAX_TEXT + 1];
   require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VGC2", 4), "component fixture stream version");
   uint32_t count = read_u32();
   require(count > 0 && count <= 256, "bounded fixture case count");
   for (uint32_t i = 0; i < count; ++i) {
      uint32_t stage = read_u32(), accepted = read_u32(), name_length = read_u32(), text_length = read_u32();
      require(stage < 2 && accepted < 2 && name_length > 0 && name_length < sizeof(name) && text_length <= BRIDGE_MAX_TEXT,
              "bounded fixture fields");
      require(fread(name, 1, name_length, stdin) == name_length, "complete fixture name");
      require(fread(text, 1, text_length, stdin) == text_length, "complete fixture text");
      name[name_length] = 0; text[text_length] = 0;
      current_case = name;
      const char *result = translate((int)stage, text, text_length);
      require((strstr(result, "\"ok\":true,") != NULL) == (accepted != 0), "literal boundary acceptance");
      if (accepted) {
         require(strstr(result, "#version 300 es") && strstr(result, "virgl-webgl2-straight-line-v4"), "versioned ESSL300 success");
      } else {
         require(strstr(result, "\"code\":\"parse-error\"") || strstr(result, "\"code\":\"unsupported-feature\""),
                 "negative must reject in guard before upstream translation");
      }
      printf("BOUNDARY %u %s\n", i, result);
      ++boundaries;
      recover();
   }
   current_case = "fixture-end";
   require(fgetc(stdin) == EOF && !ferror(stdin), "no unconsumed fixture bytes");
}
static uint32_t random32(uint32_t *state)
{
   uint32_t v = *state;
   v ^= v << 13; v ^= v >> 17; v ^= v << 5;
   return *state = v;
}
static void truncations_and_mutations(void)
{
   unsigned truncations = 0, accepted_prefixes = 0;
   current_case = "original-byte-truncations";
   for (unsigned i = 0; i < ORIGINALS; ++i) {
      const char *terminal = strstr(original[i], ": END");
      require(terminal != NULL, "original END label exists");
      size_t complete = (size_t)(terminal - original[i]) + strlen(": END");
      for (size_t length = 0; length < lengths[i]; ++length) {
         const char *result = translate(stages[i], original[i], length);
         int ok = strstr(result, "\"ok\":true,") != NULL;
         require(ok == (length >= complete), "truncation accepts only complete END");
         ++truncations; accepted_prefixes += (unsigned)ok;
         recover();
      }
   }
   printf("TRUNCATIONS count=%u complete_end_prefixes=%u\n", truncations, accepted_prefixes);
   const uint32_t seeds[] = {0x36a9127du, 0xc481e35bu, 0x79b40a61u, 0xa28d65cfu};
   unsigned accepted = 0, rejected = 0;
   char buffer[BRIDGE_MAX_TEXT + 1];
   current_case = "original-byte-mutations";
   for (unsigned seed = 0; seed < sizeof(seeds) / sizeof(seeds[0]); ++seed) {
      uint32_t state = seeds[seed];
      for (unsigned n = 0; n < 1024; ++n) {
         unsigned i = random32(&state) % ORIGINALS;
         memcpy(buffer, original[i], lengths[i]);
         for (unsigned changes = 1 + random32(&state) % 8; changes; --changes) {
            size_t offset = random32(&state) % lengths[i];
            buffer[offset] = (char)(random32(&state) & 255);
         }
         const char *result = translate(stages[i], buffer, lengths[i]);
         if (strstr(result, "\"ok\":true,")) ++accepted; else ++rejected;
         recover();
      }
      printf("SEED %08x mutations=1024 recoveries=4096 passed\n", seeds[seed]);
   }
   printf("MUTATIONS accepted=%u rejected=%u\n", accepted, rejected);
}
int main(int argc, char **argv)
{
   require(argc == 5, "usage: component-test original-frag-a original-frag-b original-affine original-matrix < case-stream");
   for (unsigned i = 0; i < ORIGINALS; ++i) {
      FILE *file = fopen(argv[i + 1], "rb");
      require(file != NULL, "open hash-checked original");
      original[i] = malloc(BRIDGE_MAX_TEXT + 1);
      require(original[i] != NULL, "allocate bounded original");
      lengths[i] = fread(original[i], 1, BRIDGE_MAX_TEXT + 1, file);
      require(lengths[i] > 0 && lengths[i] <= BRIDGE_MAX_TEXT && !ferror(file) && feof(file), "read bounded whole original");
      require(fclose(file) == 0, "close original");
      original[i][lengths[i]] = 0;
      const char *result = translate(stages[i], original[i], lengths[i]);
      require(strstr(result, "\"ok\":true,") && strstr(result, "#version 300 es") && strstr(result, "virgl-webgl2-straight-line-v4"),
              "unchanged original translates to versioned ESSL300");
      baseline[i] = strdup(result);
      require(baseline[i] != NULL, "retain bounded original result");
      printf("ORIGINAL %u %s\n", i, result);
   }
   shared_cases();
   truncations_and_mutations();
   for (unsigned i = 0; i < ORIGINALS; ++i) { free(original[i]); free(baseline[i]); }
   printf("PASS originals=4 boundaries=%u calls=%u exact_original_recoveries=%u sanitizers=true\n", boundaries, calls, recoveries);
   return 0;
}
