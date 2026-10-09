/* SPDX-License-Identifier: MIT
 * Bounded public-API driver. Independent expectations live outside the compiler. */
#include "../bridge.h"
#include "../raw_bits.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

_Static_assert(CONST_REGISTERS == 46, "Private raw/certificate capacity stays fixed");
_Static_assert(BRIDGE_MAX_EXACT_WORDS == 184, "Private exact tuple capacity stays fixed");
_Static_assert(sizeof(struct profile) <= 32768, "Owned parser arena stays fixed");

static unsigned number(FILE *input)
{
   unsigned char b[4];
   if (fread(b, 1, 4, input) != 4) exit(2);
   return b[0] | ((unsigned)b[1] << 8) | ((unsigned)b[2] << 16) | ((unsigned)b[3] << 24);
}
static char *text(FILE *input, unsigned *length)
{
   *length = number(input);
   if (*length > BRIDGE_MAX_TEXT) exit(2);
   char *value = malloc(*length + 1);
   if (!value || fread(value, 1, *length, input) != *length) exit(2);
   value[*length] = 0;
   return value;
}
int main(int argc, char **argv)
{
   if (argc != 2) return 2;
   FILE *input = fopen(argv[1], "rb");
   if (!input) return 2;
   unsigned count = number(input);
   if (count > 256) return 2;
   for (unsigned i = 0; i < count; ++i) {
      unsigned kind = number(input), a_length, b_length;
      char *a = text(input, &a_length), *b = text(input, &b_length);
      if (kind > 3) return 2;
      struct bridge_exact_word exact = {127, 0, 0};
      const char *result = kind == 2 ? bridge_translate_pair(a, a_length, b, b_length) :
         kind == 3 ? bridge_translate_exact(0, a, a_length, &exact, 1) :
         bridge_translate((int)kind, a, a_length);
      if (!result || strlen(result) > BRIDGE_MAX_PAIR_RESULT) return 3;
      printf("{\"case\":%u,\"result\":%s}\n", i, result);
      free(a); free(b);
   }
   if (fgetc(input) != EOF || ferror(input)) return 2;
   fclose(input);
   return 0;
}
