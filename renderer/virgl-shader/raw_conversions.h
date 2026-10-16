/* SPDX-License-Identifier: MIT
 * Signed32 <-> binary32 through unsigned words. No signed overflow or undefined
 * floating cast. F2I callers prove the TGSI domain before evaluating a helper. */
#ifndef WASM_VM_RAW_CONVERSIONS_H
#define WASM_VM_RAW_CONVERSIONS_H
static uint32_t raw_i2f_word(uint32_t word)
{
   uint32_t sign = word & UINT32_C(0x80000000);
   uint32_t magnitude = sign ? 0u - word : word;
   if (!magnitude) return 0;
   unsigned exponent = 0;
   for (uint32_t rest = magnitude; rest > 1; rest >>= 1) ++exponent;
   uint32_t significand;
   if (exponent <= 23) significand = magnitude << (23 - exponent);
   else {
      unsigned distance = exponent - 23;
      significand = magnitude >> distance;
      uint32_t tail = magnitude & ((UINT32_C(1) << distance) - 1);
      uint32_t half = UINT32_C(1) << (distance - 1);
      if (tail > half || (tail == half && (significand & 1))) ++significand;
      if (significand == UINT32_C(0x1000000)) { significand >>= 1; ++exponent; }
   }
   return sign | ((exponent + 127u) << 23) | (significand & UINT32_C(0x7fffff));
}
static bool raw_f2i_range_proved(uint32_t zero, uint32_t one)
{
   uint32_t upper = ~zero & UINT32_C(0x7fffffff);
   return upper < UINT32_C(0x4f000000) ||
      ((one & UINT32_C(0x80000000)) && upper == UINT32_C(0x4f000000));
}
static uint32_t raw_f2i_word(uint32_t word)
{
   unsigned exponent = (word >> 23) & 255u;
   if (exponent < 127) return 0;
   uint32_t significand = (word & UINT32_C(0x7fffff)) | UINT32_C(0x800000);
   uint32_t magnitude = exponent <= 150 ? significand >> (150 - exponent) : significand << (exponent - 150);
   return word & UINT32_C(0x80000000) ? 0u - magnitude : magnitude;
}
static const char raw_binary32_i2f[] =
   "uint raw_signed_i2f(uint word) {\n"
   " uint sign = word & 2147483648u, magnitude = sign != 0u ? 0u - word : word;\n"
   " if (magnitude == 0u) return 0u;\n"
   " uint exponent = 0u, rest = magnitude;\n"
   " if (rest >= 65536u) { rest >>= 16u; exponent += 16u; }\n"
   " if (rest >= 256u) { rest >>= 8u; exponent += 8u; }\n"
   " if (rest >= 16u) { rest >>= 4u; exponent += 4u; }\n"
   " if (rest >= 4u) { rest >>= 2u; exponent += 2u; }\n"
   " if (rest >= 2u) exponent += 1u;\n"
   " uint significand;\n"
   " if (exponent <= 23u) significand = magnitude << (23u - exponent);\n"
   " else {\n"
   "  uint distance = exponent - 23u; significand = magnitude >> distance;\n"
   "  uint tail = magnitude & ((1u << distance) - 1u), midpoint = 1u << (distance - 1u);\n"
   "  if (tail > midpoint || (tail == midpoint && (significand & 1u) != 0u)) significand += 1u;\n"
   "  if (significand == 16777216u) { significand >>= 1u; exponent += 1u; }\n"
   " }\n"
   " return sign | ((exponent + 127u) << 23u) | (significand & 8388607u);\n}\n";
static const char raw_binary32_f2i[] =
   "uint raw_signed_f2i(uint word) {\n"
   " uint exponent = (word >> 23u) & 255u;\n"
   " if (exponent < 127u) return 0u;\n"
   " uint significand = (word & 8388607u) | 8388608u;\n"
   " uint magnitude = exponent <= 150u ? significand >> (150u - exponent) : significand << (exponent - 150u);\n"
   " return (word & 2147483648u) != 0u ? 0u - magnitude : magnitude;\n}\n";
_Static_assert(sizeof(raw_binary32_i2f) + sizeof(raw_binary32_f2i) <= 4096,
               "bounded signed conversion helpers");
#endif
