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
   struct tgsi_header header; memcpy(&header, tokens, sizeof(header));
   unsigned words = header.HeaderSize + header.BodySize;
   if (words > BRIDGE_MAX_TOKENS) exit(4);
   printf("{\"rawWords\":[");
   for (unsigned i = 0; i < words; ++i) {
      uint32_t word; memcpy(&word, tokens + i, sizeof(word)); printf("%s%u", i ? "," : "", word);
   }
   printf("],\"systemDeclarations\":["); unsigned comma = 0;
   while (!tgsi_parse_end_of_tokens(&parser)) {
      if (!tgsi_parse_token(&parser)) exit(4);
      if (parser.FullToken.Token.Type != TGSI_TOKEN_TYPE_DECLARATION) continue;
      const struct tgsi_full_declaration *d = &parser.FullToken.FullDeclaration;
      if (d->Declaration.File != TGSI_FILE_SYSTEM_VALUE) continue;
      printf("%s{\"first\":%u,\"last\":%u,\"semantic\":%u,\"semanticIndex\":%u,\"mask\":%u}",
             comma++ ? "," : "", d->Range.First, d->Range.Last, d->Semantic.Name, d->Semantic.Index, d->Declaration.UsageMask);
   }
   tgsi_parse_free(&parser);
   if (tgsi_parse_init(&parser, tokens) != TGSI_PARSE_OK) exit(4);
   printf("],\"systemSources\":["); comma = 0; unsigned source_instruction = 0;
   while (!tgsi_parse_end_of_tokens(&parser)) {
      if (!tgsi_parse_token(&parser)) exit(4);
      if (parser.FullToken.Token.Type != TGSI_TOKEN_TYPE_INSTRUCTION) continue;
      const struct tgsi_full_instruction *i = &parser.FullToken.FullInstruction;
      for (unsigned n = 0; n < i->Instruction.NumSrcRegs; ++n) {
         const struct tgsi_src_register *s = &i->Src[n].Register;
         if (s->File != TGSI_FILE_SYSTEM_VALUE) continue;
         printf("%s{\"instruction\":%u,\"source\":%u,\"index\":%d,\"negate\":%u,\"absolute\":%u,\"swizzle\":[%u,%u,%u,%u]}",
                comma++ ? "," : "", source_instruction, n, s->Index, s->Negate, s->Absolute,
                s->SwizzleX, s->SwizzleY, s->SwizzleZ, s->SwizzleW);
      }
      ++source_instruction;
   }
   tgsi_parse_free(&parser);
   if (tgsi_parse_init(&parser, tokens) != TGSI_PARSE_OK) exit(4);
   printf("],\"immediates\":["); comma = 0; unsigned immediate = 0;
   while (!tgsi_parse_end_of_tokens(&parser)) {
      if (!tgsi_parse_token(&parser)) exit(4);
      if (parser.FullToken.Token.Type != TGSI_TOKEN_TYPE_IMMEDIATE) continue;
      const struct tgsi_full_immediate *i = &parser.FullToken.FullImmediate;
      printf("%s{\"index\":%u,\"type\":%u,\"words\":[%u,%u,%u,%u]}", comma++ ? "," : "",
             immediate++, i->Immediate.DataType, i->u[0].Uint, i->u[1].Uint, i->u[2].Uint, i->u[3].Uint);
   }
   tgsi_parse_free(&parser);
   if (tgsi_parse_init(&parser, tokens) != TGSI_PARSE_OK) exit(4);
   printf("],\"samplerViews\":["); comma = 0;
   while (!tgsi_parse_end_of_tokens(&parser)) {
      if (!tgsi_parse_token(&parser)) exit(4);
      if (parser.FullToken.Token.Type != TGSI_TOKEN_TYPE_DECLARATION) continue;
      const struct tgsi_full_declaration *d = &parser.FullToken.FullDeclaration;
      if (d->Declaration.File != TGSI_FILE_SAMPLER_VIEW) continue;
      printf("%s{\"first\":%u,\"last\":%u,\"target\":%u,\"returnTypes\":[%u,%u,%u,%u]}", comma++ ? "," : "",
             d->Range.First, d->Range.Last, d->SamplerView.Resource,
             d->SamplerView.ReturnTypeX, d->SamplerView.ReturnTypeY,
             d->SamplerView.ReturnTypeZ, d->SamplerView.ReturnTypeW);
   }
   tgsi_parse_free(&parser);
   if (tgsi_parse_init(&parser, tokens) != TGSI_PARSE_OK) exit(4);
   printf("],\"constantDeclarations\":["); comma = 0;
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
   tgsi_parse_free(&parser);
   if (tgsi_parse_init(&parser, tokens) != TGSI_PARSE_OK) exit(4);
   printf("],\"textureInstructions\":["); comma = 0; instruction = 0;
   while (!tgsi_parse_end_of_tokens(&parser)) {
      if (!tgsi_parse_token(&parser)) exit(4);
      if (parser.FullToken.Token.Type != TGSI_TOKEN_TYPE_INSTRUCTION) continue;
      const struct tgsi_full_instruction *i = &parser.FullToken.FullInstruction;
      if (i->Instruction.Texture) {
         printf("%s{\"instruction\":%u,\"opcode\":%u,\"target\":%u,\"writeMask\":%u,\"saturate\":%u,\"precise\":%u,\"offsets\":%u,\"sources\":[",
                comma++ ? "," : "", instruction, i->Instruction.Opcode, i->Texture.Texture,
                i->Dst[0].Register.WriteMask, i->Instruction.Saturate, i->Instruction.Precise, i->Texture.NumOffsets);
         for (unsigned n = 0; n < i->Instruction.NumSrcRegs; ++n) {
            const struct tgsi_full_src_register *s = &i->Src[n];
            printf("%s{\"file\":%u,\"index\":%d,\"slot\":%d,\"negate\":%u,\"absolute\":%u,\"swizzle\":[%u,%u,%u,%u],\"indirect\":%u}",
                   n ? "," : "", s->Register.File, s->Register.Index, s->Register.Dimension ? s->Dimension.Index : 0,
                   s->Register.Negate, s->Register.Absolute, s->Register.SwizzleX, s->Register.SwizzleY,
                   s->Register.SwizzleZ, s->Register.SwizzleW, s->Register.Indirect);
         }
         printf("]}");
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
      unsigned kind = number(f), masks[7], alen, blen;
      for (unsigned m = 0; m < 7; ++m) masks[m] = number(f);
      char *a = text(f, &alen), *b = text(f, &blen);
      const char *result;
      switch (kind) {
      case 0: case 1: result = bridge_translate_standard_texture((int)kind, a, alen); break;
      case 2: case 3: case 4:
         result = bridge_translate_standard_texture_pair(kind == 3 ? NULL : a, alen, kind == 4 ? NULL : b, blen,
                   masks[0], masks[1], masks[2], masks[3], masks[4]); break;
      case 5: result = bridge_translate_standard_texture(0, NULL, alen); break;
      case 6: result = bridge_translate_standard_texture(-1, a, alen); break;
      case 7: case 8: result = bridge_translate_standard((int)kind - 7, a, alen); break;
      case 9: result = bridge_translate_standard_pair(a, alen, b, blen); break;
      case 10: result = bridge_translate_standard_pair_typed(a, alen, b, blen, masks[0], masks[1]); break;
      case 11: result = bridge_translate_standard_pair_vertex_formats(a, alen, b, blen,
                    masks[0], masks[1], masks[2], masks[3]); break;
      case 12: case 13: result = bridge_translate_standard_uniform((int)kind - 12, a, alen); break;
      case 14: result = bridge_translate_standard_uniform_pair(a, alen, b, blen, masks[0], masks[1], masks[2], masks[3], masks[4]); break;
      case 15: case 16: result = bridge_translate_standard_integer_image((int)kind - 15, a, alen, masks[5], masks[6]); break;
      case 17: case 18: case 19:
         result = bridge_translate_standard_integer_image_pair(kind == 18 ? NULL : a, alen, kind == 19 ? NULL : b, blen,
                   masks[0], masks[1], masks[2], masks[3], masks[4], masks[5], masks[6]); break;
      case 20: result = bridge_translate_standard_integer_image(0, NULL, alen, masks[5], masks[6]); break;
      case 21: result = bridge_translate_standard_integer_image(-1, a, alen, masks[5], masks[6]); break;
      case 22: case 23: result = bridge_translate_standard_instance_base((int)kind - 22, a, alen, masks[5], masks[6]); break;
      case 24: case 25: case 26:
         result = bridge_translate_standard_instance_base_pair(kind == 25 ? NULL : a, alen, kind == 26 ? NULL : b, blen,
                   masks[0], masks[1], masks[2], masks[3], masks[4], masks[5], masks[6]); break;
      case 27: result = bridge_translate_standard_instance_base(0, NULL, alen, masks[5], masks[6]); break;
      case 28: result = bridge_translate_standard_instance_base(-1, a, alen, masks[5], masks[6]); break;
      case 29: case 30: result = bridge_translate_standard_shadow_texture((int)kind - 29, a, alen, masks[5], masks[6]); break;
      case 31: case 32: case 33:
         result = bridge_translate_standard_shadow_texture_pair(kind == 32 ? NULL : a, alen, kind == 33 ? NULL : b, blen,
                   masks[0], masks[1], masks[2], masks[3], masks[4], masks[5], masks[6]); break;
      case 34: result = bridge_translate_standard_shadow_texture(0, NULL, alen, masks[5], masks[6]); break;
      case 35: result = bridge_translate_standard_shadow_texture(-1, a, alen, masks[5], masks[6]); break;
      case 36: case 37: result = bridge_translate_standard_dimensional_texture((int)kind - 36, a, alen, masks[5], masks[6]); break;
      case 38: case 39: case 40:
         result = bridge_translate_standard_dimensional_texture_pair(kind == 39 ? NULL : a, alen, kind == 40 ? NULL : b, blen,
                   masks[0], masks[1], masks[2], masks[3], masks[4], masks[5], masks[6]); break;
      case 41: result = bridge_translate_standard_dimensional_texture(0, NULL, alen, masks[5], masks[6]); break;
      case 42: result = bridge_translate_standard_dimensional_texture(-1, a, alen, masks[5], masks[6]); break;
      default: return 2;
      }
      if (!result || strlen(result) > BRIDGE_MAX_PAIR_RESULT) return 3;
      printf("{\"case\":%u,\"result\":%s,\"originalTokens\":", i, result);
      if (strstr(result, "\"ok\":true")) {
         printf("["); original_tokens(a);
         if (kind == 2 || kind == 9 || kind == 10 || kind == 11 || kind == 14 || kind == 17 || kind == 24 || kind == 31 || kind == 38) { printf(","); original_tokens(b); }
         printf("]");
      } else printf("null");
      printf("}\n");
      free(a); free(b);
   }
   if (fgetc(f) != EOF || ferror(f)) return 2;
   fclose(f); return 0;
}
