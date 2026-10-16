/* SPDX-License-Identifier: MIT
 * Captured draw geometry and bank audit. No numeric compiler authority is
 * derived from this file; the full original pair must remain rejected. */
#include "../bridge.h"
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int valid, const char *reason)
{
   if (!valid) { fprintf(stderr, "original-92cb-geometry: %s\n", reason); exit(1); }
}

static uint32_t word(FILE *input)
{
   unsigned char bytes[4];
   require(fread(bytes, 1, 4, input) == 4, "complete little-endian word");
   return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 |
      (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}

static float f32(uint32_t bits)
{
   float value;
   memcpy(&value, &bits, sizeof(value));
   return value;
}

static char *source(const char *path, size_t *length)
{
   FILE *input = fopen(path, "rb");
   require(input != NULL, "open full original source");
   require(fseek(input, 0, SEEK_END) == 0, "source extent");
   long size = ftell(input);
   require(size > 0 && size <= BRIDGE_MAX_TEXT, "bounded original source");
   require(fseek(input, 0, SEEK_SET) == 0, "source rewind");
   char *text = malloc((size_t)size + 1);
   require(text != NULL, "source allocation");
   require(fread(text, 1, (size_t)size, input) == (size_t)size, "complete source");
   require(fgetc(input) == EOF && !ferror(input), "source end");
   require(fclose(input) == 0, "source close");
   text[size] = 0;
   require(strlen(text) == (size_t)size, "no embedded source NUL");
   *length = (size_t)size;
   return text;
}

static int accepted(const char *result)
{
   return result != NULL && !strncmp(result, "{\"ok\":true,", 11);
}

int main(int argc, char **argv)
{
   require(argc == 4, "vertex, fragment and authenticated geometry bank file");
   size_t vertex_length, fragment_length;
   char *vertex = source(argv[1], &vertex_length);
   char *fragment = source(argv[2], &fragment_length);
   FILE *input = fopen(argv[3], "rb");
   require(input != NULL, "open authenticated geometry");
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
      require(word(input) == quad[i], "four finite [0,1] float2 position/UV vertices");
   for (unsigned bank = 0; bank < 3; ++bank) {
      struct bridge_exact_word v[16], f[148];
      for (unsigned i = 0; i < 16; ++i)
         v[i] = (struct bridge_exact_word){i / 4, i % 4, word(input)};
      for (unsigned i = 0; i < 148; ++i)
         f[i] = (struct bridge_exact_word){i / 4, i % 4, word(input)};
      for (unsigned i = 0; i < 16; ++i)
         require(isfinite(f32(v[i].word)), "finite captured vertex transform and varying words");
      for (unsigned vertex_index = 0; vertex_index < 4; ++vertex_index) {
         float x = f32(quad[vertex_index * 4]);
         float y = f32(quad[vertex_index * 4 + 1]);
         for (unsigned axis = 0; axis < 3; ++axis) {
            /* Literal original vertex pc0..4 has W=1 and this affine XYZ.
             * With finite clip positions, clipping preserves convex UVs. */
            float clip = f32(v[axis].word) * x + f32(v[4 + axis].word) * y +
                         f32(v[8 + axis].word);
            require(isfinite(clip), "finite clip-space original vertex");
         }
      }
      require(f[0].word == UINT32_C(0x40800000) &&
              f[1].word == UINT32_C(0x40800000) &&
              f[24].word == UINT32_C(0x40000000),
              "captured center and positive integer exponent");
      const float scale[2] = {f32(f[16].word), f32(f[17].word)};
      const float center[2] = {f32(f[0].word), f32(f[1].word)};
      unsigned bound[2];
      for (unsigned axis = 0; axis < 2; ++axis) {
         require(isfinite(scale[axis]) && scale[axis] >= 0.0f && scale[axis] <= 2048.0f,
                 "finite nonnegative captured coordinate scale");
         float left = fabsf(-center[axis]);
         float right = fabsf(scale[axis] - center[axis]);
         float maximum = fmaxf(left, right);
         require(isfinite(maximum) && maximum <= 2048.0f &&
                 maximum == floorf(maximum), "conservative first-power base envelope");
         bound[axis] = (unsigned)maximum;
      }
      /* With vertex W fixed at 1, triangle interpolation and clip-generated
       * vertices are convex combinations. Every rasterized UV remains [0,1].
       * A finite upper bound alone is insufficient for the compiler's POW:
       * positive subnormal bases near the center are still possible. */
      require((unsigned)bound[0] < 2048 && (unsigned)bound[1] < 2048,
              "no overflow in geometric base envelope");
      const char *result = bridge_translate_pair_exact(vertex, vertex_length, v, 16,
         fragment, fragment_length, f, 148);
      require(!accepted(result), "original pair cannot borrow unbound geometry certificate");
      printf("BANK %u baseX<=%u baseY<=%u paired=%s\n", bank, bound[0], bound[1], result);
      result = bridge_translate_pair(vertex, vertex_length, fragment, fragment_length);
      require(!accepted(result), "ordinary original pair remains gated");
      printf("DEFAULT %u %s\n", bank, result);
   }
   require(fgetc(input) == EOF && !ferror(input), "no trailing geometry bytes");
   require(fclose(input) == 0, "geometry close");
   free(vertex); free(fragment);
   puts("STATUS passed");
   return 0;
}
