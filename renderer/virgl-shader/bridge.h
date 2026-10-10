#ifndef WASM_VM_VIRGL_SHADER_BRIDGE_H
#define WASM_VM_VIRGL_SHADER_BRIDGE_H

#include <stddef.h>
#include <stdint.h>

#define BRIDGE_MAX_TEXT 49152u
#define BRIDGE_MAX_TOKENS 8192u
#define BRIDGE_MAX_GLSL 262144u
#define BRIDGE_MAX_INSTRUCTIONS 768u
#define BRIDGE_MAX_TEMPORARIES 512u
#define BRIDGE_MAX_IMMEDIATES 32u
#define BRIDGE_MAX_FLOW_DEPTH 16u
#define BRIDGE_MAX_LINES 1536u
#define BRIDGE_MAX_LINE_BYTES 512u
/* json_string encodes every control byte as six ASCII bytes. Reserve its
 * worst case, independent of today's particular GLSL newline density. */
#define BRIDGE_MAX_RESULT (BRIDGE_MAX_GLSL * 6u + 16384u)
#define BRIDGE_MAX_PAIR_RESULT (BRIDGE_MAX_RESULT * 2u + 1024u)

/* stage: 0 = vertex, 1 = fragment. The returned JSON is borrowed until the
 * next call. No input pointer is retained. Calls must be serialized. The
 * checked opcode set internally selects the legacy v5 or owned raw-bit stage;
 * callers cannot select a backend or bypass output-domain validation. */
const char *bridge_translate(int stage, const char *text, size_t length);

/* Explicit private conditional transaction. Components are canonical, unique
 * stage-local slot-zero register/component/raw-word tuples (at most 46*4).
 * Text and tuples are copied before compilation. An ordinary success keeps
 * its original result; newly admitted results carry enforced exact-bank
 * preconditions. This does not select a specialization for a renderer DRAW. */
#define BRIDGE_MAX_EXACT_WORDS 184u
struct bridge_exact_word { uint32_t reg, component, word; };
const char *bridge_translate_exact(int stage, const char *text, size_t length,
                                  const struct bridge_exact_word *components, size_t count);

/* The two-stage API derives its interface from the fragment declarations.
 * Each text/stage retains the single-stage limits; no input/key is retained. */
const char *bridge_translate_pair(const char *vertex_text, size_t vertex_length,
                                  const char *fragment_text, size_t fragment_length);

#endif
