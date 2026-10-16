/* SPDX-License-Identifier: MIT */
#include "../bridge.h"
#include <stdint.h>
#include <stdio.h>

/* A bounded test-only binary protocol keeps the real two-stage C entry point
 * independent of the JavaScript wrapper used in the hardware proof. */
int main(void)
{
   unsigned char header[8];
   char vertex[BRIDGE_MAX_TEXT + 1], fragment[BRIDGE_MAX_TEXT + 1];
   if (fread(header, 1, sizeof(header), stdin) != sizeof(header)) return 2;
   uint32_t lengths[2] = {0, 0};
   for (unsigned i = 0; i < 8; ++i)
      lengths[i / 4] |= (uint32_t)header[i] << (8 * (i % 4));
   if (lengths[0] > sizeof(vertex) || lengths[1] > sizeof(fragment)) return 2;
   if (fread(vertex, 1, lengths[0], stdin) != lengths[0] ||
       fread(fragment, 1, lengths[1], stdin) != lengths[1] || fgetc(stdin) != EOF || ferror(stdin)) return 2;
   puts(bridge_translate_pair(vertex, lengths[0], fragment, lengths[1]));
   return 0;
}
