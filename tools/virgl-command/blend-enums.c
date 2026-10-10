/* Independent native oracle from the authenticated upstream Gallium header. */
#include <stdio.h>
#include "pipe/p_defines.h"

int main(void)
{
   const unsigned equations[] = { PIPE_BLEND_ADD, PIPE_BLEND_SUBTRACT,
      PIPE_BLEND_REVERSE_SUBTRACT, PIPE_BLEND_MIN, PIPE_BLEND_MAX };
   const unsigned factors[] = { PIPE_BLENDFACTOR_ONE, PIPE_BLENDFACTOR_SRC_COLOR,
      PIPE_BLENDFACTOR_SRC_ALPHA, PIPE_BLENDFACTOR_DST_ALPHA, PIPE_BLENDFACTOR_DST_COLOR,
      PIPE_BLENDFACTOR_SRC_ALPHA_SATURATE, PIPE_BLENDFACTOR_CONST_COLOR, PIPE_BLENDFACTOR_CONST_ALPHA,
      PIPE_BLENDFACTOR_ZERO, PIPE_BLENDFACTOR_INV_SRC_COLOR, PIPE_BLENDFACTOR_INV_SRC_ALPHA,
      PIPE_BLENDFACTOR_INV_DST_ALPHA, PIPE_BLENDFACTOR_INV_DST_COLOR,
      PIPE_BLENDFACTOR_INV_CONST_COLOR, PIPE_BLENDFACTOR_INV_CONST_ALPHA };
   fputs("{\"equations\":[", stdout);
   for (unsigned i = 0; i < sizeof(equations)/sizeof(equations[0]); i++)
      printf("%s%u", i ? "," : "", equations[i]);
   fputs("],\"sourceFactors\":[", stdout);
   for (unsigned i = 0; i < sizeof(factors)/sizeof(factors[0]); i++)
      printf("%s%u", i ? "," : "", factors[i]);
   printf("],\"dualSource\":[%u,%u,%u,%u]}\n", PIPE_BLENDFACTOR_SRC1_COLOR,
      PIPE_BLENDFACTOR_SRC1_ALPHA, PIPE_BLENDFACTOR_INV_SRC1_COLOR, PIPE_BLENDFACTOR_INV_SRC1_ALPHA);
   return 0;
}
