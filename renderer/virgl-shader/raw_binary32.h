/* SPDX-License-Identifier: MIT
 * ESSL300 binary32 arithmetic, evaluated only by the GPU. Every integer is
 * highp/32-bit; every executed shift is in [0,31]. The three low significand
 * bits retain guard/round/sticky information until the one rounding point.
 * Markers bind the independent GPU branch-counter instrumentation. */
#ifndef WASM_VM_RAW_BINARY32_H
#define WASM_VM_RAW_BINARY32_H
static const char raw_binary32_common[] =
   "uint raw_exact_jam(uint value, uint distance) {\n"
   " if (distance == 0u) { /* exact:jam-zero */ return value; }\n"
   " if (distance < 32u) { /* exact:jam-short */ return (value >> distance) | uint((value << (32u - distance)) != 0u); }\n"
   " /* exact:jam-wide */ return uint(value != 0u);\n}\n"
   "uint raw_exact_pack(uint sign, int exponent, uint significand) {\n"
   " if (exponent <= 0) { /* exact:underflow */ significand = raw_exact_jam(significand, uint(1 - exponent)); exponent = 1; }\n"
   " uint rounded = significand >> 3u, tail = significand & 7u;\n"
   " if (tail > 4u || (tail == 4u && (rounded & 1u) != 0u)) { /* exact:round-up */ rounded += 1u; }\n"
   " else { /* exact:round-down */ }\n"
   " if (rounded >= 16777216u) { /* exact:round-carry */ rounded >>= 1u; exponent += 1; }\n"
   " if (exponent >= 255) { /* exact:overflow */ return sign | 2139095040u; }\n"
   " if (rounded == 0u) { /* exact:rounded-zero */ return sign; }\n"
   " if (exponent == 1 && rounded < 8388608u) { /* exact:subnormal */ exponent = 0; }\n"
   " /* exact:packed */ return sign | (uint(exponent) << 23u) | (rounded & 8388607u);\n}\n";
static const char raw_binary32_add[] =
   "uint raw_precise_add(uint a, uint b) {\n"
   " uint ma = a & 2147483647u, mb = b & 2147483647u;\n"
   " if (ma > 2139095040u || mb > 2139095040u) { /* exact:add-nan */ return 2143289344u; }\n"
   " if (ma == 2139095040u || mb == 2139095040u) {\n"
   "  if (ma == mb && ((a ^ b) & 2147483648u) != 0u) { /* exact:add-invalid */ return 2143289344u; }\n"
   "  /* exact:add-infinity */ return ma == 2139095040u ? a : b;\n }\n"
   " if (ma == 0u && mb == 0u) { /* exact:add-zeros */ return (a & b) & 2147483648u; }\n"
   " if (ma == 0u) { /* exact:add-zero-a */ return b; }\n"
   " if (mb == 0u) { /* exact:add-zero-b */ return a; }\n"
   " if (ma < mb) { /* exact:add-swap */ uint swap = a; a = b; b = swap; }\n"
   " int ea = int((a >> 23u) & 255u), eb = int((b >> 23u) & 255u);\n"
   " uint sa = a & 8388607u, sb = b & 8388607u, sign = a & 2147483648u;\n"
   " if (ea == 0) { /* exact:add-a-subnormal */ ea = 1; } else { /* exact:add-a-normal */ sa |= 8388608u; }\n"
   " if (eb == 0) { /* exact:add-b-subnormal */ eb = 1; } else { /* exact:add-b-normal */ sb |= 8388608u; }\n"
   " sa <<= 3u; sb = raw_exact_jam(sb << 3u, uint(ea - eb));\n"
   " uint result;\n"
   " if (((a ^ b) & 2147483648u) == 0u) {\n"
   "  /* exact:add-same-sign */ result = sa + sb;\n"
   "  if (result >= 134217728u) { /* exact:add-carry */ result = raw_exact_jam(result, 1u); ea += 1; }\n"
   " } else {\n"
   "  /* exact:add-subtract */ result = sa - sb;\n"
   "  if (result == 0u) { /* exact:add-cancel */ return 0u; }\n"
   "  for (int step = 0; step < 26 && ea > 1 && result < 67108864u; ++step) { /* exact:add-normalize */ result <<= 1u; ea -= 1; }\n"
   " }\n"
   " return raw_exact_pack(sign, ea, result);\n}\n";
static const char raw_binary32_mul[] =
   "uint raw_precise_mul(uint a, uint b) {\n"
   " uint ma = a & 2147483647u, mb = b & 2147483647u, sign = (a ^ b) & 2147483648u;\n"
   " if (ma > 2139095040u || mb > 2139095040u) { /* exact:mul-nan */ return 2143289344u; }\n"
   " if (ma == 2139095040u || mb == 2139095040u) {\n"
   "  if (ma == 0u || mb == 0u) { /* exact:mul-invalid */ return 2143289344u; }\n"
   "  /* exact:mul-infinity */ return sign | 2139095040u;\n }\n"
   " if (ma == 0u || mb == 0u) { /* exact:mul-zero */ return sign; }\n"
   " int ea = int((a >> 23u) & 255u), eb = int((b >> 23u) & 255u);\n"
   " uint sa = a & 8388607u, sb = b & 8388607u;\n"
   " if (ea == 0) { /* exact:mul-a-subnormal */ ea = 1; } else { /* exact:mul-a-normal */ sa |= 8388608u; }\n"
   " if (eb == 0) { /* exact:mul-b-subnormal */ eb = 1; } else { /* exact:mul-b-normal */ sb |= 8388608u; }\n"
   " for (int step = 0; step < 23 && sa < 8388608u; ++step) { /* exact:mul-normalize-a */ sa <<= 1u; ea -= 1; }\n"
   " for (int step = 0; step < 23 && sb < 8388608u; ++step) { /* exact:mul-normalize-b */ sb <<= 1u; eb -= 1; }\n"
   " uint a0 = sa & 65535u, a1 = sa >> 16u, b0 = sb & 65535u, b1 = sb >> 16u;\n"
   " uint bottom = a0 * b0;\n"
   " uint middle = a0 * b1 + a1 * b0 + (bottom >> 16u);\n"
   " uint high = a1 * b1 + (middle >> 16u), low = (middle << 16u) | (bottom & 65535u);\n"
   " int exponent = ea + eb - 127; uint distance = 20u;\n"
   " if ((high & 32768u) != 0u) { /* exact:mul-high */ distance = 21u; exponent += 1; }\n"
   " else { /* exact:mul-low */ }\n"
   " uint significand = (high << (32u - distance)) | (low >> distance) | uint((low << (32u - distance)) != 0u);\n"
   " return raw_exact_pack(sign, exponent, significand);\n}\n";
_Static_assert(sizeof(raw_binary32_common) + sizeof(raw_binary32_add) + sizeof(raw_binary32_mul) <= 8192,
               "bounded GPU binary32 helpers");
#endif
