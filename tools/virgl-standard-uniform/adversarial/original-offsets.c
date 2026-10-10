/* Independent pinned-token regression for original signed16 vector offsets. */
#include "bridge.h"
#include "checked_tgsi_heap.h"
#include "tgsi/tgsi_text.h"
#include "tgsi/tgsi_parse.h"
#include <stdio.h>
#include <string.h>

static void json_text(const char *text)
{
    putchar('"');
    for (const char *c = text; *c; ++c) {
        if (*c == '\n') printf("\\n");
        else if (*c == '"' || *c == '\\') printf("\\%c", *c);
        else putchar(*c);
    }
    putchar('"');
}

static int response_matches(const char *response, int expected_ok)
{
    return response &&
        ((strstr(response, "\"ok\":true") != NULL) == expected_ok) &&
        (expected_ok || strstr(response, "\"code\":\"unsupported-feature\""));
}

int main(void)
{
    const int offsets[] = {-32768, -32767, -1024, -512, -1, 0, 1, 511,
                           512, 1023, 1024, 32766, 32767, 32768, -32769};
    const unsigned slots[] = {0, 0, 1, 12};
    for (int stage = 0; stage < 2; ++stage) {
        for (unsigned form = 0; form < 4; ++form) {
            for (unsigned n = 0; n < sizeof(offsets) / sizeof(offsets[0]); ++n) {
                const int off = offsets[n], valid = off >= -32768 && off <= 32767;
                const unsigned slot = slots[form], plain = form == 0;
                char text[2048], bank[100], source[100];
                if (plain) {
                    snprintf(bank, sizeof(bank), "CONST[0..511]");
                    snprintf(source, sizeof(source), "CONST[ADDR[0].x %c%d]",
                             off < 0 ? '-' : '+', off < 0 ? -off : off);
                } else {
                    snprintf(bank, sizeof(bank), "CONST[%u][0..%u]", slot, slot ? 1023 : 511);
                    snprintf(source, sizeof(source), "CONST[%u][ADDR[0].x %c%d]",
                             slot, off < 0 ? '-' : '+', off < 0 ? -off : off);
                }
                snprintf(text, sizeof(text),
                         "%s\nDCL %s\nDCL ADDR[0]\nDCL OUT[0], %s\n"
                         "IMM[0] FLT32 {%d.0,%d.0,%d.0,%d.0}\n"
                         "0: ARL ADDR[0].x, IMM[0].xxxx\n1: MOV OUT[0], %s\n2: END\n",
                         stage ? "FRAG" : "VERT", bank, stage ? "COLOR" : "POSITION",
                         -off, -off, -off, -off, source);

                struct tgsi_token tokens[BRIDGE_MAX_TOKENS] = {{0}};
                bridge_tgsi_scratch_begin_uniform();
                if (!tgsi_text_translate(text, tokens, BRIDGE_MAX_TOKENS)) return 2;
                struct tgsi_parse_context parser;
                if (tgsi_parse_init(&parser, tokens) != TGSI_PARSE_OK) return 2;
                int got = 0, index = 0, dimension = 0, dimension_present = 0;
                int indirect = 0, indirect_dimension = 0;
                while (!tgsi_parse_end_of_tokens(&parser)) {
                    if (!tgsi_parse_token(&parser)) return 2;
                    if (parser.FullToken.Token.Type != TGSI_TOKEN_TYPE_INSTRUCTION) continue;
                    struct tgsi_full_instruction *i = &parser.FullToken.FullInstruction;
                    for (unsigned src = 0; src < i->Instruction.NumSrcRegs; ++src) {
                        if (i->Src[src].Register.File != TGSI_FILE_CONSTANT) continue;
                        ++got;
                        index = i->Src[src].Register.Index;
                        dimension_present = i->Src[src].Register.Dimension;
                        dimension = dimension_present ? i->Src[src].Dimension.Index : 0;
                        indirect = i->Src[src].Register.Indirect;
                        indirect_dimension = dimension_present && i->Src[src].Dimension.Indirect;
                    }
                }
                tgsi_parse_free(&parser);
                /* Observe the pinned parser's truncation; selected admission must reject it. */
                const int expected_index = off == 32768 ? -32768 : off == -32769 ? 32767 : off;
                if (got != 1 || dimension != (int)slot || dimension_present == (int)plain ||
                    !indirect || indirect_dimension || index != expected_index) return 3;
                const char *response = bridge_translate_standard_uniform(stage, text, strlen(text));
                if (!response_matches(response, valid)) return 4;
                printf("{\"kind\":\"signed-offset\",\"stage\":\"%s\",\"form\":\"%s\","
                       "\"slot\":%u,\"offset\":%d,\"validSigned16\":%s,\"expectedOk\":%s,"
                       "\"predictedBase\":%d,\"effectiveVector\":0,\"originalParse\":true,"
                       "\"tokenSlot\":%d,\"tokenIndex\":%d,\"tokenIndirect\":true,"
                       "\"tokenDimensional\":%s,\"text\":",
                       stage ? "fragment" : "vertex", plain ? "plain" : "dimensional",
                       slot, off, valid ? "true" : "false", valid ? "true" : "false",
                       -off, dimension, index, dimension_present ? "true" : "false");
                json_text(text);
                printf(",\"result\":%s}\n", response);
            }
        }
    }

    const char *declarations[] = {"CONST[512]", "CONST[0..512]", "CONST[0..511]", "CONST[0..511]"};
    const unsigned direct_indices[] = {0, 0, 512, 1023};
    for (int stage = 0; stage < 2; ++stage) {
        for (unsigned n = 0; n < 4; ++n) {
            char text[512];
            snprintf(text, sizeof(text), "%s\nDCL %s\nDCL OUT[0], %s\n"
                     "0: MOV OUT[0], CONST[%u]\n1: END\n",
                     stage ? "FRAG" : "VERT", declarations[n],
                     stage ? "COLOR" : "POSITION", direct_indices[n]);
            const char *response = bridge_translate_standard_uniform(stage, text, strlen(text));
            if (!response_matches(response, 0)) return 5;
            printf("{\"kind\":\"direct-plain-limit\",\"stage\":\"%s\","
                   "\"expectedOk\":false,\"directIndex\":%u,\"text\":",
                   stage ? "fragment" : "vertex", direct_indices[n]);
            json_text(text);
            printf(",\"result\":%s}\n", response);
        }
    }
    return 0;
}
