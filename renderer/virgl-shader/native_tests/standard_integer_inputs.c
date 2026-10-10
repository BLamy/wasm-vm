/* SPDX-License-Identifier: MIT — public typed compiler driver, no output oracle. */
#include "../bridge.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static unsigned number(FILE *f)
{
   unsigned char b[4];
   if (fread(b, 1, 4, f) != 4) exit(2);
   return b[0] | ((unsigned)b[1] << 8) | ((unsigned)b[2] << 16) | ((unsigned)b[3] << 24);
}
static char *text(FILE *f, unsigned *length)
{
   *length = number(f);
   if (*length > BRIDGE_MAX_TEXT + 1) exit(2);
   char *s = malloc(*length + 1);
   if (!s || fread(s, 1, *length, f) != *length) exit(2);
   s[*length] = 0; return s;
}
int main(int argc, char **argv)
{
   if (argc != 2) return 2;
   FILE *f = fopen(argv[1], "rb"); if (!f) return 2;
   unsigned count = number(f); if (count > 65536) return 2;
   for (unsigned i = 0; i < count; ++i) {
      unsigned kind = number(f), signed_mask = number(f), unsigned_mask = number(f), alen, blen;
      char *a = text(f, &alen), *b = text(f, &blen);
      if (kind > 3) return 2;
      const char *result = kind == 1 ? bridge_translate_standard_pair(a, alen, b, blen) :
         bridge_translate_standard_pair_typed(kind == 2 ? NULL : a, alen, kind == 3 ? NULL : b, blen,
                                             signed_mask, unsigned_mask);
      if (!result || strlen(result) > BRIDGE_MAX_PAIR_RESULT) return 3;
      printf("{\"case\":%u,\"result\":%s}\n", i, result);
      free(a); free(b);
   }
   if (fgetc(f) != EOF || ferror(f)) return 2;
   fclose(f); return 0;
}
