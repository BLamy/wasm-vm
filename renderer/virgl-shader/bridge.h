#ifndef WASM_VM_VIRGL_SHADER_BRIDGE_H
#define WASM_VM_VIRGL_SHADER_BRIDGE_H

#include <stddef.h>

#define BRIDGE_MAX_TEXT 16384u
#define BRIDGE_MAX_TOKENS 8192u
#define BRIDGE_MAX_GLSL 65536u
#define BRIDGE_MAX_INSTRUCTIONS 179u
#define BRIDGE_MAX_RESULT (BRIDGE_MAX_GLSL * 2u + 16384u)
#define BRIDGE_MAX_PAIR_RESULT (BRIDGE_MAX_RESULT * 2u + 1024u)

/* stage: 0 = vertex, 1 = fragment. The returned JSON is borrowed until the
 * next call. No input pointer is retained. Calls must be serialized. */
const char *bridge_translate(int stage, const char *text, size_t length);

/* The two-stage API derives its interface from the fragment declarations.
 * Each text/stage retains the single-stage limits; no input/key is retained. */
const char *bridge_translate_pair(const char *vertex_text, size_t vertex_length,
                                  const char *fragment_text, size_t fragment_length);

#endif
