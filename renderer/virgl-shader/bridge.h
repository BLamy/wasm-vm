#ifndef WASM_VM_VIRGL_SHADER_BRIDGE_H
#define WASM_VM_VIRGL_SHADER_BRIDGE_H

#include <stddef.h>

#define BRIDGE_MAX_TEXT 16384u
#define BRIDGE_MAX_TOKENS 8192u
#define BRIDGE_MAX_GLSL 65536u
#define BRIDGE_MAX_INSTRUCTIONS 128u

/* stage: 0 = vertex, 1 = fragment. The returned JSON is borrowed until the
 * next call. No input pointer is retained. Calls must be serialized. */
const char *bridge_translate(int stage, const char *text, size_t length);

#endif
