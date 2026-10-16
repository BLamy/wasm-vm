/* SPDX-License-Identifier: MIT — direct original-layout compiler ABI recorder. */
#include "../bridge.h"
#include "../checked_tgsi_heap.h"
#include "tgsi/tgsi_text.h"
#include "tgsi/tgsi_parse.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static uint32_t number(FILE *f)
{
   unsigned char b[4];
   if (fread(b, 1, 4, f) != 4) exit(2);
   return b[0] | (uint32_t)b[1] << 8 | (uint32_t)b[2] << 16 | (uint32_t)b[3] << 24;
}
static char *text(FILE *f, uint32_t *length)
{
   *length = number(f);
   if (*length > BRIDGE_MAX_TEXT + 1) exit(2);
   char *s = malloc(*length + 1);
   if (!s || fread(s, 1, *length, f) != *length) exit(2);
   s[*length] = 0;
   return s;
}
static void tokens(const char *source)
{
   struct tgsi_token value[BRIDGE_MAX_TOKENS] = {{0}};
   bridge_tgsi_scratch_begin_uniform();
   if (!tgsi_text_translate(source, value, BRIDGE_MAX_TOKENS)) exit(4);
   struct tgsi_header header; memcpy(&header, value, sizeof(header));
   unsigned count = header.HeaderSize + header.BodySize;
   if (count > BRIDGE_MAX_TOKENS) exit(4);
   printf("[");
   for (unsigned i = 0; i < count; ++i) {
      uint32_t word; memcpy(&word, value + i, sizeof(word));
      printf("%s%u", i ? "," : "", word);
   }
   printf("]");
}
int main(int argc, char **argv)
{
   if (argc != 2) return 2;
   FILE *f = fopen(argv[1], "rb");
   if (!f) return 2;
   uint32_t cases = number(f);
   if (cases > 100000) return 2;
   for (unsigned i = 0; i < cases; ++i) {
      uint32_t kind = number(f), capture = number(f), word_count = number(f), null_words = number(f);
      uint32_t selectors[7];
      for (unsigned j = 0; j < 7; ++j) selectors[j] = number(f);
      uint32_t a_length, b_length;
      char *a = text(f, &a_length), *b = text(f, &b_length);
      if (word_count > 262) return 2;
      uint32_t words[262] = {0};
      for (unsigned j = 0; j < word_count; ++j) words[j] = number(f);
      const uint32_t *layout = null_words ? NULL : words;
      const char *response;
      if (kind == 2) response = bridge_translate_standard_stream_output_pair(a, a_length, b, b_length,
         selectors[0], selectors[1], selectors[2], selectors[3], selectors[4], selectors[5], selectors[6],
         layout, word_count, capture);
      else response = bridge_translate_standard_stream_output((int)kind, a, a_length,
         selectors[5], selectors[6], layout, word_count, capture);
      printf("{\"index\":%u,\"response\":%s,\"originalTokens\":[", i, response);
      if (!strncmp(response, "{\"ok\":true", 10)) {
         tokens(a);
         if (kind == 2) { printf(","); tokens(b); }
      }
      printf("]}\n");
      free(a); free(b);
   }
   if (fgetc(f) != EOF) return 2;
   fclose(f);
   return 0;
}
