/* Literal original compact wire enum expectations; never runtime-generated. */
#include "virgl_hw.h"
#include "virgl_protocol.h"
#include <stdio.h>
_Static_assert(VIRGL_FORMAT_R32_FLOAT == 28, "original VIRGL_FORMAT_R32_FLOAT");
_Static_assert(VIRGL_FORMAT_R32G32_FLOAT == 29, "original VIRGL_FORMAT_R32G32_FLOAT");
_Static_assert(VIRGL_FORMAT_R32G32B32_FLOAT == 30, "original VIRGL_FORMAT_R32G32B32_FLOAT");
_Static_assert(VIRGL_FORMAT_R32G32B32A32_FLOAT == 31, "original VIRGL_FORMAT_R32G32B32A32_FLOAT");
_Static_assert(VIRGL_FORMAT_R16_UNORM == 48, "original VIRGL_FORMAT_R16_UNORM");
_Static_assert(VIRGL_FORMAT_R16G16_UNORM == 49, "original VIRGL_FORMAT_R16G16_UNORM");
_Static_assert(VIRGL_FORMAT_R16G16B16_UNORM == 50, "original VIRGL_FORMAT_R16G16B16_UNORM");
_Static_assert(VIRGL_FORMAT_R16G16B16A16_UNORM == 51, "original VIRGL_FORMAT_R16G16B16A16_UNORM");
_Static_assert(VIRGL_FORMAT_R16_SNORM == 56, "original VIRGL_FORMAT_R16_SNORM");
_Static_assert(VIRGL_FORMAT_R16G16_SNORM == 57, "original VIRGL_FORMAT_R16G16_SNORM");
_Static_assert(VIRGL_FORMAT_R16G16B16_SNORM == 58, "original VIRGL_FORMAT_R16G16B16_SNORM");
_Static_assert(VIRGL_FORMAT_R16G16B16A16_SNORM == 59, "original VIRGL_FORMAT_R16G16B16A16_SNORM");
_Static_assert(VIRGL_FORMAT_R8_UNORM == 64, "original VIRGL_FORMAT_R8_UNORM");
_Static_assert(VIRGL_FORMAT_R8G8_UNORM == 65, "original VIRGL_FORMAT_R8G8_UNORM");
_Static_assert(VIRGL_FORMAT_R8G8B8_UNORM == 66, "original VIRGL_FORMAT_R8G8B8_UNORM");
_Static_assert(VIRGL_FORMAT_R8G8B8A8_UNORM == 67, "original VIRGL_FORMAT_R8G8B8A8_UNORM");
_Static_assert(VIRGL_FORMAT_R8_SNORM == 74, "original VIRGL_FORMAT_R8_SNORM");
_Static_assert(VIRGL_FORMAT_R8G8_SNORM == 75, "original VIRGL_FORMAT_R8G8_SNORM");
_Static_assert(VIRGL_FORMAT_R8G8B8_SNORM == 76, "original VIRGL_FORMAT_R8G8B8_SNORM");
_Static_assert(VIRGL_FORMAT_R8G8B8A8_SNORM == 77, "original VIRGL_FORMAT_R8G8B8A8_SNORM");
_Static_assert(VIRGL_FORMAT_R16_FLOAT == 91, "original VIRGL_FORMAT_R16_FLOAT");
_Static_assert(VIRGL_FORMAT_R16G16_FLOAT == 92, "original VIRGL_FORMAT_R16G16_FLOAT");
_Static_assert(VIRGL_FORMAT_R16G16B16_FLOAT == 93, "original VIRGL_FORMAT_R16G16B16_FLOAT");
_Static_assert(VIRGL_FORMAT_R16G16B16A16_FLOAT == 94, "original VIRGL_FORMAT_R16G16B16A16_FLOAT");
_Static_assert(VIRGL_OBJ_VERTEX_ELEMENTS_SIZE(1) == 5, "original vertex element packet width");
int main(void) {
   printf("{\"status\":\"pinned-header\",\"formats\":[");
   printf("%u", VIRGL_FORMAT_R32_FLOAT);
   printf(",%u", VIRGL_FORMAT_R32G32_FLOAT);
   printf(",%u", VIRGL_FORMAT_R32G32B32_FLOAT);
   printf(",%u", VIRGL_FORMAT_R32G32B32A32_FLOAT);
   printf(",%u", VIRGL_FORMAT_R16_UNORM);
   printf(",%u", VIRGL_FORMAT_R16G16_UNORM);
   printf(",%u", VIRGL_FORMAT_R16G16B16_UNORM);
   printf(",%u", VIRGL_FORMAT_R16G16B16A16_UNORM);
   printf(",%u", VIRGL_FORMAT_R16_SNORM);
   printf(",%u", VIRGL_FORMAT_R16G16_SNORM);
   printf(",%u", VIRGL_FORMAT_R16G16B16_SNORM);
   printf(",%u", VIRGL_FORMAT_R16G16B16A16_SNORM);
   printf(",%u", VIRGL_FORMAT_R8_UNORM);
   printf(",%u", VIRGL_FORMAT_R8G8_UNORM);
   printf(",%u", VIRGL_FORMAT_R8G8B8_UNORM);
   printf(",%u", VIRGL_FORMAT_R8G8B8A8_UNORM);
   printf(",%u", VIRGL_FORMAT_R8_SNORM);
   printf(",%u", VIRGL_FORMAT_R8G8_SNORM);
   printf(",%u", VIRGL_FORMAT_R8G8B8_SNORM);
   printf(",%u", VIRGL_FORMAT_R8G8B8A8_SNORM);
   printf(",%u", VIRGL_FORMAT_R16_FLOAT);
   printf(",%u", VIRGL_FORMAT_R16G16_FLOAT);
   printf(",%u", VIRGL_FORMAT_R16G16B16_FLOAT);
   printf(",%u", VIRGL_FORMAT_R16G16B16A16_FLOAT);
   printf("]}\n");
   return 0;
}
