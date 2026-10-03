/* SPDX-License-Identifier: MIT
 * Private checked IR shared by the bounded guard and owned raw-lane emitter.
 * None of these types is a caller-controlled compiler interface. */
#ifndef WASM_VM_RAW_BITS_H
#define WASM_VM_RAW_BITS_H
#include "bridge.h"
#include <stdbool.h>
#include <stdint.h>

enum file { IN, OUT, TEMP, CONST, IMM, SAMP, SVIEW, FILE_COUNT,
   /* Checked scalar/address-source tags are NEVER declaration-array indices. */
   ADDR = FILE_COUNT, INDIRECT_CONST };
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
                  RAW_UIF = 26, RAW_ELSE, RAW_ENDIF, RAW_UARL,
                  RAW_BGNLOOP, RAW_BRK, RAW_ENDLOOP, RAW_FSEQ, RAW_FSNE };
#define RAW_V2_OPCODES ((UINT64_C(1) << RAW_UADD) | (UINT64_C(1) << RAW_ISGE) | (UINT64_C(1) << RAW_USEQ) | (UINT64_C(1) << RAW_USNE) | (UINT64_C(1) << RAW_UCMP))
#define RAW_V3_OPCODES ((UINT64_C(1) << RAW_FSLT) | (UINT64_C(1) << RAW_FSGE))
#define RAW_EQUALITY_OPCODES ((UINT64_C(1) << RAW_FSEQ) | (UINT64_C(1) << RAW_FSNE))
#define RAW_V4_OPCODES ((UINT64_C(1) << RAW_ADD) | (UINT64_C(1) << RAW_MUL) | (UINT64_C(1) << RAW_MAD) | (UINT64_C(1) << RAW_TEX))
#define RAW_V5_OPCODES ((UINT64_C(1) << RAW_DIV) | (UINT64_C(1) << RAW_MAX) | (UINT64_C(1) << RAW_FRC) | (UINT64_C(1) << RAW_LRP))
#define RAW_V6_OPCODES ((UINT64_C(1) << RAW_DP3) | (UINT64_C(1) << RAW_RCP) | (UINT64_C(1) << RAW_RSQ))
#define RAW_NUMERIC_OPCODES (RAW_V4_OPCODES | RAW_V5_OPCODES | RAW_V6_OPCODES)
/* The remaining mask bit records a validated numeric modifier, not an opcode. */
#define RAW_V5_NEGATION (UINT64_C(1) << 21)
/* Separate from opcode bits: at least one checked numeric read used the bank. */
#define RAW_FINITE_BANK_USED (UINT64_C(1) << 25)
#define RAW_STRUCTURED_OPCODES ((UINT64_C(1) << RAW_UIF) | (UINT64_C(1) << RAW_ELSE) | (UINT64_C(1) << RAW_ENDIF))
#define RAW_LOOP_OPCODES ((UINT64_C(1) << RAW_BGNLOOP) | (UINT64_C(1) << RAW_BRK) | (UINT64_C(1) << RAW_ENDLOOP))
#define RAW_CONTROL_OPCODES (RAW_STRUCTURED_OPCODES | RAW_LOOP_OPCODES)
_Static_assert(RAW_FSNE < 64, "opcode mask width");
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
/* One checked counted-table certificate; lane IDs are TEMP index*4+component. */
struct loop_certificate {
   uint16_t begin, end, break_pc, tail_test, tail_if, tail_end;
   uint16_t j, a, b, header, invariant;
   uint8_t count_register, count_component;
   struct { uint16_t uarl, read; uint32_t reserved; uint64_t candidates; } access[4];
   bool checked;
   unsigned char reserved[7];
};
struct raw_ir {
   struct raw_instruction instructions[BRIDGE_MAX_INSTRUCTIONS];
   uint32_t immediates[FILE_REGISTERS][4];
   struct raw_lane temporary[TEMP_REGISTERS][4], output[FILE_REGISTERS][4];
   unsigned count;
   struct raw_lane address;
   uint64_t opcode_mask, indirect_indices; /* Union of complete, checked use-site candidate sets. */
   struct loop_certificate loop;
};
struct profile {
   bool declared[FILE_COUNT][TEMP_REGISTERS];
   unsigned components[FILE_COUNT][TEMP_REGISTERS];
   unsigned written[FILE_COUNT][TEMP_REGISTERS];
   unsigned semantic[2][8]; /* 0 attribute, 1 POSITION, 2 GENERIC, 3 COLOR */
   unsigned semantic_index[2][8];
   bool flat[2][8];
   unsigned instructions, immediates, constant_extent, current_pc;
   bool ended, started, color0_property, address_declared, address_written;
   bool syntax_only, live;
   unsigned char raw_flags;
   int stage;
   struct raw_ir *raw;
};

_Static_assert(sizeof(struct raw_ir) <= 32768, "raw IR allocation bound");
_Static_assert(sizeof(struct raw_destination) == 12, "checked destination layout");
_Static_assert(sizeof(struct raw_source) == 24, "checked source layout");
_Static_assert(sizeof(struct raw_instruction) == 112, "unchanged instruction layout");
_Static_assert(sizeof(struct raw_ir) == 26352, "bounded counted-loop IR allocation");
_Static_assert(sizeof(struct loop_certificate) == 96, "compact loop certificate");
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
