/* SPDX-License-Identifier: MIT */
#include "raw_bits.h"
#include "raw_binary32.h"
#include "raw_conversions.h"
#include "raw_scalar.h"
#include "raw_fraction.h"
#include "raw_known_arithmetic.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Private to the captured c580 pc28 result. It is neither floating authority
 * nor a raw-word fact, and only the adjacent original pc29 may consume it. */
#define C580_NONPOSITIVE (UINT32_C(1) << 24)

static bool complete_prefix_bank(const struct raw_ir *ir)
{
   if (!ir->exact || ir->exact->count != 34u * 4u) return false;
   for (unsigned reg = 0; reg < 34; ++reg)
      if (ir->exact->present[reg] != 15u) return false;
   /* These three complete 34x4 variants are the authenticated original draw
    * banks. Every zero and otherwise unused component is part of the identity;
    * a complete but different bank cannot borrow this source proof. */
   static const uint32_t common[34][4] = {
      [1] = {[0] = UINT32_C(0x3f800000)},
      [2] = {[0] = UINT32_C(0x3f800000)},
      [3] = {UINT32_C(0x3f800000), UINT32_C(0xa5400000),
             UINT32_C(0x332033c9), UINT32_C(0x3f800000)},
      [23] = {[0] = 1}, [28] = {[0] = UINT32_C(0x3f800000)},
      [30] = {[0] = UINT32_C(0x40000000)},
      [33] = {UINT32_C(0x3f800000), 0,
              UINT32_C(0xbf800000), UINT32_C(0x44400000)}
   };
   static const uint32_t variant[3][6] = {
      {UINT32_C(0x44760000), UINT32_C(0x44360000), UINT32_C(0x41a00000),
       UINT32_C(0x41a00000), UINT32_C(0x44760000), UINT32_C(0x44360000)},
      {UINT32_C(0x44804000), UINT32_C(0x44408000), UINT32_C(0xc0000000),
       UINT32_C(0xc0000000), UINT32_C(0x44804000), UINT32_C(0x44408000)},
      {UINT32_C(0x43970000), UINT32_C(0x43970000), UINT32_C(0x43b40000),
       UINT32_C(0x43680000), UINT32_C(0x43970000), UINT32_C(0x43970000)}
   };
   for (unsigned choice = 0; choice < 3; ++choice) {
      bool match = true;
      for (unsigned reg = 0; reg < 34 && match; ++reg)
         for (unsigned component = 0; component < 4; ++component) {
            uint32_t expected = common[reg][component];
            if (component < 2 && (reg == 0 || reg == 31 || reg == 32)) {
               unsigned offset = (reg == 0 ? 0u : reg == 31 ? 2u : 4u) + component;
               expected = variant[choice][offset];
            }
            if (ir->exact->words[reg][component] != expected) { match = false; break; }
         }
      if (match) return true;
   }
   return false;
}

static struct raw_lane source_lane(const struct raw_ir *ir, const struct raw_source *r, unsigned lane, bool conditional)
{
   unsigned component = r->swizzle[lane];
   if (r->file == TEMP) return ir->temporary[r->index][component];
   if (r->file == IMM) {
      uint32_t value = ir->immediates[r->index][component];
      return (struct raw_lane){.zero = ~value, .one = value};
   }
   if (r->file == CONST && ir->exact && (ir->exact->present[r->index] & (1u << component))) {
      uint32_t value = ir->exact->words[r->index][component];
      /* A raw fact carries no asserted floating range or output permission.
       * Existing typed consumers still have to establish those independently. */
      return (struct raw_lane){.zero = ~value, .one = value};
   }
   if (r->file == IN) {
      unsigned origin = (1 + r->index * 4 + component) | RAW_OUTPUT;
      /* A signed viewport origin plus a nonnegative GLsizei extent can reach
       * almost 2^32 before framebuffer tests. Keep another bit for highp
       * rounding and rasterization edges: |window x/y| <= 2^33. This is
       * only a finite magnitude bound, never an exact coordinate word. */
      if (complete_prefix_bank(ir) && r->index == 0 && component < 2 &&
          (ir->opcode_mask & RAW_FRAGMENT_COORDINATES_USED))
         origin |= 34u << RAW_FINITE_EXP_SHIFT;
      return (struct raw_lane){.origin = origin};
   }
   if ((r->file == CONST || r->file == INDIRECT_CONST) && conditional)
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

int raw_uif_truth(const struct raw_ir *ir, const struct raw_source *source)
{
   struct raw_lane value = source_lane(ir, source, 0, false);
   if (value.zero & value.one) return -1;
   if (value.one) return 1;
   return value.zero == UINT32_MAX ? 0 : -1;
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

/* Equality consumes encodings, including exceptional words, without a float
 * conversion. An identical NaN is unordered; the two zero signs are equal. */
static uint32_t equal_float_mask(uint32_t a, uint32_t b, bool not_equal)
{
   uint32_t magnitude_a = a & UINT32_C(0x7fffffff), magnitude_b = b & UINT32_C(0x7fffffff);
   bool unordered = magnitude_a > UINT32_C(0x7f800000) || magnitude_b > UINT32_C(0x7f800000);
   bool equal = !unordered && (a == b || (magnitude_a == 0 && magnitude_b == 0));
   return (not_equal ? !equal : equal) ? UINT32_MAX : 0;
}

static bool safe_raw_float(struct raw_lane value)
{
   const uint32_t exponent = UINT32_C(0x7f800000), mantissa = UINT32_C(0x007fffff);
   return (value.zero & exponent) && ((value.one & exponent) || (value.zero & mantissa) == mantissa);
}

/* Unknown means no certificate, not a large numerical value. A bit cube may
 * itself prove a finite upper magnitude without a complete exact word (the
 * c580 FSLT/AND mask is one example). Keep two exponent bits of headroom at
 * each arithmetic step for highp rounding while staying far from overflow. */
static unsigned finite_exp(struct raw_lane value)
{
   unsigned encoded = (value.origin & RAW_FINITE_EXP_MASK) >> RAW_FINITE_EXP_SHIFT;
   if (encoded) return encoded - 1u;
   if (!safe_raw_float(value)) return UINT32_MAX;
   uint32_t upper = ~value.zero & UINT32_C(0x7fffffff);
   unsigned field = upper >> 23;
   if (field > 226) return UINT32_MAX;
   if (field <= 127) return upper <= UINT32_C(0x3f800000) ? 0u : 1u;
   unsigned exponent = field - 127u + ((upper & UINT32_C(0x007fffff)) != 0);
   return exponent <= 100u ? exponent : UINT32_MAX;
}

unsigned raw_finite_exp(struct raw_lane value)
{
   return finite_exp(value);
}

static void set_finite_exp(struct raw_lane *result, unsigned exponent)
{
   if ((result->origin & UINT32_C(255)) && exponent <= 100u)
      result->origin = (result->origin & ~RAW_FINITE_EXP_MASK) |
         ((exponent + 1u) << RAW_FINITE_EXP_SHIFT);
}

struct prefix_source { unsigned file, index; unsigned char swizzle[4]; };
struct prefix_shape {
   unsigned opcode, dst, mask;
   struct prefix_source source[2];
};

/* The sole consumer of the new terminal bound is the unchanged c580 pc27
 * value version. Checking the complete ordered dependency prefix prevents an
 * unrelated MIN_PRECISE from acquiring that source-specific certificate. */
static const struct prefix_shape c580_prefix[28] = {
   {RAW_MUL, 19, 1, {{IN, 0, {1,0,0,0}}, {CONST, 33, {2,0,0,0}}}},
   {RAW_ADD, 9, 2, {{TEMP, 19, {0,0,0,0}}, {CONST, 33, {3,3,0,0}}}},
   {RAW_MUL, 20, 3, {{IN, 1, {0,1,1,1}}, {CONST, 0, {0,1,1,1}}}},
   {RAW_MUL, 21, 3, {{TEMP, 20, {1,0,0,0}}, {IMM, 0, {0,0,0,0}}}},
   {RAW_MUL, 22, 3, {{CONST, 32, {0,1,1,1}}, {IMM, 0, {1,1,1,1}}}},
   {RAW_ADD, 23, 3, {{CONST, 31, {0,1,1,1}}, {TEMP, 22, {0,1,1,1}}}},
   {RAW_MUL, 24, 3, {{TEMP, 23, {0,1,0,0}}, {IMM, 0, {0,0,0,0}}}},
   {RAW_MOV, 9, 1, {{IN, 0, {0,0,0,0}}, {IN, 0, {0,0,0,0}}}},
   {RAW_ADD, 25, 3, {{TEMP, 9, {0,1,0,0}}, {TEMP, 24, {0,1,0,0}}}},
   {RAW_FSLT, 26, 3, {{TEMP, 25, {0,1,1,1}}, {IMM, 0, {2,2,2,2}}}},
   {RAW_AND, 27, 3, {{TEMP, 26, {0,1,1,1}}, {IMM, 1, {0,0,0,0}}}},
   {RAW_MUL, 28, 3, {{IMM, 0, {3,3,3,3}}, {TEMP, 27, {0,1,0,0}}}},
   {RAW_MUL, 29, 3, {{TEMP, 28, {0,1,0,0}}, {IMM, 0, {0,0,0,0}}}},
   {RAW_ADD, 30, 3, {{TEMP, 29, {0,1,1,1}}, {IMM, 2, {0,0,0,0}}}},
   {RAW_MUL, 31, 3, {{TEMP, 25, {0,1,1,1}}, {TEMP, 30, {0,1,1,1}}}},
   {RAW_MUL, 32, 1, {{CONST, 29, {0,0,0,0}}, {IMM, 0, {0,0,0,0}}}},
   {RAW_ADD, 33, 3, {{TEMP, 22, {0,1,0,0}}, {TEMP, 32, {0,0,0,0}}}},
   {RAW_MUL, 34, 3, {{TEMP, 33, {0,1,0,0}}, {IMM, 0, {0,0,0,0}}}},
   {RAW_ADD, 35, 3, {{TEMP, 31, {0,1,0,0}}, {TEMP, 34, {0,1,0,0}}}},
   {RAW_MUL, 36, 1, {{CONST, 1, {0,0,0,0}}, {IMM, 0, {0,0,0,0}}}},
   {RAW_ADD, 37, 3, {{TEMP, 22, {0,1,0,0}}, {TEMP, 36, {0,0,0,0}}}},
   {RAW_MUL, 38, 3, {{TEMP, 37, {0,1,0,0}}, {IMM, 0, {0,0,0,0}}}},
   {RAW_ADD, 39, 3, {{TEMP, 31, {0,1,0,0}}, {TEMP, 38, {0,1,0,0}}}},
   {RAW_RCP, 40, 1, {{CONST, 32, {0,0,0,0}}, {IN, 0, {0,0,0,0}}}},
   {RAW_RCP, 40, 2, {{CONST, 32, {1,1,1,1}}, {IN, 0, {0,0,0,0}}}},
   {RAW_ADD, 41, 3, {{TEMP, 35, {0,1,1,1}}, {TEMP, 40, {0,1,1,1}}}},
   {RAW_ADD, 42, 3, {{TEMP, 39, {0,1,1,1}}, {TEMP, 40, {0,1,1,1}}}},
   {RAW_MIN_PRECISE, 43, 1, {{TEMP, 41, {0,0,0,0}}, {TEMP, 41, {1,0,0,0}}}}
};

static bool c580_prefix_matches(const struct raw_ir *ir, const struct raw_instruction *current,
                                unsigned count)
{
   if (ir->count != count || !complete_prefix_bank(ir) ||
       !(ir->opcode_mask & RAW_FRAGMENT_COORDINATES_USED)) return false;
   static const uint32_t expected_imm[3][4] = {
      {UINT32_C(0xbf800000), UINT32_C(0x3f000000), 0, UINT32_C(0x40000000)},
      {UINT32_C(0x3f800000), 0, 0, 0},
      {UINT32_C(0x3f800000), UINT32_C(0x3f166bb0), UINT32_C(0x3f966bb0), UINT32_C(0x40400000)}
   };
   if (memcmp(ir->immediates, expected_imm, sizeof(expected_imm))) return false;
   for (unsigned pc = 0; pc < 28; ++pc) {
      const struct raw_instruction *instruction = pc == 27 ? current : &ir->instructions[pc];
      const struct prefix_shape *shape = &c580_prefix[pc];
      if ((unsigned)instruction->opcode != shape->opcode || instruction->dst.file != TEMP ||
          instruction->dst.index != shape->dst || instruction->dst.mask != shape->mask ||
          (instruction->flags & (RAW_NEGATE_SOURCES | RAW_ABSOLUTE_SOURCES | RAW_DEAD | RAW_PRECISE)) !=
             (pc == 27 ? RAW_PRECISE : 0)) return false;
      unsigned sources = shape->opcode == RAW_MOV || shape->opcode == RAW_RCP ? 1u : 2u;
      for (unsigned source = 0; source < sources; ++source) {
         if ((unsigned)instruction->src[source].file != shape->source[source].file ||
             instruction->src[source].index != shape->source[source].index) return false;
         for (unsigned lane = 0; lane < 4; ++lane)
            if (instruction->src[source].swizzle[lane] != shape->source[source].swizzle[lane]) return false;
      }
   }
   return true;
}

static struct raw_lane precise_source(const struct raw_ir *ir, const struct raw_instruction *instruction,
                                      unsigned source, unsigned lane, bool conditional);

/* The original MIN reads the already certified pc27 value and a directly
 * owned zero bank word. Negating only the cap admits -0 as well as +0; no
 * other modifier or changed instruction can receive this sign certificate. */
static bool c580_zero_cap_matches(const struct raw_ir *ir, const struct raw_instruction *instruction)
{
   if (ir->count != 28 || !c580_prefix_matches(ir, &ir->instructions[27], 28) ||
       instruction->opcode != RAW_MIN || instruction->dst.file != TEMP ||
       instruction->dst.index != 44 || instruction->dst.mask != 1 ||
       (instruction->flags & (RAW_NEGATE_SOURCES | RAW_ABSOLUTE_SOURCES | RAW_DEAD | RAW_PRECISE)) !=
          (instruction->flags & (RAW_NEGATE_SOURCE0 << 1))) return false;
   const struct raw_source *value = &instruction->src[0], *cap = &instruction->src[1];
   if (value->file != TEMP || value->index != 43 ||
       cap->file != CONST || cap->index != 29) return false;
   for (unsigned lane = 0; lane < 4; ++lane)
      if (value->swizzle[lane] || cap->swizzle[lane]) return false;
   struct raw_lane source = precise_source(ir, instruction, 0, 0, false);
   struct raw_lane zero = precise_source(ir, instruction, 1, 0, false);
   return finite_exp(source) <= 100u &&
      (zero.zero | zero.one) == UINT32_MAX &&
      (zero.one & UINT32_C(0x7fffffff)) == 0;
}

static bool c580_positive_test_matches(const struct raw_ir *ir,
                                       const struct raw_instruction *instruction,
                                       struct raw_lane value)
{
   if (ir->count != 29 || !(value.origin & C580_NONPOSITIVE) ||
       instruction->opcode != RAW_FSLT || instruction->dst.file != TEMP ||
       instruction->dst.index != 45 || instruction->dst.mask != 1 ||
       (instruction->flags & (RAW_NEGATE_SOURCES | RAW_ABSOLUTE_SOURCES | RAW_DEAD | RAW_PRECISE)))
      return false;
   const struct raw_source *zero = &instruction->src[0], *source = &instruction->src[1];
   if (zero->file != IMM || zero->index != 0 ||
       source->file != TEMP || source->index != 44) return false;
   for (unsigned lane = 0; lane < 4; ++lane)
      if (zero->swizzle[lane] != 2 || source->swizzle[lane]) return false;
   return ir->immediates[0][2] == 0;
}

static unsigned float_mode(struct raw_lane value)
{
   unsigned authority = value.origin & UINT32_C(255);
   return authority ? authority : safe_raw_float(value) ? RAW_FLOAT_DECODE | RAW_OUTPUT : 0;
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
   unsigned origin = (yes.origin & UINT32_C(255)) == (no.origin & UINT32_C(255)) ?
      yes.origin & UINT32_C(255) : 0;
   if (mixed && float_mode(yes) && float_mode(no))
      origin = RAW_FLOAT_SHADOW | ((yes.origin | no.origin) & RAW_BANK_DEPENDENCY) |
         (output_legal(yes) && output_legal(no) ? RAW_OUTPUT : 0);
   unsigned yes_exp = finite_exp(yes), no_exp = finite_exp(no);
   struct raw_lane result = {.zero = yes.zero & no.zero, .one = yes.one & no.one, .origin = origin};
   if (yes_exp <= 100u && no_exp <= 100u)
      set_finite_exp(&result, yes_exp > no_exp ? yes_exp : no_exp);
   return result;
}

unsigned raw_consumed_mask(enum raw_opcode opcode, unsigned destination_mask)
{
   /* TGSI scalar operations consume post-swizzle x/xyz independently of the
    * written lanes. Use the same rule for initialization and float authority. */
   if (opcode == RAW_DP3) return 7u;
   if (opcode == RAW_RCP || opcode == RAW_RSQ || opcode == RAW_UARL || opcode == RAW_EX2 || opcode == RAW_LG2 || opcode == RAW_SIN || opcode == RAW_POW) return 1u;
   return opcode == RAW_TEX ? 3u : destination_mask;
}

static struct raw_lane checked_source(const struct raw_ir *ir, const struct raw_instruction *instruction,
                                     unsigned source, unsigned lane, bool conditional)
{
   const struct demand_certificate *c = &ir->demand;
   /* Only these two graph-bound reads are conditional. No ordinary TEMP read
    * can inherit a missing predecessor's authority from this side table. */
   if (c->checked && source == 1) {
      if (ir->count == c->lrp && instruction->opcode == RAW_LRP) return c->payload[lane];
      if (ir->count == c->select && instruction->opcode == RAW_UCMP)
         return c->result[instruction->src[1].swizzle[lane]];
   }
   return source_lane(ir, &instruction->src[source], lane, conditional);
}

static struct raw_lane precise_source(const struct raw_ir *ir, const struct raw_instruction *instruction,
                                      unsigned source, unsigned lane, bool conditional)
{
   struct raw_lane value = checked_source(ir, instruction, source, lane, conditional);
   if (instruction->flags & (RAW_ABSOLUTE_SOURCE0 << source)) {
      value.zero |= UINT32_C(0x80000000);
      value.one &= ~UINT32_C(0x80000000);
   }
   if (instruction->flags & (RAW_NEGATE_SOURCE0 << source)) {
      const uint32_t sign = UINT32_C(0x80000000);
      uint32_t zero = value.zero;
      value.zero = (value.zero & ~sign) | (value.one & sign);
      value.one = (value.one & ~sign) | (zero & sign);
      if (value.origin & UINT32_C(255))
         value.origin = RAW_FLOAT_SHADOW | (value.origin & (RAW_BANK_DEPENDENCY | RAW_OUTPUT));
   }
   return value;
}

bool raw_discard_guaranteed(const struct raw_ir *ir, const struct raw_instruction *instruction)
{
   if (instruction->opcode == RAW_KILL) return true;
   for (unsigned lane = 0; lane < 4; ++lane) {
      struct raw_lane value = precise_source(ir, instruction, 0, lane, false);
      uint32_t magnitude = value.one & UINT32_C(0x7fffffff);
      /* Ordered binary32 < +0: NaNs and both zeros are false. Unknown
       * encodings retain a possibly surviving edge, even with a known sign. */
      if ((value.zero | value.one) == UINT32_MAX &&
          (value.one & UINT32_C(0x80000000)) && magnitude &&
          magnitude <= UINT32_C(0x7f800000)) return true;
   }
   return false;
}

/* SAT introduces no numerical source authority. A statically known, normal
 * divisor is required at this exact post-modifier source version. Unit magnitude
 * preserves the existing numeric domain; nonunit division requires a known
 * normal-or-zero numerator and a conservative quotient exponent margin. No
 * dynamic range facts or F2I permission are manufactured by the clamp. */
static bool saturation_division_proved(struct raw_lane a, struct raw_lane b)
{
   if ((b.zero | b.one) != UINT32_MAX) return false;
   uint32_t magnitude = b.one & UINT32_C(0x7fffffff);
   if (magnitude < UINT32_C(0x00800000) || magnitude > UINT32_C(0x7e800000)) return false;
   if (magnitude == UINT32_C(0x3f800000)) return true;
   if ((a.zero | a.one) != UINT32_MAX || !safe_raw_float(a)) return false;
   if (!(a.one & UINT32_C(0x7fffffff))) return true;
   int difference = (int)((a.one >> 23) & 255u) - (int)((b.one >> 23) & 255u);
   return difference >= -124 && difference <= 125;
}

/* Prove the complete post-modifier domain from conservative encoding facts.
 * A numerical origin alone is not a bound. Every possible EX2 argument must
 * remain in [-125,126], keeping its highp result away from overflow/flush edges.
 * LG2 requires a known clear sign and nonzero exponent in a safe normal word.
 * Partial facts are sufficient only when they constrain every possible word. */
static bool exponent_domain_proved(enum raw_opcode op, struct raw_lane value)
{
   if (!safe_raw_float(value)) return false;
   const uint32_t sign = UINT32_C(0x80000000);
   if (op == RAW_LG2) return (value.zero & sign) && (value.one & UINT32_C(0x7f800000));
   uint32_t maximum = ~value.zero & UINT32_C(0x7fffffff);
   if (!(value.one & sign) && maximum > UINT32_C(0x42fc0000)) return false;
   if (!(value.zero & sign) && maximum > UINT32_C(0x42fa0000)) return false;
   return true;
}

/* Bound every possible post-modifier argument, including partial facts.
 * Numerical provenance alone cannot bound a computed value. The measured
 * [-8,8] sine domain grants no static result or conversion authority. */
static bool sine_domain_proved(struct raw_lane value)
{
   return safe_raw_float(value) && (~value.zero & UINT32_C(0x7fffffff)) <= UINT32_C(0x41000000);
}

/* Enclose log2(base) by integer binary exponents, then compare its largest
 * magnitude times the maximum exponent magnitude using significand/scale
 * integers. Facts describe every possible encoding, not just join endpoints.
 * Neither host libm nor the output of native pow grants admission authority. */
static bool power_domain_proved(struct raw_lane base, struct raw_lane exponent)
{
   const uint32_t sign = UINT32_C(0x80000000), magnitude = UINT32_C(0x7fffffff);
   const uint32_t exponent_bits = UINT32_C(0x7f800000), mantissa = UINT32_C(0x007fffff);
   if (!safe_raw_float(base) || !safe_raw_float(exponent)) return false;
   bool positive_exponent = (exponent.zero & sign) && (exponent.one & exponent_bits);
   /* Either sign of a known zero has the owned +0 result, for strictly
    * positive exponents only. Never pass it through native pow. */
   if ((base.zero & magnitude) == magnitude) return positive_exponent;
   if (!(base.zero & sign)) return false;
   if (!(base.one & magnitude) && !positive_exponent) return false;
   uint32_t lower = base.one & magnitude;
   if (!lower) {
      /* safe_raw_float forces all mantissa bits to zero in this case. The
       * lowest optional exponent bit is the smallest possible positive base. */
      uint32_t possible = ~base.zero & exponent_bits;
      lower = possible & (~possible + 1u);
   }
   uint32_t upper = ~base.zero & magnitude;
   int low_log = (int)(lower >> 23) - 127;
   int high_log = (int)(upper >> 23) - 127 + ((upper & mantissa) != 0);
   unsigned low_size = low_log < 0 ? (unsigned)-low_log : (unsigned)low_log;
   unsigned high_size = high_log < 0 ? (unsigned)-high_log : (unsigned)high_log;
   unsigned log_size = low_size > high_size ? low_size : high_size;
   uint32_t maximum = ~exponent.zero & magnitude;
   unsigned field = maximum >> 23;
   uint64_t significand = (maximum & mantissa) | (field ? UINT32_C(0x00800000) : 0);
   uint64_t product = significand * log_size;
   if (!product) return true;
   int scale = (int)field - 150;
   if (scale >= 0) return scale < 7 && product <= (UINT64_C(120) >> scale);
   if (scale <= -31) return true;
   return product <= (UINT64_C(120) << -scale);
}

/* Reciprocal of a normal binary32 power of two is another exact normal word
 * precisely when its biased exponent is at most 253. Compute the word with
 * integers: the GPU will emit this literal, never an approximate division. */
static bool exact_reciprocal_word(struct raw_lane source, uint32_t *word)
{
   if ((source.zero | source.one) != UINT32_MAX || !safe_raw_float(source)) return false;
   uint32_t magnitude = source.one & UINT32_C(0x7fffffff);
   unsigned exponent = magnitude >> 23;
   if (!exponent || exponent > 253 || (magnitude & UINT32_C(0x007fffff))) return false;
   *word = (source.one & UINT32_C(0x80000000)) | ((254u - exponent) << 23);
   return true;
}

bool raw_record(struct raw_ir *ir, const struct raw_instruction *input)
{
   if ((UINT64_C(1) << input->opcode) & RAW_CONTROL_OPCODES) {
      ir->instructions[ir->count++] = *input;
      ir->opcode_mask |= UINT64_C(1) << input->opcode;
      return true;
   }
   if (input->opcode == RAW_UARL) {
      /* UARL copies the post-swizzle raw x word, never float conversion. Read
       * before publishing so UARL of an indirect source uses the old address. */
      ir->address = source_lane(ir, &input->src[0], 0, false);
      ir->address.origin = 0;
      ir->instructions[ir->count++] = *input;
      ir->opcode_mask |= UINT64_C(1) << RAW_UARL;
      return true;
   }
   struct raw_instruction checked = *input;
   checked.float_mask = 0;
   for (unsigned source = 0; source < 3; ++source) checked.float_modes[source] = 0;
   const struct raw_instruction *instruction = &checked;
   bool mixed = (instruction->flags & RAW_MIXED) != 0;
   bool conditional = (instruction->flags & RAW_CONDITIONAL) != 0;
   bool structured = (instruction->flags & RAW_STRUCTURED) != 0;
   bool numeric = ((UINT64_C(1) << instruction->opcode) & RAW_NUMERIC_OPCODES) != 0;
   unsigned dependency = 0;
   bool conversion_bank = false;
   unsigned sources = instruction->opcode == RAW_MOV || instruction->opcode == RAW_MOV_SAT || instruction->opcode == RAW_NOT ||
      instruction->opcode == RAW_FRC || instruction->opcode == RAW_FRC_PRECISE || instruction->opcode == RAW_TEX ||
      instruction->opcode == RAW_RCP || instruction->opcode == RAW_RSQ || instruction->opcode == RAW_EX2 || instruction->opcode == RAW_LG2 || instruction->opcode == RAW_SIN ||
      instruction->opcode == RAW_I2F || instruction->opcode == RAW_F2I ||
      instruction->opcode == RAW_TRUNC || instruction->opcode == RAW_SSG ? 1 :
      instruction->opcode == RAW_UCMP || instruction->opcode == RAW_MAD || instruction->opcode == RAW_LRP ? 3 : 2;
   unsigned consumed = raw_consumed_mask(instruction->opcode, instruction->dst.mask);
   /* Capture read authority at the use site, before any aliased destination
    * changes facts. Every numeric lane must have an enforceable domain. */
   for (unsigned source = 0; source < sources; ++source)
      for (unsigned lane = 0; lane < 4; ++lane) if (consumed & (1u << lane)) {
         unsigned mode = float_mode(checked_source(ir, instruction, source, lane, conditional));
         if (numeric && !mode) return false;
         if (numeric) dependency |= mode & RAW_BANK_DEPENDENCY;
         if (mixed) checked.float_modes[source] |= (uint32_t)mode << (lane * 8);
      }
   if (instruction->opcode == RAW_DIV_SAT)
      for (unsigned lane = 0; lane < 4; ++lane) if (consumed & (1u << lane))
         if (!saturation_division_proved(precise_source(ir, instruction, 0, lane, conditional),
                                        precise_source(ir, instruction, 1, lane, conditional))) return false;
   if (((UINT64_C(1) << instruction->opcode) & RAW_EXPONENT_OPCODES) &&
       !exponent_domain_proved(instruction->opcode, precise_source(ir, instruction, 0, 0, conditional))) return false;
   if (instruction->opcode == RAW_SIN &&
       !sine_domain_proved(precise_source(ir, instruction, 0, 0, conditional))) return false;
   if (instruction->opcode == RAW_POW &&
       !power_domain_proved(precise_source(ir, instruction, 0, 0, conditional),
                            precise_source(ir, instruction, 1, 0, conditional))) {
      if (instruction->flags & RAW_PRIVATE_92CB_COMPLETE) {
         /* This flag is reachable only after the full-source/geometry byte
          * transaction. Never add numeric origin or static word facts: the
          * actual post-modifier arguments are checked in the emitted shader. */
         if (!ir->exact) return false;
      } else {
         /* The sole private exception is the two original power sites. The
          * entry point authenticated the complete source, all three banks and
          * geometry; its result still requires a physical draw-time check. */
         unsigned pc = ir->count;
         unsigned component = pc == 221 ? 0u : 1u;
         if (!(instruction->flags & RAW_PRIVATE_92CB_POWER) ||
             (pc != 221 && pc != 222) || !ir->exact ||
             instruction->dst.file != TEMP || instruction->dst.index != 172 ||
             instruction->dst.mask != (1u << component) ||
             instruction->src[0].file != TEMP || instruction->src[0].index != 171 ||
             instruction->src[0].swizzle[0] != component ||
             instruction->src[1].file != CONST || instruction->src[1].index != 6 ||
             instruction->src[1].swizzle[0] != 0 ||
             !(ir->exact->present[6] & 1u) ||
             ir->exact->words[6][0] != UINT32_C(0x40000000)) return false;
      }
   }
   uint32_t reciprocal_word = 0;
   bool known_reciprocal = instruction->opcode == RAW_RCP && ir->exact &&
      instruction->src[0].file == CONST &&
      (instruction->flags & RAW_KNOWN_RETRY) &&
      exact_reciprocal_word(precise_source(ir, instruction, 0, 0, conditional), &reciprocal_word);
   if (known_reciprocal) {
      for (unsigned lane = 0; lane < 4; ++lane) checked.src[2].swizzle[lane] = reciprocal_word;
      checked.src[2].index = instruction->dst.mask;
      checked.flags |= RAW_KNOWN_RESULT;
   }
   /* A known raw selector never demands numerical access to its unused arm.
    * Only the retry prunes these modes, preserving old emitted expressions. */
   if ((conditional || structured) && instruction->opcode == RAW_UCMP)
      for (unsigned lane = 0; lane < 4; ++lane) if (consumed & (1u << lane)) {
         struct raw_lane condition = checked_source(ir, instruction, 0, lane, conditional);
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
         a = checked_source(ir, instruction, 0, lane, conditional);
         if (sources > 1) b = checked_source(ir, instruction, 1, lane, conditional);
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
      case RAW_ISLT:
         if (known_operands(a, b)) result[lane] = known_word(
            (a.one ^ UINT32_C(0x80000000)) < (b.one ^ UINT32_C(0x80000000)) ? UINT32_MAX : 0);
         break;
      case RAW_IMAX:
         /* Signed ordering chooses one exact source word. A private integer
          * selection cannot inherit either source's float locator/authority. */
         if (known_operands(a, b)) result[lane] = known_word(
            (a.one ^ UINT32_C(0x80000000)) >= (b.one ^ UINT32_C(0x80000000)) ? a.one : b.one);
         else result[lane] = (struct raw_lane){.zero = a.zero & b.zero, .one = a.one & b.one};
         break;
      case RAW_I2F:
         if ((a.zero | a.one) == UINT32_MAX) result[lane] = known_word(raw_i2f_word(a.one));
         /* This typed conversion is defined for every signed32 word and
          * creates a finite normal-or-zero value, never an input locator. */
         result[lane].origin = RAW_FLOAT_SHADOW | RAW_OUTPUT;
         break;
      case RAW_F2I:
         a = precise_source(ir, instruction, 0, lane, conditional);
         if (!raw_f2i_range_proved(a.zero, a.one)) {
            /* No inferred float origin proves a range. Only a direct,
             * unmodified bank word can be guarded at every runtime consumer. */
            if (instruction->src[0].file != CONST ||
                (instruction->flags & (RAW_NEGATE_SOURCES | RAW_ABSOLUTE_SOURCES))) return false;
            conversion_bank = true;
         }
         if ((a.zero | a.one) == UINT32_MAX) result[lane] = known_word(raw_f2i_word(a.one));
         else if ((~a.zero & UINT32_C(0x7fffffff)) < UINT32_C(0x3f800000)) result[lane] = known_word(0);
         break;
      case RAW_TRUNC:
      case RAW_SSG:
         a = precise_source(ir, instruction, 0, lane, conditional);
         if ((a.zero | a.one) == UINT32_MAX)
            result[lane] = known_word(instruction->opcode == RAW_TRUNC ? raw_trunc_word(a.one) : raw_ssg_word(a.one));
         else if (instruction->opcode == RAW_SSG)
            /* Only +0/+1/-1 can be returned, even when sign is unknown. */
            result[lane].zero = ~UINT32_C(0xbf800000);
         result[lane].origin = RAW_FLOAT_SHADOW | RAW_OUTPUT |
            ((checked.float_modes[0] >> (lane * 8)) & RAW_BANK_DEPENDENCY);
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
         else if (lane == 0 && c580_positive_test_matches(ir, instruction, b))
            result[lane] = known_word(0);
         break;
      case RAW_FSEQ:
      case RAW_FSNE:
         if (known_operands(a, b)) result[lane] = known_word(equal_float_mask(a.one, b.one, instruction->opcode == RAW_FSNE));
         break;
      case RAW_MAX_PRECISE:
      case RAW_MIN_PRECISE: {
         a = precise_source(ir, instruction, 0, lane, conditional);
         b = precise_source(ir, instruction, 1, lane, conditional);
         struct raw_lane condition = known_operands(a, b) ?
            known_word(instruction->opcode == RAW_MIN_PRECISE ?
               ordered_float_mask(a.one, b.one, false) : ordered_float_mask(b.one, a.one, false)) : (struct raw_lane){0};
         result[lane] = selected(condition, a, b, mixed);
         if (instruction->opcode == RAW_MIN_PRECISE && ir->exact &&
             (ir->opcode_mask & RAW_FRAGMENT_COORDINATES_USED))
            result[lane].origin &= ~RAW_FINITE_EXP_MASK;
         break;
      }
      case RAW_ADD_PRECISE:
      case RAW_MUL_PRECISE:
         /* Exact private arithmetic accepts raw words, including specials.
          * Numeric access/output is the separate existing arithmetic policy:
          * both operands must already have checked numerical authority. No
          * private integer manufacture acquires that authority here. */
         a = precise_source(ir, instruction, 0, lane, conditional);
         b = precise_source(ir, instruction, 1, lane, conditional);
         if (float_mode(a) && float_mode(b)) {
            result[lane].origin = RAW_FLOAT_SHADOW | RAW_OUTPUT |
               ((a.origin | b.origin) & RAW_BANK_DEPENDENCY);
            dependency |= result[lane].origin & RAW_BANK_DEPENDENCY;
         }
         break;
      case RAW_FRC_PRECISE:
         a = precise_source(ir, instruction, 0, lane, conditional);
         if ((a.zero | a.one) == UINT32_MAX) result[lane] = known_word(raw_frc_word(a.one));
         else result[lane].zero = UINT32_C(0x80000000);
         /* The exact producer alone grants no numerical/output authority.
          * Only an existing authorized input owns a new numeric shadow;
          * known result encodings retain the old static safe-word rule. */
         if (float_mode(a)) {
            result[lane].origin = RAW_FLOAT_SHADOW | RAW_OUTPUT | (a.origin & RAW_BANK_DEPENDENCY);
            dependency |= result[lane].origin & RAW_BANK_DEPENDENCY;
         }
         break;
      case RAW_UCMP: result[lane] = selected(a, b, checked_source(ir, instruction, 2, lane, conditional), mixed); break;
      case RAW_ADD:
      case RAW_MUL: {
         a = precise_source(ir, instruction, 0, lane, conditional);
         b = precise_source(ir, instruction, 1, lane, conditional);
         if ((instruction->flags & RAW_KNOWN_RETRY) && known_operands(a, b) && safe_raw_float(a) && safe_raw_float(b)) {
            uint32_t word = instruction->opcode == RAW_ADD ? known_add(a.one, b.one) : known_mul(a.one, b.one);
            if (safe_raw_float(known_word(word))) {
               result[lane] = known_word(word);
               /* ADD/MUL have no third operand. Its four unused swizzle words
                * hold the exact emission cache; index holds the lane mask. */
               checked.src[2].swizzle[lane] = word;
               checked.src[2].index |= 1u << lane;
               checked.flags |= RAW_KNOWN_RESULT;
            }
         }
         result[lane].origin = RAW_FLOAT_SHADOW | RAW_OUTPUT |
            ((checked.float_modes[0] | checked.float_modes[1]) >> (lane * 8) & RAW_BANK_DEPENDENCY);
         break;
      }
      case RAW_MAD:
      case RAW_DIV:
      case RAW_MOV_SAT:
      case RAW_DIV_SAT:
      case RAW_MAX:
      case RAW_MIN:
      case RAW_FRC:
      case RAW_LRP:
      case RAW_DP3:
      case RAW_RCP:
      case RAW_RSQ:
      case RAW_EX2:
      case RAW_LG2:
      case RAW_SIN:
      case RAW_POW:
      case RAW_TEX:
         if (known_reciprocal) result[lane] = known_word(reciprocal_word);
         result[lane].origin = RAW_FLOAT_SHADOW | RAW_OUTPUT;
         if (instruction->opcode == RAW_TEX || ((UINT64_C(1) << instruction->opcode) & (RAW_V6_OPCODES | RAW_EXPONENT_OPCODES | RAW_SINE_OPCODES | RAW_POWER_OPCODES)))
            result[lane].origin |= dependency;
         else for (unsigned source = 0; source < sources; ++source)
            result[lane].origin |= (checked.float_modes[source] >> (lane * 8)) & RAW_BANK_DEPENDENCY;
         if (lane == 0 && c580_zero_cap_matches(ir, instruction))
            result[lane].origin |= C580_NONPOSITIVE;
         break;
      case RAW_UARL: break; /* Recorded above into the dedicated scalar state. */
      case RAW_BGNLOOP:
      case RAW_BRK:
      case RAW_ENDLOOP:
      case RAW_UIF:
      case RAW_ELSE:
      case RAW_KILL:
      case RAW_KILL_IF:
      case RAW_ENDIF: break; /* Recorded above without a destination. */
      }
      if (ir->exact && (ir->opcode_mask & RAW_FRAGMENT_COORDINATES_USED)) {
         /* A finite coordinate can only authorize a finite result through
          * operations whose overflow and exceptional cases we bound here.
          * This certificate never changes the emitted arithmetic. */
         if (instruction->opcode == RAW_ADD || instruction->opcode == RAW_MUL ||
             instruction->opcode == RAW_MIN || instruction->opcode == RAW_MIN_PRECISE) {
            unsigned left = finite_exp(precise_source(ir, instruction, 0, lane, conditional));
            unsigned right = finite_exp(precise_source(ir, instruction, 1, lane, conditional));
            if (left <= 100u && right <= 100u) {
               unsigned maximum = left > right ? left : right;
               unsigned bound = instruction->opcode == RAW_MUL ? left + right + 2u :
                  instruction->opcode == RAW_ADD ? maximum + 2u : maximum;
               if (instruction->opcode != RAW_MIN_PRECISE || c580_prefix_matches(ir, instruction, 27))
                  set_finite_exp(&result[lane], bound);
            }
         } else if (instruction->opcode == RAW_RCP && instruction->src[0].file == CONST) {
            struct raw_lane denominator = precise_source(ir, instruction, 0, 0, conditional);
            if (known_operands(denominator, denominator) && safe_raw_float(denominator) &&
                (denominator.one & UINT32_C(0x7fffffff)) >= UINT32_C(0x3f800000))
               set_finite_exp(&result[lane], 1u);
         }
      }
      /* Each structured predecessor owns a physical shadow for every value
       * with numerical authority. A join can therefore retain a value without
       * borrowing another arm's IN locator or decoding a computed raw value. */
      if (structured && float_mode(result[lane]))
         result[lane].origin = RAW_FLOAT_SHADOW | (result[lane].origin & RAW_BANK_DEPENDENCY) |
            (output_legal(result[lane]) ? RAW_OUTPUT : 0) |
            (result[lane].origin & C580_NONPOSITIVE) |
            (complete_prefix_bank(ir) && (ir->opcode_mask & RAW_FRAGMENT_COORDINATES_USED) &&
             ir->count <= 28 ? result[lane].origin & RAW_FINITE_EXP_MASK : 0);
   }
   struct raw_lane *destination = instruction->dst.file == TEMP ? ir->temporary[instruction->dst.index] : ir->output[instruction->dst.index];
   for (unsigned lane = 0; lane < 4; ++lane)
      if (instruction->dst.mask & (1u << lane)) {
         if (instruction->flags & RAW_GUARDED_LRP) {
            ir->demand.result[lane] = result[lane];
            /* LRP kills the old logical definition even if the physical write
             * is skipped. Only the certificate's selected arm can read this
             * conditional result; old initialization cannot authorize it. */
            destination[lane] = (struct raw_lane){0};
         } else destination[lane] = result[lane];
         if ((result[lane].origin & RAW_ACCESS_MASK) == RAW_FLOAT_SHADOW) checked.float_mask |= 1u << lane;
      }
   ir->instructions[ir->count++] = *instruction;
   if (instruction->opcode != RAW_MOV) ir->opcode_mask |= UINT64_C(1) << instruction->opcode;
   bool arithmetic = ((UINT64_C(1) << instruction->opcode) & RAW_ARITHMETIC_OPCODES) != 0;
   if ((instruction->flags & RAW_NEGATE_SOURCES) && !arithmetic) ir->opcode_mask |= RAW_V5_NEGATION;
   if (dependency) ir->opcode_mask |= RAW_FINITE_BANK_USED;
   if (conversion_bank) ir->opcode_mask |= RAW_CONVERSION_BANK_USED;
   if (arithmetic) ir->opcode_mask |= RAW_PRECISE_ARITHMETIC_USED;
   else if ((instruction->flags & RAW_PRECISE) && instruction->opcode != RAW_MIN_PRECISE && instruction->opcode != RAW_FRC_PRECISE)
      ir->opcode_mask |= RAW_PRECISE_WORD_USED;
   if (instruction->flags & RAW_KNOWN_RESULT) ir->opcode_mask |= RAW_KNOWN_ARITHMETIC_USED;
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

enum { RASTER_LANES = (TEMP_REGISTERS + FILE_REGISTERS) * 4,
       RASTER_WORDS = (RASTER_LANES + 31) / 32, RASTER_QUEUE = 1024,
       RASTER_NONE = UINT16_MAX };
struct raster_analysis {
   uint32_t visited[BRIDGE_MAX_INSTRUCTIONS + 1][RASTER_WORDS];
   uint32_t queue[RASTER_QUEUE];
   uint16_t next[BRIDGE_MAX_INSTRUCTIONS][2];
   bool reachable[BRIDGE_MAX_INSTRUCTIONS + 1];
   unsigned used;
};
_Static_assert(sizeof(struct raster_analysis) == 207884, "bounded raster analysis arena");
_Static_assert(RASTER_LANES < UINT16_MAX, "raster queue lane IDs fit uint16_t");
_Static_assert(sizeof(struct raster_certificate) <= sizeof(((struct raw_ir *)0)->temporary),
   "finalized certificate reuses dead TEMP facts");

static bool raster_graph(const struct raw_ir *ir, struct raster_analysis *a)
{
   struct { unsigned open, otherwise, breaking; bool loop; } frames[BRIDGE_MAX_FLOW_DEPTH];
   unsigned depth = 0;
   for (unsigned pc = 0; pc < ir->count; ++pc) {
      enum raw_opcode op = ir->instructions[pc].opcode;
      a->next[pc][0] = pc + 1; a->next[pc][1] = RASTER_NONE;
      if (op == RAW_KILL || (ir->instructions[pc].flags & RAW_TERMINATING_DISCARD)) {
         a->next[pc][0] = RASTER_NONE;
      } else if (op == RAW_UIF || op == RAW_BGNLOOP) {
         if (depth == BRIDGE_MAX_FLOW_DEPTH) return false;
         frames[depth].open = pc;
         frames[depth].otherwise = frames[depth].breaking = RASTER_NONE;
         frames[depth++].loop = op == RAW_BGNLOOP;
      } else if (op == RAW_ELSE) {
         if (!depth || frames[depth - 1].loop || frames[depth - 1].otherwise != RASTER_NONE) return false;
         frames[depth - 1].otherwise = pc;
      } else if (op == RAW_BRK) {
         unsigned owner = depth;
         while (owner && !frames[owner - 1].loop) --owner;
         if (!owner || frames[owner - 1].breaking != RASTER_NONE) return false;
         frames[owner - 1].breaking = pc;
      } else if (op == RAW_ENDIF || op == RAW_ENDLOOP) {
         if (!depth || frames[depth - 1].loop != (op == RAW_ENDLOOP)) return false;
         --depth;
         unsigned open = frames[depth].open, otherwise = frames[depth].otherwise;
         if (op == RAW_ENDLOOP) {
            unsigned breaking = frames[depth].breaking;
            if (!ir->loop.checked || open != ir->loop.begin || pc != ir->loop.end ||
                breaking != ir->loop.break_pc) return false;
            a->next[pc][0] = open + 1;
            a->next[breaking][0] = pc + 1;
         } else {
            a->next[open][1] = otherwise == RASTER_NONE ? pc + 1 : otherwise + 1;
            if (otherwise != RASTER_NONE) a->next[otherwise][0] = pc + 1;
            unsigned flags = ir->instructions[open].flags;
            if (flags & RAW_UIF_FALSE) {
               a->next[open][0] = a->next[open][1];
               a->next[open][1] = RASTER_NONE;
            } else if (flags & RAW_UIF_TRUE) a->next[open][1] = RASTER_NONE;
            if (ir->radial.used && open == ir->radial.branch) {
               /* Existing coefficient approval proves this exact edge false.
                * The outer raster profile must retain that radial contract. */
               a->next[open][0] = a->next[open][1];
               a->next[open][1] = RASTER_NONE;
            }
         }
      }
   }
   if (depth) return false;
   a->reachable[0] = true; a->queue[a->used++] = 0;
   while (a->used) {
      unsigned pc = a->queue[--a->used];
      if (pc == ir->count) continue;
      for (unsigned edge = 0; edge < 2; ++edge) {
         unsigned next = a->next[pc][edge];
         if (next == RASTER_NONE) continue;
         if (next > ir->count) return false;
         if (!a->reachable[next]) {
            a->reachable[next] = true;
            a->queue[a->used++] = next; /* At most 180 distinct boundaries. */
         }
      }
   }
   return a->reachable[ir->count];
}

static bool raster_query(struct raster_analysis *a, unsigned pc, unsigned lane)
{
   uint32_t bit = UINT32_C(1) << (lane % 32);
   if (a->visited[pc][lane / 32] & bit) return true;
   if (a->used == RASTER_QUEUE) return false;
   a->visited[pc][lane / 32] |= bit;
   a->queue[a->used++] = pc * RASTER_LANES + lane;
   return true;
}

static bool raster_source(const struct raw_ir *ir, struct raster_analysis *a,
                          struct raster_certificate *c, unsigned pc,
                          const struct raw_source *source, unsigned lane)
{
   unsigned component = source->swizzle[lane];
   if (source->file == TEMP) return raster_query(a, pc, source->index * 4 + component);
   if (source->file == IN) return true; /* Existing ordinary input authority. */
   if (source->file == IMM) return safe_raw_float(known_word(ir->immediates[source->index][component]));
   uint64_t indices = 0;
   if (source->file == CONST) indices = UINT64_C(1) << source->index;
   else if (source->file == INDIRECT_CONST) {
      indices = ir->indirect_indices;
      if (ir->loop.checked)
         for (unsigned access = 0; access < 4; ++access)
            if (ir->loop.access[access].read == pc) indices = ir->loop.access[access].candidates;
   } else return false;
   if (!indices || indices >> CONST_REGISTERS) return false;
   for (unsigned index = 0; index < CONST_REGISTERS; ++index) if (indices & (UINT64_C(1) << index)) {
      /* The loop count remains integer data even when its encoding happens to
       * be a normal float. It cannot gain a raster interpretation here. */
      if (ir->loop.checked && index == 9 && component == 0) return false;
      c->components[index] |= 1u << component;
   }
   return true;
}

int raw_certify_raster_outputs(const struct profile *p)
{
   struct raw_ir *ir = p->raw;
   if (!ir || !ir->count || ir->count > BRIDGE_MAX_INSTRUCTIONS ||
       p->semantic[OUT][0] != (p->stage == 0 ? 1u : 3u)) return 0;
   struct raster_analysis *a = calloc(1, sizeof(*a));
   if (!a) return -1;
   struct raster_certificate certificate = {0};
   bool valid = raster_graph(ir, a);
   for (unsigned index = 0; valid && index < FILE_REGISTERS; ++index) if (p->declared[OUT][index])
      for (unsigned lane = 0; valid && lane < 4; ++lane)
         if ((p->components[OUT][index] & (1u << lane)) && !output_legal(ir->output[index][lane])) {
            certificate.outputs[index] |= 1u << lane;
            valid = raster_query(a, ir->count, TEMP_REGISTERS * 4 + index * 4 + lane);
         }
   while (valid && a->used) {
      unsigned query = a->queue[--a->used], pc = query / RASTER_LANES, id = query % RASTER_LANES;
      enum file file = id < TEMP_REGISTERS * 4 ? TEMP : OUT;
      unsigned index = file == TEMP ? id / 4 : id / 4 - TEMP_REGISTERS, lane = id % 4;
      bool predecessor = false;
      for (unsigned before = 0; valid && before < ir->count; ++before) {
         if (!a->reachable[before] || (a->next[before][0] != pc && a->next[before][1] != pc)) continue;
         predecessor = true;
         const struct raw_instruction *instruction = &ir->instructions[before];
         if (((UINT64_C(1) << instruction->opcode) & RAW_CONTROL_OPCODES) ||
             instruction->dst.file != file || instruction->dst.index != index ||
             !(instruction->dst.mask & (1u << lane))) {
            valid = raster_query(a, before, id);
         } else if (instruction->opcode == RAW_MOV) {
            valid = raster_source(ir, a, &certificate, before, &instruction->src[0], lane);
         } else if (instruction->opcode == RAW_UCMP || instruction->opcode == RAW_MAX_PRECISE || instruction->opcode == RAW_MIN_PRECISE) {
            unsigned first = instruction->opcode == RAW_UCMP ? 1 : 0;
            valid = raster_source(ir, a, &certificate, before, &instruction->src[first], lane) &&
               raster_source(ir, a, &certificate, before, &instruction->src[first + 1], lane);
         } else {
            /* Existing numeric results already own ordinary output authority.
             * No integer/bitwise transformation becomes a copied bank word. */
            valid = ((UINT64_C(1) << instruction->opcode) & RAW_NUMERIC_OPCODES) != 0 ||
               (((UINT64_C(1) << instruction->opcode) & (RAW_ARITHMETIC_OPCODES | RAW_FRACTION_OPCODES)) &&
                (instruction->float_mask & (1u << lane)));
         }
      }
      valid = valid && predecessor;
   }
   bool bank = false;
   for (unsigned index = 0; index < CONST_REGISTERS; ++index) bank |= certificate.components[index] != 0;
   free(a);
   if (!valid || !bank) return 0;
   /* All semantic TEMP reads and flow joins are complete. Only now replace
    * those dead facts and publish the mandatory finite+raster obligations. */
   ir->raster = certificate;
   ir->opcode_mask |= RAW_RASTER_BANK_USED | RAW_FINITE_BANK_USED;
   return 1;
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
   if (p->stage && p->semantic[IN][index] == 1) emit(w, "gl_FragCoord.%c", "xyzw"[component]);
   else if (p->stage) emit(w, "vso_g%u.%c", p->semantic_index[IN][index], "xyzw"[component]);
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
   case INDIRECT_CONST: emit(w, "%sconst0[raw_addr].%c", p->stage ? "fs" : "vs", "xyzw"[component]); break;
   default: break; /* Guard excludes OUT/sampler operands before recording. */
   }
}

static void precise_operand(struct writer *w, const struct profile *p,
                            const struct raw_instruction *instruction, unsigned source, unsigned lane)
{
   emit(w, "(");
   bool absolute = (instruction->flags & (RAW_ABSOLUTE_SOURCE0 << source)) != 0;
   if (absolute) emit(w, "(");
   operand(w, p, &instruction->src[source], lane);
   if (absolute) emit(w, " & 2147483647u)");
   if (instruction->flags & (RAW_NEGATE_SOURCE0 << source)) emit(w, " ^ 2147483648u");
   emit(w, ")");
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
   if (op == RAW_RCP && (instruction->flags & RAW_KNOWN_RESULT)) {
      emit(w, " float_rhs = vec4(/* known:reciprocal */ uintBitsToFloat(%uu));\n",
           instruction->src[2].swizzle[0]);
      return;
   }
   if (op == RAW_POW) {
      /* Capture both operands before any masked/aliased publication. */
      emit(w, " { highp float power_base = ");
      float_operand(w, p, instruction, 0, 0);
      emit(w, "; highp float power_exponent = ");
      float_operand(w, p, instruction, 1, 0);
      if (instruction->flags & RAW_PRIVATE_92CB_COMPLETE) {
         unsigned pc = (unsigned)(instruction - p->raw->instructions);
         bool masked = pc == 231 || pc == 260 || pc == 293 || pc == 319;
         emit(w, "; float_rhs = vec4(0.0); bool power_masked = %s && power_base < 0.0;"
            " if (!power_masked) { if (!private_power_domain(power_base, power_exponent))"
            " private_power_fault = true; else if (power_base != 0.0)"
            " float_rhs = vec4(/* power:POW */ pow(power_base, power_exponent)); }"
            " if (private_probe_pc == %u) private_probe = vec4(power_base,"
            " power_exponent, float_rhs.x, power_masked ? 2.0 : 1.0); }\n",
            masked ? "true" : "false", pc);
      } else
         emit(w, "; float_rhs = vec4(0.0); if (power_base != 0.0) float_rhs = vec4(/* power:POW */ pow(power_base, power_exponent)); }\n");
      return;
   }
   if (op == RAW_SIN) {
      /* One post-swizzle x evaluation precedes every masked/aliased write. */
      emit(w, " float_rhs = vec4(/* sine:SIN */ sin(");
      float_operand(w, p, instruction, 0, 0);
      emit(w, "));\n");
      return;
   }
   if ((UINT64_C(1) << op) & RAW_EXPONENT_OPCODES) {
      /* TGSI consumes post-swizzle x once and broadcasts before publication,
       * even for a y/w-only destination or an aliased source register. */
      emit(w, op == RAW_EX2 ? " float_rhs = vec4(/* exponent:EX2 */ exp2(" : " float_rhs = vec4(/* exponent:LG2 */ log2(");
      float_operand(w, p, instruction, 0, 0);
      emit(w, "));\n");
      return;
   }
   if (op == RAW_TEX) {
      /* One vec4 sample is shared by all lanes and both representations. */
      emit(w, " float_rhs = texture(fssamp%u, vec2(", instruction->sampler);
      float_operand(w, p, instruction, 0, 0); emit(w, ", ");
      float_operand(w, p, instruction, 0, 1); emit(w, "));\n");
      return;
   }
   if ((UINT64_C(1) << op) & RAW_V6_OPCODES) {
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
      if ((instruction->flags & RAW_KNOWN_RESULT) && (instruction->src[2].index & (1u << lane))) {
         emit(w, "/* known:shadow */ uintBitsToFloat(%uu)", instruction->src[2].swizzle[lane]);
      } else if (op == RAW_UCMP) {
         unsigned yes = lane_mode(instruction, 1, lane), no = lane_mode(instruction, 2, lane);
         /* A known selector may choose an authorized shadow while the other
          * payload is arbitrary raw data. Never decode that unselected arm. */
         if (yes && no) {
            operand(w, p, &instruction->src[0], lane); emit(w, " != 0u ? ");
            float_operand(w, p, instruction, 1, lane); emit(w, " : ");
            float_operand(w, p, instruction, 2, lane);
         } else float_operand(w, p, instruction, yes ? 1 : 2, lane);
      } else if (op == RAW_DIV_SAT) {
         emit(w, "raw_saturation_divide(");
         float_operand(w, p, instruction, 0, lane); emit(w, ", ");
         float_operand(w, p, instruction, 1, lane); emit(w, ")");
      } else if (op == RAW_LRP) {
         emit(w, "mix(");
         float_operand(w, p, instruction, 2, lane); emit(w, ", ");
         float_operand(w, p, instruction, 1, lane); emit(w, ", ");
         float_operand(w, p, instruction, 0, lane); emit(w, ")");
      } else {
         if (op == RAW_MAX || op == RAW_MIN || op == RAW_FRC)
            emit(w, op == RAW_MAX ? "max(" : op == RAW_MIN ? "min(" : "fract(");
         float_operand(w, p, instruction, 0, lane);
         if (op == RAW_ADD || op == RAW_MUL || op == RAW_MAD || op == RAW_DIV || op == RAW_MAX || op == RAW_MIN) {
            emit(w, op == RAW_ADD ? " + " : op == RAW_DIV ? " / " : op == RAW_MAX || op == RAW_MIN ? ", " : " * ");
            float_operand(w, p, instruction, 1, lane);
            if (op == RAW_MAD) { emit(w, " + "); float_operand(w, p, instruction, 2, lane); }
         }
         if (op == RAW_MAX || op == RAW_MIN || op == RAW_FRC) emit(w, ")");
      }
      emit(w, ")");
   }
   emit(w, ");\n");
   if ((UINT64_C(1) << op) & RAW_SATURATION_OPCODES)
      emit(w, " /* saturation:post */ float_rhs = raw_saturate(float_rhs);\n");
}

char *raw_emit(const struct profile *p, unsigned const_count)
{
   struct writer w = {.text = calloc(BRIDGE_MAX_GLSL + 1, 1)};
   if (!w.text) return NULL;
   emit(&w, "#version 300 es\nprecision highp float;\nprecision highp int;\n");
   if (p->raw->opcode_mask & RAW_SATURATION_OPCODES)
      emit(&w, "float raw_saturate_lane(float value) {\n"
         " return value < 0.0 ? 0.0 : value > 1.0 ? 1.0 : value;\n}\n"
         "vec4 raw_saturate(vec4 value) {\n"
         " return vec4(raw_saturate_lane(value.x), raw_saturate_lane(value.y), raw_saturate_lane(value.z), raw_saturate_lane(value.w));\n}\n");
   if (p->raw->opcode_mask & (UINT64_C(1) << RAW_DIV_SAT))
      emit(&w, "float raw_saturation_divide(float a, float b) {\n"
         " if (b < 0.0) { a = -a; b = -b; }\n"
         " /* saturation:division */ return a / b;\n}\n");
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
   if (p->raw->opcode_mask & (RAW_V3_OPCODES | (UINT64_C(1) << RAW_MAX_PRECISE) | (UINT64_C(1) << RAW_MIN_PRECISE)))
      emit(&w, "uint raw_float_mask(uint a, uint b, bool greater_equal) {\n"
         " uint magnitude_a = a & 2147483647u, magnitude_b = b & 2147483647u;\n"
         " if (magnitude_a > 2139095040u || magnitude_b > 2139095040u) return 0u;\n"
         " bool both_zero = magnitude_a == 0u && magnitude_b == 0u;\n"
         " uint key_a = (a & 2147483648u) != 0u ? ~a : a ^ 2147483648u;\n"
         " uint key_b = (b & 2147483648u) != 0u ? ~b : b ^ 2147483648u;\n"
         " bool selected = greater_equal ? both_zero || key_a >= key_b : !both_zero && key_a < key_b;\n"
         " return selected ? 4294967295u : 0u;\n}\n");
   if (p->raw->opcode_mask & (UINT64_C(1) << RAW_MAX_PRECISE))
      emit(&w, "uint raw_precise_max(uint a, uint b) {\n"
         " return raw_float_mask(b, a, false) != 0u ? a : b;\n}\n");
   if (p->raw->opcode_mask & (UINT64_C(1) << RAW_MIN_PRECISE))
      emit(&w, "uint raw_precise_min(uint a, uint b) {\n"
         " return raw_float_mask(a, b, false) != 0u ? a : b;\n}\n");
   if (p->raw->opcode_mask & RAW_EQUALITY_OPCODES)
      emit(&w, "uint raw_float_equal_mask(uint a, uint b, bool not_equal) {\n"
         " uint magnitude_a = a & 2147483647u, magnitude_b = b & 2147483647u;\n"
         " bool unordered = magnitude_a > 2139095040u || magnitude_b > 2139095040u;\n"
         " bool equal = !unordered && (a == b || (magnitude_a == 0u && magnitude_b == 0u));\n"
         " return (not_equal ? !equal : equal) ? 4294967295u : 0u;\n}\n");
   if (p->raw->opcode_mask & RAW_ARITHMETIC_OPCODES) emit(&w, "%s", raw_binary32_common);
   if (p->raw->opcode_mask & (UINT64_C(1) << RAW_ADD_PRECISE)) emit(&w, "%s", raw_binary32_add);
   if (p->raw->opcode_mask & (UINT64_C(1) << RAW_MUL_PRECISE)) emit(&w, "%s", raw_binary32_mul);
   if (p->raw->opcode_mask & (UINT64_C(1) << RAW_I2F)) emit(&w, "%s", raw_binary32_i2f);
   if (p->raw->opcode_mask & (UINT64_C(1) << RAW_F2I)) emit(&w, "%s", raw_binary32_f2i);
   if (p->raw->opcode_mask & (UINT64_C(1) << RAW_TRUNC)) emit(&w, "%s", raw_binary32_trunc);
   if (p->raw->opcode_mask & (UINT64_C(1) << RAW_SSG)) emit(&w, "%s", raw_binary32_ssg);
   if (p->raw->opcode_mask & RAW_FRACTION_OPCODES) emit(&w, "%s", raw_binary32_fraction);
   if (p->raw->opcode_mask & (UINT64_C(1) << RAW_KILL_IF))
      emit(&w, "bool raw_discard_negative(highp uint word) {\n highp uint magnitude = word & 2147483647u;\n return (word & 2147483648u) != 0u && magnitude != 0u && magnitude <= 2139095040u;\n}\n");
   /* Keep all previously admitted source byte-identical. Higher declarations
    * extend the physical arrays only when this checked stage needs them. */
   unsigned temporaries = LEGACY_TEMP_REGISTERS;
   for (unsigned index = LEGACY_TEMP_REGISTERS; index < TEMP_REGISTERS; ++index)
      if (p->declared[TEMP][index]) temporaries = index + 1;
   if (p->raw_flags & RAW_PRIVATE_92CB_COMPLETE)
      emit(&w,
         "uniform int private_probe_pc;\n"
         "uniform int private_probe_mode;\n"
         "layout(location=1) out highp vec4 private_probe_out;\n"
         "bool private_power_domain(highp float base, highp float exponent) {\n"
         " uint b = floatBitsToUint(base); uint e = floatBitsToUint(exponent);\n"
         " uint bm = b & 2147483647u; uint em = e & 2147483647u;\n"
         " if (bm >= 2139095040u || em >= 2139095040u ||"
         " (bm != 0u && (b & 2147483648u) != 0u)) return false;\n"
         " if (em != 0u && em < 8388608u) return false;\n"
         " if (bm == 0u) return exponent > 0.0;\n"
         " if (bm < 8388608u) return false;\n"
         " int lower = int(bm >> 23u) - 127;\n"
         " int upper = lower + ((bm & 8388607u) != 0u ? 1 : 0);\n"
         " return float(max(abs(lower), abs(upper))) * abs(exponent) <= 119.0;\n"
         "}\n");
   emit(&w, "void main(void) {\n highp uvec4 raw_temp[%u];\n highp uvec4 raw_out[8];\n highp uvec4 raw_rhs;\n", temporaries);
   if (p->raw->indirect_indices) emit(&w, " highp uint raw_addr;\n");
   if (p->raw->opcode_mask & (RAW_NUMERIC_OPCODES | RAW_STRUCTURED_OPCODES | RAW_ARITHMETIC_OPCODES | RAW_CONVERSION_OPCODES | RAW_FRACTION_OPCODES | (UINT64_C(1) << RAW_MAX_PRECISE) | (UINT64_C(1) << RAW_MIN_PRECISE)))
      emit(&w, " highp vec4 float_temp[%u];\n highp vec4 float_out[8];\n highp vec4 float_rhs;\n", temporaries);
   if (p->raw_flags & RAW_PRIVATE_92CB_COMPLETE)
      emit(&w, " bool private_power_fault = false; highp vec4 private_probe = vec4(0.0);\n");
   for (unsigned index = 0; index < p->raw->count; ++index) {
      const struct raw_instruction *instruction = &p->raw->instructions[index];
      if ((instruction->flags & RAW_DEAD) && !((UINT64_C(1) << instruction->opcode) & (RAW_STRUCTURED_OPCODES | RAW_LOOP_OPCODES))) continue;
      if (instruction->flags & RAW_PRECISE) emit(&w, " /* TGSI PRECISE word-local */\n");
      if (instruction->opcode == RAW_BGNLOOP) { emit(&w, " do {\n"); continue; }
      if (instruction->opcode == RAW_BRK) { emit(&w, " break;\n"); continue; }
      if (instruction->opcode == RAW_ENDLOOP) { emit(&w, " } while (%s);\n", instruction->flags & RAW_DEAD ? "false" : "true"); continue; }
      if (instruction->opcode == RAW_KILL) {
         if (p->raw_flags & RAW_PRIVATE_92CB_COMPLETE)
            emit(&w, " if (private_probe_mode != 0) { private_probe_out = private_probe;"
               " fsout_c0 = vec4(private_power_fault ? -30000.0 : -10000.0); return; }\n");
         emit(&w, " discard;\n"); continue;
      }
      if (instruction->opcode == RAW_KILL_IF) {
         emit(&w, " if (");
         for (unsigned lane = 0; lane < 4; ++lane) {
            if (lane) emit(&w, " || ");
            emit(&w, "raw_discard_negative(");
            precise_operand(&w, p, instruction, 0, lane);
            emit(&w, ")");
         }
         emit(&w, ") discard;\n");
         continue;
      }
      if (instruction->opcode == RAW_UARL) {
         emit(&w, " raw_addr = "); operand(&w, p, &instruction->src[0], 0); emit(&w, ";\n");
         continue;
      }
      if (instruction->opcode == RAW_UIF) {
         if (instruction->flags & (RAW_DEAD | RAW_UIF_FALSE | RAW_UIF_TRUE))
            emit(&w, " /* proved raw UIF */ if (%s) {\n", instruction->flags & RAW_UIF_TRUE ? "true" : "false");
         else { emit(&w, " if ("); operand(&w, p, &instruction->src[0], 0); emit(&w, " != 0u) {\n"); }
         continue;
      }
      if (instruction->opcode == RAW_ELSE) { emit(&w, " } else {\n"); continue; }
      if (instruction->opcode == RAW_ENDIF) { emit(&w, " }\n"); continue; }
      bool guarded = (instruction->flags & RAW_GUARDED_LRP) != 0;
      if (guarded) {
         unsigned lane = 0;
         while (!(instruction->dst.mask & (1u << lane))) ++lane;
         emit(&w, " /* guarded interpolation */\n if ((");
         operand(&w, p, &instruction->src[0], lane);
         emit(&w, " & 2147483647u) != 0u) {\n");
      }
      bool numeric = ((UINT64_C(1) << instruction->opcode) & RAW_NUMERIC_OPCODES) != 0;
      bool arithmetic = ((UINT64_C(1) << instruction->opcode) & RAW_ARITHMETIC_OPCODES) != 0;
      bool scalar = ((UINT64_C(1) << instruction->opcode) & RAW_SCALAR_OPCODES) != 0;
      bool fraction = ((UINT64_C(1) << instruction->opcode) & RAW_FRACTION_OPCODES) != 0;
      bool raw_shadow = fraction || scalar || arithmetic || instruction->opcode == RAW_I2F || instruction->opcode == RAW_F2I || instruction->opcode == RAW_MAX_PRECISE || instruction->opcode == RAW_MIN_PRECISE ||
         ((instruction->flags & RAW_STRUCTURED) && !numeric &&
          instruction->opcode != RAW_MOV && instruction->opcode != RAW_UCMP);
      if (instruction->float_mask && !raw_shadow) float_snapshot(&w, p, instruction);
      if (numeric && !raw_shadow) emit(&w, " raw_rhs = floatBitsToUint(float_rhs");
      else {
         emit(&w, " raw_rhs = uvec4(");
         for (unsigned lane = 0; lane < 4; ++lane) {
            if (lane) emit(&w, ", ");
            if (!(instruction->dst.mask & (1u << lane))) { emit(&w, "0u"); continue; }
            enum raw_opcode op = instruction->opcode;
            emit(&w, "(");
            if (op == RAW_NOT) emit(&w, "~");
            if (op == RAW_ISGE || op == RAW_ISLT || op == RAW_IMAX) emit(&w, "(");
            if (op == RAW_FSLT || op == RAW_FSGE) emit(&w, "raw_float_mask(");
            if (op == RAW_FSEQ || op == RAW_FSNE) emit(&w, "raw_float_equal_mask(");
            if (scalar) {
               emit(&w, op == RAW_TRUNC ? "raw_numeric_trunc(" : "raw_numeric_ssg(");
               precise_operand(&w, p, instruction, 0, lane); emit(&w, ")");
            } else if (fraction) {
               emit(&w, "raw_precise_fraction(");
               precise_operand(&w, p, instruction, 0, lane); emit(&w, ")");
            } else if (op == RAW_I2F || op == RAW_F2I) {
               emit(&w, op == RAW_I2F ? "raw_signed_i2f(" : "raw_signed_f2i(");
               precise_operand(&w, p, instruction, 0, lane); emit(&w, ")");
            } else if (op == RAW_MAX_PRECISE || op == RAW_MIN_PRECISE || arithmetic) {
               emit(&w, op == RAW_MAX_PRECISE ? "raw_precise_max(" :
                    op == RAW_MIN_PRECISE ? "raw_precise_min(" : op == RAW_ADD_PRECISE ? "raw_precise_add(" : "raw_precise_mul(");
               precise_operand(&w, p, instruction, 0, lane);
            } else operand(&w, p, &instruction->src[0], lane);
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
            } else if (op == RAW_ISLT) {
               emit(&w, " ^ 2147483648u) < ("); operand(&w, p, &instruction->src[1], lane);
               emit(&w, " ^ 2147483648u) ? 4294967295u : 0u");
            } else if (op == RAW_IMAX) {
               emit(&w, " ^ 2147483648u) >= ("); operand(&w, p, &instruction->src[1], lane);
               emit(&w, " ^ 2147483648u) ? "); operand(&w, p, &instruction->src[0], lane);
               emit(&w, " : "); operand(&w, p, &instruction->src[1], lane);
            } else if (op == RAW_USEQ || op == RAW_USNE) {
               emit(&w, op == RAW_USEQ ? " == " : " != "); operand(&w, p, &instruction->src[1], lane);
               emit(&w, " ? 4294967295u : 0u");
            } else if (op == RAW_UCMP) {
               emit(&w, " != 0u ? "); operand(&w, p, &instruction->src[1], lane);
               emit(&w, " : "); operand(&w, p, &instruction->src[2], lane);
            } else if (op == RAW_MAX_PRECISE || op == RAW_MIN_PRECISE || arithmetic) {
               emit(&w, ", "); precise_operand(&w, p, instruction, 1, lane); emit(&w, ")");
            } else if (op == RAW_FSEQ || op == RAW_FSNE) {
               emit(&w, ", "); operand(&w, p, &instruction->src[1], lane);
               emit(&w, op == RAW_FSNE ? ", true)" : ", false)");
            } else if (op == RAW_FSLT || op == RAW_FSGE) {
               emit(&w, ", "); operand(&w, p, &instruction->src[1], lane);
               emit(&w, op == RAW_FSGE ? ", true)" : ", false)");
            }
            emit(&w, ")");
         }
      }
      emit(&w, ");\n");
      if (instruction->flags & RAW_KNOWN_RESULT)
         for (unsigned lane = 0; lane < 4; ++lane) if (instruction->src[2].index & (1u << lane))
            emit(&w, " /* known:word */ raw_rhs.%c = %uu;\n", "xyzw"[lane], instruction->src[2].swizzle[lane]);
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
      if (guarded) emit(&w, " }\n");
   }
   for (unsigned index = 0; p->live && index < FILE_REGISTERS; ++index) if (p->declared[OUT][index]) {
      for (unsigned lane = 0; lane < 4; ++lane) if (p->components[OUT][index] & (1u << lane)) {
         unsigned semantic = p->semantic[OUT][index];
         if (semantic == 1) emit(&w, " gl_Position");
         else if (semantic == 2) emit(&w, " vso_g%u", p->semantic_index[OUT][index]);
         else emit(&w, " fsout_c0");
         emit(&w, ".%c = ", "xyzw"[lane]);
         unsigned authority = p->raw->output[index][lane].origin;
         unsigned origin = authority & RAW_ACCESS_MASK;
         bool raster = (p->raw->opcode_mask & RAW_RASTER_BANK_USED) &&
            (p->raw->raster.outputs[index] & (1u << lane));
         if (raster) emit(&w, "uintBitsToFloat(raw_out[%u].%c)", index, "xyzw"[lane]);
         else if ((authority & RAW_OUTPUT) && origin == RAW_FLOAT_SHADOW) emit(&w, "float_out[%u].%c", index, "xyzw"[lane]);
         else if (authority & RAW_OUTPUT) input_float(&w, p, (origin - 1) / 4, (origin - 1) % 4);
         else emit(&w, "uintBitsToFloat(raw_out[%u].%c)", index, "xyzw"[lane]);
         emit(&w, ";\n");
      }
   }
   if (p->raw_flags & RAW_PRIVATE_92CB_COMPLETE)
      emit(&w, " private_probe_out = private_probe; if (private_power_fault) fsout_c0 = vec4(-30000.0);\n");
   if (!p->stage) emit(&w, " gl_Position.y = gl_Position.y * winsys_adjust_y;\n");
   emit(&w, "}\n");
   if (w.overflow) { free(w.text); return NULL; }
   return w.text;
}
