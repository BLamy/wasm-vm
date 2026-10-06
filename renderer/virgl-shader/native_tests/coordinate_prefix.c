/* SPDX-License-Identifier: MIT
 * Replay of the literal c580 pc0..27 dependencies in the checked raw IR.
 * Banks are supplied by the independent capture reader, not by this program. */
#include "../raw_bits.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(bool valid, const char *reason)
{
   if (!valid) { fprintf(stderr, "coordinate-prefix: %s\n", reason); exit(1); }
}

static FILE *bank_input;
static bool alter_pc8;

static uint32_t word(void)
{
   unsigned char bytes[4];
   require(fread(bytes, 1, sizeof(bytes), bank_input) == sizeof(bytes), "complete bank word");
   return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 |
      (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}

static struct raw_source source(enum file file, unsigned index, const char *swizzle)
{
   struct raw_source result = {.file = file, .index = index};
   for (unsigned lane = 0; lane < 4; ++lane) {
      const char *component = strchr("xyzw", swizzle[lane]);
      require(component != NULL, "literal source swizzle");
      result.swizzle[lane] = (unsigned)(component - "xyzw");
   }
   return result;
}

static void step(struct raw_ir *ir, enum raw_opcode opcode, unsigned destination,
                 const char *mask, struct raw_source left, struct raw_source right)
{
   unsigned bits = 0;
   for (const char *p = mask; *p; ++p) {
      const char *component = strchr("xyzw", *p);
      require(component != NULL, "literal destination mask");
      bits |= 1u << (component - "xyzw");
   }
   struct raw_instruction instruction = {
      .opcode = opcode, .dst = {.file = TEMP, .index = destination, .mask = bits},
      .flags = RAW_MIXED | RAW_CONDITIONAL | RAW_KNOWN_RETRY | RAW_BRANCH_RETRY,
      .src = {left, right}
   };
   if (alter_pc8 && ir->count == 8) instruction.src[0].swizzle[1] = 0;
   if (opcode == RAW_MIN_PRECISE) instruction.flags |= RAW_PRECISE;
   unsigned pc = ir->count;
   if (!raw_record(ir, &instruction)) {
      fprintf(stderr, "coordinate-prefix: pc%u opcode%u rejected\n", pc, (unsigned)opcode);
      exit(1);
   }
}

#define S(file, index, lanes) source(file, index, lanes)
#define P(op, dst, mask, left, right) step(ir, RAW_##op, dst, mask, left, right)

static void replay(struct raw_ir *ir, bool altered_prefix)
{
   alter_pc8 = altered_prefix;
   ir->immediates[0][0] = UINT32_C(0xbf800000);
   ir->immediates[0][1] = UINT32_C(0x3f000000);
   ir->immediates[0][2] = 0;
   ir->immediates[0][3] = UINT32_C(0x40000000);
   ir->immediates[1][0] = UINT32_C(0x3f800000);
   ir->immediates[2][0] = UINT32_C(0x3f800000);
   ir->immediates[2][1] = UINT32_C(0x3f166bb0);
   ir->immediates[2][2] = UINT32_C(0x3f966bb0);
   ir->immediates[2][3] = UINT32_C(0x40400000);
   P(MUL, 19, "x", S(IN, 0, "yxxx"), S(CONST, 33, "zxxx"));    /* pc0 */
   P(ADD, 9, "y", S(TEMP, 19, "xxxx"), S(CONST, 33, "wwxx"));  /* pc1 */
   P(MUL, 20, "xy", S(IN, 1, "xyyy"), S(CONST, 0, "xyyy"));   /* pc2 */
   P(MUL, 21, "xy", S(TEMP, 20, "yxxx"), S(IMM, 0, "xxxx"));  /* pc3 */
   P(MUL, 22, "xy", S(CONST, 32, "xyyy"), S(IMM, 0, "yyyy")); /* pc4 */
   P(ADD, 23, "xy", S(CONST, 31, "xyyy"), S(TEMP, 22, "xyyy"));/* pc5 */
   P(MUL, 24, "xy", S(TEMP, 23, "xyxx"), S(IMM, 0, "xxxx")); /* pc6 */
   P(MOV, 9, "x", S(IN, 0, "xxxx"), S(IN, 0, "xxxx"));        /* pc7 */
   P(ADD, 25, "xy", S(TEMP, 9, "xyxx"), S(TEMP, 24, "xyxx"));/* pc8 */
   P(FSLT, 26, "xy", S(TEMP, 25, "xyyy"), S(IMM, 0, "zzzz"));/* pc9 */
   P(AND, 27, "xy", S(TEMP, 26, "xyyy"), S(IMM, 1, "xxxx")); /* pc10 */
   P(MUL, 28, "xy", S(IMM, 0, "wwww"), S(TEMP, 27, "xyxx")); /* pc11 */
   P(MUL, 29, "xy", S(TEMP, 28, "xyxx"), S(IMM, 0, "xxxx")); /* pc12 */
   P(ADD, 30, "xy", S(TEMP, 29, "xyyy"), S(IMM, 2, "xxxx")); /* pc13 */
   P(MUL, 31, "xy", S(TEMP, 25, "xyyy"), S(TEMP, 30, "xyyy"));/* pc14 */
   P(MUL, 32, "x", S(CONST, 29, "xxxx"), S(IMM, 0, "xxxx")); /* pc15 */
   P(ADD, 33, "xy", S(TEMP, 22, "xyxx"), S(TEMP, 32, "xxxx"));/* pc16 */
   P(MUL, 34, "xy", S(TEMP, 33, "xyxx"), S(IMM, 0, "xxxx"));/* pc17 */
   P(ADD, 35, "xy", S(TEMP, 31, "xyxx"), S(TEMP, 34, "xyxx"));/* pc18 */
   P(MUL, 36, "x", S(CONST, 1, "xxxx"), S(IMM, 0, "xxxx"));  /* pc19 */
   P(ADD, 37, "xy", S(TEMP, 22, "xyxx"), S(TEMP, 36, "xxxx"));/* pc20 */
   P(MUL, 38, "xy", S(TEMP, 37, "xyxx"), S(IMM, 0, "xxxx"));/* pc21 */
   P(ADD, 39, "xy", S(TEMP, 31, "xyxx"), S(TEMP, 38, "xyxx"));/* pc22 */
   P(RCP, 40, "x", S(CONST, 32, "xxxx"), S(IN, 0, "xxxx"));  /* pc23 */
   P(RCP, 40, "y", S(CONST, 32, "yyyy"), S(IN, 0, "xxxx"));  /* pc24 */
   P(ADD, 41, "xy", S(TEMP, 35, "xyyy"), S(TEMP, 40, "xyyy"));/* pc25 */
   P(ADD, 42, "xy", S(TEMP, 39, "xyyy"), S(TEMP, 40, "xyyy"));/* pc26 */
   P(MIN_PRECISE, 43, "x", S(TEMP, 41, "xxxx"), S(TEMP, 41, "yxxx")); /* pc27 */
   alter_pc8 = false;
}

static unsigned probe(const struct raw_exact_bank *exact, bool coordinates, bool altered_prefix,
                      unsigned *x, unsigned *y)
{
   struct raw_ir *ir = calloc(1, sizeof(*ir));
   require(ir != NULL, "bounded IR allocation");
   ir->exact = exact;
   if (coordinates) ir->opcode_mask = RAW_FRAGMENT_COORDINATES_USED;
   replay(ir, altered_prefix);
   *x = raw_finite_exp(ir->temporary[41][0]);
   *y = raw_finite_exp(ir->temporary[41][1]);
   unsigned result = raw_finite_exp(ir->temporary[43][0]);
   if (result <= 100u) {
      struct raw_instruction negated = {
         .opcode = RAW_ADD, .dst = {.file = TEMP, .index = 50, .mask = 1},
         .flags = RAW_MIXED | RAW_CONDITIONAL | RAW_KNOWN_RETRY |
                  RAW_BRANCH_RETRY | RAW_NEGATE_SOURCE0,
         .src = {S(TEMP, 43, "xxxx"), S(IMM, 1, "yyyy")}
      };
      require(raw_record(ir, &negated), "negated finite source stays numerically usable");
      require(raw_finite_exp(ir->temporary[50][0]) == UINT32_MAX,
              "unused signed path cannot inherit the prefix bound");
   }
   free(ir);
   return result;
}

static void bound_is_not_authority(void)
{
   struct raw_ir *ir = calloc(1, sizeof(*ir));
   require(ir != NULL, "authority IR allocation");
   ir->temporary[42][0].origin = 32u << RAW_FINITE_EXP_SHIFT;
   struct raw_instruction instruction = {
      .opcode = RAW_ADD, .dst = {.file = TEMP, .index = 50, .mask = 1},
      .src = {S(TEMP, 42, "xxxx"), S(IMM, 1, "yyyy")}
   };
   require(!raw_record(ir, &instruction), "finite bits alone cannot grant float access");
   free(ir);
}

int main(int argc, char **argv)
{
   require(argc == 2, "one authenticated bank file path");
   bank_input = fopen(argv[1], "rb");
   require(bank_input != NULL, "open bank file");
   require(word() == UINT32_C(0x50435231), "PCR1 capture-bank header");
   unsigned count = word();
   require(count == 3, "all three original c580 banks");
   for (unsigned bank = 0; bank < count; ++bank) {
      struct raw_exact_bank exact = {0};
      exact.count = 34u * 4u;
      for (unsigned reg = 0; reg < 34; ++reg) {
         exact.present[reg] = 15;
         for (unsigned component = 0; component < 4; ++component)
            exact.words[reg][component] = word();
      }
      unsigned x, y;
      unsigned selected = probe(&exact, true, false, &x, &y);
      require(x <= 100 && y <= 100 && selected <= 100, "finite pc27 dependencies");
      printf("BANK %u pc25.x<=2^%u pc25.y<=2^%u pc27.x<=2^%u\n", bank, x, y, selected);
      require(probe(&exact, true, true, &x, &y) == UINT32_MAX,
              "changed original pc8 source has no terminal certificate");
      require(probe(&exact, false, false, &x, &y) == UINT32_MAX,
              "unauthenticated coordinates have no certificate");
      exact.present[32] &= (unsigned char)~1u;
      require(probe(&exact, true, false, &x, &y) == UINT32_MAX,
              "short exact bank has no certificate");
      exact.present[32] |= 1u;
      exact.present[7] &= (unsigned char)~8u;
      require(probe(&exact, true, false, &x, &y) == UINT32_MAX,
              "unrelated missing bank lane has no certificate");
      exact.present[7] |= 8u;
      exact.count = 135;
      require(probe(&exact, true, false, &x, &y) == UINT32_MAX,
              "short exact tuple count has no certificate");
      exact.count = 136;
      exact.words[7][3] ^= 1u;
      require(probe(&exact, true, false, &x, &y) == UINT32_MAX,
              "complete but wrong bank has no certificate");
      exact.words[7][3] ^= 1u;
      exact.words[29][0] = UINT32_C(0x80000000);
      require(probe(&exact, true, false, &x, &y) == UINT32_MAX,
              "uncaptured negative zero has no certificate");
      exact.words[29][0] = 0;
      uint32_t denominator = exact.words[32][0];
      exact.words[32][0] = 0;
      require(probe(&exact, true, false, &x, &y) == UINT32_MAX,
              "zero reciprocal denominator has no certificate");
      exact.words[32][0] = denominator;
      uint32_t coefficient = exact.words[33][2];
      exact.words[33][2] = UINT32_C(0x71000000);
      require(probe(&exact, true, false, &x, &y) == UINT32_MAX,
              "overflow-capable coefficient has no certificate");
      exact.words[33][2] = coefficient;
   }
   require(fgetc(bank_input) == EOF && !ferror(bank_input), "no trailing bytes");
   require(fclose(bank_input) == 0, "close bank file");
   bound_is_not_authority();
   puts("STATUS passed");
   return 0;
}
