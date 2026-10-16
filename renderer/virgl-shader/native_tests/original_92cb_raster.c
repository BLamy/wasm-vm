/* SPDX-License-Identifier: MIT
 * Independent single-sample center oracle for authenticated original banks.
 * This consumes the prior geometry artifact; it grants no shader authority. */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int ok, const char *why)
{
   if (!ok) { fprintf(stderr, "original-92cb-raster: %s\n", why); exit(1); }
}

static uint32_t word(FILE *input)
{
   unsigned char bytes[4];
   require(fread(bytes, 1, 4, input) == 4, "complete little-endian word");
   return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 |
      (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}

static double number(uint32_t bits)
{
   float value;
   memcpy(&value, &bits, sizeof(value));
   require(isfinite(value), "finite original vertex/bank word");
   return (double)value;
}

int main(int argc, char **argv)
{
   require(argc == 2, "authenticated predecessor geometry.bin argument");
   FILE *input = fopen(argv[1], "rb");
   require(input != NULL, "open original geometry artifact");
   char magic[4];
   require(fread(magic, 1, 4, input) == 4 && !memcmp(magic, "G921", 4) && word(input) == 3,
           "three original paired banks");
   static const uint32_t quad[16] = {
      0, 0, 0, 0, 0, UINT32_C(0x3f800000), 0, UINT32_C(0x3f800000),
      UINT32_C(0x3f800000), 0, UINT32_C(0x3f800000), 0,
      UINT32_C(0x3f800000), UINT32_C(0x3f800000),
      UINT32_C(0x3f800000), UINT32_C(0x3f800000)
   };
   for (unsigned i = 0; i < 16; ++i)
      require(word(input) == quad[i], "exact four-vertex position/UV quad");
   for (unsigned bank = 0; bank < 3; ++bank) {
      uint32_t vertex[16], fragment[148];
      for (unsigned i = 0; i < 16; ++i) vertex[i] = word(input);
      for (unsigned i = 0; i < 148; ++i) fragment[i] = word(input);
      /* The unchanged vertex source's literal pc4 sets W=1; the bank below
       * only supplies the XYZ affine transform, as proven by the predecessor. */
      require(vertex[3] == 0 && vertex[7] == 0 && vertex[11] == 0,
              "original affine bank has no cross-axis W coefficient");
      require(fragment[0] == UINT32_C(0x40800000) &&
              fragment[1] == UINT32_C(0x40800000) &&
              fragment[24] == UINT32_C(0x40000000),
              "original center and exact-square exponent");
      for (unsigned axis = 0; axis < 2; ++axis) {
         double viewport_scale = axis ? 384.0 : 512.0;
         double start = viewport_scale * number(vertex[8 + axis]) + viewport_scale;
         double diagonal = number(vertex[axis ? 5 : 0]);
         double cross = number(vertex[axis ? 1 : 4]);
         double end = viewport_scale * (diagonal + number(vertex[8 + axis])) + viewport_scale;
         double coefficient = number(fragment[16 + axis]);
         require(cross == 0.0 && end > start && end - start < 2048.0 &&
                 coefficient > 0.0 && coefficient <= 2048.0,
                 "finite positive axis-aligned original transform");
         unsigned dimension = axis ? 768u : 1024u;
         double minimum = INFINITY, maximum = 0.0, branch_maximum = 0.0;
         unsigned nearest = 0, covered = 0, branch = 0;
         for (unsigned pixel = 0; pixel < dimension; ++pixel) {
            double center = (double)pixel + .5;
            if (center < start || center > end) continue;
            double value = coefficient * (center - start) / (end - start);
            double base = fabs(value - 4.0);
            require(isfinite(value) && value >= -0.001 && value <= coefficient + .001,
                    "finite convex original UV and base");
            ++covered;
            if (base < minimum) { minimum = base; nearest = pixel; }
            if (base > maximum) maximum = base;
            if (value < 4.0) {
               ++branch;
               if (4.0 - value > branch_maximum) branch_maximum = 4.0 - value;
            }
         }
         require(covered && minimum > .49 && maximum < 2048.0 &&
                 branch_maximum <= 4.0, "ideal single-sample center envelope");
         printf("BANK %u AXIS %u COVERED %u NEAREST %u MIN_MICRO %u MAX_MICRO %u "
                "BRANCH %u BRANCH_MAX_MICRO %u\n", bank, axis, covered, nearest,
                (unsigned)(minimum * 1000000.0), (unsigned)(maximum * 1000000.0),
                branch, (unsigned)(branch_maximum * 1000000.0));
      }
   }
   require(fgetc(input) == EOF && !ferror(input), "no trailing raster bank bytes");
   require(fclose(input) == 0, "geometry close");
   puts("STATUS passed; no shader or future-DRAW authority");
   return 0;
}
