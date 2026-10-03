/* SPDX-License-Identifier: MIT */
#include "bridge.h"
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv)
{
   int stage = -1;
   if (argc == 2 && !strcmp(argv[1], "vertex")) stage = 0;
   if (argc == 2 && !strcmp(argv[1], "fragment")) stage = 1;
   char input[BRIDGE_MAX_TEXT + 1];
   size_t size = fread(input, 1, sizeof(input), stdin);
   if (ferror(stdin)) return 2;
   puts(bridge_translate(stage, input, size));
   return 0;
}
