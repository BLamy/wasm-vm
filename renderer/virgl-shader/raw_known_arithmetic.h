/* SPDX-License-Identifier: MIT
 * Integer binary32 folding for already checked normal/zero operands. No host
 * floating environment, libm, GPU estimate or dynamic source supplies a fact. */
#ifndef WASM_VM_RAW_KNOWN_ARITHMETIC_H
#define WASM_VM_RAW_KNOWN_ARITHMETIC_H
#include <stdint.h>

static uint32_t known_jam(uint32_t value, unsigned distance)
{
   if (!distance) return value;
   if (distance >= 32) return value != 0;
   return (value >> distance) | ((value << (32 - distance)) != 0);
}

static uint32_t known_pack(uint32_t sign, int exponent, uint32_t significand)
{
   if (exponent <= 0) {
      significand = known_jam(significand, (unsigned)(1 - exponent));
      exponent = 1;
   }
   uint32_t rounded = significand >> 3, tail = significand & 7;
   if (tail > 4 || (tail == 4 && (rounded & 1))) ++rounded;
   if (rounded >= UINT32_C(0x1000000)) { rounded >>= 1; ++exponent; }
   if (exponent >= 255) return sign | UINT32_C(0x7f800000);
   if (!rounded) return sign;
   if (exponent == 1 && rounded < UINT32_C(0x800000)) exponent = 0;
   return sign | ((uint32_t)exponent << 23) | (rounded & UINT32_C(0x7fffff));
}

static uint32_t known_add(uint32_t a, uint32_t b)
{
   uint32_t ma = a & UINT32_C(0x7fffffff), mb = b & UINT32_C(0x7fffffff);
   if (!ma && !mb) return (a & b) & UINT32_C(0x80000000);
   if (!ma) return b;
   if (!mb) return a;
   if (ma < mb) { uint32_t swap = a; a = b; b = swap; }
   int ea = (int)((a >> 23) & 255), eb = (int)((b >> 23) & 255);
   uint32_t sa = ((a & UINT32_C(0x7fffff)) | UINT32_C(0x800000)) << 3;
   uint32_t sb = known_jam(((b & UINT32_C(0x7fffff)) | UINT32_C(0x800000)) << 3, (unsigned)(ea - eb));
   uint32_t result;
   if (!((a ^ b) & UINT32_C(0x80000000))) {
      result = sa + sb;
      if (result >= UINT32_C(0x8000000)) { result = known_jam(result, 1); ++ea; }
   } else {
      result = sa - sb;
      if (!result) return 0;
      for (unsigned step = 0; step < 26 && ea > 1 && result < UINT32_C(0x4000000); ++step) { result <<= 1; --ea; }
   }
   return known_pack(a & UINT32_C(0x80000000), ea, result);
}

static uint32_t known_mul(uint32_t a, uint32_t b)
{
   uint32_t sign = (a ^ b) & UINT32_C(0x80000000);
   if (!(a & UINT32_C(0x7fffffff)) || !(b & UINT32_C(0x7fffffff))) return sign;
   uint64_t product = (uint64_t)((a & UINT32_C(0x7fffff)) | UINT32_C(0x800000)) *
      ((b & UINT32_C(0x7fffff)) | UINT32_C(0x800000));
   int exponent = (int)((a >> 23) & 255) + (int)((b >> 23) & 255) - 127;
   unsigned distance = 20;
   if (product & (UINT64_C(1) << 47)) { distance = 21; ++exponent; }
   uint32_t significand = (uint32_t)(product >> distance) | ((product & ((UINT64_C(1) << distance) - 1)) != 0);
   return known_pack(sign, exponent, significand);
}
#endif
