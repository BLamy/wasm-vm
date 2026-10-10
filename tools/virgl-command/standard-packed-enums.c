/* Literal pinned original packed wire enums, independent of JS descriptors. */
#include "virgl_hw.h"
#include "virgl_protocol.h"
#include <stdio.h>
_Static_assert(VIRGL_FORMAT_R10G10B10A2_UNORM == 8, "original packed unorm");
_Static_assert(VIRGL_FORMAT_R10G10B10A2_USCALED == 123, "original packed uscaled");
_Static_assert(VIRGL_FORMAT_R10G10B10A2_SSCALED == 172, "original packed sscaled");
_Static_assert(VIRGL_FORMAT_R10G10B10A2_SNORM == 173, "original packed snorm");
_Static_assert(VIRGL_FORMAT_B10G10R10A2_UNORM == 131, "separate packed swizzle");
_Static_assert(VIRGL_OBJ_VERTEX_ELEMENTS_SIZE(1) == 5, "original vertex element packet width");
int main(void) { puts("{\"status\":\"pinned-header\",\"formats\":[8,123,172,173],\"components\":4,\"elementBytes\":4}"); return 0; }
