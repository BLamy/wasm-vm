/* SPDX-License-Identifier: MIT
 * Public C driver; expectations and TGSI decoding live in independent tools.
 */
#include "../bridge.h"
#include "../checked_tgsi_heap.h"
#include "tgsi/tgsi_text.h"
#include "tgsi/tgsi_parse.h"
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
static void oracle(const char *text)
{
   char normalized[BRIDGE_MAX_TEXT + 1];
   size_t len = strlen(text); if (len > BRIDGE_MAX_TEXT) exit(4);
   for (size_t i = 0; i <= len; ++i) normalized[i] = text[i] == '\r' ? ' ' : text[i];
   struct tgsi_token tokens[BRIDGE_MAX_TOKENS] = {{0}};
   bridge_tgsi_scratch_begin();
   if (!tgsi_text_translate(normalized, tokens, BRIDGE_MAX_TOKENS)) exit(4);
   struct tgsi_parse_context p;
   if (tgsi_parse_init(&p, tokens) != TGSI_PARSE_OK) exit(4);
   printf("{\"stage\":%u,\"declarations\":[", p.FullHeader.Processor.Processor);
   unsigned instructions = 0, imms = 0, properties = 0, samplers = 0, writes[32] = {0}; int comma = 0;
   while (!tgsi_parse_end_of_tokens(&p)) {
      tgsi_parse_token(&p);
      unsigned type = p.FullToken.Token.Type;
      if (type == TGSI_TOKEN_TYPE_DECLARATION) {
         const struct tgsi_full_declaration *d = &p.FullToken.FullDeclaration;
         printf("%s{\"file\":%u,\"first\":%u,\"last\":%u,\"mask\":%u,\"hasSemantic\":%u,\"semantic\":%u,\"sid\":%u,\"interpolate\":%u}",
            comma++ ? "," : "", d->Declaration.File, d->Range.First, d->Range.Last,
            d->Declaration.UsageMask, d->Declaration.Semantic, d->Semantic.Name,
            d->Semantic.Index, d->Interp.Interpolate);
      } else if (type == TGSI_TOKEN_TYPE_INSTRUCTION) {
         ++instructions;
         const struct tgsi_full_instruction *i = &p.FullToken.FullInstruction;
         for (unsigned dst = 0; dst < i->Instruction.NumDstRegs; ++dst)
            if (i->Dst[dst].Register.File == TGSI_FILE_OUTPUT && i->Dst[dst].Register.Index < 32)
               writes[i->Dst[dst].Register.Index] |= i->Dst[dst].Register.WriteMask;
         if (i->Instruction.Opcode == TGSI_OPCODE_TEX) samplers |= 1u << i->Src[1].Register.Index;
      }
      else if (type == TGSI_TOKEN_TYPE_IMMEDIATE) ++imms;
      else if (type == TGSI_TOKEN_TYPE_PROPERTY) ++properties;
      else exit(4);
   }
   tgsi_parse_free(&p);
   printf("],\"instructions\":%u,\"immediates\":%u,\"properties\":%u,\"samplersUsed\":%u,\"outputWrites\":[", instructions, imms, properties, samplers);
   for (unsigned i = 0; i < 32; ++i) printf("%s%u", i ? "," : "", writes[i]);
   printf("]}");
}
int main(int argc, char **argv)
{
   if (argc != 2) return 2;
   FILE *f = fopen(argv[1], "rb"); if (!f) return 2;
   unsigned count = number(f); if (count > 65536) return 2;
   for (unsigned i = 0; i < count; ++i) {
      unsigned kind = number(f), alen, blen;
      char *a = text(f, &alen), *b = text(f, &blen);
      if (kind > 5) return 2;
      const char *result = kind == 2 ? bridge_translate_standard_pair(a, alen, b, blen) :
         kind == 5 ? bridge_translate_pair(a, alen, b, blen) :
         kind < 2 ? bridge_translate_standard((int)kind, a, alen) :
         bridge_translate((int)kind - 3, a, alen);
      if (!result || strlen(result) > BRIDGE_MAX_PAIR_RESULT) return 3;
      printf("{\"case\":%u,\"result\":%s,\"oracle\":", i, result);
      if (strstr(result, "\"ok\":true")) {
         printf("["); oracle(a);
         if (kind == 2 || kind == 5) { printf(","); oracle(b); }
         printf("]");
      } else printf("null");
      printf("}\n");
      free(a); free(b);
   }
   if (fgetc(f) != EOF || ferror(f)) return 2;
   fclose(f); return 0;
}
