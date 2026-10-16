/* SPDX-License-Identifier: MIT */
/* All language checks use the production public API. The separately pinned
 * primary TGSI parser is interrogated only for canonical complete witnesses. */
#include "../bridge.h"
#include "tgsi/tgsi_text.h"
#include "tgsi/tgsi_parse.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int ok, const char *why)
{
   if (!ok) { fprintf(stderr, "hex-literals: %s\n", why); exit(1); }
}
static uint32_t read_u32(void)
{
   unsigned char bytes[4]; require(fread(bytes, 1, 4, stdin) == 4, "complete fixture integer");
   return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
      ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}
int main(void)
{
   char magic[4]; require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VHL1", 4), "fixture header");
   unsigned count = read_u32(); require(count > 0 && count <= 10000, "bounded case count");
   for (unsigned i = 0; i < count; ++i) {
      unsigned stage = read_u32(), expected = read_u32(), primary = read_u32(), length = read_u32();
      require(stage < 2 && expected < 2 && primary < 2 && length <= BRIDGE_MAX_TEXT + 1, "bounded request");
      char *text = malloc(length + 1); require(text != NULL, "fixture allocation");
      require(fread(text, 1, length, stdin) == length, "complete fixture text"); text[length] = 0;
      const char *result = bridge_translate((int)stage, text, length);
      require((strncmp(result, "{\"ok\":true,", 11) == 0) == (int)expected, "literal public admission");
      require(strnlen(result, BRIDGE_MAX_RESULT) < BRIDGE_MAX_RESULT, "bounded terminated response");
      if (!expected) require(!strstr(result, "\"glsl\":"), "no partial rejected shader");
      char *baseline = strdup(result); require(baseline != NULL, "response ownership");
      printf("CASE %u %s\n", i, baseline); fflush(stdout);
      require(!strcmp(bridge_translate((int)stage, text, length), baseline), "exact repeat and recovery");
      if (primary) {
         struct tgsi_token tokens[BRIDGE_MAX_TOKENS];
         require(tgsi_text_translate(text, tokens, BRIDGE_MAX_TOKENS), "canonical primary parser accepted");
         struct tgsi_parse_context context;
         require(tgsi_parse_init(&context, tokens) == TGSI_PARSE_OK, "primary token initialization");
         printf("PRIMARY %u {\"immediates\":[", i);
         unsigned immediates = 0;
         while (!tgsi_parse_end_of_tokens(&context)) {
            tgsi_parse_token(&context);
            if (context.FullToken.Token.Type != TGSI_TOKEN_TYPE_IMMEDIATE) continue;
            const struct tgsi_full_immediate *immediate = &context.FullToken.FullImmediate;
            require(immediate->Immediate.NrTokens == 5, "four literal primary words");
            if (immediates++) putchar(',');
            printf("[%u,%u,%u,%u]", immediate->u[0].Uint, immediate->u[1].Uint,
                   immediate->u[2].Uint, immediate->u[3].Uint);
         }
         printf("]}\n"); tgsi_parse_free(&context);
      }
      free(baseline); free(text);
   }
   require(fgetc(stdin) == EOF && !ferror(stdin), "no trailing fixture bytes");
   puts("STATUS passed"); return 0;
}
