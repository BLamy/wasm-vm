/* SPDX-License-Identifier: MIT */
#include "../bridge.h"
#include "../raw_bits.h"
#include "../raw_known_arithmetic.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fenv.h>

static void require(int ok, const char *why)
{
   if (!ok) { fprintf(stderr, "known-arithmetic: %s\n", why); exit(1); }
}
static uint32_t read_u32(void)
{
   unsigned char b[4]; require(fread(b, 1, 4, stdin) == 4, "complete fixture integer");
   return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
int main(void)
{
   char magic[4]; require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VKA1", 4), "fixture header");
   unsigned arithmetic = read_u32(); require(arithmetic > 0 && arithmetic <= 20000, "bounded arithmetic");
   for (unsigned i = 0; i < arithmetic; ++i) {
      unsigned op = read_u32(); uint32_t a = read_u32(), b = read_u32(), wanted = read_u32();
      require(op < 2, "typed arithmetic");
      const int modes[] = {FE_TONEAREST, FE_DOWNWARD, FE_UPWARD, FE_TOWARDZERO};
      for (unsigned mode = 0; mode < 4; ++mode) {
         require(fesetround(modes[mode]) == 0, "vary host rounding environment");
         uint32_t actual = op ? known_mul(a, b) : known_add(a, b);
         if (actual != wanted) fprintf(stderr, "arithmetic %u op%u %08x %08x: %08x != %08x\n", i, op, a, b, actual, wanted);
         require(actual == wanted, "independent rational prediction in every rounding mode");
      }
      printf("WORD %u %u\n", i, wanted);
   }
   require(fesetround(FE_TONEAREST) == 0, "restore host environment");
   unsigned count = read_u32(); require(count > 0 && count <= 15000, "bounded cases");
   for (unsigned i = 0; i < count; ++i) {
      unsigned stage = read_u32(), expected = read_u32(), bytes = read_u32();
      unsigned partner_bytes = read_u32(), pair_expected = read_u32();
      require(stage < 2 && expected < 2 && bytes <= BRIDGE_MAX_TEXT && partner_bytes <= BRIDGE_MAX_TEXT && pair_expected < 2, "bounded request");
      char *text = malloc(bytes + 1), *partner = malloc(partner_bytes + 1); require(text && partner, "input ownership");
      require(fread(text, 1, bytes, stdin) == bytes && fread(partner, 1, partner_bytes, stdin) == partner_bytes, "complete inputs");
      text[bytes] = partner[partner_bytes] = 0;
      const char *result = bridge_translate((int)stage, text, bytes);
      if ((strncmp(result, "{\"ok\":true,", 11) == 0) != (int)expected) fprintf(stderr, "case %u: %s\n%s\n", i, result, text);
      require((strncmp(result, "{\"ok\":true,", 11) == 0) == (int)expected, "predetermined public admission");
      char *saved = strdup(result); require(saved != NULL, "response ownership");
      printf("CASE %u %s\n", i, saved);
      require(!strcmp(bridge_translate((int)stage, text, bytes), saved), "exact single repeat");
      free(saved);
      result = stage ? bridge_translate_pair(partner, partner_bytes, text, bytes) : bridge_translate_pair(text, bytes, partner, partner_bytes);
      if ((strncmp(result, "{\"ok\":true,", 11) == 0) != (int)pair_expected) fprintf(stderr, "pair %u: %s\n", i, result);
      require((strncmp(result, "{\"ok\":true,", 11) == 0) == (int)pair_expected, "predetermined pair admission");
      saved = strdup(result); require(saved != NULL, "pair response ownership");
      printf("PAIR %u %s\n", i, saved);
      result = stage ? bridge_translate_pair(partner, partner_bytes, text, bytes) : bridge_translate_pair(text, bytes, partner, partner_bytes);
      require(!strcmp(result, saved), "exact pair repeat");
      free(saved); free(text); free(partner);
   }
   require(fgetc(stdin) == EOF && !ferror(stdin), "no trailing fixture bytes");
   printf("LAYOUT %zu %zu %zu\n", sizeof(struct raw_ir), sizeof(struct raw_instruction), sizeof(struct profile));
   puts("STATUS passed"); return 0;
}
