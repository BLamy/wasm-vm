/* SPDX-License-Identifier: MIT */
#include "raw_bits.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

static struct raw_lane source_lane(const struct raw_ir *ir, const struct raw_source *r, unsigned lane, bool conditional)
{
   unsigned component = r->swizzle[lane];
   if (r->file == TEMP) return ir->temporary[r->index][component];
   if (r->file == IMM) {
      uint32_t value = ir->immediates[r->index][component];
      return (struct raw_lane){.zero = ~value, .one = value};
   }
   if (r->file == IN) return (struct raw_lane){.origin = (1 + r->index * 4 + component) | RAW_OUTPUT};
   if (r->file == CONST && conditional)
      return (struct raw_lane){.origin = RAW_FLOAT_CONDITIONAL | RAW_BANK_DEPENDENCY};
   return (struct raw_lane){0};
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

static bool safe_raw_float(struct raw_lane value)
{
   const uint32_t exponent = UINT32_C(0x7f800000), mantissa = UINT32_C(0x007fffff);
   return (value.zero & exponent) && ((value.one & exponent) || (value.zero & mantissa) == mantissa);
}

static unsigned float_mode(struct raw_lane value)
{
   return value.origin ? value.origin : safe_raw_float(value) ? RAW_FLOAT_DECODE | RAW_OUTPUT : 0;
}

static bool output_legal(struct raw_lane value)
{
   return (value.origin & RAW_OUTPUT) || safe_raw_float(value);
}

struct raw_lane raw_join(struct raw_lane yes, struct raw_lane no)
{
   unsigned origin = 0;
   if (float_mode(yes) && float_mode(no))
      origin = RAW_FLOAT_SHADOW | ((yes.origin | no.origin) & RAW_BANK_DEPENDENCY) |
         (output_legal(yes) && output_legal(no) ? RAW_OUTPUT : 0);
   return (struct raw_lane){.zero = yes.zero & no.zero, .one = yes.one & no.one, .origin = origin};
}

static struct raw_lane selected(struct raw_lane condition, struct raw_lane yes, struct raw_lane no, bool mixed)
{
   if (condition.zero == UINT32_MAX) return no;
   if (condition.one) return yes;
   /* An unknown selector retains only facts true for BOTH payloads. Distinct
    * float origins remain distinct in old profiles. A mixed stage instead
    * materializes the chosen authorized value in a new float shadow. */
   unsigned origin = yes.origin == no.origin ? yes.origin : 0;
   if (mixed && float_mode(yes) && float_mode(no))
      origin = RAW_FLOAT_SHADOW | ((yes.origin | no.origin) & RAW_BANK_DEPENDENCY) |
         (output_legal(yes) && output_legal(no) ? RAW_OUTPUT : 0);
   return (struct raw_lane){.zero = yes.zero & no.zero, .one = yes.one & no.one, .origin = origin};
}

unsigned raw_consumed_mask(enum raw_opcode opcode, unsigned destination_mask)
{
   /* TGSI scalar operations consume post-swizzle x/xyz independently of the
    * written lanes. Use the same rule for initialization and float authority. */
   if (opcode == RAW_DP3) return 7u;
   if (opcode == RAW_RCP || opcode == RAW_RSQ) return 1u;
   return opcode == RAW_TEX ? 3u : destination_mask;
}

bool raw_record(struct raw_ir *ir, const struct raw_instruction *input)
{
   if ((1u << input->opcode) & RAW_STRUCTURED_OPCODES) {
      ir->instructions[ir->count++] = *input;
      ir->opcode_mask |= 1u << input->opcode;
      return true;
   }
   struct raw_instruction checked = *input;
   checked.float_mask = 0;
   for (unsigned source = 0; source < 3; ++source) checked.float_modes[source] = 0;
   const struct raw_instruction *instruction = &checked;
   bool mixed = (instruction->flags & RAW_MIXED) != 0;
   bool conditional = (instruction->flags & RAW_CONDITIONAL) != 0;
   bool structured = (instruction->flags & RAW_STRUCTURED) != 0;
   bool numeric = ((1u << instruction->opcode) & RAW_NUMERIC_OPCODES) != 0;
   unsigned dependency = 0;
   unsigned sources = instruction->opcode == RAW_MOV || instruction->opcode == RAW_NOT ||
      instruction->opcode == RAW_FRC || instruction->opcode == RAW_TEX ||
      instruction->opcode == RAW_RCP || instruction->opcode == RAW_RSQ ? 1 :
      instruction->opcode == RAW_UCMP || instruction->opcode == RAW_MAD || instruction->opcode == RAW_LRP ? 3 : 2;
   unsigned consumed = raw_consumed_mask(instruction->opcode, instruction->dst.mask);
   /* Capture read authority at the use site, before any aliased destination
    * changes facts. Every numeric lane must have an enforceable domain. */
   for (unsigned source = 0; source < sources; ++source)
      for (unsigned lane = 0; lane < 4; ++lane) if (consumed & (1u << lane)) {
         unsigned mode = float_mode(source_lane(ir, &instruction->src[source], lane, conditional));
         if (numeric && !mode) return false;
         if (numeric) dependency |= mode & RAW_BANK_DEPENDENCY;
         if (mixed) checked.float_modes[source] |= (uint32_t)mode << (lane * 8);
      }
   /* A known raw selector never demands numerical access to its unused arm.
    * Only the retry prunes these modes, preserving old emitted expressions. */
   if ((conditional || structured) && instruction->opcode == RAW_UCMP)
      for (unsigned lane = 0; lane < 4; ++lane) if (consumed & (1u << lane)) {
         struct raw_lane condition = source_lane(ir, &instruction->src[0], lane, conditional);
         if (condition.zero == UINT32_MAX || condition.one) {
            unsigned unused = condition.zero == UINT32_MAX ? 1 : 2;
            checked.float_modes[unused] &= ~(UINT32_C(255) << (lane * 8));
         }
      }
   struct raw_lane result[4] = {{0}};
   /* Read all consumed lanes before publishing any destination lane. */
   for (unsigned lane = 0; lane < 4; ++lane) if (instruction->dst.mask & (1u << lane)) {
      struct raw_lane a = {0}, b = {0};
      if (!numeric) {
         a = source_lane(ir, &instruction->src[0], lane, conditional);
         if (sources > 1) b = source_lane(ir, &instruction->src[1], lane, conditional);
      }
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
      case RAW_UCMP: result[lane] = selected(a, b, source_lane(ir, &instruction->src[2], lane, conditional), mixed); break;
      case RAW_ADD:
      case RAW_MUL:
      case RAW_MAD:
      case RAW_DIV:
      case RAW_MAX:
      case RAW_FRC:
      case RAW_LRP:
      case RAW_DP3:
      case RAW_RCP:
      case RAW_RSQ:
      case RAW_TEX:
         result[lane].origin = RAW_FLOAT_SHADOW | RAW_OUTPUT;
         if (instruction->opcode == RAW_TEX || ((1u << instruction->opcode) & RAW_V6_OPCODES))
            result[lane].origin |= dependency;
         else for (unsigned source = 0; source < sources; ++source)
            result[lane].origin |= (checked.float_modes[source] >> (lane * 8)) & RAW_BANK_DEPENDENCY;
         break;
      case RAW_UIF:
      case RAW_ELSE:
      case RAW_ENDIF: break; /* Recorded above without a destination. */
      }
      /* Each structured predecessor owns a physical shadow for every value
       * with numerical authority. A join can therefore retain a value without
       * borrowing another arm's IN locator or decoding a computed raw value. */
      if (structured && float_mode(result[lane]))
         result[lane].origin = RAW_FLOAT_SHADOW | (result[lane].origin & RAW_BANK_DEPENDENCY) |
            (output_legal(result[lane]) ? RAW_OUTPUT : 0);
   }
   struct raw_lane *destination = instruction->dst.file == TEMP ? ir->temporary[instruction->dst.index] : ir->output[instruction->dst.index];
   for (unsigned lane = 0; lane < 4; ++lane)
      if (instruction->dst.mask & (1u << lane)) {
         destination[lane] = result[lane];
         if ((result[lane].origin & RAW_ACCESS_MASK) == RAW_FLOAT_SHADOW) checked.float_mask |= 1u << lane;
      }
   ir->instructions[ir->count++] = *instruction;
   if (instruction->opcode != RAW_MOV) ir->opcode_mask |= 1u << instruction->opcode;
   if (instruction->flags & RAW_NEGATE_SOURCES) ir->opcode_mask |= RAW_V5_NEGATION;
   if (dependency) ir->opcode_mask |= RAW_FINITE_BANK_USED;
   return true;
}

bool raw_outputs_safe(const struct profile *p)
{
   for (unsigned index = 0; index < FILE_REGISTERS; ++index) if (p->declared[OUT][index]) {
      for (unsigned lane = 0; lane < 4; ++lane) if (p->components[OUT][index] & (1u << lane)) {
         struct raw_lane value = p->raw->output[index][lane];
         /* Exclude Inf/NaN, then exclude possible subnormal values. Signed
          * zero is permitted; neither the sign nor normal mantissa is lost. */
         if (!output_legal(value)) return false;
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

static unsigned lane_mode(const struct raw_instruction *instruction, unsigned source, unsigned lane)
{
   return (instruction->float_modes[source] >> (lane * 8)) & 255u;
}

static void float_operand(struct writer *w, const struct profile *p, const struct raw_instruction *instruction, unsigned source, unsigned lane)
{
   unsigned mode = lane_mode(instruction, source, lane) & RAW_ACCESS_MASK;
   const struct raw_source *r = &instruction->src[source];
   bool negate = (instruction->flags & (RAW_NEGATE_SOURCE0 << source)) != 0;
   if (negate) emit(w, "-(");
   if (mode == RAW_FLOAT_SHADOW) emit(w, "float_temp[%u].%c", r->index, "xyzw"[r->swizzle[lane]]);
   else if (mode == RAW_FLOAT_DECODE || mode == RAW_FLOAT_CONDITIONAL) {
      emit(w, "uintBitsToFloat("); operand(w, p, r, lane); emit(w, ")");
   } else input_float(w, p, (mode - 1) / 4, (mode - 1) % 4);
   if (negate) emit(w, ")");
}

static void float_snapshot(struct writer *w, const struct profile *p, const struct raw_instruction *instruction)
{
   enum raw_opcode op = instruction->opcode;
   if (op == RAW_TEX) {
      /* One vec4 sample is shared by all lanes and both representations. */
      emit(w, " float_rhs = texture(fssamp%u, vec2(", instruction->sampler);
      float_operand(w, p, instruction, 0, 0); emit(w, ", ");
      float_operand(w, p, instruction, 0, 1); emit(w, "));\n");
      return;
   }
   if ((1u << op) & RAW_V6_OPCODES) {
      /* Evaluate once, then broadcast before either view is published. In
       * particular RCP reads source x even when its destination is only w. */
      emit(w, " float_rhs = vec4(");
      if (op == RAW_DP3) {
         emit(w, "dot(");
         for (unsigned source = 0; source < 2; ++source) {
            if (source) emit(w, ", ");
            emit(w, "vec3(");
            for (unsigned lane = 0; lane < 3; ++lane) {
               if (lane) emit(w, ", ");
               float_operand(w, p, instruction, source, lane);
            }
            emit(w, ")");
         }
      } else {
         emit(w, op == RAW_RCP ? "1.0 / (" : "inversesqrt(");
         float_operand(w, p, instruction, 0, 0);
      }
      emit(w, "));\n");
      return;
   }
   emit(w, " float_rhs = vec4(");
   for (unsigned lane = 0; lane < 4; ++lane) {
      if (lane) emit(w, ", ");
      if (!(instruction->float_mask & (1u << lane))) { emit(w, "0.0"); continue; }
      emit(w, "(");
      if (op == RAW_UCMP) {
         unsigned yes = lane_mode(instruction, 1, lane), no = lane_mode(instruction, 2, lane);
         /* A known selector may choose an authorized shadow while the other
          * payload is arbitrary raw data. Never decode that unselected arm. */
         if (yes && no) {
            operand(w, p, &instruction->src[0], lane); emit(w, " != 0u ? ");
            float_operand(w, p, instruction, 1, lane); emit(w, " : ");
            float_operand(w, p, instruction, 2, lane);
         } else float_operand(w, p, instruction, yes ? 1 : 2, lane);
      } else if (op == RAW_LRP) {
         emit(w, "mix(");
         float_operand(w, p, instruction, 2, lane); emit(w, ", ");
         float_operand(w, p, instruction, 1, lane); emit(w, ", ");
         float_operand(w, p, instruction, 0, lane); emit(w, ")");
      } else {
         if (op == RAW_MAX || op == RAW_FRC) emit(w, op == RAW_MAX ? "max(" : "fract(");
         float_operand(w, p, instruction, 0, lane);
         if (op == RAW_ADD || op == RAW_MUL || op == RAW_MAD || op == RAW_DIV || op == RAW_MAX) {
            emit(w, op == RAW_ADD ? " + " : op == RAW_DIV ? " / " : op == RAW_MAX ? ", " : " * ");
            float_operand(w, p, instruction, 1, lane);
            if (op == RAW_MAD) { emit(w, " + "); float_operand(w, p, instruction, 2, lane); }
         }
         if (op == RAW_MAX || op == RAW_FRC) emit(w, ")");
      }
      emit(w, ")");
   }
   emit(w, ");\n");
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
   for (unsigned index = 0; index < FILE_REGISTERS; ++index) {
      bool used = false;
      for (unsigned i = 0; i < p->raw->count; ++i)
         used |= p->raw->instructions[i].opcode == RAW_TEX && p->raw->instructions[i].sampler == index;
      if (used) emit(&w, "uniform highp sampler2D fssamp%u;\n", index);
   }
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
   if (p->raw->opcode_mask & (RAW_NUMERIC_OPCODES | RAW_STRUCTURED_OPCODES))
      emit(&w, " highp vec4 float_temp[118];\n highp vec4 float_out[8];\n highp vec4 float_rhs;\n");
   for (unsigned index = 0; index < p->raw->count; ++index) {
      const struct raw_instruction *instruction = &p->raw->instructions[index];
      if (instruction->opcode == RAW_UIF) {
         emit(&w, " if ("); operand(&w, p, &instruction->src[0], 0); emit(&w, " == 0u) {\n");
         continue;
      }
      if (instruction->opcode == RAW_ELSE) { emit(&w, " } else {\n"); continue; }
      if (instruction->opcode == RAW_ENDIF) { emit(&w, " }\n"); continue; }
      bool numeric = ((1u << instruction->opcode) & RAW_NUMERIC_OPCODES) != 0;
      bool raw_shadow = (instruction->flags & RAW_STRUCTURED) && !numeric &&
         instruction->opcode != RAW_MOV && instruction->opcode != RAW_UCMP;
      if (instruction->float_mask && !raw_shadow) float_snapshot(&w, p, instruction);
      if (numeric) emit(&w, " raw_rhs = floatBitsToUint(float_rhs");
      else {
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
      }
      emit(&w, ");\n");
      if (instruction->float_mask && raw_shadow) {
         emit(&w, " float_rhs = vec4(");
         for (unsigned lane = 0; lane < 4; ++lane) {
            if (lane) emit(&w, ", ");
            if (instruction->float_mask & (1u << lane)) emit(&w, "uintBitsToFloat(raw_rhs.%c)", "xyzw"[lane]);
            else emit(&w, "0.0");
         }
         emit(&w, ");\n");
      }
      emit(&w, " raw_%s[%u].", instruction->dst.file == TEMP ? "temp" : "out", instruction->dst.index);
      for (unsigned lane = 0; lane < 4; ++lane) if (instruction->dst.mask & (1u << lane)) emit(&w, "%c", "xyzw"[lane]);
      emit(&w, " = raw_rhs.");
      for (unsigned lane = 0; lane < 4; ++lane) if (instruction->dst.mask & (1u << lane)) emit(&w, "%c", "xyzw"[lane]);
      emit(&w, ";\n");
      if (instruction->float_mask) {
         emit(&w, " float_%s[%u].", instruction->dst.file == TEMP ? "temp" : "out", instruction->dst.index);
         for (unsigned lane = 0; lane < 4; ++lane) if (instruction->float_mask & (1u << lane)) emit(&w, "%c", "xyzw"[lane]);
         emit(&w, " = float_rhs.");
         for (unsigned lane = 0; lane < 4; ++lane) if (instruction->float_mask & (1u << lane)) emit(&w, "%c", "xyzw"[lane]);
         emit(&w, ";\n");
      }
   }
   for (unsigned index = 0; index < FILE_REGISTERS; ++index) if (p->declared[OUT][index]) {
      for (unsigned lane = 0; lane < 4; ++lane) if (p->components[OUT][index] & (1u << lane)) {
         unsigned semantic = p->semantic[OUT][index];
         if (semantic == 1) emit(&w, " gl_Position");
         else if (semantic == 2) emit(&w, " vso_g%u", p->semantic_index[OUT][index]);
         else emit(&w, " fsout_c0");
         emit(&w, ".%c = ", "xyzw"[lane]);
         unsigned authority = p->raw->output[index][lane].origin;
         unsigned origin = authority & RAW_ACCESS_MASK;
         if ((authority & RAW_OUTPUT) && origin == RAW_FLOAT_SHADOW) emit(&w, "float_out[%u].%c", index, "xyzw"[lane]);
         else if (authority & RAW_OUTPUT) input_float(&w, p, (origin - 1) / 4, (origin - 1) % 4);
         else emit(&w, "uintBitsToFloat(raw_out[%u].%c)", index, "xyzw"[lane]);
         emit(&w, ";\n");
      }
   }
   if (!p->stage) emit(&w, " gl_Position.y = gl_Position.y * winsys_adjust_y;\n");
   emit(&w, "}\n");
   if (w.overflow) { free(w.text); return NULL; }
   return w.text;
}
