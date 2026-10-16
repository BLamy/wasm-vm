/* Independent literal pins from the original VirGL header. */
#include "virgl_hw.h"
#include "virgl_protocol.h"
#include <stdio.h>
_Static_assert(VIRGL_FORMAT_R8_UINT == 177, "original VIRGL_FORMAT_R8_UINT");
_Static_assert(VIRGL_FORMAT_R8G8_UINT == 178, "original VIRGL_FORMAT_R8G8_UINT");
_Static_assert(VIRGL_FORMAT_R8G8B8_UINT == 179, "original VIRGL_FORMAT_R8G8B8_UINT");
_Static_assert(VIRGL_FORMAT_R8G8B8A8_UINT == 180, "original VIRGL_FORMAT_R8G8B8A8_UINT");
_Static_assert(VIRGL_FORMAT_R8_SINT == 181, "original VIRGL_FORMAT_R8_SINT");
_Static_assert(VIRGL_FORMAT_R8G8_SINT == 182, "original VIRGL_FORMAT_R8G8_SINT");
_Static_assert(VIRGL_FORMAT_R8G8B8_SINT == 183, "original VIRGL_FORMAT_R8G8B8_SINT");
_Static_assert(VIRGL_FORMAT_R8G8B8A8_SINT == 184, "original VIRGL_FORMAT_R8G8B8A8_SINT");
_Static_assert(VIRGL_FORMAT_R16_UINT == 185, "original VIRGL_FORMAT_R16_UINT");
_Static_assert(VIRGL_FORMAT_R16G16_UINT == 186, "original VIRGL_FORMAT_R16G16_UINT");
_Static_assert(VIRGL_FORMAT_R16G16B16_UINT == 187, "original VIRGL_FORMAT_R16G16B16_UINT");
_Static_assert(VIRGL_FORMAT_R16G16B16A16_UINT == 188, "original VIRGL_FORMAT_R16G16B16A16_UINT");
_Static_assert(VIRGL_FORMAT_R16_SINT == 189, "original VIRGL_FORMAT_R16_SINT");
_Static_assert(VIRGL_FORMAT_R16G16_SINT == 190, "original VIRGL_FORMAT_R16G16_SINT");
_Static_assert(VIRGL_FORMAT_R16G16B16_SINT == 191, "original VIRGL_FORMAT_R16G16B16_SINT");
_Static_assert(VIRGL_FORMAT_R16G16B16A16_SINT == 192, "original VIRGL_FORMAT_R16G16B16A16_SINT");
_Static_assert(VIRGL_FORMAT_R32_UINT == 193, "original VIRGL_FORMAT_R32_UINT");
_Static_assert(VIRGL_FORMAT_R32G32_UINT == 194, "original VIRGL_FORMAT_R32G32_UINT");
_Static_assert(VIRGL_FORMAT_R32G32B32_UINT == 195, "original VIRGL_FORMAT_R32G32B32_UINT");
_Static_assert(VIRGL_FORMAT_R32G32B32A32_UINT == 196, "original VIRGL_FORMAT_R32G32B32A32_UINT");
_Static_assert(VIRGL_FORMAT_R32_SINT == 197, "original VIRGL_FORMAT_R32_SINT");
_Static_assert(VIRGL_FORMAT_R32G32_SINT == 198, "original VIRGL_FORMAT_R32G32_SINT");
_Static_assert(VIRGL_FORMAT_R32G32B32_SINT == 199, "original VIRGL_FORMAT_R32G32B32_SINT");
_Static_assert(VIRGL_FORMAT_R32G32B32A32_SINT == 200, "original VIRGL_FORMAT_R32G32B32A32_SINT");
_Static_assert(VIRGL_OBJ_VERTEX_ELEMENTS_SIZE(1) == 5, "original element width");
int main(void) {
 printf("{\"status\":\"pinned-header\",\"formats\":[");
 printf("%u", VIRGL_FORMAT_R8_UINT);
 printf(",%u", VIRGL_FORMAT_R8G8_UINT);
 printf(",%u", VIRGL_FORMAT_R8G8B8_UINT);
 printf(",%u", VIRGL_FORMAT_R8G8B8A8_UINT);
 printf(",%u", VIRGL_FORMAT_R8_SINT);
 printf(",%u", VIRGL_FORMAT_R8G8_SINT);
 printf(",%u", VIRGL_FORMAT_R8G8B8_SINT);
 printf(",%u", VIRGL_FORMAT_R8G8B8A8_SINT);
 printf(",%u", VIRGL_FORMAT_R16_UINT);
 printf(",%u", VIRGL_FORMAT_R16G16_UINT);
 printf(",%u", VIRGL_FORMAT_R16G16B16_UINT);
 printf(",%u", VIRGL_FORMAT_R16G16B16A16_UINT);
 printf(",%u", VIRGL_FORMAT_R16_SINT);
 printf(",%u", VIRGL_FORMAT_R16G16_SINT);
 printf(",%u", VIRGL_FORMAT_R16G16B16_SINT);
 printf(",%u", VIRGL_FORMAT_R16G16B16A16_SINT);
 printf(",%u", VIRGL_FORMAT_R32_UINT);
 printf(",%u", VIRGL_FORMAT_R32G32_UINT);
 printf(",%u", VIRGL_FORMAT_R32G32B32_UINT);
 printf(",%u", VIRGL_FORMAT_R32G32B32A32_UINT);
 printf(",%u", VIRGL_FORMAT_R32_SINT);
 printf(",%u", VIRGL_FORMAT_R32G32_SINT);
 printf(",%u", VIRGL_FORMAT_R32G32B32_SINT);
 printf(",%u", VIRGL_FORMAT_R32G32B32A32_SINT);
 printf("]}\n");
 return 0;
}
