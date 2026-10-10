/* SPDX-License-Identifier: MIT — actual compiler ABI, no semantic output oracle. */
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
static void original_tokens(const char *source)
{
   struct tgsi_token tokens[BRIDGE_MAX_TOKENS] = {{0}};
   bridge_tgsi_scratch_begin_uniform();
   if (!tgsi_text_translate(source, tokens, BRIDGE_MAX_TOKENS)) exit(4);
   struct tgsi_parse_context parser;
   if (tgsi_parse_init(&parser, tokens) != TGSI_PARSE_OK) exit(4);
   printf("{\"constantDeclarations\":["); unsigned comma = 0;
   while (!tgsi_parse_end_of_tokens(&parser)) {
      if (!tgsi_parse_token(&parser)) exit(4);
      if (parser.FullToken.Token.Type != TGSI_TOKEN_TYPE_DECLARATION) continue;
      const struct tgsi_full_declaration *d = &parser.FullToken.FullDeclaration;
      if (d->Declaration.File != TGSI_FILE_CONSTANT) continue;
      printf("%s{\"slot\":%u,\"first\":%u,\"last\":%u,\"dimensional\":%s}", comma++ ? "," : "",
             d->Declaration.Dimension ? d->Dim.Index2D : 0, d->Range.First, d->Range.Last,
             d->Declaration.Dimension ? "true" : "false");
   }
   tgsi_parse_free(&parser);
   if (tgsi_parse_init(&parser, tokens) != TGSI_PARSE_OK) exit(4);
   printf("],\"constantSources\":["); comma = 0; unsigned instruction = 0;
   while (!tgsi_parse_end_of_tokens(&parser)) {
      if (!tgsi_parse_token(&parser)) exit(4);
      if (parser.FullToken.Token.Type != TGSI_TOKEN_TYPE_INSTRUCTION) continue;
      const struct tgsi_full_instruction *i = &parser.FullToken.FullInstruction;
      for (unsigned n = 0; n < i->Instruction.NumSrcRegs; ++n) {
         const struct tgsi_full_src_register *s = &i->Src[n];
         if (s->Register.File != TGSI_FILE_CONSTANT) continue;
         printf("%s{\"instruction\":%u,\"slot\":%d,\"index\":%d,\"indirect\":%s,\"indirectDimension\":%s}", comma++ ? "," : "",
                instruction, s->Register.Dimension ? s->Dimension.Index : 0, s->Register.Index,
                s->Register.Indirect ? "true" : "false", s->Register.Dimension && s->Dimension.Indirect ? "true" : "false");
      }
      ++instruction;
   }
   tgsi_parse_free(&parser); printf("]}");
}
int main(int argc, char **argv)
{
   if (argc != 2) return 2;
   FILE *f = fopen(argv[1], "rb"); if (!f) return 2;
   unsigned count = number(f); if (count > 65536) return 2;
   for (unsigned i = 0; i < count; ++i) {
      unsigned kind = number(f), masks[5], alen, blen;
      for (unsigned m = 0; m < 5; ++m) masks[m] = number(f);
      char *a = text(f, &alen), *b = text(f, &blen);
      const char *result;
      switch (kind) {
      case 0: case 1: result = bridge_translate_standard_uniform((int)kind, a, alen); break;
      case 2: case 3: case 4:
         result = bridge_translate_standard_uniform_pair(kind == 3 ? NULL : a, alen, kind == 4 ? NULL : b, blen,
                   masks[0], masks[1], masks[2], masks[3], masks[4]); break;
      case 5: result = bridge_translate_standard_uniform(0, NULL, alen); break;
      case 6: result = bridge_translate_standard_uniform(-1, a, alen); break;
      case 7: case 8: result = bridge_translate_standard((int)kind - 7, a, alen); break;
      case 9: result = bridge_translate_standard_pair(a, alen, b, blen); break;
      case 10: result = bridge_translate_standard_pair_typed(a, alen, b, blen, masks[0], masks[1]); break;
      case 11: result = bridge_translate_standard_pair_vertex_formats(a, alen, b, blen,
                    masks[0], masks[1], masks[2], masks[3]); break;
      default: return 2;
      }
      if (!result || strlen(result) > BRIDGE_MAX_PAIR_RESULT) return 3;
      printf("{\"case\":%u,\"result\":%s,\"originalTokens\":", i, result);
      if (strstr(result, "\"ok\":true")) {
         printf("["); original_tokens(a);
         if (kind == 2 || kind >= 9) { printf(","); original_tokens(b); }
         printf("]");
      } else printf("null");
      printf("}\n");
      free(a); free(b);
   }
   if (fgetc(f) != EOF || ferror(f)) return 2;
   fclose(f); return 0;
}
