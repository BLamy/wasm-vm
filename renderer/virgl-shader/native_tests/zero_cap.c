/* SPDX-License-Identifier: MIT
 * Exact c580 pc28/29 continuation of the independently captured prefix. */
#define main coordinate_prefix_fixture_main
#include "coordinate_prefix.c"
#undef main

static struct raw_ir *new_ir(const struct raw_exact_bank *bank, bool coordinates, bool changed_prefix)
{
   struct raw_ir *ir = calloc(1, sizeof(*ir));
   require(ir != NULL, "zero-cap IR allocation");
   ir->exact = bank;
   if (coordinates) ir->opcode_mask = RAW_FRAGMENT_COORDINATES_USED;
   replay(ir, changed_prefix);
   require(ir->count == 28, "literal prefix length");
   /* The real whole-text pass has RAW_STRUCTURED from the following UIF.
    * Replay every captured slot with that flag so finite facts must survive
    * physical float-shadow materialization before pc28 is reached. */
   struct raw_ir *structured = calloc(1, sizeof(*structured));
   require(structured != NULL, "structured IR allocation");
   structured->exact = bank;
   structured->opcode_mask = coordinates ? RAW_FRAGMENT_COORDINATES_USED : 0;
   memcpy(structured->immediates, ir->immediates, sizeof(ir->immediates));
   for (unsigned pc = 0; pc < 28; ++pc) {
      struct raw_instruction instruction = ir->instructions[pc];
      instruction.flags |= RAW_STRUCTURED;
      require(raw_record(structured, &instruction), "structured captured prefix accepted");
   }
   free(ir);
   return structured;
}

static void record_cap(struct raw_ir *ir, unsigned flags, unsigned destination,
                       unsigned mask, unsigned value_index, unsigned cap_index)
{
   struct raw_instruction instruction = {
      .opcode = RAW_MIN, .dst = {.file = TEMP, .index = destination, .mask = mask},
      .src = {S(TEMP, value_index, "xxxx"), S(CONST, cap_index, "xxxx")},
      .flags = RAW_MIXED | RAW_STRUCTURED | RAW_CONDITIONAL |
               RAW_KNOWN_RETRY | RAW_BRANCH_RETRY | flags
   };
   require(raw_record(ir, &instruction), "numeric zero-cap MIN accepted");
}

static bool record_positive_test(struct raw_ir *ir, unsigned flags, unsigned source_index,
                                 const char *swizzle)
{
   struct raw_instruction instruction = {
      .opcode = RAW_FSLT, .dst = {.file = TEMP, .index = 45, .mask = 1},
      .src = {S(IMM, 0, "zzzz"), S(TEMP, source_index, swizzle)},
      .flags = RAW_MIXED | RAW_STRUCTURED | RAW_CONDITIONAL |
               RAW_KNOWN_RETRY | RAW_BRANCH_RETRY | flags
   };
   require(raw_record(ir, &instruction), "ordered positive test accepted");
   struct raw_source predicate = S(TEMP, 45, "xxxx");
   int truth = raw_uif_truth(ir, &predicate);
   if (truth == 0)
      require(ir->temporary[45][0].zero == UINT32_MAX && ir->temporary[45][0].one == 0,
              "false branch is a materialized raw zero mask");
   return truth == 0;
}

static void good_case(const struct raw_exact_bank *bank, bool minus_zero)
{
   struct raw_ir *ir = new_ir(bank, true, false);
   require(raw_finite_exp(ir->temporary[43][0]) == 52, "finite pc27 input");
   record_cap(ir, minus_zero ? RAW_NEGATE_SOURCE0 << 1 : 0, 44, 1, 43, 29);
   require((ir->temporary[44][0].origin & (UINT32_C(1) << 24)) != 0,
           "owned result version is nonpositive");
   require((ir->temporary[44][0].zero | ir->temporary[44][0].one) != UINT32_MAX,
           "dynamic MIN retains its ordinary winner bytes");
   require(record_positive_test(ir, 0, 44, "xxxx"), "ordered positive arm is dead");
   printf("CAP sign=%s pc27<=2^%u MIN<=0 FSLT=0 UIF=false\n",
          minus_zero ? "-0" : "+0", raw_finite_exp(ir->temporary[43][0]));
   free(ir);
}

static void negative_cases(const struct raw_exact_bank *bank)
{
   struct raw_ir *ir = new_ir(bank, true, true);
   record_cap(ir, 0, 44, 1, 43, 29);
   require(!record_positive_test(ir, 0, 44, "xxxx"), "mutated prefix has no branch proof");
   free(ir);

   ir = new_ir(bank, false, false);
   record_cap(ir, 0, 44, 1, 43, 29);
   require(!record_positive_test(ir, 0, 44, "xxxx"), "unauthenticated coordinates have no proof");
   free(ir);

   ir = new_ir(bank, true, false);
   ir->temporary[43][0] = (struct raw_lane){.zero = ~UINT32_C(0x7fc00000),
      .one = UINT32_C(0x7fc00000), .origin = RAW_FLOAT_SHADOW | RAW_OUTPUT};
   record_cap(ir, 0, 44, 1, 43, 29);
   require(!record_positive_test(ir, 0, 44, "xxxx"), "NaN-capable source has no proof");
   free(ir);

   ir = new_ir(bank, true, false);
   record_cap(ir, RAW_NEGATE_SOURCE0, 44, 1, 43, 29);
   require(!record_positive_test(ir, 0, 44, "xxxx"), "sign-changed dynamic source has no proof");
   free(ir);

   ir = new_ir(bank, true, false);
   record_cap(ir, 0, 44, 1, 41, 29);
   require(!record_positive_test(ir, 0, 44, "xxxx"), "changed finite source has no proof");
   free(ir);

   ir = new_ir(bank, true, false);
   record_cap(ir, 0, 44, 1, 43, 28);
   require(!record_positive_test(ir, 0, 44, "xxxx"), "other exact bank operand has no proof");
   free(ir);

   ir = new_ir(bank, true, false);
   record_cap(ir, 0, 44, 2, 43, 29);
   require(!record_positive_test(ir, 0, 44, "xxxx"), "changed destination mask has no proof");
   free(ir);

   ir = new_ir(bank, true, false);
   record_cap(ir, 0, 44, 1, 43, 29);
   require(!record_positive_test(ir, 0, 44, "yyyy"), "changed swizzle has no proof");
   free(ir);

   ir = new_ir(bank, true, false);
   record_cap(ir, 0, 44, 1, 43, 29);
   require(!record_positive_test(ir, RAW_NEGATE_SOURCE0 << 1, 44, "xxxx"),
           "sign-changing comparison has no proof");
   free(ir);

   ir = new_ir(bank, true, false);
   record_cap(ir, 0, 44, 1, 43, 29);
   struct raw_instruction overwrite = {
      .opcode = RAW_MOV, .dst = {.file = TEMP, .index = 44, .mask = 1},
      .src = {S(IN, 0, "xxxx")}
   };
   require(raw_record(ir, &overwrite), "overwriting MIN result accepted");
   require(!record_positive_test(ir, 0, 44, "xxxx"), "overwritten version has no proof");
   free(ir);

   ir = new_ir(bank, true, false);
   record_cap(ir, 0, 44, 1, 43, 29);
   struct raw_lane joined = raw_join(ir->temporary[44][0], (struct raw_lane){0});
   require(!(joined.origin & (UINT32_C(1) << 24)), "unknown join loses sign fact");
   ir->temporary[44][0] = joined;
   require(!record_positive_test(ir, 0, 44, "xxxx"), "joined version has no proof");
   free(ir);

   struct raw_exact_bank changed_cap = *bank;
   ir = new_ir(&changed_cap, true, false);
   changed_cap.words[29][0] = UINT32_C(0x3f800000);
   record_cap(ir, 0, 44, 1, 43, 29);
   require(!record_positive_test(ir, 0, 44, "xxxx"), "positive bank cap has no proof");
   free(ir);
}

int main(int argc, char **argv)
{
   require(argc == 2, "one independently captured bank file");
   bank_input = fopen(argv[1], "rb");
   require(bank_input != NULL, "open bank file");
   require(word() == UINT32_C(0x50435231) && word() == 3, "three complete captured banks");
   for (unsigned choice = 0; choice < 3; ++choice) {
      struct raw_exact_bank bank = {.count = 136};
      for (unsigned reg = 0; reg < 34; ++reg) {
         bank.present[reg] = 15;
         for (unsigned lane = 0; lane < 4; ++lane) bank.words[reg][lane] = word();
      }
      good_case(&bank, false);
      good_case(&bank, true);
      negative_cases(&bank);
      bank.words[7][3] ^= 1;
      struct raw_ir *wrong = new_ir(&bank, true, false);
      record_cap(wrong, 0, 44, 1, 43, 29);
      require(!record_positive_test(wrong, 0, 44, "xxxx"), "wrong bank has no proof");
      free(wrong);
      bank.words[7][3] ^= 1;
      bank.count = 135;
      struct raw_ir *short_bank = new_ir(&bank, true, false);
      record_cap(short_bank, 0, 44, 1, 43, 29);
      require(!record_positive_test(short_bank, 0, 44, "xxxx"), "short bank has no proof");
      free(short_bank);
   }
   require(fgetc(bank_input) == EOF && !ferror(bank_input), "no trailing bank data");
   require(fclose(bank_input) == 0, "close bank file");
   puts("STATUS passed");
   return 0;
}
