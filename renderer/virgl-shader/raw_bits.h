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
                  RAW_UADD, RAW_ISGE, RAW_USEQ, RAW_USNE, RAW_UCMP };
#define RAW_V2_OPCODES ((1u << RAW_UADD) | (1u << RAW_ISGE) | (1u << RAW_USEQ) | (1u << RAW_USNE) | (1u << RAW_UCMP))
/* A checked source needs no declaration range, destination mask or parser flag.
 * Three 24-byte sources fit the former two 36-byte parser-register slots. */
struct raw_source { enum file file; unsigned index, swizzle[4]; };
struct raw_instruction { enum raw_opcode opcode; struct reg dst; struct raw_source src[3]; };
/* origin is zero for raw data, or 1 + input register * 4 + input lane.
 * A surviving MOV origin is emitted directly through the float IO ABI. */
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
   int stage;
   struct raw_ir *raw;
};

_Static_assert(sizeof(struct raw_ir) <= 32768, "raw IR allocation bound");
_Static_assert(sizeof(struct raw_source) == 24, "checked source layout");
_Static_assert(sizeof(struct raw_instruction) == 112, "unchanged instruction layout");
_Static_assert(sizeof(struct raw_ir) == 26232, "unchanged raw IR allocation");
_Static_assert(sizeof(struct profile) <= 8192, "profile stack bound");

/* Called only after the complete instruction has passed operand validation. */
void raw_record(struct raw_ir *ir, const struct raw_instruction *instruction);
bool raw_outputs_safe(const struct profile *profile);
/* Returns one owned <=64KiB NUL-terminated shader, or NULL on allocation/bound
 * failure. const_count preserves the pinned declaration extent (0..47). */
char *raw_emit(const struct profile *profile, unsigned const_count);
#endif
