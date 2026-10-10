/* SPDX-License-Identifier: MIT
 * Standard GLES3 emission from the pinned TGSI parser. A float temporary can
 * canonicalize integer NaN encodings (notably the true mask 0xffffffff).
 * Therefore register custody, MOV, UCMP and integer operations use uvec4;
 * only actual float operations and smoothly interpolated IO decode words.
 * This emitter carries no static numeric or exact/private certificate.
 */
#include "standard_emit.h"
#include "bridge.h"
#include "tgsi/tgsi_parse.h"
#include "tgsi/tgsi_info.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef STANDARD_OUTPUT_CAPACITY
#define STANDARD_OUTPUT_CAPACITY BRIDGE_MAX_GLSL
#endif
struct output { char *text; size_t used; bool failed; };
static void put(struct output *o, const char *format, ...)
{
   if (o->failed) return;
   va_list args; va_start(args, format);
   int n = vsnprintf(o->text + o->used, STANDARD_OUTPUT_CAPACITY + 1 - o->used, format, args);
   va_end(args);
   if (n < 0 || (size_t)n > STANDARD_OUTPUT_CAPACITY - o->used) o->failed = true;
   else o->used += (size_t)n;
}
static void named(const struct standard_profile *p, unsigned file, unsigned index, char name[48])
{
   if (file == TGSI_FILE_TEMPORARY) snprintf(name, 48, "t%u", index);
   else if (file == TGSI_FILE_OUTPUT) snprintf(name, 48, "o%u", index);
   else if (file == TGSI_FILE_IMMEDIATE) snprintf(name, 48, "imm%u", index);
   else if (file == TGSI_FILE_INPUT) {
      const struct standard_io *io = &p->input[index];
      if (!p->stage) snprintf(name, 48,
         (p->signed_inputs | p->unsigned_inputs) & (1u << index) ? "uvec4(in_%u)" : "floatBitsToUint(in_%u)", index);
      else if (io->semantic == STD_POSITION) snprintf(name, 48, "floatBitsToUint(gl_FragCoord)");
      else if (io->semantic == STD_PCOORD) snprintf(name, 48, "wv_point_coord()");
      else if (io->flat) snprintf(name, 48, "vso_g%u", io->sid);
      else snprintf(name, 48, "floatBitsToUint(vso_g%u)", io->sid);
   } else if (file == TGSI_FILE_SYSTEM_VALUE) {
      if (p->system[index].semantic == STD_PCOORD) snprintf(name, 48, "wv_point_coord()");
      else snprintf(name, 48, "uvec4(uint(%s))", p->system[index].semantic == STD_VERTEXID ? "gl_VertexID" : "gl_InstanceID");
   } else snprintf(name, 48, "INVALID"); /* structurally unreachable */
}
static void source(struct output *o, const struct standard_profile *p,
                   const struct tgsi_full_instruction *i, unsigned at, const char *variable)
{
   const struct tgsi_full_src_register *s = &i->Src[at];
   const struct tgsi_src_register *r = &s->Register;
   char base[48];
   if (r->File == TGSI_FILE_CONSTANT) {
      if (r->Indirect) snprintf(base, sizeof(base), "%sconst0[addr0]", p->stage ? "fs" : "vs");
      else snprintf(base, sizeof(base), "%sconst0[%u]", p->stage ? "fs" : "vs", r->Index);
   } else named(p, r->File, r->Index, base);
   const char *lane = "xyzw";
   put(o, "uvec4 %s = (%s).%c%c%c%c;\n", variable, base,
       lane[r->SwizzleX], lane[r->SwizzleY], lane[r->SwizzleZ], lane[r->SwizzleW]);
   enum tgsi_opcode_type type = tgsi_opcode_infer_src_type(i->Instruction.Opcode);
   if (i->Instruction.Opcode == TGSI_OPCODE_UCMP && !at) type = TGSI_TYPE_UNSIGNED;
   if (type == TGSI_TYPE_FLOAT || type == TGSI_TYPE_UNTYPED) {
      /* IEEE sign modifiers, without floating arithmetic or NaN conversion. */
      if (r->Absolute) put(o, "%s &= uvec4(0x7fffffffu);\n", variable);
      if (r->Negate) put(o, "%s ^= uvec4(0x80000000u);\n", variable);
   } else if (r->Negate) put(o, "%s = uvec4(0u) - %s;\n", variable, variable);
}
static void interface(struct output *o, const struct standard_profile *p)
{
   put(o, "#version 300 es\nprecision highp float;\nprecision highp int;\n");
   for (unsigned f = STD_IN; f <= STD_OUT; ++f) {
      const struct standard_io *list = f == STD_IN ? p->input : p->output;
      for (unsigned j = 0; j < STANDARD_IO; ++j) if (p->declared[f][j]) {
         const struct standard_io *io = &list[j];
         if (io->semantic == STD_ATTRIBUTE) put(o, "in %s in_%u;\n", standard_attribute_type(p, j), j);
         else if (io->semantic == STD_GENERIC)
            put(o, "%s %s %s vso_g%u;\n", io->flat ? "flat" : "smooth",
                f == STD_IN ? "in" : "out", io->flat ? "uvec4" : "vec4", io->sid);
         else if (io->semantic == STD_COLOR) put(o, "layout(location=%u) out vec4 fsout_c%u;\n", io->sid, io->sid);
      }
   }
   if (p->broadcast) for (unsigned j = 1; j < 4; ++j) put(o, "layout(location=%u) out vec4 fsout_c%u;\n", j, j);
   if (p->constants) put(o, "uniform uvec4 %sconst0[%u];\n", p->stage ? "fs" : "vs", p->constants);
   for (unsigned j = 0; j < STANDARD_SAMPLERS; ++j) if (p->used_samplers & (1u << j))
      put(o, "uniform highp sampler2D %ssamp%u;\n", p->stage ? "fs" : "vs", j);
   if (!p->stage) put(o, "layout(std140) uniform VirglBlock {\nvec4 clipp[8];\nuint stipple_pattern[32];\nfloat winsys_adjust_y;\nfloat alpha_ref_val;\nbool clip_plane_enabled;\nint drawid_base;\n};\nuniform vec2 wv_point_size;\n");
   bool point_coord = false;
   for (unsigned j = 0; j < STANDARD_IO; ++j)
      point_coord |= p->declared[STD_IN][j] && p->input[j].semantic == STD_PCOORD;
   for (unsigned j = 0; j < 2; ++j)
      point_coord |= p->declared[STD_SV][j] && p->system[j].semantic == STD_PCOORD;
   if (point_coord) put(o, "uniform float wv_point_coord_y;\nuvec4 wv_point_coord() {\nreturn floatBitsToUint(vec4(gl_PointCoord.x, mix(1.0 - gl_PointCoord.y, gl_PointCoord.y, clamp(wv_point_coord_y, 0.0, 1.0)), 0.0, 1.0));\n}\n");
}
static void exit_program(struct output *o, const struct standard_profile *p)
{
   unsigned point_size = STANDARD_IO;
   for (unsigned j = 0; j < STANDARD_IO; ++j) if (p->declared[STD_OUT][j]) {
      const struct standard_io *io = &p->output[j];
      if (io->semantic == STD_POSITION) put(o, "gl_Position = uintBitsToFloat(o%u);\n", j);
      else if (io->semantic == STD_GENERIC) put(o, "vso_g%u = %s(o%u);\n", io->sid, io->flat ? "uvec4" : "uintBitsToFloat", j);
      else if (io->semantic == STD_COLOR) put(o, "fsout_c%u = uintBitsToFloat(o%u);\n", io->sid, j);
      else if (io->semantic == STD_PSIZE) point_size = j;
   }
   if (!p->stage) {
      put(o, "gl_Position.y *= winsys_adjust_y;\ngl_PointSize = wv_point_size.y > 0.5 ? ");
      if (point_size < STANDARD_IO) put(o, "uintBitsToFloat(o%u).x", point_size);
      else put(o, "1.0"); /* Unwritten PSIZE retains native undefined-domain authority. */
      put(o, " : wv_point_size.x;\n");
   }
   if (p->broadcast) for (unsigned j = 1; j < 4; ++j) put(o, "fsout_c%u = fsout_c0;\n", j);
   put(o, "}\n");
}
static bool instruction(struct output *o, const struct standard_profile *p,
                        const struct tgsi_full_instruction *i)
{
   unsigned op = i->Instruction.Opcode;
   if (op == TGSI_OPCODE_END) { exit_program(o, p); return true; }
   if (op == TGSI_OPCODE_ELSE) { put(o, "} else {\n"); return true; }
   if (op == TGSI_OPCODE_ENDIF) { put(o, "}\n"); return true; }
   if (op == TGSI_OPCODE_BGNLOOP) { put(o, "do {\n"); return true; }
   if (op == TGSI_OPCODE_ENDLOOP) { put(o, "} while (true);\n"); return true; }
   if (op == TGSI_OPCODE_BRK) { put(o, "break;\n"); return true; }
   if (op == TGSI_OPCODE_KILL) { put(o, "discard;\n"); return true; }
   /* IF's predicate must outlive the small operand scope. */
   if (op == TGSI_OPCODE_IF || op == TGSI_OPCODE_UIF) {
      put(o, "{\n"); source(o, p, i, 0, "condition");
      put(o, "flow_condition = %s;\n}\nif (flow_condition) {\n",
          op == TGSI_OPCODE_UIF ? "condition.x != 0u" : "uintBitsToFloat(condition).x != 0.0");
      return true;
   }
   put(o, "{\n");
   static const char *variables[] = {"a", "b", "c"};
   unsigned sources = op == TGSI_OPCODE_TEX ? 1 : i->Instruction.NumSrcRegs;
   for (unsigned j = 0; j < sources; ++j) source(o, p, i, j, variables[j]);
   if (op == TGSI_OPCODE_KILL_IF) { put(o, "if (any(lessThan(uintBitsToFloat(a), vec4(0.0)))) discard;\n}\n"); return true; }
   if (op == TGSI_OPCODE_UARL || op == TGSI_OPCODE_ARL) {
      put(o, "addr0 = %s;\n}\n", op == TGSI_OPCODE_UARL ? "int(a.x)" : "int(floor(uintBitsToFloat(a).x))"); return true;
   }
#define FA "uintBitsToFloat(a)"
#define FB "uintBitsToFloat(b)"
#define FC "uintBitsToFloat(c)"
#define IA "ivec4(a)"
#define IB "ivec4(b)"
#define RAW(x) put(o, "uvec4 r = " x ";\n")
#define FLOAT(x) RAW("floatBitsToUint(" x ")")
#define SCALAR(x) FLOAT("vec4(" x ")")
   switch (op) {
   case TGSI_OPCODE_MOV: RAW("a"); break;
   case TGSI_OPCODE_UCMP:
      RAW("uvec4(a.x != 0u ? b.x : c.x, a.y != 0u ? b.y : c.y, a.z != 0u ? b.z : c.z, a.w != 0u ? b.w : c.w)"); break;
   case TGSI_OPCODE_MUL: FLOAT(FA " * " FB); break;
   case TGSI_OPCODE_ADD: FLOAT(FA " + " FB); break;
   case TGSI_OPCODE_SUB: FLOAT(FA " - " FB); break;
   case TGSI_OPCODE_DIV: FLOAT(FA " / " FB); break;
   case TGSI_OPCODE_MAD: FLOAT(FA " * " FB " + " FC); break;
   case TGSI_OPCODE_LRP: FLOAT(FA " * " FB " + (vec4(1.0) - " FA ") * " FC); break;
   case TGSI_OPCODE_DP2: SCALAR("dot(" FA ".xy, " FB ".xy)"); break;
   case TGSI_OPCODE_DP3: SCALAR("dot(" FA ".xyz, " FB ".xyz)"); break;
   case TGSI_OPCODE_DP4: SCALAR("dot(" FA ", " FB ")"); break;
   case TGSI_OPCODE_RCP: SCALAR("1.0 / " FA ".x"); break;
   case TGSI_OPCODE_RSQ: SCALAR("inversesqrt(" FA ".x)"); break;
   case TGSI_OPCODE_SQRT: SCALAR("sqrt(" FA ".x)"); break;
   case TGSI_OPCODE_EX2: SCALAR("exp2(" FA ".x)"); break;
   case TGSI_OPCODE_LG2: SCALAR("log2(" FA ".x)"); break;
   case TGSI_OPCODE_POW: SCALAR("pow(" FA ".x, " FB ".x)"); break;
   case TGSI_OPCODE_SIN: SCALAR("sin(" FA ".x)"); break;
   case TGSI_OPCODE_COS: SCALAR("cos(" FA ".x)"); break;
   case TGSI_OPCODE_MIN: FLOAT("min(" FA ", " FB ")"); break;
   case TGSI_OPCODE_MAX: FLOAT("max(" FA ", " FB ")"); break;
   case TGSI_OPCODE_ABS: FLOAT("abs(" FA ")"); break;
   case TGSI_OPCODE_FRC: FLOAT("fract(" FA ")"); break;
   case TGSI_OPCODE_FLR: FLOAT("floor(" FA ")"); break;
   case TGSI_OPCODE_ROUND: FLOAT("roundEven(" FA ")"); break;
   case TGSI_OPCODE_TRUNC: FLOAT("trunc(" FA ")"); break;
   case TGSI_OPCODE_CEIL: FLOAT("ceil(" FA ")"); break;
   case TGSI_OPCODE_SSG: FLOAT("sign(" FA ")"); break;
   case TGSI_OPCODE_DDX: FLOAT("dFdx(" FA ")"); break;
   case TGSI_OPCODE_DDY: FLOAT("dFdy(" FA ")"); break;
   case TGSI_OPCODE_I2F: FLOAT("vec4(" IA ")"); break;
   case TGSI_OPCODE_U2F: FLOAT("vec4(a)"); break;
   case TGSI_OPCODE_F2I: RAW("uvec4(ivec4(" FA "))"); break;
   case TGSI_OPCODE_F2U: RAW("uvec4(" FA ")"); break;
   case TGSI_OPCODE_UADD: RAW("a + b"); break;
   case TGSI_OPCODE_UMUL: RAW("a * b"); break;
   case TGSI_OPCODE_INEG: RAW("uvec4(0u) - a"); break;
   case TGSI_OPCODE_IMIN: RAW("uvec4(min(" IA ", " IB "))"); break;
   case TGSI_OPCODE_IMAX: RAW("uvec4(max(" IA ", " IB "))"); break;
   case TGSI_OPCODE_UMIN: RAW("min(a, b)"); break;
   case TGSI_OPCODE_UMAX: RAW("max(a, b)"); break;
   case TGSI_OPCODE_AND: RAW("a & b"); break;
   case TGSI_OPCODE_OR: RAW("a | b"); break;
   case TGSI_OPCODE_XOR: RAW("a ^ b"); break;
   case TGSI_OPCODE_NOT: RAW("~a"); break;
   /* TGSI's integer shifts consume the low five bits, unlike out-of-range
    * native GLSL shifts, whose result is undefined. */
   case TGSI_OPCODE_SHL: RAW("a << (b & uvec4(31u))"); break;
   case TGSI_OPCODE_ISHR: RAW("uvec4(" IA " >> (b & uvec4(31u)))"); break;
   case TGSI_OPCODE_USHR: RAW("a >> (b & uvec4(31u))"); break;
#define COMPARE(opcode,fn,a,b) case TGSI_OPCODE_##opcode: RAW("uvec4(" fn "(" a ", " b ")) * uvec4(0xffffffffu)"); break
   COMPARE(FSEQ,"equal",FA,FB); COMPARE(FSNE,"notEqual",FA,FB);
   COMPARE(FSLT,"lessThan",FA,FB); COMPARE(FSGE,"greaterThanEqual",FA,FB);
   COMPARE(USEQ,"equal","a","b"); COMPARE(USNE,"notEqual","a","b");
   COMPARE(USLT,"lessThan","a","b"); COMPARE(USGE,"greaterThanEqual","a","b");
   COMPARE(ISLT,"lessThan",IA,IB); COMPARE(ISGE,"greaterThanEqual",IA,IB);
#undef COMPARE
#define COMPARE(opcode,fn) case TGSI_OPCODE_##opcode: FLOAT("vec4(" fn "(" FA ", " FB "))"); break
   COMPARE(SEQ,"equal"); COMPARE(SNE,"notEqual");
   COMPARE(SLT,"lessThan"); COMPARE(SGE,"greaterThanEqual");
#undef COMPARE
   case TGSI_OPCODE_TEX:
      put(o, "uvec4 r = floatBitsToUint(texture(%ssamp%u, " FA ".xy));\n", p->stage ? "fs" : "vs", i->Src[1].Register.Index); break;
   default: return false;
   }
#undef RAW
#undef FLOAT
#undef SCALAR
#undef FA
#undef FB
#undef FC
#undef IA
#undef IB
   if (i->Instruction.Saturate) put(o, "r = floatBitsToUint(clamp(uintBitsToFloat(r), vec4(0.0), vec4(1.0)));\n");
   const struct tgsi_dst_register *dst = &i->Dst[0].Register;
   char name[48], mask[5]; named(p, dst->File, dst->Index, name);
   unsigned n = 0; for (unsigned j = 0; j < 4; ++j) if (dst->WriteMask & (1u << j)) mask[n++] = "xyzw"[j]; mask[n] = 0;
   put(o, "%s.%s = r.%s;\n}\n", name, mask, mask);
   return true;
}
const char *standard_emit(const struct standard_profile *p, const struct tgsi_token *tokens, char **result)
{
   *result = NULL;
   struct output output = {.text = calloc(STANDARD_OUTPUT_CAPACITY + 1, 1)};
   if (!output.text) return "allocation-failed";
   interface(&output, p);
   struct tgsi_parse_context ctx;
   bool okay = tgsi_parse_init(&ctx, tokens) == TGSI_PARSE_OK;
   if (okay) {
      unsigned imm = 0;
      while (!tgsi_parse_end_of_tokens(&ctx)) {
         if (!tgsi_parse_token(&ctx)) { okay = false; break; }
         if (ctx.FullToken.Token.Type == TGSI_TOKEN_TYPE_IMMEDIATE) {
            const struct tgsi_full_immediate *i = &ctx.FullToken.FullImmediate;
            put(&output, "const uvec4 imm%u = uvec4(%uu, %uu, %uu, %uu);\n", imm++, i->u[0].Uint, i->u[1].Uint, i->u[2].Uint, i->u[3].Uint);
         }
      }
      tgsi_parse_free(&ctx);
      if (imm != p->immediates) okay = false;
   }
   put(&output, "void main() {\nbool flow_condition;\n");
   for (unsigned j = 0; j < BRIDGE_MAX_TEMPORARIES; ++j) if (p->declared[STD_TEMP][j]) put(&output, "uvec4 t%u;\n", j);
   for (unsigned j = 0; j < STANDARD_IO; ++j) if (p->declared[STD_OUT][j]) put(&output, "uvec4 o%u;\n", j);
   if (p->declared[STD_ADDR][0]) put(&output, "int addr0;\n");
   if (okay && tgsi_parse_init(&ctx, tokens) == TGSI_PARSE_OK) {
      unsigned count = 0;
      while (!tgsi_parse_end_of_tokens(&ctx)) {
         if (!tgsi_parse_token(&ctx)) { okay = false; break; }
         if (ctx.FullToken.Token.Type == TGSI_TOKEN_TYPE_INSTRUCTION) {
            ++count;
            if (!instruction(&output, p, &ctx.FullToken.FullInstruction)) { okay = false; break; }
         }
      }
      tgsi_parse_free(&ctx);
      if (count != p->instructions) okay = false;
   } else okay = false;
   if (!okay || output.failed) { free(output.text); return "translation-error"; }
   *result = output.text;
   return NULL;
}
