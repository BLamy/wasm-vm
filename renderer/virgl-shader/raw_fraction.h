/* SPDX-License-Identifier: MIT
 * Exact binary32 x-floor(x), rounded once to nearest-even. No host/GPU floating
 * operation participates. Every executed shift is in [1,24], normalization is
 * bounded to 23 steps. Known words supply facts, never new input authority. */
#ifndef WASM_VM_RAW_FRACTION_H
#define WASM_VM_RAW_FRACTION_H
static uint32_t raw_frc_complement(uint32_t fraction)
{
   unsigned exponent = (fraction >> 23) & 255u;
   if (exponent < 102) return UINT32_C(0x3f800000);
   uint32_t significand = (fraction & UINT32_C(0x007fffff)) | UINT32_C(0x00800000);
   if (exponent == 126) {
      /* Sterbenz-exact 1-f at the common 2^-24 lattice. */
      uint32_t remaining = UINT32_C(0x01000000) - significand;
      for (unsigned step = 0; step < 23 && remaining < UINT32_C(0x00800000); ++step) {
         remaining <<= 1; --exponent;
      }
      return (exponent << 23) | (remaining & UINT32_C(0x007fffff));
   }
   unsigned distance = 126 - exponent;
   uint32_t rounded = significand >> distance;
   uint32_t tail = significand & ((UINT32_C(1) << distance) - 1u);
   uint32_t halfway = UINT32_C(1) << (distance - 1);
   if (tail > halfway || (tail == halfway && (rounded & 1u))) ++rounded;
   uint32_t remaining = UINT32_C(0x01000000) - rounded;
   return remaining == UINT32_C(0x01000000) ? UINT32_C(0x3f800000) :
      UINT32_C(0x3f000000) | (remaining & UINT32_C(0x007fffff));
}
static uint32_t raw_frc_word(uint32_t word)
{
   unsigned exponent = (word >> 23) & 255u;
   uint32_t magnitude = word & UINT32_C(0x7fffffff);
   if (exponent == 255) return UINT32_C(0x7fc00000);
   if (!magnitude || exponent >= 150) return 0;
   uint32_t fraction = magnitude;
   if (exponent >= 127) {
      fraction = magnitude & ((UINT32_C(1) << (150 - exponent)) - 1u);
      if (!fraction) return 0;
      for (unsigned step = 0; step < 23 && fraction < UINT32_C(0x00800000); ++step) {
         fraction <<= 1; --exponent;
      }
      fraction = (exponent << 23) | (fraction & UINT32_C(0x007fffff));
   }
   return word & UINT32_C(0x80000000) ? raw_frc_complement(fraction) : fraction;
}
static const char raw_binary32_fraction[] =
   "uint raw_fraction_complement(uint fraction) {\n"
   " uint exponent = (fraction >> 23u) & 255u;\n"
   " if (exponent < 102u) { /* fraction:complement-tiny */ return 1065353216u; }\n"
   " uint significand = (fraction & 8388607u) | 8388608u;\n"
   " if (exponent == 126u) { /* fraction:complement-exact */\n"
   "  uint remaining = 16777216u - significand;\n"
   "  for (uint step = 0u; step < 23u && remaining < 8388608u; ++step) { /* fraction:complement-normalize */ remaining <<= 1u; exponent -= 1u; }\n"
   "  return (exponent << 23u) | (remaining & 8388607u);\n }\n"
   " uint distance = 126u - exponent;\n"
   " uint rounded = significand >> distance;\n"
   " uint tail = significand & ((1u << distance) - 1u), halfway = 1u << (distance - 1u);\n"
   " if (tail > halfway || (tail == halfway && (rounded & 1u) != 0u)) { /* fraction:round-up */ rounded += 1u; }\n"
   " else { /* fraction:round-keep */ }\n"
   " uint remaining = 16777216u - rounded;\n"
   " if (remaining == 16777216u) { /* fraction:round-one */ return 1065353216u; }\n"
   " /* fraction:round-below-one */ return 1056964608u | (remaining & 8388607u);\n}\n"
   "uint raw_precise_fraction(uint word) {\n"
   " uint exponent = (word >> 23u) & 255u, magnitude = word & 2147483647u;\n"
   " if (exponent == 255u) { /* fraction:special */ return 2143289344u; }\n"
   " if (magnitude == 0u || exponent >= 150u) { /* fraction:zero-integer */ return 0u; }\n"
   " uint fraction = magnitude;\n"
   " if (exponent >= 127u) { /* fraction:remove-integer */\n"
   "  fraction = magnitude & ((1u << (150u - exponent)) - 1u);\n"
   "  if (fraction == 0u) { /* fraction:exact-integer */ return 0u; }\n"
   "  for (uint step = 0u; step < 23u && fraction < 8388608u; ++step) { /* fraction:normalize */ fraction <<= 1u; exponent -= 1u; }\n"
   "  fraction = (exponent << 23u) | (fraction & 8388607u);\n"
   " } else { /* fraction:small */ }\n"
   " if ((word & 2147483648u) != 0u) { /* fraction:negative */ return raw_fraction_complement(fraction); }\n"
   " /* fraction:positive */ return fraction;\n}\n";
_Static_assert(sizeof(raw_binary32_fraction) <= 3072, "bounded precise fraction helper");
#endif
