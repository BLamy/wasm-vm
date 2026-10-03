/* SPDX-License-Identifier: MIT */
#include "bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned calls;
static const char valid[] = "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n";
static char baseline[BRIDGE_MAX_GLSL * 2 + 16384];
static const struct { const char *path; int stage; } corpus[] = {
   {"tests/passthrough.vert.tgsi", 0}, {"tests/transform.vert.tgsi", 0},
   {"tests/linkage.frag.tgsi", 1}, {"tests/arithmetic.frag.tgsi", 1},
   {"tests/texture.frag.tgsi", 1}, {"tests/alpha.frag.tgsi", 1},
};
static char *corpus_text[6], *corpus_result[6];

static void require(int condition, const char *why)
{
   if (!condition) { fprintf(stderr, "FAIL: %s (call %u)\n", why, calls); exit(1); }
}

static const char *translate(int stage, const char *text, size_t length)
{
   ++calls;
   const char *result = bridge_translate(stage, text, length);
   require(result && strlen(result) < sizeof(baseline), "bounded result");
   require(!strncmp(result, "{\"ok\":true,", 11) || !strncmp(result, "{\"ok\":false,", 12), "structured result");
   return result;
}

static void recover(void)
{
   require(!strcmp(translate(0, valid, sizeof(valid) - 1), baseline), "successful conversion unchanged after hostile input");
}

static void rejects(int stage, const char *text, size_t length, const char *code)
{
   char expected[80];
   snprintf(expected, sizeof(expected), "\"code\":\"%s\"", code);
   const char *result = translate(stage, text, length);
   require(strstr(result, "\"ok\":false") && strstr(result, expected), expected);
   recover();
}

static uint32_t random32(uint32_t *state)
{
   uint32_t x = *state;
   x ^= x << 13; x ^= x >> 17; x ^= x << 5;
   return *state = x;
}

int main(void)
{
   const char *result = translate(0, valid, sizeof(valid) - 1);
   require(strstr(result, "\"ok\":true") && strstr(result, "#version 300 es"), "baseline translated by upstream");
   strcpy(baseline, result);
   for (unsigned i = 0; i < 6; ++i) {
      FILE *file = fopen(corpus[i].path, "rb");
      require(file != NULL, "open literal corpus");
      corpus_text[i] = malloc(BRIDGE_MAX_TEXT + 1);
      require(corpus_text[i] != NULL, "allocate corpus");
      size_t n = fread(corpus_text[i], 1, BRIDGE_MAX_TEXT, file);
      require(n > 0 && !ferror(file) && feof(file), "read bounded corpus");
      fclose(file);
      corpus_text[i][n] = 0;
      result = translate(corpus[i].stage, corpus_text[i], n);
      require(strstr(result, "\"ok\":true") != NULL, "all literal corpus conversions accepted under sanitizers");
      corpus_result[i] = strdup(result);
      require(corpus_result[i] != NULL, "retain corpus reference");
   }
   rejects(2, valid, sizeof(valid) - 1, "unsupported-stage");
   rejects(1, valid, sizeof(valid) - 1, "unsupported-stage");
   rejects(0, NULL, 0, "invalid-input");
   rejects(0, "", 0, "parse-error");
   rejects(0, "VERT\nEND\n", 9, "parse-error");
   rejects(0, valid, sizeof(valid), "invalid-input"); /* embedded terminal NUL */
   const char nonascii[] = "VERT\n\xff";
   rejects(0, nonascii, sizeof(nonascii) - 1, "invalid-input");
   char buffer[BRIDGE_MAX_TEXT + 2];
   memset(buffer, 'x', sizeof(buffer));
   rejects(0, buffer, BRIDGE_MAX_TEXT + 1, "input-too-large");
   rejects(0, buffer, BRIDGE_MAX_TEXT, "parse-error");

   static const struct { const char *line, *code; } cases[] = {
      { "PROPERTY UNKNOWN 1", "unsupported-feature" },
      { "PROPERTY FS_COORD_ORIGIN LOWER_LEFT", "unsupported-feature" },
      { "DCL IN[4294967296]", "unsupported-feature" },
      { "DCL IN[8]", "unsupported-feature" },
      { "DCL IN[0000000000000000000000000000000000000000]", "unsupported-feature" },
      { "DCL IN[0..7]", "unsupported-feature" },
      { "DCL IN[0]", "parse-error" },
      { "DCL OUT[1], POSITION", "parse-error" },
      { "DCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[0]", "parse-error" },
      { "DCL TEMP[0]\nMOV OUT[0], TEMP[0]", "parse-error" },
      /* v3 admits MOV/ADD/MUL component writes; masked MAD stays outside
       * this profile, preserving a neighboring unsupported-operation check. */
      { "MAD OUT[0].xy, IN[0], IN[0], IN[0]", "unsupported-feature" },
      { "MOV OUT[0], IN[0].xxx", "parse-error" },
      { "MOV OUT[0], -IN[0]", "parse-error" },
      { "IMM[0] FLT32 { nan, 0, 0, 0 }", "parse-error" },
      { "IMM[0] FLT32 { 1e99, 0, 0, 0 }", "parse-error" },
      { "IMM[0] FLT32 { 1000001, 0, 0, 0 }", "parse-error" },
      { "IMM[0] FLT32 { 1e-99, 0, 0, 0 }", "parse-error" },
      { "IMM[1] FLT32 { 0, 0, 0, 0 }", "parse-error" },
      { "FAKE OUT[0], IN[0]", "unsupported-feature" },
      { "IF IN[0]", "unsupported-feature" },
      { "9999999999999999999999999999: MOV OUT[0], IN[0]", "parse-error" },
      { "1: MOV OUT[0], IN[0]", "parse-error" },
      { "END\nMOV OUT[0], IN[0]", "parse-error" },
      { "MOV OUT[0], IN[0]\nDCL TEMP[0]", "parse-error" },
      { "MOV OUT[0], IN[0] trailing", "parse-error" },
   };
   for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); ++i) {
      int length = snprintf(buffer, sizeof(buffer), "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n%s\nMOV OUT[0], IN[0]\nEND\n", cases[i].line);
      require(length > 0 && (size_t)length < sizeof(buffer), "test input fits");
      rejects(0, buffer, (size_t)length, cases[i].code);
   }
   size_t length = (size_t)snprintf(buffer, sizeof(buffer), "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n");
   for (unsigned i = 0; i < BRIDGE_MAX_INSTRUCTIONS + 1; ++i)
      length += (size_t)snprintf(buffer + length, sizeof(buffer) - length, "MOV OUT[0], IN[0]\n");
   length += (size_t)snprintf(buffer + length, sizeof(buffer) - length, "END\n");
   rejects(0, buffer, length, "parse-error");

   /* Every truncation boundary, including all punctuation and operand edges. */
   for (size_t i = 0; i < sizeof(valid) - 1; ++i) {
      translate(0, valid, i);
      recover();
   }
   /* Fixed independent seeds make every mutation replayable. Mutations may
    * remain valid; recovery must be byte-identical regardless of that result. */
   const uint32_t seeds[] = {0x63dc19b1, 0xe687af04, 0x591ef830, 0x1ad290c7};
   unsigned accepted = 0, rejected = 0;
   for (unsigned seed = 0; seed < sizeof(seeds) / sizeof(seeds[0]); ++seed) {
      uint32_t state = seeds[seed];
      for (unsigned i = 0; i < 1024; ++i) {
         size_t n;
         if (i % 2) {
            n = sizeof(valid) - 1;
            memcpy(buffer, valid, n);
            for (unsigned changes = 1 + random32(&state) % 8; changes; --changes)
               buffer[random32(&state) % n] = (char)(random32(&state) & 255);
         } else {
            n = random32(&state) % 1024;
            for (size_t j = 0; j < n; ++j) buffer[j] = (char)(random32(&state) & 127);
         }
         result = translate(0, buffer, n);
         if (strstr(result, "\"ok\":true")) ++accepted; else ++rejected;
         recover();
         if (i % 64 == 0) for (unsigned c = 0; c < 6; ++c)
            require(!strcmp(translate(corpus[c].stage, corpus_text[c], strlen(corpus_text[c])), corpus_result[c]), "all VS/FS corpus results recover unchanged");
      }
      printf("seed=%08x mutations=1024 recovery=1024 passed\n", seeds[seed]);
   }
   for (unsigned i = 0; i < 6; ++i) { free(corpus_text[i]); free(corpus_result[i]); }
   printf("PASS calls=%u mutations_accepted=%u mutations_rejected=%u bounded_errors_and_recovery=true\n", calls, accepted, rejected);
   return 0;
}
