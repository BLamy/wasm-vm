/* Independent pinned protocol/layout oracle, compiled natively and under sanitizers. */
#include <float.h>
#include <stdio.h>
#include "virgl_hw.h"
#include "virgl_protocol.h"

_Static_assert(sizeof(float) == 4 && FLT_RADIX == 2 && FLT_MANT_DIG == 24,
               "The evidence host must use IEEE binary32 float lanes");

int main(void)
{
   const unsigned formats[] = { VIRGL_FORMAT_R32_FLOAT, VIRGL_FORMAT_R32G32_FLOAT,
      VIRGL_FORMAT_R32G32B32_FLOAT, VIRGL_FORMAT_R32G32B32A32_FLOAT };
   const size_t widths[] = { sizeof(float[1]), sizeof(float[2]), sizeof(float[3]), sizeof(float[4]) };
   printf("{\"objectType\":%u,\"formats\":[", VIRGL_OBJECT_VERTEX_ELEMENTS);
   for (unsigned i = 0; i < 4; i++) printf("%s%u", i ? "," : "", formats[i]);
   fputs("],\"byteWidths\":[", stdout);
   for (unsigned i = 0; i < 4; i++) printf("%s%zu", i ? "," : "", widths[i]);
   printf("],\"wordCounts\":[%u,%u],\"firstFields\":[%u,%u,%u,%u]}\n",
      VIRGL_OBJ_VERTEX_ELEMENTS_SIZE(1), VIRGL_OBJ_VERTEX_ELEMENTS_SIZE(16),
      VIRGL_OBJ_VERTEX_ELEMENTS_V0_SRC_OFFSET(0), VIRGL_OBJ_VERTEX_ELEMENTS_V0_INSTANCE_DIVISOR(0),
      VIRGL_OBJ_VERTEX_ELEMENTS_V0_VERTEX_BUFFER_INDEX(0), VIRGL_OBJ_VERTEX_ELEMENTS_V0_SRC_FORMAT(0));
   return 0;
}
