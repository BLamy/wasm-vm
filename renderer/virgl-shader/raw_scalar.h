/* SPDX-License-Identifier: MIT
 * Component-wise scalar operations on encodings with checked numeric access.
 * These helpers grant no authority to private integer words. For finite inputs,
 * TRUNC preserves the source zero sign; SSG returns canonical positive zero. */
#ifndef WASM_VM_RAW_SCALAR_H
#define WASM_VM_RAW_SCALAR_H
static uint32_t raw_trunc_word(uint32_t word)
{
   unsigned exponent = (word >> 23) & 255u;
   if (exponent < 127) return word & UINT32_C(0x80000000);
   if (exponent >= 150) return word;
   return word & ~((UINT32_C(1) << (150 - exponent)) - 1u);
}
static uint32_t raw_ssg_word(uint32_t word)
{
   return (word & UINT32_C(0x7fffffff)) ?
      (word & UINT32_C(0x80000000)) | UINT32_C(0x3f800000) : 0u;
}
static const char raw_binary32_trunc[] =
   "uint raw_numeric_trunc(uint word) {\n"
   " uint exponent = (word >> 23u) & 255u;\n"
   " if (exponent < 127u) return word & 2147483648u;\n"
   " if (exponent >= 150u) return word;\n"
   " return word & ~((1u << (150u - exponent)) - 1u);\n}\n";
static const char raw_binary32_ssg[] =
   "uint raw_numeric_ssg(uint word) {\n"
   " return (word & 2147483647u) != 0u ? (word & 2147483648u) | 1065353216u : 0u;\n}\n";
_Static_assert(sizeof(raw_binary32_trunc) + sizeof(raw_binary32_ssg) <= 1024,
               "bounded numeric scalar helpers");
#endif
