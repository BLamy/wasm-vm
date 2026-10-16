/* SPDX-License-Identifier: MIT */
#include "../bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int ok)
{
   if (!ok) { fputs("exact-reciprocal: invalid fixture or compiler result\n", stderr); exit(1); }
}

static uint32_t word(void)
{
   unsigned char bytes[4]; require(fread(bytes, 1, 4, stdin) == 4);
   return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
      ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

int main(void)
{
   char magic[4]; require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VRP1", 4));
   unsigned count = word(); require(count > 0 && count <= 512);
   for (unsigned c = 0; c < count; ++c) {
      unsigned length[2] = {word(), word()}, tuples[2] = {word(), word()};
      require(length[0] > 0 && length[0] <= BRIDGE_MAX_TEXT &&
              length[1] > 0 && length[1] <= BRIDGE_MAX_TEXT &&
              tuples[0] <= 184 && tuples[1] <= 184);
      struct bridge_exact_word *components[2] = {NULL, NULL};
      char *text[2] = {NULL, NULL};
      for (unsigned stage = 0; stage < 2; ++stage) {
         if (tuples[stage]) {
            components[stage] = calloc(tuples[stage], sizeof(*components[stage]));
            require(components[stage] != NULL);
            for (unsigned i = 0; i < tuples[stage]; ++i) {
               components[stage][i].reg = word();
               components[stage][i].component = word();
               components[stage][i].word = word();
            }
         }
      }
      for (unsigned stage = 0; stage < 2; ++stage) {
         text[stage] = malloc(length[stage] + 1); require(text[stage] != NULL);
         require(fread(text[stage], 1, length[stage], stdin) == length[stage]);
         text[stage][length[stage]] = 0;
      }
      const char *result = bridge_translate_pair_exact(text[0], length[0], components[0], tuples[0],
                                                       text[1], length[1], components[1], tuples[1]);
      require(result != NULL); printf("EXACT %s\n", result);
      result = bridge_translate_pair(text[0], length[0], text[1], length[1]);
      require(result != NULL); printf("OLD %s\n", result);
      for (unsigned stage = 0; stage < 2; ++stage) { free(text[stage]); free(components[stage]); }
   }
   require(fgetc(stdin) == EOF && !ferror(stdin));
   puts("STATUS passed");
   return 0;
}
