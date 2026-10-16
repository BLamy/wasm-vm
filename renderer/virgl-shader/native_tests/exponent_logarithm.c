/* SPDX-License-Identifier: MIT
 * Public admission/recovery plus separately pinned TGSI tokens/GLSL semantics.
 * No primary program enters the owned IR or supplies expected output words. */
#include "../bridge.h"
#include "../raw_bits.h"
#include "../checked_upstream.h"
#include "tgsi/tgsi_text.h"
#include "tgsi/tgsi_parse.h"
#include "tgsi/tgsi_info.h"
#include "vrend/vrend_shader.h"
#include "vrend/vrend_strbuf.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int ok, const char *why)
{
   if (!ok) { fprintf(stderr, "exponent: %s\n", why); exit(1); }
}
static uint32_t read_u32(void)
{
   unsigned char b[4]; require(fread(b, 1, 4, stdin) == 4, "complete fixture integer");
   return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
static void json_string(const char *text)
{
   putchar('"');
   for (const unsigned char *p = (const unsigned char *)text; *p; ++p) {
      if (*p == '"' || *p == '\\') printf("\\%c", *p);
      else if (*p < 32) printf("\\u%04x", *p);
      else putchar(*p);
   }
   putchar('"');
}
static void primary(unsigned index, unsigned stage, const char *text)
{
   struct tgsi_token tokens[BRIDGE_MAX_TOKENS] = {0};
   require(tgsi_text_translate(text, tokens, BRIDGE_MAX_TOKENS), "canonical pinned TGSI parser");
   struct tgsi_parse_context context;
   require(tgsi_parse_init(&context, tokens) == TGSI_PARSE_OK, "pinned token initialization");
   printf("PRIMARY %u {\"exponentInstructions\":[", index);
   unsigned count = 0;
   while (!tgsi_parse_end_of_tokens(&context)) {
      tgsi_parse_token(&context);
      if (context.FullToken.Token.Type != TGSI_TOKEN_TYPE_INSTRUCTION) continue;
      const struct tgsi_full_instruction *full = &context.FullToken.FullInstruction;
      unsigned op = full->Instruction.Opcode;
      if (op != TGSI_OPCODE_EX2 && op != TGSI_OPCODE_LG2) continue;
      require(full->Instruction.NumDstRegs == 1 && full->Instruction.NumSrcRegs == 1 && !full->Instruction.Precise && !full->Instruction.Saturate,
              "actual primary arity/modifiers");
      require(tgsi_opcode_infer_src_type(op) == TGSI_TYPE_FLOAT && tgsi_opcode_infer_dst_type(op) == TGSI_TYPE_FLOAT,
              "pinned source/destination typed conversion semantics");
      require(tgsi_get_opcode_info(op)->output_mode == TGSI_OUTPUT_REPLICATE,
              "actual pinned scalar replication mode");
      printf("%s{\"opcode\":\"%s\",\"sourceType\":%u,\"destinationType\":%u,\"outputMode\":%u,\"mask\":%u}", count++ ? "," : "",
             op == TGSI_OPCODE_EX2 ? "EX2" : "LG2", tgsi_opcode_infer_src_type(op), tgsi_opcode_infer_dst_type(op), tgsi_get_opcode_info(op)->output_mode, full->Dst[0].Register.WriteMask);
   }
   require(count > 0, "primary conversion instruction exists"); tgsi_parse_free(&context);
   struct vrend_shader_cfg cfg = {.glsl_version = 300, .max_draw_buffers = 1, .use_gles = 1, .use_core_profile = 1, .use_integer = 1};
   struct vrend_shader_key key = {0};
   if (stage) key.fs.lower_left_origin = 1;
   struct vrend_shader_info info = {0}; struct vrend_variable_shader_info variable = {0}; struct vrend_strarray shader = {0};
   require(strarray_alloc(&shader, SHADER_MAX_STRINGS), "primary source allocation");
   bridge_upstream_allocation_begin();
   require(vrend_convert_shader(NULL, &cfg, tokens, 0, &key, &info, &variable, &shader) && !bridge_upstream_allocation_failed(), "pinned primary conversion");
   size_t bytes = 0;
   for (int i = 0; i < shader.num_strings; ++i) bytes += strlen(shader.strings[i].buf);
   require(bytes < BRIDGE_MAX_GLSL, "bounded primary source");
   char *glsl = calloc(bytes + 1, 1); require(glsl != NULL, "primary source ownership");
   for (int i = 0; i < shader.num_strings; ++i) strcat(glsl, shader.strings[i].buf);
   printf("],\"constantCount\":%d,\"glsl\":", info.num_consts); json_string(glsl); puts("}");
   free(glsl); strarray_free(&shader, true); free(info.sampler_arrays); free(info.image_arrays);
}
int main(void)
{
   char magic[4]; require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VXL1", 4), "fixture header");
   unsigned count = read_u32(); require(count > 0 && count <= 10000, "bounded cases");
   for (unsigned i = 0; i < count; ++i) {
      unsigned stage = read_u32(), expected = read_u32(), reference = read_u32(), bytes = read_u32();
      require(stage < 2 && expected < 2 && reference < 2 && bytes <= BRIDGE_MAX_TEXT, "bounded request");
      char *text = malloc(bytes + 1); require(text != NULL, "fixture allocation");
      require(fread(text, 1, bytes, stdin) == bytes, "complete fixture text"); text[bytes] = 0;
      const char *result = bridge_translate((int)stage, text, bytes);
      if ((strncmp(result, "{\"ok\":true,", 11) == 0) != (int)expected) fprintf(stderr, "case %u: %s\n%s\n", i, result, text);
      require((strncmp(result, "{\"ok\":true,", 11) == 0) == (int)expected, "predetermined public admission");
      require(strnlen(result, BRIDGE_MAX_RESULT) < BRIDGE_MAX_RESULT, "bounded response");
      if (!expected) require(!strstr(result, "\"glsl\":") && !strstr(result, "\"metadata\":"), "closed rejection");
      char *baseline = strdup(result); require(baseline != NULL, "response ownership");
      printf("CASE %u %s\n", i, baseline); fflush(stdout);
      require(!strcmp(bridge_translate((int)stage, text, bytes), baseline), "exact repeat/recovery");
      if (reference) primary(i, stage, text);
      free(text); free(baseline);
   }
   require(fgetc(stdin) == EOF && !ferror(stdin), "no trailing fixture bytes"); puts("STATUS passed"); return 0;
}
