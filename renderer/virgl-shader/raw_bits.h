/* SPDX-License-Identifier: MIT
 * Private checked IR shared by the bounded guard and owned raw-lane emitter.
 * None of these types is a caller-controlled compiler interface. */
#ifndef WASM_VM_RAW_BITS_H
#define WASM_VM_RAW_BITS_H
#include "bridge.h"
#include <stdbool.h>
#include <stdint.h>

enum file { IN, OUT, TEMP, CONST, IMM, SAMP, SVIEW, FILE_COUNT };
enum operand_kind { DECLARATION, DESTINATION, SOURCE };
enum { FILE_REGISTERS = 8, CONST_REGISTERS = 46, TEMP_REGISTERS = 118 };
struct reg { enum file file; unsigned index, last, mask, swizzle[4]; bool explicit_mask; };
enum raw_opcode { RAW_MOV, RAW_AND, RAW_OR, RAW_NOT, RAW_SHL, RAW_USHR,
                  RAW_UADD, RAW_ISGE, RAW_USEQ, RAW_USNE, RAW_UCMP,
                  RAW_FSLT, RAW_FSGE, RAW_ADD, RAW_MUL, RAW_MAD, RAW_TEX,
                  RAW_DIV, RAW_MAX, RAW_FRC, RAW_LRP,
                  /* Bit21 is the validated v5 negation feature, not an opcode. */
                  RAW_DP3 = 22, RAW_RCP, RAW_RSQ,
                  /* Bit25 is the finite-bank feature, not an opcode. */
                  RAW_UIF = 26, RAW_ELSE, RAW_ENDIF };
#define RAW_V2_OPCODES ((1u << RAW_UADD) | (1u << RAW_ISGE) | (1u << RAW_USEQ) | (1u << RAW_USNE) | (1u << RAW_UCMP))
#define RAW_V3_OPCODES ((1u << RAW_FSLT) | (1u << RAW_FSGE))
#define RAW_V4_OPCODES ((1u << RAW_ADD) | (1u << RAW_MUL) | (1u << RAW_MAD) | (1u << RAW_TEX))
#define RAW_V5_OPCODES ((1u << RAW_DIV) | (1u << RAW_MAX) | (1u << RAW_FRC) | (1u << RAW_LRP))
#define RAW_V6_OPCODES ((1u << RAW_DP3) | (1u << RAW_RCP) | (1u << RAW_RSQ))
#define RAW_NUMERIC_OPCODES (RAW_V4_OPCODES | RAW_V5_OPCODES | RAW_V6_OPCODES)
/* The remaining mask bit records a validated numeric modifier, not an opcode. */
#define RAW_V5_NEGATION (1u << 21)
/* Separate from opcode bits: at least one checked numeric read used the bank. */
#define RAW_FINITE_BANK_USED (1u << 25)
#define RAW_STRUCTURED_OPCODES ((1u << RAW_UIF) | (1u << RAW_ELSE) | (1u << RAW_ENDIF))
enum { RAW_FLOAT_SHADOW = 33, RAW_FLOAT_DECODE = 34, RAW_FLOAT_CONDITIONAL = 35,
       RAW_ACCESS_MASK = 63, RAW_OUTPUT = 64, RAW_BANK_DEPENDENCY = 128,
       RAW_MIXED = 1, RAW_NEGATE_SOURCE0 = 2, RAW_NEGATE_SOURCES = 14,
       RAW_CONDITIONAL = 16, RAW_STRUCTURED = 32 };
/* Checked operands retain only validated use-site fields. The compact
 * destination leaves room for float authority without growing the IR. */
struct raw_source { enum file file; unsigned index, swizzle[4]; };
struct raw_destination { enum file file; unsigned index, mask; };
struct raw_instruction {
   enum raw_opcode opcode;
   struct raw_destination dst;
   struct raw_source src[3];
   uint32_t float_modes[3]; /* Four checked 8-bit lane modes per source. */
   unsigned float_mask, sampler, flags;
};
/* One checked byte separates numeric access, ordinary output permission and
 * finite-bank dependence. Conditional access is never an IN shortcut or an
 * ordinary output proof; a numeric-only selected shadow retains that limit. */
struct raw_lane { uint32_t zero, one; unsigned origin; };
struct raw_ir {
   struct raw_instruction instructions[BRIDGE_MAX_INSTRUCTIONS];
   uint32_t immediates[FILE_REGISTERS][4];
   struct raw_lane temporary[TEMP_REGISTERS][4], output[FILE_REGISTERS][4];
   unsigned count, opcode_mask;
};
struct profile {
   bool declared[FILE_COUNT][TEMP_REGISTERS];
   unsigned components[FILE_COUNT][TEMP_REGISTERS];
   unsigned written[FILE_COUNT][TEMP_REGISTERS];
   unsigned semantic[2][8]; /* 0 attribute, 1 POSITION, 2 GENERIC, 3 COLOR */
   unsigned semantic_index[2][8];
   bool flat[2][8];
   unsigned instructions, immediates, constant_extent;
   bool ended, started, color0_property;
   unsigned char raw_flags;
   int stage;
   struct raw_ir *raw;
};

_Static_assert(sizeof(struct raw_ir) <= 32768, "raw IR allocation bound");
_Static_assert(sizeof(struct raw_destination) == 12, "checked destination layout");
_Static_assert(sizeof(struct raw_source) == 24, "checked source layout");
_Static_assert(sizeof(struct raw_instruction) == 112, "unchanged instruction layout");
_Static_assert(sizeof(struct raw_ir) == 26232, "unchanged raw IR allocation");
_Static_assert(sizeof(struct profile) <= 8192, "profile stack bound");

/* Shared post-swizzle lane selection for initialization and float authority. */
unsigned raw_consumed_mask(enum raw_opcode opcode, unsigned destination_mask);
/* Called after operand validation; false means a numeric use lacks authority.
 * A rejection publishes neither facts nor an instruction. */
bool raw_record(struct raw_ir *ir, const struct raw_instruction *instruction);
bool raw_outputs_safe(const struct profile *profile);
/* Only initialized predecessors are joined; structured writes have already
 * materialized each authorized value in its destination's physical shadow. */
struct raw_lane raw_join(struct raw_lane yes, struct raw_lane no);
/* Returns one owned <=64KiB NUL-terminated shader, or NULL on allocation/bound
 * failure. const_count preserves the pinned declaration extent (0..47). */
char *raw_emit(const struct profile *profile, unsigned const_count);
#endif
