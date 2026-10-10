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
#define BRIDGE_MAX_VERTEX_CONSTANTS 128u
#define BRIDGE_MAX_FLOW_DEPTH 16u
#define BRIDGE_MAX_LINES 1536u
#define BRIDGE_MAX_LINE_BYTES 512u
/* json_string encodes every control byte as six ASCII bytes. Reserve its
 * worst case, independent of today's particular GLSL newline density. */
#define BRIDGE_MAX_RESULT (BRIDGE_MAX_GLSL * 6u + 16384u)
#define BRIDGE_MAX_PAIR_RESULT (BRIDGE_MAX_RESULT * 2u + 1024u)

/* stage: 0 = vertex, 1 = fragment. The returned JSON is borrowed until the
 * next call. No input pointer is retained. Calls must be serialized. The
 * checked opcode set internally selects the ordinary v5/v6 or owned raw-bit stage;
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

/* Private paired transaction. Each canonical list has 0..184 stage-local
 * components; at least one list is nonempty. Both complete texts and lists
 * are owned before compilation. The checked fragment interface is retained
 * across the conditional attempt; no caller-provided shader key is accepted. */
const char *bridge_translate_pair_exact(const char *vertex_text, size_t vertex_length,
                                        const struct bridge_exact_word *vertex_components, size_t vertex_count,
                                        const char *fragment_text, size_t fragment_length,
                                        const struct bridge_exact_word *fragment_components, size_t fragment_count);

/* Private physical 92cb first-power observer. Inputs are authenticated against
 * the complete captured sources and 3-bank geometry before an internal pc0..222
 * prefix is built. Its result is conditional on the draw-time state below and
 * is never a full-fragment or production DRAW admission. */
struct bridge_92cb_draw_state {
   uint32_t viewport_x, viewport_y, viewport_width, viewport_height;
   uint32_t samples, color_format, mode, first, count;
};
const char *bridge_translate_original_92cb_first_power(
   const char *vertex_text, size_t vertex_length,
   const char *fragment_text, size_t fragment_length,
   const unsigned char *geometry, size_t geometry_length,
   unsigned bank, const struct bridge_92cb_draw_state *draw);

/* Isolated full-source capture transaction. The same complete byte pins and
 * draw state apply; dynamic powers carry emitted invocation-time guards and
 * a separate diagnostic output. It grants no production draw authority. */
const char *bridge_translate_original_92cb_complete(
   const char *vertex_text, size_t vertex_length,
   const char *fragment_text, size_t fragment_length,
   const unsigned char *geometry, size_t geometry_length,
   unsigned bank, const struct bridge_92cb_draw_state *draw);

/* Distinct host-selected standard GLES3 facet. Structural admission only:
 * native highp/undefined-domain semantics, no exact or conditional authority.
 * Neither old entry points nor guest inputs select this facet implicitly.
 * JSON is borrowed until the next call; serialize calls and copy results.
 * Both complete input strings are copied before semantic allocations. */
const char *bridge_translate_standard(int stage, const char *text, size_t length);
const char *bridge_translate_standard_pair(const char *vertex_text, size_t vertex_length,
                                           const char *fragment_text, size_t fragment_length);

/* Host vertex-format specialization only. Disjoint 16-bit masks must name
 * declared vertex attributes; no guest text key or numeric authority is added. */
const char *bridge_translate_standard_pair_typed(const char *vertex_text, size_t vertex_length,
                                                 const char *fragment_text, size_t fragment_length,
                                                 uint32_t signed_inputs, uint32_t unsigned_inputs);

#endif
