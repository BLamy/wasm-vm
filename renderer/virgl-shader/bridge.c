/* SPDX-License-Identifier: MIT
 * Bounded profile adapter around the unmodified upstream VirGL compiler.
 * The guard validates a deliberately small language before upstream's general
 * TGSI parser sees it. No unbounded numeric/range value, unsupported property,
 * indirect address, unsupported stage, or control-flow token reaches upstream.
 */
#include "bridge.h"
#include "vrend/vrend_shader.h"
#include "tgsi/tgsi_text.h"
#include "util/os_misc.h"
#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum file { IN, OUT, TEMP, CONST, IMM, SAMP, SVIEW, FILE_COUNT };
enum operand_kind { DECLARATION, DESTINATION, SOURCE };
struct reg { enum file file; unsigned index, last, mask; bool explicit_mask; };
struct profile {
   bool declared[FILE_COUNT][8];
   unsigned components[FILE_COUNT][8];
   unsigned written[FILE_COUNT][8];
   unsigned semantic[2][8]; /* 0 attribute, 1 POSITION, 2 GENERIC, 3 COLOR */
   unsigned semantic_index[2][8];
   unsigned instructions, immediates;
   bool ended, started, color0_property;
   int stage;
};

static char response[BRIDGE_MAX_GLSL * 2 + 16384];
static size_t response_used;
static bool response_overflow;
static bool upstream_logged;
static const char *failure_code;

/* Logging is bounded and never allows guest text to become a format string.
 * Any upstream diagnostic invalidates the conversion instead of silently
 * accepting a warning about dropped semantics. */
void virgl_logv(enum virgl_log_level_flags level, const char *fmt, va_list args)
{
   (void)level; (void)fmt; (void)args;
   upstream_logged = true;
}
unsigned vrend_debug(const struct vrend_context *ctx, enum virgl_debug_flags flags)
{
   (void)ctx; (void)flags;
   return 0;
}
void vrend_print_context_name(const struct vrend_context *ctx) { (void)ctx; }
/* Only these two OS services are referenced by the shader-only dependency
 * closure. Native and Wasm use the same deterministic, environment-free hooks. */
const char *os_get_option(const char *name) { (void)name; return NULL; }
void os_log_message(const char *message) { (void)message; upstream_logged = true; }

static void append(const char *fmt, ...)
{
   if (response_overflow) return;
   va_list args;
   va_start(args, fmt);
   int n = vsnprintf(response + response_used, sizeof(response) - response_used, fmt, args);
   va_end(args);
   if (n < 0 || (size_t)n >= sizeof(response) - response_used) {
      response_overflow = true;
      return;
   }
   response_used += (size_t)n;
}

static void json_string(const char *s)
{
   append("\"");
   for (; *s; ++s) {
      unsigned char c = (unsigned char)*s;
      if (c == '"' || c == '\\') append("\\%c", c);
      else if (c < 32) append("\\u%04x", c);
      else append("%c", c);
   }
   append("\"");
}

static const char *error(const char *code, const char *message)
{
   response_used = 0;
   response_overflow = false;
   append("{\"ok\":false,\"error\":{\"code\":"); json_string(code);
   append(",\"message\":"); json_string(message); append("}}");
   return response;
}

static void space(const char **p) { while (**p == ' ' || **p == '\t' || **p == '\r') ++*p; }
static bool punctuation(const char **p, char c)
{
   space(p);
   if (**p != c) return false;
   ++*p;
   return true;
}
static bool word(const char **p, const char *s)
{
   space(p);
   size_t n = strlen(s);
   if (strncmp(*p, s, n) || isalnum((unsigned char)(*p)[n]) || (*p)[n] == '_') return false;
   *p += n;
   return true;
}
static bool end(const char **p) { space(p); return **p == '\0'; }
static bool index_number(const char **p, unsigned *result)
{
   space(p);
   if (**p < '0' || **p > '7') { failure_code = "unsupported-feature"; return false; }
   *result = (unsigned)(*(*p)++ - '0');
   if (isdigit((unsigned char)**p)) { failure_code = "unsupported-feature"; return false; }
   return true;
}
static bool register_name(const char **p, struct reg *r, enum operand_kind kind)
{
   static const char *names[] = {"IN", "OUT", "TEMP", "CONST", "IMM", "SAMP", "SVIEW"};
   unsigned f;
   for (f = 0; f < FILE_COUNT; ++f) if (word(p, names[f])) break;
   if (f == FILE_COUNT || !punctuation(p, '[') || !index_number(p, &r->index)) return false;
   r->file = (enum file)f;
   r->last = r->index;
   space(p);
   if (!strncmp(*p, "..", 2)) {
      if (kind != DECLARATION || f != TEMP) { failure_code = "unsupported-feature"; return false; }
      *p += 2;
      if (!index_number(p, &r->last) || r->last < r->index) return false;
   }
   if (!punctuation(p, ']')) return false;
   r->mask = 15;
   r->explicit_mask = punctuation(p, '.');
   if (r->explicit_mask) {
      static const char components[] = "xyzw";
      const char *begin = *p;
      r->mask = 0;
      unsigned count = 0, previous = 0;
      while (**p && strchr(components, **p)) {
         unsigned component = (unsigned)(strchr(components, **p) - components);
         if (++count > 4 || (kind != SOURCE && count > 1 && component <= previous)) return false;
         previous = component;
         r->mask |= 1u << component;
         ++*p;
      }
      if (kind == SOURCE) {
         if (count != 4) return false;
      } else if (!((count == 2 && !strncmp(begin, "xy", 2)) ||
                   (kind == DESTINATION && count == 1 && (*begin == 'z' || *begin == 'w')))) {
         failure_code = "unsupported-feature";
         return false;
      }
   }
   return true;
}
static bool source(const char **p, struct profile *s)
{
   struct reg r;
   if (!register_name(p, &r, SOURCE) || r.file == OUT || r.file >= SAMP || !s->declared[r.file][r.index] ||
       (s->components[r.file][r.index] & r.mask) != r.mask) return false;
   /* Deliberately conservative: all selected lanes must be declared, including
    * lanes a masked destination may not consume. TEMP writes remain full. */
   return r.file != TEMP || s->written[TEMP][r.index] == 15;
}
static bool literal_float(const char **p)
{
   space(p);
   const char *begin = *p;
   while (**p && strchr("+-0123456789.eE", **p)) ++*p;
   size_t n = (size_t)(*p - begin);
   if (!n || n > 32) return false;
   char number[33]; memcpy(number, begin, n); number[n] = 0;
   char *after;
   errno = 0;
   float value = strtof(number, &after);
   return !errno && *after == 0 && isfinite(value) && fabsf(value) <= 1000000.0f;
}

static bool literal_float_bits(const char **p)
{
   space(p);
   uint32_t bits = 0;
   unsigned digits = 0;
   while (isdigit((unsigned char)**p)) {
      unsigned digit = (unsigned)(**p - '0');
      if (++digits > 10 || bits > (UINT32_MAX - digit) / 10) return false;
      bits = bits * 10 + digit;
      ++*p;
   }
   if (!digits || ((bits & UINT32_C(0x7f800000)) == 0 && (bits & UINT32_C(0x007fffff)) != 0)) return false;
   float value;
   memcpy(&value, &bits, sizeof(value));
   return isfinite(value) && fabsf(value) <= 1000000.0f;
}

static bool declaration(const char **p, struct profile *s)
{
   struct reg r;
   if (s->started || !register_name(p, &r, DECLARATION) || r.file == IMM) return false;
   for (unsigned i = r.index; i <= r.last; ++i) if (s->declared[r.file][i]) return false;
   unsigned semantic = 0, sid = 0;
   if (r.file == OUT || (r.file == IN && s->stage == 1)) {
      if (!punctuation(p, ',')) return false;
      if (word(p, "POSITION")) {
         if (s->stage != 0 || r.file != OUT || r.index != 0) return false;
         semantic = 1;
      } else if (word(p, "GENERIC")) {
         if (!punctuation(p, '[') || !index_number(p, &sid) || !punctuation(p, ']')) return false;
         if (s->stage == 1 && r.file == OUT) return false;
         semantic = 2;
      } else if (word(p, "COLOR")) {
         if (s->stage != 1 || r.file != OUT || r.index != 0) return false;
         semantic = 3;
      } else { failure_code = "unsupported-feature"; return false; }
      for (unsigned i = 0; i < 8; ++i)
         if (s->declared[r.file][i] && s->semantic[r.file][i] == semantic && s->semantic_index[r.file][i] == sid) return false;
      if (s->stage == 1 && r.file == IN && (!punctuation(p, ',') || !word(p, "PERSPECTIVE"))) return false;
   } else if (r.file == SVIEW) {
      if (s->stage != 1 || !punctuation(p, ',') || !word(p, "2D") || !punctuation(p, ',') || !word(p, "FLOAT")) return false;
   } else if (r.file == SAMP && s->stage != 1) return false;
   if (r.mask != 15 && (semantic != 2 || r.mask != 3)) return false;
   if (!end(p)) return false;
   for (unsigned i = r.index; i <= r.last; ++i) {
      s->declared[r.file][i] = true;
      s->components[r.file][i] = r.mask;
   }
   if (r.file <= OUT) {
      s->semantic[r.file][r.index] = semantic;
      s->semantic_index[r.file][r.index] = sid;
   }
   return true;
}

static bool instruction(const char **p, struct profile *s)
{
   unsigned arity;
   bool tex = false, mov = false;
   if (word(p, "END")) { s->ended = true; return end(p); }
   if (word(p, "MOV")) { arity = 1; mov = true; }
   else if (word(p, "ADD") || word(p, "MUL")) arity = 2;
   else if (word(p, "MAD")) arity = 3;
   else if (word(p, "TEX")) { tex = true; arity = 1; }
   else { failure_code = "unsupported-feature"; return false; }
   if (++s->instructions > BRIDGE_MAX_INSTRUCTIONS) return false;
   struct reg dst;
   if (!register_name(p, &dst, DESTINATION) || (dst.file != OUT && dst.file != TEMP) ||
       !s->declared[dst.file][dst.index] || (s->components[dst.file][dst.index] & dst.mask) != dst.mask) return false;
   if (dst.explicit_mask && (!mov || dst.file != OUT)) { failure_code = "unsupported-feature"; return false; }
   for (unsigned i = 0; i < arity; ++i)
      if (!punctuation(p, ',') || !source(p, s)) return false;
   if (tex) {
      struct reg sampler;
      if (s->stage != 1 || !punctuation(p, ',') || !register_name(p, &sampler, SOURCE) || sampler.file != SAMP || sampler.explicit_mask ||
          !s->declared[SAMP][sampler.index] || !s->declared[SVIEW][sampler.index] || !punctuation(p, ',') || !word(p, "2D")) return false;
   }
   if (!end(p)) return false;
   s->written[dst.file][dst.index] |= dst.mask;
   return true;
}

static bool validate(char *text, struct profile *s)
{
   char *save = NULL;
   bool header = false;
   unsigned line_count = 0;
   for (char *line = strtok_r(text, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
      const char *p = line;
      if (end(&p)) continue;
      if (++line_count > 256 || strlen(line) > 512 || s->ended) return false;
      if (!header) {
         header = true;
         if (word(&p, s->stage == 0 ? "FRAG" : "VERT")) { failure_code = "unsupported-stage"; return false; }
         if (!word(&p, s->stage == 0 ? "VERT" : "FRAG") || !end(&p)) return false;
      } else if (word(&p, "DCL")) {
         if (!declaration(&p, s)) return false;
      } else if (word(&p, "IMM")) {
         unsigned i;
         if (s->started || !punctuation(&p, '[') || !index_number(&p, &i) || i != s->immediates || !punctuation(&p, ']')) return false;
         bool bits = false;
         if (!word(&p, "FLT32")) {
            if (!word(&p, "UINT32")) return false;
            bits = true;
         }
         if (!punctuation(&p, '{')) return false;
         for (unsigned c = 0; c < 4; ++c)
            if ((c && !punctuation(&p, ',')) || !(bits ? literal_float_bits(&p) : literal_float(&p))) return false;
         if (!punctuation(&p, '}') || !end(&p)) return false;
         s->declared[IMM][i] = true; s->components[IMM][i] = 15; ++s->immediates;
      } else if (word(&p, "PROPERTY")) {
         if (s->stage != 1 || s->started || s->color0_property ||
             !word(&p, "FS_COLOR0_WRITES_ALL_CBUFS") || !word(&p, "1") || !end(&p)) {
            failure_code = "unsupported-feature";
            return false;
         }
         /* Fixed cfg.max_draw_buffers=1 makes this exactly COLOR0, not MRT. */
         s->color0_property = true;
      } else {
         s->started = true;
         /* Labels are optional, bounded, sequential, and never jump targets. */
         if (isdigit((unsigned char)*p)) {
            unsigned label = 0, digits = 0;
            while (isdigit((unsigned char)*p)) {
               if (++digits > 3) return false;
               label = label * 10 + (unsigned)(*p++ - '0');
            }
            if (label != s->instructions || !punctuation(&p, ':')) return false;
         }
         if (!instruction(&p, s)) return false;
      }
   }
   if (!header || !s->ended || !s->instructions || !s->declared[OUT][0]) return false;
   for (unsigned i = 0; i < 8; ++i)
      if (s->declared[OUT][i] && s->written[OUT][i] != s->components[OUT][i]) return false;
   return s->semantic[OUT][0] == (s->stage == 0 ? 1u : 3u);
}

static void io_metadata(const struct profile *s, enum file f)
{
   bool comma = false;
   append("[");
   for (unsigned i = 0; i < 8; ++i) if (s->declared[f][i]) {
      unsigned semantic = s->semantic[f][i], sid = s->semantic_index[f][i];
      const char *names[] = {"ATTRIBUTE", "POSITION", "GENERIC", "COLOR"};
      char name[32];
      if (!semantic) snprintf(name, sizeof(name), "in_%u", i);
      else if (semantic == 1) snprintf(name, sizeof(name), "gl_Position");
      else if (semantic == 2) snprintf(name, sizeof(name), "vso_g%u", sid);
      else snprintf(name, sizeof(name), "fsout_c0");
      append("%s{\"index\":%u,\"name\":\"%s\",\"type\":\"vec4\",\"semantic\":\"%s\",\"semanticIndex\":%u,\"componentMask\":%u", comma ? "," : "", i, name, names[semantic], sid, s->components[f][i]);
      if (f == OUT) append(",\"writtenMask\":%u", s->written[f][i]);
      append("}");
      comma = true;
   }
   append("]");
}

const char *bridge_translate(int stage, const char *text, size_t length)
{
   if (stage != 0 && stage != 1) return error("unsupported-stage", "Only vertex and fragment stages are supported.");
   if (!text) return error("invalid-input", "TGSI text is required.");
   if (length > BRIDGE_MAX_TEXT) return error("input-too-large", "TGSI text exceeds 16384 bytes.");
   for (size_t i = 0; i < length; ++i) {
      unsigned char c = (unsigned char)text[i];
      if ((c < 32 && c != '\n' && c != '\t' && c != '\r') || c > 126)
         return error("invalid-input", "TGSI must contain printable ASCII and ordinary whitespace, without NUL bytes.");
   }
   char checked[BRIDGE_MAX_TEXT + 1], input[BRIDGE_MAX_TEXT + 1];
   memcpy(input, text, length); input[length] = 0;
   memcpy(checked, input, length + 1);
   struct profile profile = {.stage = stage};
   failure_code = "parse-error";
   if (!validate(checked, &profile)) return error(failure_code, "TGSI is malformed or outside the documented straight-line profile.");
   struct tgsi_token tokens[BRIDGE_MAX_TOKENS];
   memset(tokens, 0, sizeof(tokens));
   upstream_logged = false;
   if (!tgsi_text_translate(input, tokens, BRIDGE_MAX_TOKENS)) return error("parse-error", "Upstream TGSI validation rejected the shader.");
   struct vrend_shader_cfg cfg = {.glsl_version = 300, .max_draw_buffers = 1, .use_gles = 1, .use_core_profile = 1, .use_integer = 1};
   struct vrend_shader_key key = {0};
   if (stage == 1) key.fs.lower_left_origin = 1;
   struct vrend_shader_info info = {0};
   struct vrend_variable_shader_info variable = {0};
   struct vrend_strarray shader = {0};
   if (!strarray_alloc(&shader, SHADER_MAX_STRINGS)) return error("translation-error", "Shader output allocation failed.");
   bool converted = vrend_convert_shader(NULL, &cfg, tokens, 0, &key, &info, &variable, &shader);
   size_t total = 0;
   for (int i = 0; i < shader.num_strings; ++i) total += strlen(shader.strings[i].buf);
   if (!converted || upstream_logged || total > BRIDGE_MAX_GLSL) {
      strarray_free(&shader, true); free(info.sampler_arrays); free(info.image_arrays);
      return error("translation-error", "Upstream translation failed, logged a diagnostic, or exceeded the output bound.");
   }
   response_used = 0; response_overflow = false;
   append("{\"ok\":true,\"glsl\":\"");
   for (int i = 0; i < shader.num_strings; ++i) {
      /* Append one JSON string's contents without its surrounding quotes. */
      for (const char *p = shader.strings[i].buf; *p; ++p) {
         unsigned char c = (unsigned char)*p;
         if (c == '"' || c == '\\') append("\\%c", c);
         else if (c < 32) append("\\u%04x", c);
         else append("%c", c);
      }
   }
   append("\",\"metadata\":{\"profile\":\"virgl-webgl2-straight-line-v2\",\"stage\":\"%s\",\"inputs\":", stage ? "fragment" : "vertex");
   io_metadata(&profile, IN); append(",\"outputs\":"); io_metadata(&profile, OUT);
   append(",\"attributes\":");
   if (!stage) io_metadata(&profile, IN); else append("[]");
   append(",\"uniforms\":[");
   if (info.num_consts) append("{\"name\":\"%sconst0\",\"type\":\"uvec4[]\",\"count\":%d,\"encoding\":\"float32-bits\"}", stage ? "fs" : "vs", info.num_consts);
   append("],\"samplers\":[");
   bool comma = false;
   for (unsigned i = 0; i < 8; ++i) if (info.samplers_used_mask & (1u << i)) {
      append("%s{\"index\":%u,\"name\":\"fssamp%u\",\"type\":\"sampler2D\"}", comma ? "," : "", i, i); comma = true;
   }
   append("],\"uniformBlocks\":[");
   if (!stage) append("{\"name\":\"VirglBlock\",\"byteLength\":656,\"members\":[{\"name\":\"winsys_adjust_y\",\"offset\":640,\"type\":\"float\",\"default\":1}]}" );
   append("]}}");
   strarray_free(&shader, true); free(info.sampler_arrays); free(info.image_arrays);
   if (response_overflow) return error("translation-error", "JSON output exceeded its bound.");
   return response;
}
