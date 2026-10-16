/* Original ABI expectations, compiled against the independently pinned headers. */
#include "pipe/p_defines.h"
#include "virgl_protocol.h"
#include <stdio.h>
_Static_assert(PIPE_PRIM_POINTS == 0, "original Gallium POINTS");
_Static_assert(VIRGL_OBJ_RS_SIZE == 9, "original rasterizer extent");
_Static_assert(VIRGL_OBJ_RS_POINT_SIZE == 3, "original point-size float field");
_Static_assert(VIRGL_OBJ_RS_SPRITE_COORD_ENABLE == 4, "original generic-sprite field");
_Static_assert(VIRGL_OBJ_RS_S0_POINT_SIZE_PER_VERTEX(1) == (1u << 24), "original per-vertex selector");
int main(void)
{
   printf("{\"status\":\"pinned-header\",\"points\":%u,\"rasterizerWords\":%u,\"pointSizeWord\":%u,\"perVertexMask\":%u}\n",
          PIPE_PRIM_POINTS, VIRGL_OBJ_RS_SIZE, VIRGL_OBJ_RS_POINT_SIZE, VIRGL_OBJ_RS_S0_POINT_SIZE_PER_VERTEX(1));
   return 0;
}
