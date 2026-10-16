/* SPDX-License-Identifier: MIT
 * Independent ideal-center first-power oracle for captured original banks.
 * A physical readback must separately establish interpolated values. */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int ok, const char *reason)
{
   if (!ok) { fprintf(stderr, "original-92cb-power-domain: %s\n", reason); exit(1); }
}

static uint32_t word(FILE *input)
{
   unsigned char data[4];
   require(fread(data, 1, 4, input) == 4, "complete original bank word");
   return (uint32_t)data[0] | (uint32_t)data[1] << 8 |
      (uint32_t)data[2] << 16 | (uint32_t)data[3] << 24;
}

static double finite_word(uint32_t bits)
{
   float value;
   memcpy(&value, &bits, sizeof(value));
   require(isfinite(value), "finite original geometric/fragment word");
   return (double)value;
}

struct axis {
   double first, last, coefficient, center, minimum, maximum;
   unsigned covered, branch;
};

static struct axis measure(const uint32_t *vertex, const uint32_t *fragment, unsigned axis)
{
   double scale = axis ? 384.0 : 512.0;
   double shift = finite_word(vertex[8 + axis]);
   double diagonal = finite_word(vertex[axis ? 5 : 0]);
   double cross = finite_word(vertex[axis ? 1 : 4]);
   struct axis result = {
      .first = scale * (shift + 1.0),
      .last = scale * (shift + diagonal + 1.0),
      .coefficient = finite_word(fragment[16 + axis]),
      .center = finite_word(fragment[axis]),
      .minimum = INFINITY
   };
   require(cross == 0.0 && result.last > result.first &&
           result.coefficient > 0.0 && result.coefficient <= 2048.0,
           "finite positive original axis geometry");
   unsigned dimension = axis ? 768u : 1024u;
   for (unsigned pixel = 0; pixel < dimension; ++pixel) {
      double location = (double)pixel + 0.5;
      if (location < result.first || location > result.last) continue;
      double coordinate = result.coefficient *
         ((location - result.first) / (result.last - result.first));
      double delta = coordinate - result.center, base = fabs(delta);
      require(isfinite(base) && base > 0.49 && base <= 2048.0,
              "ideal original first-power base envelope");
      result.covered++;
      if (delta < 0.0) result.branch++;
      if (base < result.minimum) result.minimum = base;
      if (base > result.maximum) result.maximum = base;
   }
   require(result.covered > 0, "covered original pixel centers");
   return result;
}

int main(int argc, char **argv)
{
   require(argc == 2, "authenticated geometry argument");
   FILE *input = fopen(argv[1], "rb");
   require(input != NULL, "open original geometry");
   char magic[4];
   require(fread(magic, 1, 4, input) == 4 && !memcmp(magic, "G921", 4) &&
           word(input) == 3, "three original banks");
   static const uint32_t quad[16] = {
      0, 0, 0, 0, 0, UINT32_C(0x3f800000), 0, UINT32_C(0x3f800000),
      UINT32_C(0x3f800000), 0, UINT32_C(0x3f800000), 0,
      UINT32_C(0x3f800000), UINT32_C(0x3f800000),
      UINT32_C(0x3f800000), UINT32_C(0x3f800000)
   };
   for (unsigned index = 0; index < 16; ++index)
      require(word(input) == quad[index], "exact original four-vertex strip");
   for (unsigned bank = 0; bank < 3; ++bank) {
      uint32_t vertex[16], fragment[148];
      for (unsigned index = 0; index < 16; ++index) vertex[index] = word(input);
      for (unsigned index = 0; index < 148; ++index) fragment[index] = word(input);
      require(fragment[0] == UINT32_C(0x40800000) &&
              fragment[1] == UINT32_C(0x40800000) &&
              fragment[24] == UINT32_C(0x40000000),
              "original center and exact-square exponent");
      struct axis x = measure(vertex, fragment, 0);
      struct axis y = measure(vertex, fragment, 1);
      printf("BANK %u COVERED %u ACTIVE %u X_MIN_MICRO %u Y_MIN_MICRO %u "
             "X_MAX_MICRO %u Y_MAX_MICRO %u\n", bank,
             x.covered * y.covered, x.branch * y.branch,
             (unsigned)(x.minimum * 1000000.0),
             (unsigned)(y.minimum * 1000000.0),
             (unsigned)(x.maximum * 1000000.0),
             (unsigned)(y.maximum * 1000000.0));
   }
   require(fgetc(input) == EOF && !ferror(input), "no trailing geometry bytes");
   require(fclose(input) == 0, "geometry close");
   puts("STATUS passed; physical readback and draw enforcement remain separate");
   return 0;
}
