/* SPDX-License-Identifier: MIT */
#include "raw_bits.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

static struct raw_lane source_lane(const struct raw_ir *ir, const struct raw_source *r, unsigned lane)
{
   unsigned component = r->swizzle[lane];
   if (r->file == TEMP) return ir->temporary[r->index][component];
   if (r->file == IMM) {
      uint32_t value = ir->immediates[r->index][component];
      return (struct raw_lane){.zero = ~value, .one = value};
   }
   if (r->file == IN) return (struct raw_lane){.origin = 1 + r->index * 4 + component};
   return (struct raw_lane){0}; /* Raw CONST has no float-origin authority. */
}

static struct raw_lane shifted(struct raw_lane a, struct raw_lane b, bool left)
{
   struct raw_lane result = {.zero = UINT32_MAX, .one = UINT32_MAX};
   /* Join every compatible low-five-bit count. This is a bounded 32-element
    * abstract evaluation, not a claim that dynamic counts are constant. */
   for (unsigned count = 0; count < 32; ++count) {
      if ((count & b.zero & 31u) || (~count & b.one & 31u)) continue;
      uint32_t zero, one;
      if (left) {
         zero = (a.zero << count) | (count ? UINT32_MAX >> (32 - count) : 0);
         one = a.one << count;
      } else {
         zero = (a.zero >> count) | (count ? UINT32_MAX << (32 - count) : 0);
         one = a.one >> count;
      }
      result.zero &= zero;
      result.one &= one;
   }
   return result;
}

static struct raw_lane known_word(uint32_t word)
{
   return (struct raw_lane){.zero = ~word, .one = word};
}

static bool known_operands(struct raw_lane a, struct raw_lane b)
{
   return (a.zero | a.one) == UINT32_MAX && (b.zero | b.one) == UINT32_MAX;
}

static uint32_t ordered_float_mask(uint32_t a, uint32_t b, bool greater_equal)
{
   uint32_t magnitude_a = a & UINT32_C(0x7fffffff), magnitude_b = b & UINT32_C(0x7fffffff);
   if (magnitude_a > UINT32_C(0x7f800000) || magnitude_b > UINT32_C(0x7f800000)) return 0;
   bool both_zero = magnitude_a == 0 && magnitude_b == 0;
   uint32_t key_a = a & UINT32_C(0x80000000) ? ~a : a ^ UINT32_C(0x80000000);
   uint32_t key_b = b & UINT32_C(0x80000000) ? ~b : b ^ UINT32_C(0x80000000);
   bool selected = greater_equal ? both_zero || key_a >= key_b : !both_zero && key_a < key_b;
   return selected ? UINT32_MAX : 0;
}

static struct raw_lane selected(struct raw_lane condition, struct raw_lane yes, struct raw_lane no)
{
   if (condition.zero == UINT32_MAX) return no;
   if (condition.one) return yes;
   /* An unknown selector retains only facts true for BOTH payloads. Distinct
    * float origins cannot become one input identity merely by being floats. */
   return (struct raw_lane){.zero = yes.zero & no.zero, .one = yes.one & no.one,
      .origin = yes.origin == no.origin ? yes.origin : 0};
}

void raw_record(struct raw_ir *ir, const struct raw_instruction *instruction)
{
   struct raw_lane result[4] = {{0}};
   /* Read all consumed lanes before publishing any destination lane. */
   for (unsigned lane = 0; lane < 4; ++lane) if (instruction->dst.mask & (1u << lane)) {
      struct raw_lane a = source_lane(ir, &instruction->src[0], lane), b = {0};
      if (instruction->opcode != RAW_MOV && instruction->opcode != RAW_NOT)
         b = source_lane(ir, &instruction->src[1], lane);
      switch (instruction->opcode) {
      case RAW_MOV: result[lane] = a; break;
      case RAW_AND: result[lane] = (struct raw_lane){.zero = a.zero | b.zero, .one = a.one & b.one}; break;
      case RAW_OR: result[lane] = (struct raw_lane){.zero = a.zero & b.zero, .one = a.one | b.one}; break;
      case RAW_NOT: result[lane] = (struct raw_lane){.zero = a.one, .one = a.zero}; break;
      case RAW_SHL: result[lane] = shifted(a, b, true); break;
      case RAW_USHR: result[lane] = shifted(a, b, false); break;
      case RAW_UADD:
         if (known_operands(a, b)) result[lane] = known_word(a.one + b.one);
         break;
      case RAW_ISGE:
         if (known_operands(a, b)) result[lane] = known_word(
            (a.one ^ UINT32_C(0x80000000)) >= (b.one ^ UINT32_C(0x80000000)) ? UINT32_MAX : 0);
         break;
      case RAW_USEQ:
         if (known_operands(a, b)) result[lane] = known_word(a.one == b.one ? UINT32_MAX : 0);
         break;
      case RAW_USNE:
         if (known_operands(a, b)) result[lane] = known_word(a.one != b.one ? UINT32_MAX : 0);
         break;
      case RAW_FSLT:
      case RAW_FSGE:
         if (known_operands(a, b)) result[lane] = known_word(ordered_float_mask(a.one, b.one, instruction->opcode == RAW_FSGE));
         break;
      case RAW_UCMP: result[lane] = selected(a, b, source_lane(ir, &instruction->src[2], lane)); break;
      }
   }
   struct raw_lane *destination = instruction->dst.file == TEMP ? ir->temporary[instruction->dst.index] : ir->output[instruction->dst.index];
   for (unsigned lane = 0; lane < 4; ++lane)
      if (instruction->dst.mask & (1u << lane)) destination[lane] = result[lane];
   ir->instructions[ir->count++] = *instruction;
   if (instruction->opcode != RAW_MOV) ir->opcode_mask |= 1u << instruction->opcode;
}

bool raw_outputs_safe(const struct profile *p)
{
   const uint32_t exponent = UINT32_C(0x7f800000), mantissa = UINT32_C(0x007fffff);
   for (unsigned index = 0; index < FILE_REGISTERS; ++index) if (p->declared[OUT][index]) {
      for (unsigned lane = 0; lane < 4; ++lane) if (p->components[OUT][index] & (1u << lane)) {
         struct raw_lane value = p->raw->output[index][lane];
         if (value.origin) continue;
         /* Exclude Inf/NaN, then exclude possible subnormal values. Signed
          * zero is permitted; neither the sign nor normal mantissa is lost. */
         if (!(value.zero & exponent) ||
             (!(value.one & exponent) && (value.zero & mantissa) != mantissa)) return false;
      }
   }
   return true;
}

struct writer { char *text; size_t used; bool overflow; };
static void emit(struct writer *w, const char *format, ...)
{
   if (w->overflow) return;
   va_list args;
   va_start(args, format);
   int count = vsnprintf(w->text + w->used, BRIDGE_MAX_GLSL + 1 - w->used, format, args);
   va_end(args);
   if (count < 0 || (size_t)count > BRIDGE_MAX_GLSL - w->used) w->overflow = true;
   else w->used += (size_t)count;
}

static void input_float(struct writer *w, const struct profile *p, unsigned index, unsigned component)
{
   if (p->stage) emit(w, "vso_g%u.%c", p->semantic_index[IN][index], "xyzw"[component]);
   else emit(w, "in_%u.%c", index, "xyzw"[component]);
}

static void operand(struct writer *w, const struct profile *p, const struct raw_source *r, unsigned lane)
{
   unsigned component = r->swizzle[lane];
   switch (r->file) {
   case IN:
      emit(w, "floatBitsToUint("); input_float(w, p, r->index, component); emit(w, ")"); break;
   case TEMP: emit(w, "raw_temp[%u].%c", r->index, "xyzw"[component]); break;
   case IMM: emit(w, "%uu", p->raw->immediates[r->index][component]); break;
   case CONST: emit(w, "%sconst0[%u].%c", p->stage ? "fs" : "vs", r->index, "xyzw"[component]); break;
   default: break; /* Guard excludes OUT/sampler operands before recording. */
   }
}

char *raw_emit(const struct profile *p, unsigned const_count)
{
   struct writer w = {.text = calloc(BRIDGE_MAX_GLSL + 1, 1)};
   if (!w.text) return NULL;
   emit(&w, "#version 300 es\nprecision highp float;\nprecision highp int;\n");
   for (unsigned file = IN; file <= OUT; ++file)
      for (unsigned index = 0; index < FILE_REGISTERS; ++index) if (p->declared[file][index]) {
         unsigned semantic = p->semantic[file][index];
         if (semantic == 0) emit(&w, "in vec4 in_%u;\n", index);
         /* Component masks constrain accessed lanes, not the float link ABI:
          * the pinned legacy emitter declares vec4 even for xy/xyz GENERIC. */
         else if (semantic == 2) emit(&w, "%s %s vec4 vso_g%u;\n", p->flat[file][index] ? "flat" : "smooth", file == IN ? "in" : "out", p->semantic_index[file][index]);
         else if (semantic == 3) emit(&w, "layout(location=0) out vec4 fsout_c0;\n");
      }
   if (const_count) emit(&w, "uniform highp uvec4 %sconst0[%u];\n", p->stage ? "fs" : "vs", const_count);
   if (!p->stage) emit(&w, "layout(std140) uniform VirglBlock {\n vec4 clipp[8];\n uint stipple_pattern[32];\n float winsys_adjust_y;\n float alpha_ref_val;\n bool clip_plane_enabled;\n int drawid_base;\n};\n");
   if (p->raw->opcode_mask & RAW_V3_OPCODES)
      emit(&w, "uint raw_float_mask(uint a, uint b, bool greater_equal) {\n"
         " uint magnitude_a = a & 2147483647u, magnitude_b = b & 2147483647u;\n"
         " if (magnitude_a > 2139095040u || magnitude_b > 2139095040u) return 0u;\n"
         " bool both_zero = magnitude_a == 0u && magnitude_b == 0u;\n"
         " uint key_a = (a & 2147483648u) != 0u ? ~a : a ^ 2147483648u;\n"
         " uint key_b = (b & 2147483648u) != 0u ? ~b : b ^ 2147483648u;\n"
         " bool selected = greater_equal ? both_zero || key_a >= key_b : !both_zero && key_a < key_b;\n"
         " return selected ? 4294967295u : 0u;\n}\n");
   emit(&w, "void main(void) {\n highp uvec4 raw_temp[118];\n highp uvec4 raw_out[8];\n highp uvec4 raw_rhs;\n");
   for (unsigned index = 0; index < p->raw->count; ++index) {
      const struct raw_instruction *instruction = &p->raw->instructions[index];
      emit(&w, " raw_rhs = uvec4(");
      for (unsigned lane = 0; lane < 4; ++lane) {
         if (lane) emit(&w, ", ");
         if (!(instruction->dst.mask & (1u << lane))) { emit(&w, "0u"); continue; }
         enum raw_opcode op = instruction->opcode;
         emit(&w, "(");
         if (op == RAW_NOT) emit(&w, "~");
         if (op == RAW_ISGE) emit(&w, "(");
         if (op == RAW_FSLT || op == RAW_FSGE) emit(&w, "raw_float_mask(");
         operand(&w, p, &instruction->src[0], lane);
         if (op == RAW_AND || op == RAW_OR) {
            emit(&w, op == RAW_AND ? " & " : " | "); operand(&w, p, &instruction->src[1], lane);
         } else if (op == RAW_SHL || op == RAW_USHR) {
            emit(&w, op == RAW_SHL ? " << (" : " >> (");
            operand(&w, p, &instruction->src[1], lane); emit(&w, " & 31u)");
         } else if (op == RAW_UADD) {
            emit(&w, " + "); operand(&w, p, &instruction->src[1], lane);
         } else if (op == RAW_ISGE) {
            emit(&w, " ^ 2147483648u) >= ("); operand(&w, p, &instruction->src[1], lane);
            emit(&w, " ^ 2147483648u) ? 4294967295u : 0u");
         } else if (op == RAW_USEQ || op == RAW_USNE) {
            emit(&w, op == RAW_USEQ ? " == " : " != "); operand(&w, p, &instruction->src[1], lane);
            emit(&w, " ? 4294967295u : 0u");
         } else if (op == RAW_UCMP) {
            emit(&w, " != 0u ? "); operand(&w, p, &instruction->src[1], lane);
            emit(&w, " : "); operand(&w, p, &instruction->src[2], lane);
         } else if (op == RAW_FSLT || op == RAW_FSGE) {
            emit(&w, ", "); operand(&w, p, &instruction->src[1], lane);
            emit(&w, op == RAW_FSGE ? ", true)" : ", false)");
         }
         emit(&w, ")");
      }
      emit(&w, ");\n raw_%s[%u].", instruction->dst.file == TEMP ? "temp" : "out", instruction->dst.index);
      for (unsigned lane = 0; lane < 4; ++lane) if (instruction->dst.mask & (1u << lane)) emit(&w, "%c", "xyzw"[lane]);
      emit(&w, " = raw_rhs.");
      for (unsigned lane = 0; lane < 4; ++lane) if (instruction->dst.mask & (1u << lane)) emit(&w, "%c", "xyzw"[lane]);
      emit(&w, ";\n");
   }
   for (unsigned index = 0; index < FILE_REGISTERS; ++index) if (p->declared[OUT][index]) {
      for (unsigned lane = 0; lane < 4; ++lane) if (p->components[OUT][index] & (1u << lane)) {
         unsigned semantic = p->semantic[OUT][index];
         if (semantic == 1) emit(&w, " gl_Position");
         else if (semantic == 2) emit(&w, " vso_g%u", p->semantic_index[OUT][index]);
         else emit(&w, " fsout_c0");
         emit(&w, ".%c = ", "xyzw"[lane]);
         unsigned origin = p->raw->output[index][lane].origin;
         if (origin) input_float(&w, p, (origin - 1) / 4, (origin - 1) % 4);
         else emit(&w, "uintBitsToFloat(raw_out[%u].%c)", index, "xyzw"[lane]);
         emit(&w, ";\n");
      }
   }
   if (!p->stage) emit(&w, " gl_Position.y = gl_Position.y * winsys_adjust_y;\n");
   emit(&w, "}\n");
   if (w.overflow) { free(w.text); return NULL; }
   return w.text;
}
