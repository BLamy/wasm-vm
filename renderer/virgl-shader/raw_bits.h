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
                  RAW_DIV, RAW_MAX, RAW_FRC, RAW_LRP };
#define RAW_V2_OPCODES ((1u << RAW_UADD) | (1u << RAW_ISGE) | (1u << RAW_USEQ) | (1u << RAW_USNE) | (1u << RAW_UCMP))
#define RAW_V3_OPCODES ((1u << RAW_FSLT) | (1u << RAW_FSGE))
#define RAW_V4_OPCODES ((1u << RAW_ADD) | (1u << RAW_MUL) | (1u << RAW_MAD) | (1u << RAW_TEX))
#define RAW_V5_OPCODES ((1u << RAW_DIV) | (1u << RAW_MAX) | (1u << RAW_FRC) | (1u << RAW_LRP))
#define RAW_NUMERIC_OPCODES (RAW_V4_OPCODES | RAW_V5_OPCODES)
/* The remaining mask bit records a validated numeric modifier, not an opcode. */
#define RAW_V5_NEGATION (1u << 21)
enum { RAW_FLOAT_SHADOW = 33, RAW_FLOAT_DECODE = 34, RAW_MIXED = 1,
       RAW_NEGATE_SOURCE0 = 2, RAW_NEGATE_SOURCES = 14 };
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
/* origin is zero for raw data, 1 + input register * 4 + input lane,
 * or RAW_FLOAT_SHADOW for an actual ordinary computed/copied float. */
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
   bool ended, started, color0_property, mixed_candidate;
   int stage;
   struct raw_ir *raw;
};

_Static_assert(sizeof(struct raw_ir) <= 32768, "raw IR allocation bound");
_Static_assert(sizeof(struct raw_destination) == 12, "checked destination layout");
_Static_assert(sizeof(struct raw_source) == 24, "checked source layout");
_Static_assert(sizeof(struct raw_instruction) == 112, "unchanged instruction layout");
_Static_assert(sizeof(struct raw_ir) == 26232, "unchanged raw IR allocation");
_Static_assert(sizeof(struct profile) <= 8192, "profile stack bound");

/* Called after operand validation; false means a numeric use lacks authority.
 * A rejection publishes neither facts nor an instruction. */
bool raw_record(struct raw_ir *ir, const struct raw_instruction *instruction);
bool raw_outputs_safe(const struct profile *profile);
/* Returns one owned <=64KiB NUL-terminated shader, or NULL on allocation/bound
 * failure. const_count preserves the pinned declaration extent (0..47). */
char *raw_emit(const struct profile *profile, unsigned const_count);
#endif
