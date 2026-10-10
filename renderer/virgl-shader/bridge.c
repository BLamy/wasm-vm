/* SPDX-License-Identifier: MIT
 * Bounded profile adapter around the unmodified upstream VirGL compiler.
 * The guard validates a deliberately small language before upstream's general
 * TGSI parser sees it. No unbounded numeric/range value, unsupported property,
 * indirect address, unsupported stage, or control-flow token reaches upstream.
 * Checked indirect constants use the owned raw backend exclusively.
 */
#include "bridge.h"
#include "checked_tgsi_heap.h"
#include "checked_upstream.h"
#include "raw_bits.h"
#include "private_92cb_inputs.h"
#include "standard_guard.h"
#include "standard_emit.h"
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

static char single_response[BRIDGE_MAX_RESULT];
static char pair_response[BRIDGE_MAX_PAIR_RESULT];
static char *response = single_response;
static size_t response_capacity = sizeof(single_response);
static size_t response_used;
static bool response_overflow;
static bool upstream_logged;
static const char *failure_code;
/* Public unsupported-feature also covers syntax. Only this typed failure may
 * retry with compiler-derived finite-bank authority. */
static bool missing_numeric_authority;
static bool missing_initialization;

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
   int n = vsnprintf(response + response_used, response_capacity - response_used, fmt, args);
   va_end(args);
   if (n < 0 || (size_t)n >= response_capacity - response_used) {
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
static bool index_number(const char **p, unsigned *result, unsigned limit)
{
   space(p);
   if (**p < '0' || **p > '9') { failure_code = "unsupported-feature"; return false; }
   unsigned value = 0, digits = 0;
   bool zero = **p == '0';
   while (isdigit((unsigned char)**p)) {
      unsigned digit = (unsigned)(**p - '0');
      if (++digits > 3 || (zero && digits > 1) || value > (limit - 1) / 10 ||
          (value == (limit - 1) / 10 && digit > (limit - 1) % 10)) {
         failure_code = "unsupported-feature";
         return false;
      }
      value = value * 10 + digit;
      ++*p;
   }
   *result = value;
   return true;
}
static unsigned register_limit(const struct profile *s, unsigned file)
{
   return file == TEMP ? TEMP_REGISTERS : file == CONST ?
      (!s->stage && !s->raw ? BRIDGE_MAX_VERTEX_CONSTANTS : CONST_REGISTERS) :
      file == IMM ? IMM_REGISTERS : FILE_REGISTERS;
}
static bool register_name(const char **p, const struct profile *s, struct reg *r, enum operand_kind kind)
{
   if (word(p, "ADDR")) {
      failure_code = "unsupported-feature";
      if (kind == SOURCE || !punctuation(p, '[') || !index_number(p, &r->index, 1) || !punctuation(p, ']')) return false;
      r->file = ADDR; r->last = 0; r->mask = 1;
      for (unsigned i = 0; i < 4; ++i) r->swizzle[i] = 0;
      r->explicit_mask = punctuation(p, '.');
      if (r->explicit_mask && !word(p, "x")) return false;
      return kind == DECLARATION || r->explicit_mask;
   }
   static const char *names[] = {"IN", "OUT", "TEMP", "CONST", "IMM", "SAMP", "SVIEW"};
   unsigned f;
   for (f = 0; f < FILE_COUNT; ++f) if (word(p, names[f])) break;
   if (f == FILE_COUNT || !punctuation(p, '[')) return false;
   bool indirect = f == CONST && word(p, "ADDR");
   if (indirect) {
      failure_code = "unsupported-feature";
      if (kind != SOURCE || !punctuation(p, '[') || !index_number(p, &r->index, 1) ||
          !punctuation(p, ']') || !punctuation(p, '.') || !word(p, "x")) return false;
   } else if (!index_number(p, &r->index, register_limit(s, f))) return false;
   r->file = indirect ? INDIRECT_CONST : (enum file)f;
   r->last = r->index;
   space(p);
   if (!strncmp(*p, "..", 2)) {
      if (kind != DECLARATION || (f != TEMP && f != CONST)) { failure_code = "unsupported-feature"; return false; }
      *p += 2;
      if (!index_number(p, &r->last, register_limit(s, f)) || r->last < r->index) return false;
   }
   if (!punctuation(p, ']')) return false;
   r->mask = 15;
   for (unsigned i = 0; i < 4; ++i) r->swizzle[i] = i;
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
         r->swizzle[count - 1] = component;
         r->mask |= 1u << component;
         ++*p;
      }
      if (kind == SOURCE) {
         if (count != 4) return false;
      } else if (!((count == 2 && !strncmp(begin, "xy", 2)) ||
                   (count == 3 && !strncmp(begin, "xyz", 3)) ||
                   (kind == DESTINATION && count != 0))) {
         failure_code = "unsupported-feature";
         return false;
      }
   }
   return true;
}
static bool source(const char **p, struct profile *s, unsigned consumed, struct raw_source *operand,
                   enum raw_opcode opcode, unsigned role)
{
   struct reg r;
   bool dead = !s->syntax_only && (s->raw_flags & RAW_BRANCH_RETRY) && !s->live;
   if (!register_name(p, s, &r, SOURCE)) return false;
   /* Handle the checked indirect tag BEFORE any ordinary file-array lookup. */
   if (r.file != INDIRECT_CONST &&
       (r.file == OUT || r.file >= SAMP || !s->declared[r.file][r.index])) return false;
   /* Match tgsi_util_get_inst_usage_mask: choose opcode/destination lanes
    * first, then map each through its ordered source selector. */
   unsigned needed = 0;
   for (unsigned lane = 0; lane < 4; ++lane)
      if (consumed & (1u << lane)) needed |= 1u << r.swizzle[lane];
   if (r.file == INDIRECT_CONST) {
      failure_code = "unsupported-feature";
      if (!s->raw || !s->address_declared) return false;
      if (s->raw_flags & RAW_BRANCH_RETRY) {
         bool declared = false;
         for (unsigned i = 0; i < CONST_REGISTERS; ++i)
            declared |= s->declared[CONST][i] && (s->components[CONST][i] & needed) == needed;
         if (!declared) return false;
      }
      if (dead) s->dead_indirect = true;
      if (!s->syntax_only && !dead) {
         if (!s->address_written) return false;
         uint64_t candidates = 0;
         if (s->raw->loop.checked)
            for (unsigned use = 0; use < 4; ++use)
               if (s->current_pc == s->raw->loop.access[use].read) candidates = s->raw->loop.access[use].candidates;
         if (!candidates) {
            struct raw_lane address = s->raw->address;
            /* The unsigned maximum bounds ALL compatible known-bit words. */
            if ((address.zero & address.one) || (uint32_t)~address.zero >= CONST_REGISTERS) return false;
            for (unsigned i = 0; i < CONST_REGISTERS; ++i)
               if (!(i & address.zero) && !((uint32_t)~i & address.one)) candidates |= UINT64_C(1) << i;
         }
         if (!candidates || candidates >> CONST_REGISTERS) return false;
         for (unsigned i = 0; i < CONST_REGISTERS; ++i) if (candidates & (UINT64_C(1) << i))
            if (!s->declared[CONST][i] || (s->components[CONST][i] & needed) != needed) return false;
         s->raw->indirect_indices |= candidates;
      }
   } else if ((s->components[r.file][r.index] & needed) != needed) return false;
   if (!s->syntax_only && !dead && r.file == TEMP && (s->written[TEMP][r.index] & needed) != needed) {
      const struct demand_certificate *c = s->raw ? &s->raw->demand : NULL;
      bool permitted = c && c->checked && role == 1 &&
         ((s->current_pc == c->lrp && opcode == RAW_LRP) ||
          (s->current_pc == c->select && opcode == RAW_UCMP));
      if (permitted) {
         const struct raw_source *bound = &s->raw->instructions[s->current_pc].src[1];
         permitted = bound->file == r.file && bound->index == r.index &&
            !memcmp(bound->swizzle, r.swizzle, sizeof(r.swizzle));
      }
      if (!permitted) { missing_initialization = true; return false; }
   }
   if (operand) {
      operand->file = r.file;
      operand->index = r.index;
      memcpy(operand->swizzle, r.swizzle, sizeof(operand->swizzle));
   }
   return true;
}
static bool literal_float(const char **p, uint32_t *bits)
{
   space(p);
   const char *begin = *p;
   if (begin[0] == '0' && begin[1] == 'x') {
      /* Pinned TGSI text: 0x plus eight hexadecimal digits is a binary32
       * encoding, not an integer-to-float conversion. Validate before upstream. */
      const char *cur = begin + 2;
      uint32_t value = 0;
      for (unsigned i = 0; i < 8; ++i) {
         unsigned char c = (unsigned char)*cur++;
         unsigned digit;
         if (c >= '0' && c <= '9') digit = c - '0';
         else if (c >= 'a' && c <= 'f') digit = c - 'a' + 10;
         else if (c >= 'A' && c <= 'F') digit = c - 'A' + 10;
         else return false;
         value = (value << 4) | digit;
      }
      const char *after = cur;
      space(&after);
      if (*after != ',' && *after != '}') return false;
      if (bits) *bits = value;
      else {
         float decoded;
         memcpy(&decoded, &value, sizeof(decoded));
         if (((value & UINT32_C(0x7f800000)) == 0 && (value & UINT32_C(0x007fffff)) != 0) ||
             !isfinite(decoded) || fabsf(decoded) > 1000000.0f) {
            failure_code = "unsupported-feature";
            return false;
         }
      }
      *p = cur;
      return true;
   }
   while (**p && strchr("+-0123456789.eE", **p)) ++*p;
   size_t n = (size_t)(*p - begin);
   if (!n || n > 32) return false;
   char number[33]; memcpy(number, begin, n); number[n] = 0;
   char *after;
   errno = 0;
   float value = strtof(number, &after);
   if (errno || *after || !isfinite(value) || fabsf(value) > 1000000.0f) return false;
   if (bits) memcpy(bits, &value, sizeof(value));
   return true;
}

static bool literal_float_bits(const char **p, uint32_t *raw_bits)
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
   if (!digits) return false;
   const char *after = *p;
   space(&after);
   if (*after != ',' && *after != '}') return false;
   if (raw_bits) { *raw_bits = bits; return true; }
   float value;
   memcpy(&value, &bits, sizeof(value));
   if (((bits & UINT32_C(0x7f800000)) == 0 && (bits & UINT32_C(0x007fffff)) != 0) ||
       !isfinite(value) || fabsf(value) > 1000000.0f) {
      failure_code = "unsupported-feature";
      return false;
   }
   return true;
}

static bool declaration(const char **p, struct profile *s)
{
   struct reg r;
   if (s->started || !register_name(p, s, &r, DECLARATION) || r.file == IMM) return false;
   if (r.file == ADDR) {
      failure_code = "unsupported-feature";
      if (!s->raw || s->address_declared || !end(p)) return false;
      s->address_declared = true;
      failure_code = "parse-error";
      return true;
   }
   if (s->raw && !(s->raw_flags & RAW_MIXED) && (r.file == SAMP || r.file == SVIEW)) { failure_code = "unsupported-feature"; return false; }
   for (unsigned i = r.index; i <= r.last; ++i) if (s->declared[r.file][i]) return false;
   unsigned semantic = 0, sid = 0;
   bool flat = false;
   if (r.file == OUT || (r.file == IN && s->stage == 1)) {
      if (!punctuation(p, ',')) return false;
      if (word(p, "POSITION")) {
         if (r.index != 0 || !((s->stage == 0 && r.file == OUT) ||
             (s->stage == 1 && r.file == IN && s->raw))) return false;
         semantic = 1;
      } else if (word(p, "GENERIC")) {
         if (!punctuation(p, '[') || !index_number(p, &sid, FILE_REGISTERS) || !punctuation(p, ']')) return false;
         if (s->stage == 1 && r.file == OUT) return false;
         semantic = 2;
      } else if (word(p, "COLOR")) {
         if (s->stage != 1 || r.file != OUT || r.index != 0) return false;
         semantic = 3;
      } else { failure_code = "unsupported-feature"; return false; }
      for (unsigned i = 0; i < 8; ++i)
         if (s->declared[r.file][i] && s->semantic[r.file][i] == semantic && s->semantic_index[r.file][i] == sid) return false;
      if (s->stage == 1 && r.file == IN) {
         if (!punctuation(p, ',')) return false;
         if (semantic == 1) { if (!word(p, "LINEAR")) return false; }
         else if (word(p, "CONSTANT")) flat = true;
         else if (!word(p, "PERSPECTIVE")) return false;
      }
   } else if (r.file == SVIEW) {
      if (s->stage != 1 || !punctuation(p, ',') || !word(p, "2D") || !punctuation(p, ',') || !word(p, "FLOAT")) return false;
   } else if (r.file == SAMP && s->stage != 1) return false;
   if (r.mask != 15 && (semantic != 2 || (r.mask != 3 && r.mask != 7))) return false;
   if (!end(p)) return false;
   if (r.file == CONST) {
      /* Preserve vrend_shader.c:1961–1965, including a last CONST[0]
       * declaration's extra, guest-inaccessible array element. */
      if (!r.last) ++s->constant_extent;
      else if (r.last + 1 > s->constant_extent) s->constant_extent = r.last + 1;
   }
   for (unsigned i = r.index; i <= r.last; ++i) {
      s->declared[r.file][i] = true;
      s->components[r.file][i] = r.mask;
   }
   if (r.file <= OUT) {
      s->semantic[r.file][r.index] = semantic;
      s->semantic_index[r.file][r.index] = sid;
      s->flat[r.file][r.index] = flat;
   }
   return true;
}

/* The certificate recognizes one typed dependency graph, not source spelling or
 * register numbers. Every operand has already passed the shared syntax parser. */
static unsigned loop_scalar(const struct raw_instruction *i)
{
   if (i->dst.file != TEMP || !i->dst.mask || (i->dst.mask & (i->dst.mask - 1))) return UINT16_MAX;
   unsigned lane = 0;
   while (!(i->dst.mask & (1u << lane))) ++lane;
   return i->dst.index * 4 + lane;
}
static bool loop_arg(const struct raw_instruction *i, unsigned source, unsigned consumed, unsigned lane)
{
   const struct raw_source *r = &i->src[source];
   return lane != UINT16_MAX && r->file == TEMP && r->index == lane / 4 && r->swizzle[consumed] == lane % 4;
}
static bool loop_scalar_arg(const struct raw_instruction *i, unsigned source, unsigned lane)
{
   unsigned dst = loop_scalar(i);
   return dst != UINT16_MAX && loop_arg(i, source, dst % 4, lane);
}
static bool loop_word(const struct raw_ir *ir, const struct raw_instruction *i, unsigned source, unsigned consumed, uint32_t word)
{
   const struct raw_source *r = &i->src[source];
   return r->file == IMM && ir->immediates[r->index][r->swizzle[consumed]] == word;
}
static bool loop_scalar_word(const struct raw_ir *ir, const struct raw_instruction *i, unsigned source, uint32_t word)
{
   unsigned dst = loop_scalar(i);
   return dst != UINT16_MAX && loop_word(ir, i, source, dst % 4, word);
}
static bool loop_count(const struct raw_instruction *i)
{
   unsigned dst = loop_scalar(i);
   return dst != UINT16_MAX && i->src[1].file == CONST && i->src[1].index == 9 && i->src[1].swizzle[dst % 4] == 0;
}
static bool loop_load(const struct raw_instruction *i, bool scalar)
{
   unsigned dst = loop_scalar(i);
   return i->opcode == RAW_MOV && i->dst.file == TEMP && i->src[0].file == INDIRECT_CONST &&
      (scalar ? dst != UINT16_MAX && i->src[0].swizzle[dst % 4] == 0 : i->dst.mask == 15);
}
static bool loop_writes(const struct raw_instruction *i, unsigned lane)
{
   return !((UINT64_C(1) << i->opcode) & RAW_CONTROL_OPCODES) && i->dst.file == TEMP &&
      i->dst.index == lane / 4 && (i->dst.mask & (1u << (lane % 4)));
}

static bool demand_zero(const struct raw_ir *ir, const struct raw_instruction *i, unsigned source, unsigned lane)
{
   const struct raw_source *r = &i->src[source];
   return r->file == IMM && !(ir->immediates[r->index][r->swizzle[lane]] & UINT32_C(0x7fffffff));
}

static uint32_t demand_positive(const struct raw_ir *ir, const struct raw_instruction *i, unsigned source)
{
   unsigned dst = loop_scalar(i);
   const struct raw_source *r = &i->src[source];
   if (dst == UINT16_MAX || r->file != IMM) return 0;
   uint32_t word = ir->immediates[r->index][r->swizzle[dst % 4]];
   return word && word < UINT32_C(0x7f800000) ? word : 0;
}

static bool demand_graph(const struct raw_ir *ir, unsigned join, struct demand_certificate *c)
{
   const struct raw_instruction *v = &ir->instructions[join];
   const enum raw_opcode ops[] = {RAW_ENDIF, RAW_FSLT, RAW_FSLT, RAW_OR,
      RAW_MUL, RAW_ADD, RAW_DIV, RAW_UCMP, RAW_LRP, RAW_FSNE, RAW_UCMP};
   for (unsigned pc = 0; pc < 11; ++pc)
      if (v[pc].opcode != ops[pc] || (v[pc].flags & RAW_NEGATE_SOURCES)) return false;
   unsigned lt = loop_scalar(&v[1]), gt = loop_scalar(&v[2]), condition = loop_scalar(&v[3]);
   unsigned product = loop_scalar(&v[4]), sum = loop_scalar(&v[5]), quotient = loop_scalar(&v[6]);
   unsigned weight = loop_scalar(&v[7]), selector = loop_scalar(&v[9]);
   if (lt == UINT16_MAX || gt == UINT16_MAX || condition == UINT16_MAX || product == UINT16_MAX ||
       sum == UINT16_MAX || quotient == UINT16_MAX || weight == UINT16_MAX || selector == UINT16_MAX ||
       v[1].src[0].file != TEMP || v[8].dst.file != TEMP || v[8].src[1].file != TEMP ||
       v[10].dst.mask != v[8].dst.mask) return false;
   unsigned width = v[1].src[0].index * 4 + v[1].src[0].swizzle[lt % 4];
   uint32_t lower = demand_positive(ir, &v[1], 1), upper = demand_positive(ir, &v[2], 0);
   if (!lower || lower >= upper || !loop_scalar_arg(&v[2], 1, width) ||
       !loop_scalar_arg(&v[3], 0, lt) || !loop_scalar_arg(&v[3], 1, gt) ||
       !loop_scalar_arg(&v[5], 1, product) || !loop_scalar_arg(&v[6], 0, sum) ||
       !loop_scalar_arg(&v[6], 1, width) || !loop_scalar_arg(&v[7], 0, condition) ||
       !demand_zero(ir, &v[7], 1, weight % 4) || !loop_scalar_arg(&v[7], 2, quotient) ||
       !loop_scalar_arg(&v[9], 0, weight) || !demand_zero(ir, &v[9], 1, selector % 4)) return false;
   /* Bind the producer versions, not just register names. In particular a
    * predicate may not overwrite the width or the other live predicate. */
   if (loop_writes(&v[2], lt)) return false;
   for (unsigned pc = 1; pc <= 6; ++pc) if (loop_writes(&v[pc], width)) return false;
   for (unsigned pc = 4; pc <= 6; ++pc) if (loop_writes(&v[pc], condition)) return false;
   if (loop_writes(&v[8], weight)) return false;
   for (unsigned lane = 0; lane < 4; ++lane) if (v[8].dst.mask & (1u << lane)) {
      if (!loop_arg(&v[8], 0, lane, weight) || !loop_arg(&v[10], 0, lane, selector) ||
          !loop_arg(&v[10], 1, lane, v[8].dst.index * 4 + lane) ||
          v[10].src[2].file != v[8].src[2].file || v[10].src[2].index != v[8].src[2].index ||
          v[10].src[2].swizzle[lane] != v[8].src[2].swizzle[lane] ||
          loop_writes(&v[9], v[8].dst.index * 4 + lane)) return false;
      unsigned payload = v[8].src[1].index * 4 + v[8].src[1].swizzle[lane];
      for (unsigned pc = 1; pc <= 7; ++pc)
         if (loop_writes(&v[pc], payload) || (v[8].src[2].file == TEMP &&
             loop_writes(&v[pc], v[8].src[2].index * 4 + v[8].src[2].swizzle[lane]))) return false;
      if (v[8].src[2].file == TEMP &&
          (loop_writes(&v[8], v[8].src[2].index * 4 + v[8].src[2].swizzle[lane]) ||
           loop_writes(&v[9], v[8].src[2].index * 4 + v[8].src[2].swizzle[lane]))) return false;
   }
   *c = (struct demand_certificate){.join = join, .lrp = join + 8, .select = join + 10,
      .width = width, .recognized = true};
   return true;
}

static bool demand_recognize(struct raw_ir *ir)
{
   struct demand_certificate found = {0};
   for (unsigned pc = 0; pc + 10 < ir->count; ++pc) {
      struct demand_certificate candidate;
      if (ir->instructions[pc].opcode == RAW_ENDIF && demand_graph(ir, pc, &candidate)) {
         if (found.recognized) return false;
         found = candidate;
      }
   }
   if (!found.recognized) return false;
   ir->demand = found;
   return true;
}

static bool radial_recognize(struct raw_ir *ir)
{
   struct radial_certificate found = {0};
   for (unsigned pc = 0; pc + 2 < ir->count; ++pc) {
      const struct raw_instruction *v = &ir->instructions[pc];
      unsigned magnitude = loop_scalar(&v[0]), condition = loop_scalar(&v[1]);
      if ((v[0].opcode != RAW_MAX && v[0].opcode != RAW_MAX_PRECISE) ||
          v[1].opcode != RAW_FSLT || v[2].opcode != RAW_UIF ||
          magnitude == UINT16_MAX || condition == UINT16_MAX ||
          (v[0].flags & RAW_NEGATE_SOURCES) != (RAW_NEGATE_SOURCE0 << 1) ||
          (v[1].flags & RAW_NEGATE_SOURCES) ||
          !loop_scalar_arg(&v[1], 0, magnitude) ||
          !loop_scalar_word(ir, &v[1], 1, UINT32_C(0x3727c5ac)) ||
          !loop_arg(&v[2], 0, 0, condition)) continue;
      unsigned lane = magnitude % 4;
      if (v[0].src[0].file != CONST || v[0].src[1].file != CONST ||
          v[0].src[0].index != 4 || v[0].src[1].index != 4 ||
          v[0].src[0].swizzle[lane] != 0 || v[0].src[1].swizzle[lane] != 0) continue;
      unsigned depth = 1, otherwise = 0, end = pc + 3;
      for (; end < ir->count; ++end) {
         enum raw_opcode op = ir->instructions[end].opcode;
         if (op == RAW_UIF) ++depth;
         else if (op == RAW_ELSE && depth == 1) otherwise = end;
         else if (op == RAW_ENDIF && !--depth) break;
      }
      if (!otherwise || end == ir->count || found.recognized) return false;
      /* Adjacency binds both producer versions. The only policy input is the
       * fixed CONST4.x word, not a float shadow or a caller-supplied register. */
      found = (struct radial_certificate){.magnitude = pc, .comparison = pc + 1,
         .branch = pc + 2, .otherwise = otherwise, .end = end,
         .condition = condition, .recognized = true};
   }
   if (!found.recognized) return false;
   ir->radial = found;
   return true;
}
static uint64_t loop_indices(unsigned first, unsigned last)
{
   uint64_t result = 0;
   for (unsigned i = first; i <= last; ++i) result |= UINT64_C(1) << i;
   return result;
}
static bool loop_recognize(struct raw_ir *ir)
{
   unsigned begin = 0, loops = 0, breaks = 0, ends = 0;
   for (unsigned pc = 0; pc < ir->count; ++pc) {
      if (ir->instructions[pc].opcode == RAW_BGNLOOP) { begin = pc; ++loops; }
      breaks += ir->instructions[pc].opcode == RAW_BRK;
      ends += ir->instructions[pc].opcode == RAW_ENDLOOP;
   }
   if (loops != 1 || breaks != 1 || ends != 1 || begin < 3 || begin + 24 >= ir->count) return false;
   const struct raw_instruction *v = &ir->instructions[begin];
   static const enum raw_opcode body[] = {RAW_BGNLOOP, RAW_UARL, RAW_MOV, RAW_FSLT, RAW_ISGE,
      RAW_OR, RAW_UIF, RAW_BRK, RAW_ENDIF, RAW_UADD, RAW_SHL, RAW_UADD, RAW_UADD,
      RAW_USHR, RAW_MOV, RAW_ENDLOOP, RAW_USNE, RAW_UIF, RAW_SHL, RAW_UADD,
      RAW_USHR, RAW_MOV, RAW_UARL, RAW_MOV};
   for (unsigned i = 0; i < sizeof(body) / sizeof(body[0]); ++i) if (v[i].opcode != body[i]) return false;
   unsigned a = loop_scalar(&v[-3]), b = loop_scalar(&v[-2]), j = loop_scalar(&v[-1]);
   if (v[-3].opcode != RAW_MOV || v[-2].opcode != RAW_MOV || v[-1].opcode != RAW_MOV ||
       !loop_scalar_word(ir, &v[-3], 0, 11) || !loop_scalar_word(ir, &v[-2], 0, 16) ||
       !loop_scalar_word(ir, &v[-1], 0, 1) || a == b || a == j || b == j) return false;
   unsigned h = loop_scalar(&v[2]), fp = loop_scalar(&v[3]), ip = loop_scalar(&v[4]);
   unsigned pred = loop_scalar(&v[5]), next = loop_scalar(&v[9]), shift = loop_scalar(&v[10]), num = loop_scalar(&v[12]);
   if (fp == UINT16_MAX || v[3].src[0].file != TEMP) return false;
   unsigned q = v[3].src[0].index * 4 + v[3].src[0].swizzle[fp % 4];
   unsigned roles[] = {a, b, j, h, fp, ip, pred, next, shift, num, q};
   for (unsigned i = 0; i < sizeof(roles) / sizeof(roles[0]); ++i) {
      if (roles[i] == UINT16_MAX) return false;
      for (unsigned k = 0; k < i; ++k) if (roles[i] == roles[k]) return false;
   }
   if (!loop_arg(&v[1], 0, 0, a) || !loop_load(&v[2], true) || !loop_scalar_arg(&v[3], 1, h) ||
       !loop_scalar_arg(&v[4], 0, j) || !loop_count(&v[4]) ||
       !loop_scalar_arg(&v[5], 0, fp) || !loop_scalar_arg(&v[5], 1, ip) || !loop_arg(&v[6], 0, 0, pred) ||
       !loop_scalar_arg(&v[9], 0, j) || !loop_scalar_word(ir, &v[9], 1, 1) ||
       !loop_scalar_arg(&v[10], 0, j) || !loop_scalar_word(ir, &v[10], 1, 4) ||
       loop_scalar(&v[11]) != b || !loop_scalar_arg(&v[11], 0, shift) || !loop_scalar_word(ir, &v[11], 1, 16) ||
       !loop_scalar_word(ir, &v[12], 0, 176) || !loop_scalar_arg(&v[12], 1, shift) ||
       loop_scalar(&v[13]) != a || !loop_scalar_arg(&v[13], 0, num) || !loop_scalar_word(ir, &v[13], 1, 4) ||
       loop_scalar(&v[14]) != j || !loop_scalar_arg(&v[14], 0, next) ||
       !loop_scalar_arg(&v[16], 0, j) || !loop_count(&v[16]) ||
       !loop_arg(&v[17], 0, 0, loop_scalar(&v[16]))) return false;
   /* The true edge of this exact USNE is the relational j<=17 proof. */
   unsigned tail_end = begin + 18;
   while (tail_end < ir->count && !((UINT64_C(1) << ir->instructions[tail_end].opcode) & RAW_CONTROL_OPCODES)) ++tail_end;
   if (tail_end >= ir->count || (ir->instructions[tail_end].opcode != RAW_ELSE && ir->instructions[tail_end].opcode != RAW_ENDIF)) return false;
   unsigned ts = loop_scalar(&v[18]);
   if (!loop_scalar_arg(&v[18], 0, j) || !loop_scalar_word(ir, &v[18], 1, 4) ||
       v[19].dst.file != TEMP || v[19].dst.mask != 3 || v[20].dst.file != TEMP || v[20].dst.mask != 3) return false;
   unsigned nums = v[19].dst.index * 4, addresses = v[20].dst.index * 4;
   for (unsigned lane = 0; lane < 2; ++lane)
      if (!loop_word(ir, &v[19], 0, lane, lane ? 144 : 432) || !loop_arg(&v[19], 1, lane, ts) ||
          !loop_arg(&v[20], 0, lane, nums + lane) || !loop_word(ir, &v[20], 1, lane, 4)) return false;
   if (!loop_scalar_arg(&v[21], 0, addresses + 1) || !loop_arg(&v[22], 0, 0, loop_scalar(&v[21])) ||
       !loop_load(&v[23], true)) return false;
   unsigned upper = 0;
   for (unsigned pc = begin + 24; pc + 6 < tail_end; ++pc) {
      const struct raw_instruction *u = &ir->instructions[pc];
      if (u[0].opcode == RAW_UADD && loop_scalar_word(ir, &u[0], 0, 448) && loop_scalar_arg(&u[0], 1, b) &&
          u[1].opcode == RAW_USHR && loop_scalar_arg(&u[1], 0, loop_scalar(&u[0])) && loop_scalar_word(ir, &u[1], 1, 4) &&
          u[2].opcode == RAW_UARL && loop_arg(&u[2], 0, 0, loop_scalar(&u[1])) && loop_load(&u[3], false) &&
          u[4].opcode == RAW_MOV && loop_scalar_arg(&u[4], 0, addresses) &&
          u[5].opcode == RAW_UARL && loop_arg(&u[5], 0, 0, loop_scalar(&u[4])) && loop_load(&u[6], false)) {
         if (upper) return false;
         upper = pc;
      }
   }
   if (!upper) return false;
   /* Protect the role versions and the lower-address pair until all uses. */
   unsigned protected[] = {a, b, j, h, q};
   for (unsigned pc = begin + 16; pc < tail_end; ++pc) {
      const struct raw_instruction *i = &ir->instructions[pc];
      for (unsigned k = 0; k < sizeof(protected) / sizeof(protected[0]); ++k)
         if (loop_writes(i, protected[k])) return false;
      if (pc > begin + 20 && pc <= upper + 6 && (loop_writes(i, addresses) || loop_writes(i, addresses + 1))) return false;
   }
   /* The pair itself must not overwrite carried roles while being formed. */
   for (unsigned k = 0; k < sizeof(protected) / sizeof(protected[0]); ++k)
      if (loop_writes(&v[19], protected[k]) || loop_writes(&v[20], protected[k])) return false;
   struct loop_certificate c = {.begin = begin, .end = begin + 15, .break_pc = begin + 7,
      .tail_test = begin + 16, .tail_if = begin + 17, .tail_end = tail_end,
      .j = j, .a = a, .b = b, .header = h, .invariant = q, .count_register = 9, .count_component = 0, .checked = true};
   c.access[0].uarl = begin + 1; c.access[0].read = begin + 2; c.access[0].candidates = loop_indices(11, 28);
   c.access[1].uarl = begin + 22; c.access[1].read = begin + 23; c.access[1].candidates = loop_indices(10, 26);
   c.access[2].uarl = upper + 2; c.access[2].read = upper + 3; c.access[2].candidates = loop_indices(29, 45);
   c.access[3].uarl = upper + 5; c.access[3].read = upper + 6; c.access[3].candidates = loop_indices(28, 44);
   ir->loop = c;
   return true;
}

static void loop_header(struct profile *s)
{
   const struct loop_certificate *c = &s->raw->loop;
   /* Only the three certified recurrence lanes carry facts across iterations.
    * Every other body-written lane must be defined afresh before its use. */
   for (unsigned pc = c->begin + 1; pc < c->end; ++pc) {
      const struct raw_instruction *i = &s->raw->instructions[pc];
      if ((UINT64_C(1) << i->opcode) & RAW_CONTROL_OPCODES || i->dst.file != TEMP) continue;
      s->written[TEMP][i->dst.index] &= ~i->dst.mask;
      for (unsigned lane = 0; lane < 4; ++lane) if (i->dst.mask & (1u << lane)) s->raw->temporary[i->dst.index][lane] = (struct raw_lane){0};
   }
   unsigned lanes[] = {c->j, c->a, c->b};
   for (unsigned k = 0; k < 3; ++k) {
      struct raw_lane fact = {.zero = UINT32_MAX, .one = UINT32_MAX};
      for (unsigned j = 1; j <= 18; ++j) {
         uint32_t value = k == 0 ? j : k == 1 ? j + 10 : 16 * j;
         fact.zero &= ~value; fact.one &= value;
      }
      s->raw->temporary[lanes[k] / 4][lanes[k] % 4] = fact;
      s->written[TEMP][lanes[k] / 4] |= 1u << (lanes[k] % 4);
   }
   s->address_written = false; s->raw->address = (struct raw_lane){0};
}

enum { FLOW_DEPTH = BRIDGE_MAX_FLOW_DEPTH };
struct flow_frame {
   struct raw_lane temporary[TEMP_REGISTERS][4], output[FILE_REGISTERS][4];
   unsigned temporary_written[TEMP_REGISTERS], output_written[FILE_REGISTERS];
   unsigned target, else_target;
   bool has_target, has_else, has_else_target, address_written;
   bool is_loop, entry_live, saved_live, exit_live;
   struct raw_lane address;
};
struct flow_context { struct flow_frame frames[FLOW_DEPTH]; unsigned depth; };
_Static_assert(sizeof(struct flow_context) == 433092, "bounded conditional heap arena");

/* A frame initially owns entry state. ELSE swaps it with the completed true
 * predecessor, so only one snapshot per level is needed. Declarations and
 * recorded instructions are global and never participate in this swap. */
static void flow_snapshot(struct profile *s, struct flow_frame *frame, bool swap)
{
   bool written = frame->address_written;
   struct raw_lane address = frame->address;
   frame->address_written = s->address_written;
   frame->address = s->raw->address;
   if (swap) { s->address_written = written; s->raw->address = address; }
   for (unsigned file = OUT; file <= TEMP; ++file) {
      unsigned count = file == TEMP ? TEMP_REGISTERS : FILE_REGISTERS;
      unsigned *saved_written = file == TEMP ? frame->temporary_written : frame->output_written;
      struct raw_lane (*saved)[4] = file == TEMP ? frame->temporary : frame->output;
      struct raw_lane (*current)[4] = file == TEMP ? s->raw->temporary : s->raw->output;
      for (unsigned index = 0; index < count; ++index) {
         unsigned written = saved_written[index];
         saved_written[index] = s->written[file][index];
         if (swap) s->written[file][index] = written;
         for (unsigned lane = 0; lane < 4; ++lane) {
            struct raw_lane value = saved[index][lane];
            saved[index][lane] = current[index][lane];
            if (swap) current[index][lane] = value;
         }
      }
   }
}

static void flow_join(struct profile *s, const struct flow_frame *frame)
{
   s->address_written &= frame->address_written;
   s->raw->address = s->address_written ?
      raw_join(s->raw->address, frame->address) : (struct raw_lane){0};
   for (unsigned file = OUT; file <= TEMP; ++file) {
      unsigned count = file == TEMP ? TEMP_REGISTERS : FILE_REGISTERS;
      const unsigned *saved_written = file == TEMP ? frame->temporary_written : frame->output_written;
      const struct raw_lane (*saved)[4] = file == TEMP ? frame->temporary : frame->output;
      struct raw_lane (*current)[4] = file == TEMP ? s->raw->temporary : s->raw->output;
      for (unsigned index = 0; index < count; ++index) {
         s->written[file][index] &= saved_written[index];
         for (unsigned lane = 0; lane < 4; ++lane)
            current[index][lane] = s->written[file][index] & (1u << lane) ?
               raw_join(current[index][lane], saved[index][lane]) : (struct raw_lane){0};
      }
   }
}

static bool demand_join(struct profile *s, const struct flow_frame *frame)
{
   struct demand_certificate *c = &s->raw->demand;
   if (!c->recognized || s->current_pc != c->join) return true;
   if (!frame->has_else || !s->live || !frame->saved_live) return false;
   unsigned width = c->width;
   struct raw_lane zero = s->raw->temporary[width / 4][width % 4];
   if (!(s->written[TEMP][width / 4] & (1u << (width % 4))) ||
       (zero.zero | zero.one) != UINT32_MAX || (zero.one & UINT32_C(0x7fffffff))) return false;
   const struct raw_instruction *lrp = &s->raw->instructions[c->lrp];
   const struct raw_source *payload = &lrp->src[1];
   unsigned needed = 0;
   for (unsigned lane = 0; lane < 4; ++lane) if (lrp->dst.mask & (1u << lane)) {
      unsigned component = payload->swizzle[lane];
      needed |= 1u << component;
      if (!(frame->temporary_written[payload->index] & (1u << component))) return false;
      c->payload[lane] = frame->temporary[payload->index][component];
   }
   c->missing = needed & ~s->written[TEMP][payload->index];
   if (!c->missing) return false;
   /* ELSE's saved snapshot is the initialized predecessor. The current
    * zero-width predecessor is discarded by the bound integer selector.
    * The normal join below still intersects every initialization mask. */
   c->checked = true;
   return true;
}

static bool control(const char **p, struct profile *s, struct flow_context *flow, enum raw_opcode opcode)
{
   failure_code = "unsupported-feature";
   struct raw_instruction raw = {.opcode = opcode, .flags = s->raw_flags};
   bool pruning = !s->syntax_only && (s->raw_flags & RAW_BRANCH_RETRY);
   if (pruning && !s->live) raw.flags |= RAW_DEAD;
   bool loop = opcode == RAW_BGNLOOP || opcode == RAW_ENDLOOP;
   if (opcode == RAW_UIF && !source(p, s, 1u, &raw.src[0], opcode, 0)) return false;
   unsigned target = 0;
   bool has_target = opcode != RAW_ENDIF && opcode != RAW_BRK && punctuation(p, ':');
   if (loop) {
      if (!has_target || !index_number(p, &target, BRIDGE_MAX_INSTRUCTIONS) || target != 0) return false;
   } else if (has_target && (!index_number(p, &target, BRIDGE_MAX_INSTRUCTIONS) || target <= s->instructions)) return false;
   if (!end(p) || s->instructions >= BRIDGE_MAX_INSTRUCTIONS) return false;
   if (opcode == RAW_UIF || opcode == RAW_BGNLOOP) {
      if (flow->depth == FLOW_DEPTH) return false;
      if (opcode == RAW_BGNLOOP) {
         for (unsigned i = 0; i < flow->depth; ++i) if (flow->frames[i].is_loop) return false;
         if (!s->syntax_only && (!s->raw->loop.checked || s->current_pc != s->raw->loop.begin)) return false;
      }
      struct flow_frame *frame = &flow->frames[flow->depth++];
      frame->is_loop = opcode == RAW_BGNLOOP;
      frame->target = target; frame->has_target = has_target;
      frame->has_else = frame->has_else_target = false;
      frame->entry_live = s->live; frame->saved_live = frame->exit_live = false;
      if (!s->syntax_only) {
         if (frame->is_loop) { if (!pruning || s->live) loop_header(s); }
         else flow_snapshot(s, frame, false);
         if (!frame->is_loop && pruning && s->live) {
            int truth = raw_uif_truth(s->raw, &raw.src[0]);
            if (truth >= 0) {
               raw.flags |= truth ? RAW_UIF_TRUE : RAW_UIF_FALSE;
               s->raw->opcode_mask |= RAW_BRANCH_LIVENESS_USED;
               if (truth) frame->entry_live = false;
               else s->live = false;
            }
         }
         if (!frame->is_loop && s->raw->radial.recognized &&
             s->current_pc == s->raw->radial.branch) {
            /* The owned finite bank must satisfy the coefficient domain
             * before execution. Its bound predicate cannot take this edge.
             * ELSE restores entry_live; ENDIF joins only live predecessors. */
            s->live = false;
            s->raw->radial.used = true;
         }
      }
   } else if (opcode == RAW_BRK) {
      unsigned depth = flow->depth;
      while (depth && !flow->frames[depth - 1].is_loop) --depth;
      if (!depth) return false;
      if (!s->syntax_only) {
         struct flow_frame *frame = &flow->frames[depth - 1];
         if (s->current_pc != s->raw->loop.break_pc || (!s->live && (!pruning || frame->entry_live))) return false;
         if (s->live) {
            flow_snapshot(s, frame, false); frame->exit_live = true;
            s->live = false;
         }
      }
   } else {
      if (!flow->depth) return false;
      struct flow_frame *frame = &flow->frames[flow->depth - 1];
      if (opcode == RAW_ENDLOOP) {
         bool dead_loop = pruning && !frame->entry_live;
         if (!frame->is_loop || (!s->syntax_only && (s->current_pc != s->raw->loop.end || (!frame->exit_live && !dead_loop)))) return false;
         if (!s->syntax_only) {
            if (!dead_loop) { flow_snapshot(s, frame, true); s->live = true; raw.flags &= ~RAW_DEAD; }
            else s->live = false;
         }
         --flow->depth;
      } else {
         if (frame->is_loop) return false;
         if (opcode == RAW_ELSE) {
            if (frame->has_else || (frame->has_target && frame->target != s->instructions)) return false;
            frame->has_else = true; frame->has_else_target = has_target; frame->else_target = target;
            frame->saved_live = s->live; s->live = frame->entry_live;
            if (!s->syntax_only) flow_snapshot(s, frame, true);
         } else {
            if ((frame->has_else ? frame->has_else_target && frame->else_target != s->instructions :
                 frame->has_target && frame->target != s->instructions)) return false;
            bool other_live = frame->has_else ? frame->saved_live : frame->entry_live;
            if (!s->syntax_only && !demand_join(s, frame)) return false;
            if (!s->syntax_only && other_live) {
               if (s->live) flow_join(s, frame);
               else flow_snapshot(s, frame, true);
            }
            s->live |= other_live;
            --flow->depth;
         }
      }
   }
   ++s->instructions;
   if (s->syntax_only) s->raw->instructions[s->raw->count++] = raw;
   else raw_record(s->raw, &raw);
   failure_code = "parse-error";
   return true;
}

static bool discard_instruction(const char **p, struct profile *s, enum raw_opcode opcode)
{
   failure_code = "unsupported-feature";
   if (!s->raw || s->stage != 1 || s->instructions >= BRIDGE_MAX_INSTRUCTIONS) return false;
   struct raw_instruction raw = {.opcode = opcode, .flags = s->raw_flags};
   if (opcode == RAW_KILL_IF) {
      if (punctuation(p, '-')) raw.flags |= RAW_NEGATE_SOURCE0;
      bool absolute = punctuation(p, '|');
      if (absolute) raw.flags |= RAW_ABSOLUTE_SOURCE0;
      if (!source(p, s, 15u, &raw.src[0], opcode, 0) || (absolute && !punctuation(p, '|'))) return false;
   }
   if (!end(p)) return false;
   ++s->instructions;
   if (s->syntax_only) s->raw->instructions[s->raw->count++] = raw;
   else {
      if ((s->raw_flags & RAW_BRANCH_RETRY) && !s->live) {
         raw.flags |= RAW_DEAD;
         s->raw->instructions[s->raw->count++] = raw;
      } else {
         if (raw_discard_guaranteed(s->raw, &raw)) {
            s->live = false;
            raw.flags |= RAW_TERMINATING_DISCARD;
         }
         raw_record(s->raw, &raw);
      }
   }
   failure_code = "parse-error";
   return true;
}

static bool instruction(const char **p, struct profile *s, struct flow_context *flow)
{
   s->current_pc = s->instructions;
   unsigned arity;
   bool tex = false, partial = false;
   struct raw_instruction raw = {0};
   if (word(p, "END")) {
      if (flow && flow->depth) { failure_code = "unsupported-feature"; return false; }
      s->ended = true; return end(p);
   }
   if (word(p, "KILL_IF")) return discard_instruction(p, s, RAW_KILL_IF);
   if (word(p, "KILL")) return discard_instruction(p, s, RAW_KILL);
   if (flow) {
      if (word(p, "BGNLOOP")) return control(p, s, flow, RAW_BGNLOOP);
      if (word(p, "BRK")) return control(p, s, flow, RAW_BRK);
      if (word(p, "ENDLOOP")) return control(p, s, flow, RAW_ENDLOOP);
      if (word(p, "UIF")) return control(p, s, flow, RAW_UIF);
      if (word(p, "ELSE")) return control(p, s, flow, RAW_ELSE);
      if (word(p, "ENDIF")) return control(p, s, flow, RAW_ENDIF);
   }
   if (s->raw && word(p, "MOV_PRECISE")) {
      arity = 1; partial = true; raw.flags = RAW_PRECISE;
   } else if (word(p, "MOV")) { arity = 1; partial = true; }
   else if (s->raw) {
      if (word(p, "MOV_SAT")) raw.opcode = RAW_MOV_SAT;
      else if (word(p, "DIV_SAT")) raw.opcode = RAW_DIV_SAT;
      else if (word(p, "EX2")) raw.opcode = RAW_EX2;
      else if (word(p, "LG2")) raw.opcode = RAW_LG2;
      else if (word(p, "SIN")) raw.opcode = RAW_SIN;
      else if (word(p, "POW")) raw.opcode = RAW_POW;
      else if (word(p, "FSEQ_PRECISE")) { raw.opcode = RAW_FSEQ; raw.flags = RAW_PRECISE; }
      else if (word(p, "FSNE_PRECISE")) { raw.opcode = RAW_FSNE; raw.flags = RAW_PRECISE; }
      else if (word(p, "MAX_PRECISE")) { raw.opcode = RAW_MAX_PRECISE; raw.flags = RAW_PRECISE; }
      else if (word(p, "MIN_PRECISE")) { raw.opcode = RAW_MIN_PRECISE; raw.flags = RAW_PRECISE; }
      else if (word(p, "FRC_PRECISE")) { raw.opcode = RAW_FRC_PRECISE; raw.flags = RAW_PRECISE; }
      else if (word(p, "ADD_PRECISE")) { raw.opcode = RAW_ADD_PRECISE; raw.flags = RAW_PRECISE; }
      else if (word(p, "MUL_PRECISE")) { raw.opcode = RAW_MUL_PRECISE; raw.flags = RAW_PRECISE; }
      else if (word(p, "UARL")) raw.opcode = RAW_UARL;
      else if (word(p, "AND")) raw.opcode = RAW_AND;
      else if (word(p, "OR")) raw.opcode = RAW_OR;
      else if (word(p, "NOT")) raw.opcode = RAW_NOT;
      else if (word(p, "SHL")) raw.opcode = RAW_SHL;
      else if (word(p, "USHR")) raw.opcode = RAW_USHR;
      else if (word(p, "UADD")) raw.opcode = RAW_UADD;
      else if (word(p, "ISGE")) raw.opcode = RAW_ISGE;
      else if (word(p, "ISLT")) raw.opcode = RAW_ISLT;
      else if (word(p, "IMAX")) raw.opcode = RAW_IMAX;
      else if (word(p, "I2F")) raw.opcode = RAW_I2F;
      else if (word(p, "F2I")) raw.opcode = RAW_F2I;
      else if (word(p, "TRUNC")) raw.opcode = RAW_TRUNC;
      else if (word(p, "SSG")) raw.opcode = RAW_SSG;
      else if (word(p, "USEQ")) raw.opcode = RAW_USEQ;
      else if (word(p, "USNE")) raw.opcode = RAW_USNE;
      else if (word(p, "UCMP")) raw.opcode = RAW_UCMP;
      else if (word(p, "FSLT")) raw.opcode = RAW_FSLT;
      else if (word(p, "FSGE")) raw.opcode = RAW_FSGE;
      else if (word(p, "FSEQ")) raw.opcode = RAW_FSEQ;
      else if (word(p, "FSNE")) raw.opcode = RAW_FSNE;
      else if (word(p, "ADD")) raw.opcode = RAW_ADD;
      else if (word(p, "MUL")) raw.opcode = RAW_MUL;
      else if (word(p, "MAD")) raw.opcode = RAW_MAD;
      else if (word(p, "TEX")) raw.opcode = RAW_TEX;
      else if (word(p, "DIV")) raw.opcode = RAW_DIV;
      else if (word(p, "MAX")) raw.opcode = RAW_MAX;
      else if (word(p, "MIN")) raw.opcode = RAW_MIN;
      else if (word(p, "FRC")) raw.opcode = RAW_FRC;
      else if (word(p, "LRP")) raw.opcode = RAW_LRP;
      else if (word(p, "DP3")) raw.opcode = RAW_DP3;
      else if (word(p, "RCP")) raw.opcode = RAW_RCP;
      else if (word(p, "RSQ")) raw.opcode = RAW_RSQ;
      else { failure_code = "unsupported-feature"; return false; }
      tex = raw.opcode == RAW_TEX;
      arity = raw.opcode == RAW_MOV_SAT || raw.opcode == RAW_UARL || raw.opcode == RAW_NOT || raw.opcode == RAW_FRC || raw.opcode == RAW_FRC_PRECISE ||
         raw.opcode == RAW_RCP || raw.opcode == RAW_RSQ || raw.opcode == RAW_EX2 || raw.opcode == RAW_LG2 || raw.opcode == RAW_SIN || raw.opcode == RAW_I2F || raw.opcode == RAW_F2I ||
         raw.opcode == RAW_TRUNC || raw.opcode == RAW_SSG || tex ? 1 :
         raw.opcode == RAW_UCMP || raw.opcode == RAW_MAD || raw.opcode == RAW_LRP ? 3 : 2;
      partial = !tex && raw.opcode != RAW_MAD;
      /* These formerly unsupported numeric tokens retain that error category
       * for malformed syntax and unproven domains in an owned raw stage. */
      if (raw.opcode == RAW_UARL || ((UINT64_C(1) << raw.opcode) & (RAW_NUMERIC_OPCODES | RAW_ARITHMETIC_OPCODES | RAW_CONVERSION_OPCODES | RAW_FRACTION_OPCODES))) failure_code = "unsupported-feature";
   }
   else if (word(p, "ADD") || word(p, "MUL")) { arity = 2; partial = true; }
   else if (word(p, "MAD")) arity = 3;
   else if (word(p, "TEX")) { tex = true; arity = 1; }
   else { failure_code = "unsupported-feature"; return false; }
   if (++s->instructions > BRIDGE_MAX_INSTRUCTIONS) return false;
   struct reg dst;
   if (!register_name(p, s, &dst, DESTINATION)) return false;
   if (raw.opcode == RAW_UARL) {
      if (dst.file != ADDR || !s->address_declared) return false;
   } else if ((dst.file != OUT && dst.file != TEMP) || !s->declared[dst.file][dst.index] ||
              (s->components[dst.file][dst.index] & dst.mask) != dst.mask) return false;
   if (dst.explicit_mask && !partial) { failure_code = "unsupported-feature"; return false; }
   unsigned consumed = s->raw ? raw_consumed_mask(raw.opcode, dst.mask) : tex ? 3u : dst.mask;
   for (unsigned i = 0; i < arity; ++i) {
      if (!punctuation(p, ',')) return false;
      /* A modifier belongs only to a numeric operand; samplers, raw selectors
       * and bitwise payloads never pass through this typed minus parser. */
      bool arithmetic = s->raw && ((UINT64_C(1) << raw.opcode) & RAW_ARITHMETIC_OPCODES);
      if (s->raw && (((UINT64_C(1) << raw.opcode) & (RAW_NUMERIC_OPCODES | RAW_ARITHMETIC_OPCODES)) ||
          raw.opcode == RAW_MAX_PRECISE || raw.opcode == RAW_MIN_PRECISE || raw.opcode == RAW_FRC_PRECISE || raw.opcode == RAW_F2I) && punctuation(p, '-'))
         raw.flags |= RAW_NEGATE_SOURCE0 << i;
      bool absolute = (arithmetic || raw.opcode == RAW_F2I) && punctuation(p, '|');
      if (absolute) raw.flags |= RAW_ABSOLUTE_SOURCE0 << i;
      if (!source(p, s, consumed, s->raw ? &raw.src[i] : NULL, raw.opcode, i)) return false;
      if (absolute && !punctuation(p, '|')) return false;
   }
   if (tex) {
      struct reg sampler;
      if (s->stage != 1 || !punctuation(p, ',') || !register_name(p, s, &sampler, SOURCE) || sampler.file != SAMP || sampler.explicit_mask ||
          !s->declared[SAMP][sampler.index] || !s->declared[SVIEW][sampler.index] || !punctuation(p, ',') || !word(p, "2D")) return false;
      raw.sampler = sampler.index;
   }
   if (!end(p)) return false;
   if (s->raw) {
      raw.dst = (struct raw_destination){dst.file, dst.index, dst.mask};
      raw.flags |= s->raw_flags;
      if (!s->syntax_only && (s->raw_flags & RAW_BRANCH_RETRY) && !s->live) {
         /* The earlier whole-text syntax pass validated this original slot.
          * Keep its index, but publish no lane, address, domain or written fact. */
         raw.flags |= RAW_DEAD;
         s->raw->instructions[s->raw->count++] = raw;
         failure_code = "parse-error";
         return true;
      }
      if (!s->syntax_only && s->raw->demand.checked && s->current_pc == s->raw->demand.lrp)
         raw.flags |= RAW_GUARDED_LRP;
      if (s->syntax_only) s->raw->instructions[s->raw->count++] = raw;
      else if (!raw_record(s->raw, &raw)) {
         missing_numeric_authority = true;
         failure_code = "unsupported-feature";
         return false;
      }
   }
   if (dst.file == ADDR) s->address_written = true;
   else if (raw.flags & RAW_GUARDED_LRP) s->written[dst.file][dst.index] &= ~dst.mask;
   else s->written[dst.file][dst.index] |= dst.mask;
   failure_code = "parse-error";
   return true;
}

static bool validate_body(char *text, struct profile *s, struct flow_context *flow)
{
   char *save = NULL;
   bool header = false;
   unsigned line_count = 0;
   for (char *line = strtok_r(text, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
      const char *p = line;
      if (end(&p)) continue;
      if (++line_count > BRIDGE_MAX_LINES || strlen(line) > BRIDGE_MAX_LINE_BYTES || s->ended) return false;
      if (!header) {
         header = true;
         if (word(&p, s->stage == 0 ? "FRAG" : "VERT")) { failure_code = "unsupported-stage"; return false; }
         if (!word(&p, s->stage == 0 ? "VERT" : "FRAG") || !end(&p)) return false;
      } else if (word(&p, "DCL")) {
         if (!declaration(&p, s)) return false;
      } else if (word(&p, "IMM")) {
         unsigned i;
         if (s->started || !punctuation(&p, '[') || !index_number(&p, &i, IMM_REGISTERS) || i != s->immediates || !punctuation(&p, ']')) return false;
         bool bits = false;
         if (!word(&p, "FLT32")) {
            if (!word(&p, "UINT32")) return false;
            bits = true;
         }
         if (!punctuation(&p, '{')) return false;
         for (unsigned c = 0; c < 4; ++c) {
            uint32_t *value = s->raw ? &s->raw->immediates[i][c] : NULL;
            if ((c && !punctuation(&p, ',')) || !(bits ? literal_float_bits(&p, value) : literal_float(&p, value))) return false;
         }
         if (!punctuation(&p, '}') || !end(&p)) return false;
         s->declared[IMM][i] = true; s->components[IMM][i] = 15; ++s->immediates;
      } else if (word(&p, "PROPERTY")) {
         failure_code = "unsupported-feature";
         if (s->stage != 1 || s->started) return false;
         if (word(&p, "FS_COORD_ORIGIN")) {
            if (!s->raw || s->coordinate_origin_property || !word(&p, "LOWER_LEFT") || !end(&p)) return false;
            s->coordinate_origin_property = true;
         } else if (word(&p, "FS_COORD_PIXEL_CENTER")) {
            if (!s->raw || s->coordinate_center_property || !word(&p, "HALF_INTEGER") || !end(&p)) return false;
            s->coordinate_center_property = true;
         } else {
            if (s->color0_property || !word(&p, "FS_COLOR0_WRITES_ALL_CBUFS") || !word(&p, "1") || !end(&p)) return false;
            /* Fixed cfg.max_draw_buffers=1 makes this exactly COLOR0, not MRT. */
            s->color0_property = true;
         }
         failure_code = "parse-error";
      } else {
         s->started = true;
         /* The two validated TGSI properties and POSITION declaration already
          * precede the first instruction. Make that checked coordinate source
          * visible to the raw interpreter before its first IN[0] read. Final
          * validation below still rejects an incomplete convention. */
         if (s->raw && s->stage == 1 && s->declared[IN][0] &&
             s->semantic[IN][0] == 1 && s->coordinate_origin_property &&
             s->coordinate_center_property)
            s->raw->opcode_mask |= RAW_FRAGMENT_COORDINATES_USED;
         /* Labels are optional, bounded, sequential, and never jump targets. */
         if (isdigit((unsigned char)*p)) {
            unsigned label = 0, digits = 0;
            while (isdigit((unsigned char)*p)) {
               if (++digits > 3) return false;
               label = label * 10 + (unsigned)(*p++ - '0');
            }
            if (label != s->instructions || !punctuation(&p, ':')) return false;
         }
         if (!instruction(&p, s, flow)) return false;
      }
   }
   if (flow && flow->depth) { failure_code = "unsupported-feature"; return false; }
   if (!header || !s->ended || !s->instructions || !s->declared[OUT][0]) return false;
   bool coordinates = s->stage == 1 && s->declared[IN][0] && s->semantic[IN][0] == 1;
   if (coordinates != s->coordinate_origin_property || coordinates != s->coordinate_center_property) {
      failure_code = "unsupported-feature";
      return false;
   }
   /* A direct MOV of the builtin needs no fabricated opcode or static facts. */
   if (coordinates) s->raw->opcode_mask |= RAW_FRAGMENT_COORDINATES_USED;
   if (s->syntax_only) return s->semantic[OUT][0] == (s->stage == 0 ? 1u : 3u);
   for (unsigned i = 0; i < 8; ++i)
      if (s->live && s->declared[OUT][i] && s->written[OUT][i] != s->components[OUT][i]) return false;
   if (s->raw && (!s->raw->opcode_mask ||
       (s->address_declared && !s->raw->indirect_indices && !s->dead_indirect))) {
      failure_code = "unsupported-feature";
      return false;
   }
   if (s->live && s->raw && !raw_outputs_safe(s)) {
      int raster = raw_certify_raster_outputs(s);
      if (raster != 1) {
         /* An exact producer alone cannot borrow raw-bank output authority.
          * One whole-text finite-bank retry can establish ordinary numerical
          * access separately. Allocation failure is never retried as a domain. */
         if (raster == 0 && (s->raw->opcode_mask & (RAW_PRECISE_ARITHMETIC_USED | RAW_FRACTION_OPCODES)) &&
             !(s->raw_flags & RAW_CONDITIONAL)) missing_numeric_authority = true;
         failure_code = raster < 0 ? "translation-error" : "unsupported-feature";
         return false;
      }
   }
   return s->semantic[OUT][0] == (s->stage == 0 ? 1u : 3u);
}

static bool validate(char *text, struct profile *s)
{
   s->live = true;
   struct flow_context *flow = NULL;
   if (s->raw_flags & RAW_STRUCTURED) {
      flow = calloc(1, sizeof(*flow));
      if (!flow) { failure_code = "translation-error"; return false; }
   }
   bool valid = validate_body(text, s, flow);
   free(flow);
   return valid;
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
      else if (semantic == 1) snprintf(name, sizeof(name), "%s", s->stage ? "gl_FragCoord" : "gl_Position");
      else if (semantic == 2) snprintf(name, sizeof(name), "vso_g%u", sid);
      else snprintf(name, sizeof(name), "fsout_c0");
      append("%s{\"index\":%u,\"name\":\"%s\",\"type\":\"vec4\",\"semantic\":\"%s\",\"semanticIndex\":%u,\"componentMask\":%u", comma ? "," : "", i, name, names[semantic], sid, s->components[f][i]);
      if (f == OUT) append(",\"writtenMask\":%u", s->written[f][i]);
      if (semantic == 2) append(",\"interpolation\":\"%s\"", s->flat[f][i] ? "flat" : "smooth");
      if (semantic == 1 && s->stage) append(",\"interpolation\":\"linear\"");
      append("}");
      comma = true;
   }
   append("]");
}

/* Each conversion owns only upstream outputs. Text/token workspaces live in
 * sequential helper calls, so a pair never doubles their Wasm stack footprint. */
struct conversion {
   struct profile profile;
   struct vrend_shader_info info;
   struct vrend_variable_shader_info variable;
   struct vrend_strarray shader;
   char *owned_shader;
};
_Static_assert(sizeof(struct conversion) * 2 <= 73728, "pair conversion stack bound");

static void cleanup(struct conversion *c)
{
   strarray_free(&c->shader, true);
   free(c->info.sampler_arrays);
   free(c->info.image_arrays);
   free(c->profile.raw);
   free(c->owned_shader);
}

static void begin_response(bool pair)
{
   response = pair ? pair_response : single_response;
   response_capacity = pair ? sizeof(pair_response) : sizeof(single_response);
   response_used = 0;
   response_overflow = false;
}

static const char *numeric_rejection(void)
{
   return error("unsupported-feature", "TGSI is malformed or outside the documented straight-line profile.");
}

static void demand_reset(struct profile *profile, int stage, struct raw_ir *ir, unsigned flags)
{
   memset(ir->temporary, 0, sizeof(ir->temporary));
   memset(ir->output, 0, sizeof(ir->output));
   ir->count = 0; ir->opcode_mask = ir->indirect_indices = 0;
   ir->address = (struct raw_lane){0};
   memset(ir->demand.payload, 0, sizeof(ir->demand.payload));
   memset(ir->demand.result, 0, sizeof(ir->demand.result));
   ir->demand.missing = 0; ir->demand.checked = false;
   *profile = (struct profile){.stage = stage, .raw = ir, .raw_flags = flags};
}

static bool demand_retry(struct profile *profile, const char *text, size_t length, char *checked)
{
   /* Reuse the one owned IR. The syntax pass cannot publish a shader, and a
    * failed graph never grants access to a missing lane. Ordinary success has
    * already won; loops keep their independent certificate and admission. */
   if (!profile->raw || !(profile->raw_flags & RAW_STRUCTURED) || profile->raw->loop.checked) return false;
   struct raw_ir *ir = profile->raw;
   int stage = profile->stage;
   unsigned flags = profile->raw_flags;
   const struct raw_exact_bank *exact = ir->exact;
   memset(ir, 0, sizeof(*ir));
   ir->exact = exact;
   *profile = (struct profile){.stage = stage, .raw = ir, .raw_flags = flags, .syntax_only = true};
   memcpy(checked, text, length); checked[length] = 0;
   failure_code = "parse-error"; missing_numeric_authority = missing_initialization = false;
   if (!validate(checked, profile) || !demand_recognize(ir)) return false;
   demand_reset(profile, stage, ir, flags);
   memcpy(checked, text, length); checked[length] = 0;
   failure_code = "parse-error"; missing_numeric_authority = missing_initialization = false;
   if (validate(checked, profile)) return !(flags & RAW_CONDITIONAL) || (ir->opcode_mask & RAW_FINITE_BANK_USED);
   if (!missing_numeric_authority || (flags & RAW_CONDITIONAL)) return false;
   /* A missing payload can precede the first finite-bank use. The complete
    * checked retry retains only the graph, not predecessor facts or masks. */
   demand_reset(profile, stage, ir, flags | RAW_CONDITIONAL);
   memcpy(checked, text, length); checked[length] = 0;
   failure_code = "parse-error"; missing_numeric_authority = missing_initialization = false;
   return validate(checked, profile) && (ir->opcode_mask & RAW_FINITE_BANK_USED);
}

static bool radial_retry(struct profile *profile, const char *text, size_t length, char *checked)
{
   if (!profile->raw || !(profile->raw_flags & RAW_STRUCTURED)) return false;
   struct raw_ir *ir = profile->raw;
   int stage = profile->stage;
   unsigned flags = RAW_MIXED | RAW_STRUCTURED | RAW_CONDITIONAL | (profile->raw_flags & (RAW_KNOWN_RETRY | RAW_BRANCH_RETRY));
   const struct raw_exact_bank *exact = ir->exact;
   memset(ir, 0, sizeof(*ir));
   ir->exact = exact;
   *profile = (struct profile){.stage = stage, .raw = ir, .raw_flags = flags, .syntax_only = true};
   memcpy(checked, text, length); checked[length] = 0;
   failure_code = "parse-error"; missing_numeric_authority = missing_initialization = false;
   if (!validate(checked, profile) || !radial_recognize(ir)) return false;
   bool loop = false;
   for (unsigned pc = 0; pc < ir->count; ++pc) loop |= ir->instructions[pc].opcode == RAW_BGNLOOP;
   if (loop && !loop_recognize(ir)) return false;
   /* A radial predicate and the existing selected-away interpolation prove
    * independent edges. Neither certificate grants the other's lane facts. */
   if (!loop) (void)demand_recognize(ir);
   demand_reset(profile, stage, ir, flags);
   memcpy(checked, text, length); checked[length] = 0;
   failure_code = "parse-error"; missing_numeric_authority = missing_initialization = false;
   return validate(checked, profile) && ir->radial.used && (ir->opcode_mask & RAW_FINITE_BANK_USED);
}

static bool exact_declarations(const struct profile *profile, const struct raw_exact_bank *exact)
{
   for (unsigned i = 0; i < exact->count; ++i) {
      const struct bridge_exact_word *word = &exact->components[i];
      if (!profile->declared[CONST][word->reg] ||
          !(profile->components[CONST][word->reg] & (1u << word->component)) ||
          word->reg >= profile->constant_extent) return false;
   }
   return true;
}

static const char *check_input_attempt(struct profile *profile, const char *text, size_t length, unsigned retry_flags,
                                     const struct raw_exact_bank *exact)
{
   if (!text) return error("invalid-input", "TGSI text is required.");
   if (length > BRIDGE_MAX_TEXT) return error("input-too-large", "TGSI text exceeds 49152 bytes.");
   for (size_t i = 0; i < length; ++i) {
      unsigned char c = (unsigned char)text[i];
      if ((c < 32 && c != '\n' && c != '\t' && c != '\r') || c > 126)
         return error("invalid-input", "TGSI must contain printable ASCII and ordinary whitespace, without NUL bytes.");
   }
   char checked[BRIDGE_MAX_TEXT + 1];
   memcpy(checked, text, length); checked[length] = 0;
   /* This bounded lexical probe chooses which validator to attempt; it never
    * admits a shader or selects emitted semantics. Only fully validated new
    * instructions plus a complete output proof authorize the owned backend.
    * Texts without such opcode tokens retain the exact legacy validator path. */
   bool candidate = false, numeric_candidate = false, structured_candidate = false, loop_candidate = false;
   char *save = NULL;
   for (char *line = strtok_r(checked, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
      const char *p = line;
      space(&p);
      if (isdigit((unsigned char)*p)) {
         while (isdigit((unsigned char)*p)) ++p;
         if (!punctuation(&p, ':')) continue;
      }
      if (word(&p, "KILL") || word(&p, "KILL_IF")) {
         candidate = true;
      } else if (word(&p, "BGNLOOP") || word(&p, "BRK") || word(&p, "ENDLOOP")) {
         candidate = structured_candidate = loop_candidate = true;
      } else if (word(&p, "UIF") || word(&p, "ELSE") || word(&p, "ENDIF")) {
         candidate = structured_candidate = true;
      } else if (profile->stage == 1 && word(&p, "PROPERTY") &&
                 (word(&p, "FS_COORD_ORIGIN") || word(&p, "FS_COORD_PIXEL_CENTER"))) {
         candidate = true;
      } else if (word(&p, "MOV_PRECISE") || word(&p, "FSEQ_PRECISE") || word(&p, "FSNE_PRECISE")) {
         candidate = true;
      } else if (word(&p, "ADD_PRECISE") || word(&p, "MUL_PRECISE") || word(&p, "FRC_PRECISE")) {
         candidate = numeric_candidate = true;
      } else if (word(&p, "I2F") || word(&p, "F2I") || word(&p, "TRUNC") || word(&p, "SSG") || word(&p, "MOV_SAT") || word(&p, "DIV_SAT") || word(&p, "EX2") || word(&p, "LG2") || word(&p, "SIN") || word(&p, "POW")) {
         candidate = numeric_candidate = true;
      } else if (word(&p, "AND") || word(&p, "OR") || word(&p, "NOT") || word(&p, "SHL") || word(&p, "USHR") ||
          word(&p, "UADD") || word(&p, "ISGE") || word(&p, "ISLT") || word(&p, "IMAX") || word(&p, "USEQ") || word(&p, "USNE") || word(&p, "UCMP") ||
          word(&p, "FSLT") || word(&p, "FSGE") || word(&p, "FSEQ") || word(&p, "FSNE") || word(&p, "UARL")) {
         candidate = true;
      } else if (word(&p, "ADD") || word(&p, "MUL") || word(&p, "MAD") || word(&p, "TEX")) {
         numeric_candidate = true;
         /* Probe source positions only. A '-' in a literal/declaration or
          * unrelated token cannot move an ordinary legacy program here. The
          * complete typed parser below remains the sole admission authority. */
         while ((p = strchr(p, ','))) {
            ++p; space(&p);
            if (*p == '-') candidate = true;
         }
      } else if (word(&p, "DIV") || word(&p, "MAX") || word(&p, "MAX_PRECISE") || word(&p, "MIN") || word(&p, "MIN_PRECISE") || word(&p, "FRC") || word(&p, "LRP") ||
                 word(&p, "DP3") || word(&p, "RCP") || word(&p, "RSQ")) {
         candidate = numeric_candidate = true;
      }
   }
   if (candidate || exact) {
      profile->raw_flags = (numeric_candidate || structured_candidate ? RAW_MIXED : 0) |
         (structured_candidate ? RAW_STRUCTURED : 0) | retry_flags;
      profile->raw = calloc(1, sizeof(*profile->raw));
      if (!profile->raw) return error("translation-error", "Raw IR allocation failed.");
      profile->raw->exact = exact;
   }
   if (profile->raw && ((retry_flags & RAW_BRANCH_RETRY) || exact) && !loop_candidate) {
      /* Complete original grammar must pass before any dead semantic read is
       * skipped. Keep every slot for existing graph/certificate indexes. */
      profile->syntax_only = true;
      memcpy(checked, text, length); checked[length] = 0;
      failure_code = "parse-error";
      if (!validate(checked, profile)) return numeric_rejection();
      if (exact && !exact_declarations(profile, exact))
         return error("invalid-input", "Exact components must be declared by the complete stage text.");
      demand_reset(profile, profile->stage, profile->raw, profile->raw_flags);
   }
   if (loop_candidate) {
      /* Syntax-only records share the one bounded IR; they never reach emit.
       * The complete recognized graph supplies the independent finite policy. */
      profile->syntax_only = true;
      memcpy(checked, text, length); checked[length] = 0;
      failure_code = "parse-error";
      bool grammar = validate(checked, profile);
      if (grammar && exact && !exact_declarations(profile, exact))
         return error("invalid-input", "Exact components must be declared by the complete stage text.");
      if (!grammar || !loop_recognize(profile->raw)) {
         profile->syntax_only = false;
         return error(!strcmp(failure_code, "translation-error") ? failure_code : "unsupported-feature",
            !strcmp(failure_code, "translation-error") ? "Structured flow allocation failed." :
            "TGSI is malformed or outside the documented straight-line profile.");
      }
      struct raw_ir *ir = profile->raw;
      int stage = profile->stage;
      /* Retain parsed instructions for the header's write-set scan. The
       * checked pass overwrites them in place, one instruction at a time. */
      memset(ir->temporary, 0, sizeof(ir->temporary));
      memset(ir->output, 0, sizeof(ir->output));
      ir->count = 0; ir->opcode_mask = ir->indirect_indices = 0;
      ir->address = (struct raw_lane){0};
      *profile = (struct profile){.stage = stage, .raw = ir,
         .raw_flags = RAW_MIXED | RAW_STRUCTURED | RAW_CONDITIONAL | retry_flags};
      memcpy(checked, text, length); checked[length] = 0;
      failure_code = "parse-error"; missing_numeric_authority = missing_initialization = false;
      if (validate(checked, profile)) return NULL;
      if (missing_initialization && radial_retry(profile, text, length, checked)) return NULL;
      profile->raw_flags &= ~RAW_CONDITIONAL;
      return error(!strcmp(failure_code, "translation-error") ? failure_code : "unsupported-feature",
         !strcmp(failure_code, "translation-error") ? "Structured flow allocation failed." :
         "TGSI is malformed or outside the documented straight-line profile.");
   }
   memcpy(checked, text, length); checked[length] = 0;
   failure_code = "parse-error";
   missing_numeric_authority = missing_initialization = false;
   if (validate(checked, profile)) return NULL;
   if (!missing_numeric_authority) {
      const char *original_code = failure_code;
      if (missing_initialization && (demand_retry(profile, text, length, checked) ||
          (strcmp(failure_code, "translation-error") && radial_retry(profile, text, length, checked)))) return NULL;
      profile->raw_flags &= ~RAW_CONDITIONAL;
      if (strcmp(failure_code, "translation-error")) failure_code = original_code;
      return error(failure_code, !strcmp(failure_code, "translation-error") ? "Structured flow allocation failed." :
         "TGSI is malformed or outside the documented straight-line profile.");
   }
   /* The ordinary result wins whenever it succeeds. A failed domain use gets
    * one fresh whole-text attempt: no first-pass facts or borrowed response
    * pointer survive, and no concurrent second IR grows the storage budget. */
   int stage = profile->stage;
   free(profile->raw);
   *profile = (struct profile){.stage = stage, .raw_flags = RAW_MIXED | RAW_CONDITIONAL |
      (structured_candidate ? RAW_STRUCTURED : 0) | retry_flags};
   profile->raw = calloc(1, sizeof(*profile->raw));
   if (!profile->raw) return numeric_rejection();
   profile->raw->exact = exact;
   memcpy(checked, text, length); checked[length] = 0;
   failure_code = "parse-error";
   missing_numeric_authority = missing_initialization = false;
   if (validate(checked, profile) && (profile->raw->opcode_mask & RAW_FINITE_BANK_USED)) return NULL;
   if (missing_initialization && (demand_retry(profile, text, length, checked) ||
       (strcmp(failure_code, "translation-error") && radial_retry(profile, text, length, checked)))) return NULL;
   return numeric_rejection();
}

static const char *check_input(struct profile *profile, const char *text, size_t length)
{
   const char *failed = check_input_attempt(profile, text, length, 0, NULL);
   if (!failed) return NULL;
   bool parse_failure = strstr(failed, "\"code\":\"parse-error\"") != NULL;
   if (!parse_failure && !strstr(failed, "\"code\":\"unsupported-feature\"")) return failed;
   /* Existing successful source/metadata bytes win. A fresh final transaction
    * may materialize known producers; failed retries preserve the old error. */
   int stage = profile->stage;
   if (!parse_failure) {
      free(profile->raw);
      *profile = (struct profile){.stage = stage};
      const char *known = check_input_attempt(profile, text, length, RAW_KNOWN_RETRY, NULL);
      if (!known && profile->raw && (profile->raw->opcode_mask & RAW_KNOWN_ARITHMETIC_USED)) {
         response_used = 0; response_overflow = false;
         return NULL;
      }
   }
   free(profile->raw);
   *profile = (struct profile){.stage = stage};
   const char *retry = check_input_attempt(profile, text, length, RAW_KNOWN_RETRY | RAW_BRANCH_RETRY, NULL);
   if (!retry && profile->raw && (profile->raw->opcode_mask & RAW_BRANCH_LIVENESS_USED)) {
      response_used = 0; response_overflow = false;
      return NULL;
   }
   return parse_failure ? error("parse-error", "TGSI is malformed or outside the documented straight-line profile.") : numeric_rejection();
}

static const char *convert(struct conversion *c, const char *text, size_t length,
                           const struct vrend_fs_shader_info *fragment_interface)
{
   if (c->profile.raw) {
      /* Raw stages never enter the float-backed upstream emitter. These are
       * value-only metadata from declarations already checked by our guard. */
      c->info.num_consts = (int)c->profile.constant_extent;
      for (unsigned i = 0; i < c->profile.raw->count; ++i)
         if (c->profile.raw->instructions[i].opcode == RAW_TEX && !(c->profile.raw->instructions[i].flags & RAW_DEAD))
            c->info.samplers_used_mask |= 1u << c->profile.raw->instructions[i].sampler;
      if (c->profile.stage) {
         struct vrend_fs_shader_info *fs = &c->variable.fs_info;
         for (unsigned i = 0; i < FILE_REGISTERS; ++i) if (c->profile.declared[IN][i] && c->profile.semantic[IN][i] == 2) {
            struct vrend_interp_info *entry = &fs->interpinfo[fs->num_interps++];
            entry->semantic_name = TGSI_SEMANTIC_GENERIC;
            entry->semantic_index = c->profile.semantic_index[IN][i];
            entry->interpolate = c->profile.flat[IN][i] ? TGSI_INTERPOLATE_CONSTANT : TGSI_INTERPOLATE_PERSPECTIVE;
            entry->location = TGSI_INTERPOLATE_LOC_CENTER;
         }
      }
      c->owned_shader = raw_emit(&c->profile, c->profile.constant_extent);
      if (!c->owned_shader) return error("translation-error", "Raw GLSL allocation or output bound failed.");
      return NULL;
   }
   char input[BRIDGE_MAX_TEXT + 1];
   memcpy(input, text, length); input[length] = 0;
   struct tgsi_token tokens[BRIDGE_MAX_TOKENS] = {0};
   upstream_logged = false;
   bridge_tgsi_scratch_begin();
   if (!tgsi_text_translate(input, tokens, BRIDGE_MAX_TOKENS)) return bridge_tgsi_scratch_failed() ?
      error("translation-error", "Upstream TGSI scratch allocation failed or exceeded its bound.") :
      error("parse-error", "Upstream TGSI validation rejected the shader.");
   struct vrend_shader_cfg cfg = {.glsl_version = 300, .max_draw_buffers = 1, .use_gles = 1, .use_core_profile = 1, .use_integer = 1};
   struct vrend_shader_key key = {0};
   if (c->profile.stage == 1) key.fs.lower_left_origin = 1;
   if (fragment_interface) key.fs_info = *fragment_interface;
   if (!strarray_alloc(&c->shader, SHADER_MAX_STRINGS)) return error("translation-error", "Shader output allocation failed.");
   bridge_upstream_allocation_begin();
   bool converted = vrend_convert_shader(NULL, &cfg, tokens, 0, &key, &c->info, &c->variable, &c->shader);
   size_t total = 0;
   for (int i = 0; i < c->shader.num_strings; ++i) total += strlen(c->shader.strings[i].buf);
   if (!converted || bridge_upstream_allocation_failed() || upstream_logged || total > BRIDGE_MAX_GLSL)
      return error("translation-error", "Upstream translation failed, logged a diagnostic, or exceeded the output bound.");
   return NULL;
}

/* Interstage inputs are GENERIC, all centered and either
 * PERSPECTIVE or CONSTANT. Cross-check upstream's value-only export before it
 * becomes a vertex key; never accept caller keys or copy owned shader pointers. */
static bool checked_fragment_interface(const struct conversion *fragment)
{
   const struct profile *p = &fragment->profile;
   const struct vrend_fs_shader_info *info = &fragment->variable.fs_info;
   unsigned count = 0;
   bool seen[FILE_REGISTERS] = {0};
   for (unsigned i = 0; i < FILE_REGISTERS; ++i) count += p->declared[IN][i] && p->semantic[IN][i] == 2;
   if (info->num_interps != (int)count || info->has_sample_input || info->has_noperspective) return false;
   for (unsigned i = 0; i < count; ++i) {
      const struct vrend_interp_info *entry = &info->interpinfo[i];
      if (entry->semantic_name != TGSI_SEMANTIC_GENERIC || entry->semantic_index >= FILE_REGISTERS ||
          entry->location != TGSI_INTERPOLATE_LOC_CENTER || seen[entry->semantic_index]) return false;
      seen[entry->semantic_index] = true;
      bool matched = false;
      for (unsigned j = 0; j < FILE_REGISTERS; ++j) if (p->declared[IN][j] && p->semantic[IN][j] == 2 && p->semantic_index[IN][j] == entry->semantic_index) {
         unsigned expected = p->flat[IN][j] ? TGSI_INTERPOLATE_CONSTANT : TGSI_INTERPOLATE_PERSPECTIVE;
         if (entry->interpolate != expected) return false;
         matched = true;
      }
      if (!matched) return false;
   }
   return true;
}

static bool match_interface(struct profile *vertex, const struct profile *fragment)
{
   for (unsigned i = 0; i < FILE_REGISTERS; ++i) if (fragment->declared[IN][i] && fragment->semantic[IN][i] == 2) {
      bool matched = false;
      for (unsigned j = 0; j < FILE_REGISTERS; ++j) {
         if (!vertex->declared[OUT][j] || vertex->semantic[OUT][j] != 2 ||
             vertex->semantic_index[OUT][j] != fragment->semantic_index[IN][i]) continue;
         if ((fragment->components[IN][i] & vertex->written[OUT][j]) != fragment->components[IN][i]) return false;
         vertex->flat[OUT][j] = fragment->flat[IN][i];
         matched = true;
      }
      if (!matched) return false;
   }
   return true;
}

static void interface_key(const struct profile *fragment)
{
   append("\"generic-interpolation-v1:");
   bool comma = false;
   for (unsigned sid = 0; sid < FILE_REGISTERS; ++sid)
      for (unsigned i = 0; i < FILE_REGISTERS; ++i)
         if (fragment->declared[IN][i] && fragment->semantic[IN][i] == 2 && fragment->semantic_index[IN][i] == sid) {
            append("%sg%u/%u/%s", comma ? ";" : "", sid, fragment->components[IN][i], fragment->flat[IN][i] ? "flat" : "smooth");
            comma = true;
         }
   if (fragment->raw && (fragment->raw->opcode_mask & RAW_FRAGMENT_COORDINATES_USED))
      append("|tgsi-fragment-position-v1:in0/linear/lower-left/half-integer/window-z/reciprocal-w");
   if (fragment->raw && (fragment->raw->opcode_mask & RAW_DISCARD_OPCODES))
      append("|tgsi-fragment-discard-v1:ordered-any-negative/raw-words/always-%u", !fragment->live);
   append("\"");
}

static void constant_domain(int stage, int count)
{
   append(",\"constantDomains\":[{\"kind\":\"constant-bank-finite-f32-v1\",\"stage\":\"%s\",\"slot\":0,\"name\":\"%sconst0\",\"count\":%d}]",
      stage ? "fragment" : "vertex", stage ? "fs" : "vs", count);
}

/* The outer profile keeps every simultaneous obligation mandatory. A precision
 * record cannot replace a finite/indirect/loop/radial admission contract. */
/* A dead loop retains its independent syntax certificate for the emitter and
 * graph. Only a reachable loop requires the live count/bank consumer policy. */
static bool live_loop(const struct raw_ir *ir)
{
   return ir->loop.checked && !(ir->instructions[ir->loop.begin].flags & RAW_DEAD);
}

static const char *precise_profile(const struct raw_ir *ir)
{
   if (ir->radial.used) return live_loop(ir) ? "virgl-webgl2-raw-bits-v26" :
      ir->indirect_indices ? "virgl-webgl2-raw-bits-v25" : "virgl-webgl2-raw-bits-v24";
   if (live_loop(ir)) return "virgl-webgl2-raw-bits-v23";
   if (ir->indirect_indices) return ir->opcode_mask & RAW_FINITE_BANK_USED ?
      "virgl-webgl2-raw-bits-v22" : "virgl-webgl2-raw-bits-v21";
   if (ir->opcode_mask & RAW_STRUCTURED_OPCODES) return ir->opcode_mask & RAW_FINITE_BANK_USED ?
      "virgl-webgl2-raw-bits-v20" : "virgl-webgl2-raw-bits-v19";
   return ir->opcode_mask & RAW_FINITE_BANK_USED ? "virgl-webgl2-raw-bits-v18" : "virgl-webgl2-raw-bits-v17";
}

static void precise_contract(const struct profile *profile)
{
   bool used[4] = {false};
   for (unsigned i = 0; i < profile->raw->count; ++i) {
      const struct raw_instruction *instruction = &profile->raw->instructions[i];
      if (instruction->flags & RAW_DEAD) continue;
      if (!(instruction->flags & RAW_PRECISE)) continue;
      if ((UINT64_C(1) << instruction->opcode) & RAW_ARITHMETIC_OPCODES) continue;
      if (instruction->opcode == RAW_MIN_PRECISE || instruction->opcode == RAW_FRC_PRECISE) continue;
      used[instruction->opcode == RAW_FSEQ ? 0 : instruction->opcode == RAW_FSNE ? 1 :
         instruction->opcode == RAW_MAX_PRECISE ? 2 : 3] = true;
   }
   append(",\"preciseWordContract\":{\"kind\":\"tgsi-precise-word-local-v1\",\"stage\":\"%s\",\"operations\":[",
      profile->stage ? "fragment" : "vertex");
   static const char *names[] = {"FSEQ", "FSNE", "MAX", "MOV"};
   bool comma = false;
   for (unsigned i = 0; i < 4; ++i) if (used[i]) {
      append("%s\"%s\"", comma ? "," : "", names[i]); comma = true;
   }
   append("]}");
}

static void arithmetic_contract(const struct profile *profile, const char *base)
{
   bool add = (profile->raw->opcode_mask & (UINT64_C(1) << RAW_ADD_PRECISE)) != 0;
   bool mul = (profile->raw->opcode_mask & (UINT64_C(1) << RAW_MUL_PRECISE)) != 0;
   append(",\"arithmeticBaseProfile\":\"%s\",\"preciseArithmeticContract\":{\"kind\":\"tgsi-precise-binary32-rne-v1\",\"stage\":\"%s\",\"operations\":[%s%s%s],\"rounding\":\"nearest-even\",\"nan\":\"canonical-quiet-0x7fc00000\",\"subnormals\":\"gradual\"}",
      base, profile->stage ? "fragment" : "vertex", add ? "\"ADD\"" : "",
      add && mul ? "," : "", mul ? "\"MUL\"" : "");
}

static void raster_contract(const struct profile *profile, unsigned count, const char *base)
{
   int stage = profile->stage;
   append(",\"rasterBaseProfile\":\"%s\",\"constantRasterDomains\":[{\"kind\":\"constant-bank-raster-copy-f32-v1\",\"stage\":\"%s\",\"slot\":0,\"name\":\"%sconst0\",\"count\":%u,\"components\":[",
      base, stage ? "fragment" : "vertex", stage ? "fs" : "vs", count);
   bool comma = false;
   for (unsigned index = 0; index < CONST_REGISTERS; ++index) {
      unsigned mask = profile->raw->raster.components[index];
      if (mask) {
         append("%s{\"register\":%u,\"mask\":%u}", comma ? "," : "", index, mask);
         comma = true;
      }
   }
   append("]}]");
}

static void conversion_contract(const struct profile *profile, unsigned count, const char *base)
{
   uint64_t ops = profile->raw->opcode_mask;
   bool i2f = (ops & (UINT64_C(1) << RAW_I2F)) != 0, f2i = (ops & (UINT64_C(1) << RAW_F2I)) != 0;
   append(",\"conversionBaseProfile\":\"%s\",\"signedConversionContract\":{\"kind\":\"tgsi-signed32-binary32-v1\",\"stage\":\"%s\",\"operations\":[%s%s%s],\"integerToFloat\":\"nearest-even\",\"floatToInteger\":\"toward-zero\",\"domain\":\"finite-negative-le-2^31-positive-lt-2^31\"}",
      base, profile->stage ? "fragment" : "vertex", i2f ? "\"I2F\"" : "", i2f && f2i ? "," : "", f2i ? "\"F2I\"" : "");
   if (!(ops & RAW_CONVERSION_BANK_USED)) return;
   unsigned char components[CONST_REGISTERS] = {0};
   for (unsigned pc = 0; pc < profile->raw->count; ++pc) {
      const struct raw_instruction *i = &profile->raw->instructions[pc];
      if (i->opcode != RAW_F2I || i->src[0].file != CONST) continue;
      for (unsigned lane = 0; lane < 4; ++lane)
         if (i->dst.mask & (1u << lane)) components[i->src[0].index] |= 1u << i->src[0].swizzle[lane];
   }
   append(",\"constantConversionDomains\":[{\"kind\":\"constant-bank-f2i-range-v1\",\"stage\":\"%s\",\"slot\":0,\"name\":\"%sconst0\",\"count\":%u,\"components\":[",
      profile->stage ? "fragment" : "vertex", profile->stage ? "fs" : "vs", count);
   bool comma = false;
   for (unsigned index = 0; index < CONST_REGISTERS; ++index) if (components[index]) {
      append("%s{\"register\":%u,\"mask\":%u}", comma ? "," : "", index, components[index]); comma = true;
   }
   append("]}]");
}

static void scalar_contract(const struct profile *profile, const char *base)
{
   uint64_t ops = profile->raw->opcode_mask;
   bool trunc = (ops & (UINT64_C(1) << RAW_TRUNC)) != 0, ssg = (ops & (UINT64_C(1) << RAW_SSG)) != 0;
   append(",\"scalarBaseProfile\":\"%s\",\"scalarWordContract\":{\"kind\":\"tgsi-finite-scalar-binary32-v1\",\"stage\":\"%s\",\"operations\":[%s%s%s],\"domain\":\"existing-finite-numeric-authority\",\"truncation\":\"toward-zero-preserve-zero-sign\",\"sign\":\"negative-one-positive-one-canonical-zero\",\"result\":\"normal-or-signed-zero\"}",
      base, profile->stage ? "fragment" : "vertex", trunc ? "\"TRUNC\"" : "", trunc && ssg ? "," : "", ssg ? "\"SSG\"" : "");
}

static void minimum_contract(const struct profile *profile, const char *base)
{
   uint64_t ops = profile->raw->opcode_mask;
   bool plain = (ops & (UINT64_C(1) << RAW_MIN)) != 0, precise = (ops & (UINT64_C(1) << RAW_MIN_PRECISE)) != 0;
   append(",\"minimumBaseProfile\":\"%s\",\"minimumWordContract\":{\"kind\":\"tgsi-minimum-word-local-v1\",\"stage\":\"%s\",\"operations\":[%s%s%s],\"ordinary\":\"existing-finite-numeric-authority\",\"precise\":\"ordered-less-first-otherwise-second-original-word\",\"modifiers\":\"negation-before-selection\",\"output\":\"existing-numeric-or-selected-raw-authority\"}",
      base, profile->stage ? "fragment" : "vertex", plain ? "\"MIN\"" : "", plain && precise ? "," : "", precise ? "\"MIN_PRECISE\"" : "");
}

static void fraction_contract(const struct profile *profile, const char *base)
{
   append(",\"fractionBaseProfile\":\"%s\",\"fractionWordContract\":{\"kind\":\"tgsi-fraction-binary32-rne-v1\",\"stage\":\"%s\",\"operations\":[\"FRC_PRECISE\"],\"equation\":\"x-minus-floor\",\"rounding\":\"nearest-even\",\"specials\":\"canonical-quiet-0x7fc00000\",\"subnormals\":\"gradual\",\"zero\":\"canonical-positive\",\"modifiers\":\"negation-before-evaluation\",\"authority\":\"existing-numeric-or-static-word-authority\"}",
      base, profile->stage ? "fragment" : "vertex");
}

static void saturation_contract(const struct profile *profile, const char *base)
{
   uint64_t ops = profile->raw->opcode_mask;
   bool divide = (ops & (UINT64_C(1) << RAW_DIV_SAT)) != 0, move = (ops & (UINT64_C(1) << RAW_MOV_SAT)) != 0;
   append(",\"saturationBaseProfile\":\"%s\",\"saturationContract\":{\"kind\":\"tgsi-numeric-saturation-local-v1\",\"stage\":\"%s\",\"operations\":[%s%s%s],\"equation\":\"post-operation-ternary-zero-one\",\"authority\":\"existing-numeric-authority\",\"divisionDomain\":\"static-normal-divisor-unit-or-known-bounded-quotient\",\"division\":\"positive-denominator-highp-2.5-ulp\",\"modifiers\":\"negation-before-operation\",\"zero\":\"underlying-numeric-result\"}",
      base, profile->stage ? "fragment" : "vertex", divide ? "\"DIV_SAT\"" : "", divide && move ? "," : "", move ? "\"MOV_SAT\"" : "");
}

static void exponent_contract(const struct profile *profile, const char *base)
{
   uint64_t ops = profile->raw->opcode_mask;
   bool exponential = (ops & (UINT64_C(1) << RAW_EX2)) != 0, logarithm = (ops & (UINT64_C(1) << RAW_LG2)) != 0;
   append(",\"exponentBaseProfile\":\"%s\",\"exponentContract\":{\"kind\":\"tgsi-bounded-exponent-logarithm-v1\",\"stage\":\"%s\",\"operations\":[%s%s%s],\"source\":\"post-swizzle-x-replicated-before-mask\",\"proof\":\"static-post-modifier-word-facts\",\"exponentDomain\":\"normal-or-zero-minus125-to126\",\"logarithmDomain\":\"positive-normal\",\"exponentError\":\"(3+2*abs(x))-ulp\",\"logarithmError\":\"3-ulp-outside-[0.5,2];abs-lt-2^-21-inside\",\"modifiers\":\"negation-before-evaluation\",\"authority\":\"existing-numeric-authority\",\"result\":\"ordinary-highp-no-static-range-facts\"}",
      base, profile->stage ? "fragment" : "vertex", exponential ? "\"EX2\"" : "", exponential && logarithm ? "," : "", logarithm ? "\"LG2\"" : "");
}

static void sine_contract(const struct profile *profile, const char *base)
{
   append(",\"sineBaseProfile\":\"%s\",\"sineContract\":{\"kind\":\"tgsi-bounded-sine-v1\",\"stage\":\"%s\",\"operations\":[\"SIN\"],\"source\":\"post-swizzle-x-replicated-before-mask\",\"proof\":\"static-post-modifier-word-facts\",\"domain\":\"normal-or-zero-minus8-to8\",\"error\":\"absolute-le-2^-20\",\"precision\":\"measured-physical-host-no-essl-guarantee\",\"modifiers\":\"negation-before-evaluation\",\"authority\":\"existing-numeric-authority\",\"result\":\"ordinary-highp-no-static-range-facts\"}",
      base, profile->stage ? "fragment" : "vertex");
}

static void power_contract(const struct profile *profile, const char *base)
{
   if (profile->raw_flags & RAW_PRIVATE_92CB_COMPLETE) {
      append(",\"powerBaseProfile\":\"%s\",\"powerContract\":{"
         "\"kind\":\"tgsi-private-invocation-guarded-power-v1\","
         "\"stage\":\"fragment\",\"operations\":[\"POW\"],"
         "\"source\":\"post-swizzle-x-pair-replicated-before-mask\","
         "\"proof\":\"checked-actual-operands-before-evaluation\","
         "\"domain\":\"zero-positive-or-positive-normal-log-envelope-120\","
         "\"maskedNegativeSites\":[231,260,293,319],"
         "\"invalidResult\":\"explicit-fault-sentinel\","
         "\"error\":\"measured-relative-le-2^-14-zero-exact\","
         "\"result\":\"ordinary-highp-no-static-range-facts\"}", base);
      return;
   }

   append(",\"powerBaseProfile\":\"%s\",\"powerContract\":{\"kind\":\"tgsi-bounded-power-v1\",\"stage\":\"%s\",\"operations\":[\"POW\"],\"source\":\"post-swizzle-x-pair-replicated-before-mask\",\"proof\":\"static-post-modifier-word-facts-integer-exponent-envelope\",\"domain\":\"zero-positive-or-positive-normal-log-envelope-120\",\"error\":\"relative-le-2^-14-zero-exact\",\"precision\":\"measured-physical-host-explicit-budget\",\"modifiers\":\"negation-before-evaluation\",\"authority\":\"existing-numeric-authority\",\"result\":\"ordinary-highp-no-static-range-facts\"}",
      base, profile->stage ? "fragment" : "vertex");
}

static void coordinate_contract(const char *base)
{
   append(",\"coordinateBaseProfile\":\"%s\",\"coordinateContract\":{\"kind\":\"tgsi-fragment-position-v1\",\"stage\":\"fragment\",\"input\":0,\"semanticIndex\":0,\"source\":\"gl_FragCoord\",\"interpolation\":\"linear\",\"origin\":\"lower-left\",\"pixelCenter\":\"half-integer\",\"components\":\"window-xy-depth-z-reciprocal-clip-w\",\"precision\":\"essl3-highp-builtin\",\"rasterization\":\"single-sample-half-pixel\",\"surfaceOrigin\":\"lower-left\",\"authority\":\"existing-input-no-static-range-facts\"}", base);
}

static void discard_contract(const struct profile *profile, const char *base)
{
   uint64_t ops = profile->raw->opcode_mask;
   bool kill = (ops & (UINT64_C(1) << RAW_KILL)) != 0;
   bool conditional = (ops & (UINT64_C(1) << RAW_KILL_IF)) != 0;
   append(",\"discardBaseProfile\":\"%s\",\"discardContract\":{\"kind\":\"tgsi-fragment-discard-v1\",\"stage\":\"fragment\",\"operations\":[%s%s%s],\"source\":\"all-four-post-swizzle-word-lanes\",\"comparison\":\"ordered-binary32-any-negative-zero-and-nan-false\",\"modifiers\":\"absolute-before-negation\",\"liveness\":\"exclude-proved-discarded-predecessors\",\"authority\":\"no-new-numeric-range-or-initialization-facts\",\"alwaysDiscards\":%s}",
      base, kill ? "\"KILL\"" : "", kill && conditional ? "," : "", conditional ? "\"KILL_IF\"" : "", profile->live ? "false" : "true");
}

static void known_arithmetic_contract(const struct profile *profile, const char *base)
{
   bool add = false, mul = false, rcp = false;
   for (unsigned pc = 0; pc < profile->raw->count; ++pc) {
      const struct raw_instruction *i = &profile->raw->instructions[pc];
      if (!(i->flags & RAW_KNOWN_RESULT)) continue;
      add |= i->opcode == RAW_ADD;
      mul |= i->opcode == RAW_MUL;
      rcp |= i->opcode == RAW_RCP;
   }
   append(",\"knownArithmeticBaseProfile\":\"%s\",\"knownArithmeticContract\":{\"kind\":\"tgsi-known-arithmetic-v1\",\"stage\":\"%s\",\"operations\":[%s%s%s%s%s],\"source\":\"fully-known-authorized-normal-or-zero-post-modifier\",\"rounding\":\"binary32-nearest-ties-to-even-integer\",\"result\":\"normal-or-zero-only\",\"emission\":\"literal-word-and-matching-shadow\",\"authority\":\"exact-emitted-producer-version-only\",\"storage\":\"unused-third-operand-four-word-cache\"}",
      base, profile->stage ? "fragment" : "vertex", add ? "\"ADD\"" : "", add && mul ? "," : "", mul ? "\"MUL\"" : "",
      rcp && (add || mul) ? "," : "", rcp ? "\"RCP\"" : "");
}

static void branch_contract(const struct profile *profile, const char *base)
{
   append(",\"branchBaseProfile\":\"%s\",\"branchContract\":{\"kind\":\"tgsi-proved-raw-uif-v1\",\"stage\":\"%s\",\"condition\":\"post-swizzle-x-raw-word-nonzero\",\"proof\":\"producer-known-zero-or-proved-one-bit\",\"liveness\":\"exclude-proved-unreachable-predecessors\",\"syntax\":\"complete-unmodified-original-before-pruning\",\"deadReads\":\"declarations-and-grammar-only-no-published-facts\",\"indices\":\"original-instruction-positions\",\"authority\":\"no-new-dynamic-word-numeric-or-bank-facts\",\"storage\":\"instruction-flags-no-ir-growth\"}",
      base, profile->stage ? "fragment" : "vertex");
}

static void stage_result(const struct conversion *c)
{
   const struct profile *profile = &c->profile;
   const struct vrend_shader_info *info = &c->info;
   int stage = profile->stage;
   append("\"glsl\":\"");
   for (int i = 0; i < (c->owned_shader ? 1 : c->shader.num_strings); ++i) {
      for (const char *p = c->owned_shader ? c->owned_shader : c->shader.strings[i].buf; *p; ++p) {
         unsigned char byte = (unsigned char)*p;
         if (byte == '"' || byte == '\\') append("\\%c", byte);
         else if (byte < 32) append("\\u%04x", byte);
         else append("%c", byte);
      }
   }
   bool wide_vertex_bank = false;
   if (!stage && !profile->raw)
      for (unsigned i = CONST_REGISTERS; i < BRIDGE_MAX_VERTEX_CONSTANTS; ++i)
         wide_vertex_bank |= profile->declared[CONST][i];
   const char *name = !c->owned_shader ? (wide_vertex_bank ?
      "virgl-webgl2-straight-line-v6" : "virgl-webgl2-straight-line-v5") :
      profile->raw->opcode_mask & RAW_PRECISE_WORD_USED ? precise_profile(profile->raw) :
      profile->raw->radial.used ? (live_loop(profile->raw) ? "virgl-webgl2-raw-bits-v16" :
         profile->raw->indirect_indices ? "virgl-webgl2-raw-bits-v15" : "virgl-webgl2-raw-bits-v14") :
      live_loop(c->profile.raw) ? "virgl-webgl2-raw-bits-v12" :
      c->profile.raw->indirect_indices ?
         (c->profile.raw->opcode_mask & RAW_FINITE_BANK_USED ? "virgl-webgl2-raw-bits-v11" : "virgl-webgl2-raw-bits-v10") :
      c->profile.raw->opcode_mask & RAW_STRUCTURED_OPCODES ?
         (c->profile.raw->opcode_mask & RAW_FINITE_BANK_USED ? "virgl-webgl2-raw-bits-v9" : "virgl-webgl2-raw-bits-v8") :
      c->profile.raw->opcode_mask & RAW_FINITE_BANK_USED ? "virgl-webgl2-raw-bits-v7" :
      c->profile.raw->opcode_mask & RAW_EQUALITY_OPCODES ? "virgl-webgl2-raw-bits-v13" :
      c->profile.raw->opcode_mask & RAW_V6_OPCODES ? "virgl-webgl2-raw-bits-v6" :
      c->profile.raw->opcode_mask & (RAW_V5_OPCODES | RAW_V5_NEGATION) ? "virgl-webgl2-raw-bits-v5" :
      c->profile.raw->opcode_mask & RAW_V4_OPCODES ? "virgl-webgl2-raw-bits-v4" :
      c->profile.raw->opcode_mask & RAW_V3_OPCODES ? "virgl-webgl2-raw-bits-v3" :
      c->profile.raw->opcode_mask & RAW_V2_OPCODES ? "virgl-webgl2-raw-bits-v2" : "virgl-webgl2-raw-bits-v1";
   bool raster = profile->raw && (profile->raw->opcode_mask & RAW_RASTER_BANK_USED);
   bool arithmetic = profile->raw && (profile->raw->opcode_mask & RAW_PRECISE_ARITHMETIC_USED);
   bool conversion = profile->raw && (profile->raw->opcode_mask & RAW_CONVERSION_OPCODES);
   bool conversion_bank = profile->raw && (profile->raw->opcode_mask & RAW_CONVERSION_BANK_USED);
   bool scalar = profile->raw && (profile->raw->opcode_mask & RAW_SCALAR_OPCODES);
   bool minimum = profile->raw && (profile->raw->opcode_mask & RAW_MINIMUM_OPCODES);
   bool fraction = profile->raw && (profile->raw->opcode_mask & RAW_FRACTION_OPCODES);
   bool saturation = profile->raw && (profile->raw->opcode_mask & RAW_SATURATION_OPCODES);
   bool exponent = profile->raw && (profile->raw->opcode_mask & RAW_EXPONENT_OPCODES);
   bool power = profile->raw && (profile->raw->opcode_mask & RAW_POWER_OPCODES);
   bool sine = profile->raw && (profile->raw->opcode_mask & RAW_SINE_OPCODES);
   bool coordinates = profile->raw && (profile->raw->opcode_mask & RAW_FRAGMENT_COORDINATES_USED);
   bool discard = profile->raw && (profile->raw->opcode_mask & RAW_DISCARD_OPCODES);
   bool known_arithmetic = profile->raw && (profile->raw->opcode_mask & RAW_KNOWN_ARITHMETIC_USED);
   bool branch = profile->raw && (profile->raw->opcode_mask & RAW_BRANCH_LIVENESS_USED);
   const char *conversion_name = conversion_bank ? "virgl-webgl2-raw-bits-v30" : "virgl-webgl2-raw-bits-v29";
   const char *base_profile =
      power ? "virgl-webgl2-raw-bits-v37" : sine ? "virgl-webgl2-raw-bits-v36" : exponent ? "virgl-webgl2-raw-bits-v35" : saturation ? "virgl-webgl2-raw-bits-v34" : fraction ? "virgl-webgl2-raw-bits-v33" : minimum ? "virgl-webgl2-raw-bits-v32" : scalar ? "virgl-webgl2-raw-bits-v31" : conversion ? conversion_name :
      arithmetic ? "virgl-webgl2-raw-bits-v28" : raster ? "virgl-webgl2-raw-bits-v27" : name;
   const char *inherited_profile = branch ? "virgl-webgl2-raw-bits-v41" : known_arithmetic ? "virgl-webgl2-raw-bits-v40" : discard ? "virgl-webgl2-raw-bits-v39" : coordinates ? "virgl-webgl2-raw-bits-v38" : base_profile;
   const struct raw_exact_bank *exact = profile->raw ? profile->raw->exact : NULL;
   append("\",\"metadata\":{\"profile\":\"%s\",\"stage\":\"%s\",\"inputs\":",
      exact ? "virgl-webgl2-raw-bits-v42" : inherited_profile,
      stage ? "fragment" : "vertex");
   io_metadata(profile, IN); append(",\"outputs\":"); io_metadata(profile, OUT);
   append(",\"attributes\":");
   if (!stage) io_metadata(profile, IN); else append("[]");
   append(",\"uniforms\":[");
   if (info->num_consts) append("{\"name\":\"%sconst0\",\"type\":\"uvec4[]\",\"count\":%d,\"encoding\":\"float32-bits\"}", stage ? "fs" : "vs", info->num_consts);
   append("],\"samplers\":[");
   bool comma = false;
   for (unsigned i = 0; i < FILE_REGISTERS; ++i) if (info->samplers_used_mask & (1u << i)) {
      append("%s{\"index\":%u,\"name\":\"fssamp%u\",\"type\":\"sampler2D\"}", comma ? "," : "", i, i); comma = true;
   }
   append("],\"uniformBlocks\":[");
   if (!stage) append("{\"name\":\"VirglBlock\",\"byteLength\":656,\"members\":[{\"name\":\"winsys_adjust_y\",\"offset\":640,\"type\":\"float\",\"default\":1}]}" );
   append("]");
   if (profile->raw && (profile->raw->opcode_mask & RAW_FINITE_BANK_USED))
      constant_domain(stage, info->num_consts);
   else if (profile->raw && live_loop(profile->raw))
      constant_domain(stage, info->num_consts); /* Explicit loop policy, not a fabricated numeric dependency. */
   if (profile->raw && profile->raw->indirect_indices) {
      append(",\"constantAccesses\":[{\"kind\":\"constant-bank-static-indirect-v1\",\"stage\":\"%s\",\"slot\":0,\"name\":\"%sconst0\",\"count\":%d,\"indices\":[",
         stage ? "fragment" : "vertex", stage ? "fs" : "vs", info->num_consts);
      bool first = true;
      for (unsigned i = 0; i < CONST_REGISTERS; ++i) if (profile->raw->indirect_indices & (UINT64_C(1) << i)) {
         append("%s%u", first ? "" : ",", i); first = false;
      }
      append("]}]");
   }
   if (profile->raw && live_loop(profile->raw))
      append(",\"constantConstraints\":[{\"kind\":\"constant-bank-counted-table-i32-v1\",\"stage\":\"%s\",\"slot\":0,\"name\":\"%sconst0\",\"count\":%d,\"register\":9,\"component\":0,\"maximum\":18}]",
         stage ? "fragment" : "vertex", stage ? "fs" : "vs", info->num_consts);
   if (profile->raw && profile->raw->radial.used)
      append(",\"constantRadialDomains\":[{\"kind\":\"constant-bank-radial-coefficient-f32-v1\",\"stage\":\"%s\",\"slot\":0,\"name\":\"%sconst0\",\"count\":%d,\"register\":4,\"component\":0,\"minimumMagnitude\":925353388}]",
         stage ? "fragment" : "vertex", stage ? "fs" : "vs", info->num_consts);
   if (profile->raw && (profile->raw->opcode_mask & RAW_PRECISE_WORD_USED)) precise_contract(profile);
   if (raster) raster_contract(profile, info->num_consts, name);
   if (arithmetic) arithmetic_contract(profile, raster ? "virgl-webgl2-raw-bits-v27" : name);
   if (conversion) conversion_contract(profile, info->num_consts,
      arithmetic ? "virgl-webgl2-raw-bits-v28" : raster ? "virgl-webgl2-raw-bits-v27" : name);
   if (scalar) scalar_contract(profile, conversion ? conversion_name :
      arithmetic ? "virgl-webgl2-raw-bits-v28" : raster ? "virgl-webgl2-raw-bits-v27" : name);
   if (minimum) minimum_contract(profile, scalar ? "virgl-webgl2-raw-bits-v31" : conversion ? conversion_name :
      arithmetic ? "virgl-webgl2-raw-bits-v28" : raster ? "virgl-webgl2-raw-bits-v27" : name);
   if (fraction) fraction_contract(profile, minimum ? "virgl-webgl2-raw-bits-v32" : scalar ? "virgl-webgl2-raw-bits-v31" :
      conversion ? conversion_name : arithmetic ? "virgl-webgl2-raw-bits-v28" : raster ? "virgl-webgl2-raw-bits-v27" : name);
   if (saturation) saturation_contract(profile, fraction ? "virgl-webgl2-raw-bits-v33" : minimum ? "virgl-webgl2-raw-bits-v32" :
      scalar ? "virgl-webgl2-raw-bits-v31" : conversion ? conversion_name : arithmetic ? "virgl-webgl2-raw-bits-v28" : raster ? "virgl-webgl2-raw-bits-v27" : name);
   if (exponent) exponent_contract(profile, saturation ? "virgl-webgl2-raw-bits-v34" : fraction ? "virgl-webgl2-raw-bits-v33" : minimum ? "virgl-webgl2-raw-bits-v32" :
      scalar ? "virgl-webgl2-raw-bits-v31" : conversion ? conversion_name : arithmetic ? "virgl-webgl2-raw-bits-v28" : raster ? "virgl-webgl2-raw-bits-v27" : name);
   if (sine) sine_contract(profile, exponent ? "virgl-webgl2-raw-bits-v35" : saturation ? "virgl-webgl2-raw-bits-v34" : fraction ? "virgl-webgl2-raw-bits-v33" : minimum ? "virgl-webgl2-raw-bits-v32" :
      scalar ? "virgl-webgl2-raw-bits-v31" : conversion ? conversion_name : arithmetic ? "virgl-webgl2-raw-bits-v28" : raster ? "virgl-webgl2-raw-bits-v27" : name);
   if (power) power_contract(profile, sine ? "virgl-webgl2-raw-bits-v36" : exponent ? "virgl-webgl2-raw-bits-v35" : saturation ? "virgl-webgl2-raw-bits-v34" : fraction ? "virgl-webgl2-raw-bits-v33" : minimum ? "virgl-webgl2-raw-bits-v32" :
      scalar ? "virgl-webgl2-raw-bits-v31" : conversion ? conversion_name : arithmetic ? "virgl-webgl2-raw-bits-v28" : raster ? "virgl-webgl2-raw-bits-v27" : name);
   if (coordinates) coordinate_contract(base_profile);
   if (discard) discard_contract(profile, coordinates ? "virgl-webgl2-raw-bits-v38" : base_profile);
   if (known_arithmetic) known_arithmetic_contract(profile, discard ? "virgl-webgl2-raw-bits-v39" : coordinates ? "virgl-webgl2-raw-bits-v38" : base_profile);
   if (branch) branch_contract(profile, known_arithmetic ? "virgl-webgl2-raw-bits-v40" : discard ? "virgl-webgl2-raw-bits-v39" : coordinates ? "virgl-webgl2-raw-bits-v38" : base_profile);
   if (exact) {
      append(",\"exactBaseProfile\":\"%s\",\"constantExactDomains\":[{\"kind\":\"constant-bank-exact-u32-v1\",\"stage\":\"%s\",\"slot\":0,\"name\":\"%sconst0\",\"count\":%d,\"components\":[",
         inherited_profile, stage ? "fragment" : "vertex", stage ? "fs" : "vs", info->num_consts);
      for (unsigned i = 0; i < exact->count; ++i) {
         const struct bridge_exact_word *word = &exact->components[i];
         append("%s{\"register\":%u,\"component\":%u,\"word\":%u}",
            i ? "," : "", word->reg, word->component, word->word);
      }
      append("]}]");
   }
   append("}");
}

const char *bridge_translate(int stage, const char *text, size_t length)
{
   begin_response(false);
   if (stage != 0 && stage != 1) return error("unsupported-stage", "Only vertex and fragment stages are supported.");
   struct conversion c = {.profile = {.stage = stage}};
   const char *failed = check_input(&c.profile, text, length);
   if (!failed) failed = convert(&c, text, length, NULL);
   if (!failed) { append("{\"ok\":true,"); stage_result(&c); append("}"); }
   bool retry_failed = (c.profile.raw_flags & RAW_CONDITIONAL) && (failed || response_overflow);
   cleanup(&c);
   if (retry_failed) return numeric_rejection();
   if (response_overflow) return error("translation-error", "JSON output exceeded its bound.");
   return response;
}

const char *bridge_translate_exact(int stage, const char *text, size_t length,
                                  const struct bridge_exact_word *components, size_t count)
{
   begin_response(false);
   if (stage != 0 && stage != 1) return error("unsupported-stage", "Only vertex and fragment stages are supported.");
   if (!text || !components || !count || count > BRIDGE_MAX_EXACT_WORDS)
      return error("invalid-input", "Provide complete text and 1..184 canonical exact components.");
   if (length > BRIDGE_MAX_TEXT) return error("input-too-large", "TGSI text exceeds 49152 bytes.");
   /* No semantic allocation or callback can observe caller-owned input after
    * these copies. The bounded table lives until the conversion is cleaned. */
   char owned_text[BRIDGE_MAX_TEXT + 1];
   memcpy(owned_text, text, length); owned_text[length] = 0;
   struct raw_exact_bank exact = {.count = (unsigned)count};
   memcpy(exact.components, components, count * sizeof(*components));
   unsigned previous = 0;
   for (unsigned i = 0; i < exact.count; ++i) {
      const struct bridge_exact_word *word = &exact.components[i];
      if (word->reg >= CONST_REGISTERS || word->component >= 4)
         return error("invalid-input", "Exact register/component is outside the private bank.");
      unsigned key = word->reg * 4 + word->component;
      if (i && key <= previous) return error("invalid-input", "Exact components must be unique and canonically ordered.");
      previous = key;
      exact.words[word->reg][word->component] = word->word;
      exact.present[word->reg] |= (unsigned char)(1u << word->component);
   }
   struct conversion c = {.profile = {.stage = stage}};
   const char *failed = check_input(&c.profile, owned_text, length);
   if (!failed) {
      /* Valid private assumptions never alter an already admitted old result. */
      if (!exact_declarations(&c.profile, &exact)) {
         cleanup(&c);
         return error("invalid-input", "Exact components must be declared by the complete stage text.");
      }
      failed = convert(&c, owned_text, length, NULL);
      if (!failed) { append("{\"ok\":true,"); stage_result(&c); append("}"); }
      bool retry_failed = (c.profile.raw_flags & RAW_CONDITIONAL) && (failed || response_overflow);
      cleanup(&c);
      if (retry_failed) return numeric_rejection();
      if (response_overflow) return error("translation-error", "JSON output exceeded its bound.");
      return response;
   }
   bool eligible = strstr(failed, "\"code\":\"parse-error\"") || strstr(failed, "\"code\":\"unsupported-feature\"");
   char original[256];
   snprintf(original, sizeof(original), "%s", failed);
   cleanup(&c);
   if (!eligible) return response;
   c = (struct conversion){.profile = {.stage = stage}};
   failed = check_input_attempt(&c.profile, owned_text, length, RAW_KNOWN_RETRY | RAW_BRANCH_RETRY, &exact);
   bool invalid = failed && strstr(failed, "\"code\":\"invalid-input\"");
   if (!failed) failed = convert(&c, owned_text, length, NULL);
   if (!failed) {
      begin_response(false);
      append("{\"ok\":true,"); stage_result(&c); append("}");
   }
   bool rejected = failed || response_overflow;
   cleanup(&c);
   if (rejected && !invalid) { begin_response(false); append("%s", original); }
   return response;
}

const char *bridge_translate_pair(const char *vertex_text, size_t vertex_length,
                                  const char *fragment_text, size_t fragment_length)
{
   begin_response(true);
   struct conversion vertex = {.profile = {.stage = 0}}, fragment = {.profile = {.stage = 1}};
   const char *failed = check_input(&vertex.profile, vertex_text, vertex_length);
   if (!failed) failed = check_input(&fragment.profile, fragment_text, fragment_length);
   if (!failed && !match_interface(&vertex.profile, &fragment.profile))
      failed = error("incompatible-interface", "Fragment GENERIC inputs require matching fully written vertex outputs.");
   if (!failed) failed = convert(&fragment, fragment_text, fragment_length, NULL);
   if (!failed && !checked_fragment_interface(&fragment))
      failed = error("translation-error", "Upstream fragment interpolation metadata differs from the checked interface.");
   if (!failed) failed = convert(&vertex, vertex_text, vertex_length, &fragment.variable.fs_info);
   if (!failed) {
      append("{\"ok\":true,\"vertex\":{"); stage_result(&vertex);
      append("},\"fragment\":{"); stage_result(&fragment);
      append("},\"interfaceKey\":"); interface_key(&fragment.profile); append("}");
   }
   /* A later stage/interface/emission failure must not replace the original
    * ordinary rejection that selected a conditional transaction. */
   bool retry_failed = ((vertex.profile.raw_flags | fragment.profile.raw_flags) & RAW_CONDITIONAL) &&
      (failed || response_overflow);
   cleanup(&vertex); cleanup(&fragment);
   if (retry_failed) return numeric_rejection();
   if (response_overflow) return error("translation-error", "JSON output exceeded its bound.");
   return response;
}

/* Keep the two owned source copies on the bounded entry stack, and the two
 * conversions in one checked heap arena. No second entry frame is nested. */
struct exact_pair_input {
   char text[BRIDGE_MAX_TEXT + 1];
   struct raw_exact_bank exact;
};
_Static_assert(sizeof(struct exact_pair_input) * 2 <= 104320, "owned pair input bound");

static bool pair_exact_components(struct raw_exact_bank *exact,
                                  const struct bridge_exact_word *components, size_t count)
{
   exact->count = (unsigned)count;
   if (count) memcpy(exact->components, components, count * sizeof(*components));
   unsigned previous = 0;
   for (unsigned i = 0; i < exact->count; ++i) {
      const struct bridge_exact_word *word = &exact->components[i];
      if (word->reg >= CONST_REGISTERS || word->component >= 4) return false;
      unsigned key = word->reg * 4 + word->component;
      if (i && key <= previous) return false;
      previous = key;
      exact->words[word->reg][word->component] = word->word;
      exact->present[word->reg] |= (unsigned char)(1u << word->component);
   }
   return true;
}

static bool pair_exact_eligible(const char *failed)
{
   return strstr(failed, "\"code\":\"parse-error\"") || strstr(failed, "\"code\":\"unsupported-feature\"");
}

static const char *pair_exact_stage(struct conversion *c, const struct exact_pair_input *input,
                                   size_t length, bool qualified)
{
   const struct raw_exact_bank *exact = &input->exact;
   const char *failed = check_input(&c->profile, input->text, length);
   if (!failed) {
      if (exact->count && !exact_declarations(&c->profile, exact))
         return error("invalid-input", "Exact components must be declared by the complete stage text.");
   } else if (qualified && exact->count && pair_exact_eligible(failed)) {
      int stage = c->profile.stage;
      cleanup(c);
      memset(c, 0, sizeof(*c)); c->profile.stage = stage;
      failed = check_input_attempt(&c->profile, input->text, length,
         RAW_KNOWN_RETRY | RAW_BRANCH_RETRY, exact);
   }
   return failed;
}

static const char *pair_exact_finish(struct conversion *stages, const struct exact_pair_input *inputs,
                                    const size_t *lengths, int private_bank)
{
   struct conversion *vertex = &stages[0], *fragment = &stages[1];
   if (!match_interface(&vertex->profile, &fragment->profile))
      return error("incompatible-interface", "Fragment GENERIC inputs require matching fully written vertex outputs.");
   const char *failed = convert(fragment, inputs[1].text, lengths[1], NULL);
   if (!failed && !checked_fragment_interface(fragment))
      failed = error("translation-error", "Upstream fragment interpolation metadata differs from the checked interface.");
   if (!failed) failed = convert(vertex, inputs[0].text, lengths[0], &fragment->variable.fs_info);
   if (!failed) {
      begin_response(true);
      append("{\"ok\":true,\"vertex\":{"); stage_result(vertex);
      append("},\"fragment\":{"); stage_result(fragment);
      append("},\"interfaceKey\":"); interface_key(&fragment->profile);
      if (private_bank >= 0 && private_bank < 3)
         append(",\"private92cbFirstPower\":{\"kind\":\"original-92cb-pc221-222-v1\","
            "\"bank\":%d,\"completeVertexSha256\":\"7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e\","
            "\"completeFragmentSha256\":\"92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba\","
            "\"geometrySha256\":\"0d8bf78697b9be39a58c9274e221a89a9903f8587dfa2cf5cf5b754ae82e27ac\","
            "\"viewport\":[0,0,1024,768],\"samples\":0,\"colorFormat\":34836,"
            "\"mode\":5,\"first\":0,\"count\":4,\"drawTimeRecheckRequired\":true,"
            "\"productionDrawAuthority\":false}", private_bank);
      if (private_bank >= 3) {
         append(",\"private92cbComplete\":{\"kind\":\"original-92cb-full-guarded-v1\","
            "\"bank\":%d,\"instructions\":716,\"completeSource\":true,"
            "\"completeVertexSha256\":\"7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e\","
            "\"completeFragmentSha256\":\"92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba\","
            "\"geometrySha256\":\"0d8bf78697b9be39a58c9274e221a89a9903f8587dfa2cf5cf5b754ae82e27ac\","
            "\"viewport\":[0,0,1024,768],\"samples\":0,\"colorFormat\":34836,"
            "\"mode\":5,\"first\":0,\"count\":4,"
            "\"powerGuard\":\"normal-or-zero-nonnegative-envelope-120\","
            "\"maskedNegativePowers\":[231,260,293,319],"
            "\"diagnosticAttachment\":1,\"drawTimeRecheckRequired\":true,"
            "\"productionDrawAuthority\":false,\"powerSites\":[", private_bank - 3);
         bool comma = false;
         for (unsigned pc = 0; pc < fragment->profile.raw->count; ++pc) {
            const struct raw_instruction *i = &fragment->profile.raw->instructions[pc];
            if (i->opcode != RAW_POW || (i->flags & RAW_DEAD)) continue;
            append("%s%u", comma ? "," : "", pc); comma = true;
         }
         append("]}");
      }
      append("}");
   }
   return failed;
}

const char *bridge_translate_pair_exact(const char *vertex_text, size_t vertex_length,
                                        const struct bridge_exact_word *vertex_components, size_t vertex_count,
                                        const char *fragment_text, size_t fragment_length,
                                        const struct bridge_exact_word *fragment_components, size_t fragment_count)
{
   begin_response(true);
   if (!vertex_text || !fragment_text || vertex_count > BRIDGE_MAX_EXACT_WORDS ||
       fragment_count > BRIDGE_MAX_EXACT_WORDS || !(vertex_count || fragment_count) ||
       (vertex_count && !vertex_components) || (fragment_count && !fragment_components))
      return error("invalid-input", "Provide both texts and bounded canonical stage-local exact components.");
   if (vertex_length > BRIDGE_MAX_TEXT || fragment_length > BRIDGE_MAX_TEXT)
      return error("input-too-large", "TGSI text exceeds 49152 bytes.");
   struct exact_pair_input inputs[2] = {0};
   const size_t lengths[2] = {vertex_length, fragment_length};
   memcpy(inputs[0].text, vertex_text, vertex_length);
   memcpy(inputs[1].text, fragment_text, fragment_length);
   if (!pair_exact_components(&inputs[0].exact, vertex_components, vertex_count) ||
       !pair_exact_components(&inputs[1].exact, fragment_components, fragment_count))
      return error("invalid-input", "Exact components must be bounded, unique and canonically ordered.");
   /* Both input banks/texts now belong to this call, before the first actual
    * allocation. All conversion pointers are released before inputs expire. */
   struct conversion *stages = calloc(2, sizeof(*stages));
   if (!stages) return error("allocation-failed", "Paired conversion allocation failed.");
   stages[1].profile.stage = 1;
   const char *failed = pair_exact_stage(&stages[0], &inputs[0], lengths[0], false);
   if (!failed) failed = pair_exact_stage(&stages[1], &inputs[1], lengths[1], false);
   if (!failed) failed = pair_exact_finish(stages, inputs, lengths, -1);
   bool conditional = ((stages[0].profile.raw_flags | stages[1].profile.raw_flags) & RAW_CONDITIONAL) != 0;
   bool invalid_input = failed && strstr(failed, "\"code\":\"invalid-input\"");
   if (conditional && (failed || response_overflow) && !invalid_input) failed = numeric_rejection();
   else if (response_overflow) failed = error("translation-error", "JSON output exceeded its bound.");
   bool eligible = failed && pair_exact_eligible(failed);
   char original[256];
   if (eligible) snprintf(original, sizeof(original), "%s", failed);
   cleanup(&stages[0]); cleanup(&stages[1]);
   if (eligible) {
      memset(stages, 0, 2 * sizeof(*stages)); stages[1].profile.stage = 1;
      begin_response(true);
      failed = pair_exact_stage(&stages[0], &inputs[0], lengths[0], true);
      if (!failed) failed = pair_exact_stage(&stages[1], &inputs[1], lengths[1], true);
      bool invalid = failed && strstr(failed, "\"code\":\"invalid-input\"");
      if (!failed) failed = pair_exact_finish(stages, inputs, lengths, -1);
      bool rejected = failed || response_overflow;
      cleanup(&stages[0]); cleanup(&stages[1]);
      if (rejected && !invalid) { begin_response(true); append("%s", original); }
   }
   free(stages);
   return response;
}

static uint32_t private_92cb_word(const unsigned char *bytes)
{
   return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 |
      (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}

/* The observer preserves every original declaration and instruction through
 * pc222. Only the two open branch targets are retargeted to a new output tail.
 * No original pc223+ operation is parsed, translated or certified. */
static char *private_92cb_prefix(size_t *length)
{
   const char *source = private_92cb_fragment;
   const char *line216 = strstr(source, "\n216: UIF TEMP[167].xxxx :272\n");
   const char *line217 = strstr(source, "\n217:   UIF TEMP[168].xxxx :242\n");
   const char *line218 = strstr(source, "\n218:     MUL TEMP[169].xy,");
   const char *line223 = strstr(source, "\n223:     ADD TEMP[173].x,");
   if (!line216 || !line217 || !line218 || !line223 ||
       !(line216 < line217 && line217 < line218 && line218 < line223)) return NULL;
   static const char branches[] =
      "\n216: UIF TEMP[167].xxxx :228\n217:   UIF TEMP[168].xxxx :225";
   static const char tail[] =
      "\n223: MOV OUT[0].xy, TEMP[170].xyxx"
      "\n224: MOV OUT[0].zw, TEMP[172].xyxy"
      "\n225: ELSE :227"
      "\n226: MOV OUT[0], IMM[0].yyyy"
      "\n227: ENDIF"
      "\n228: ELSE :230"
      "\n229: MOV OUT[0], IMM[0].yyyy"
      "\n230: ENDIF"
      "\n231: END\n";
   size_t before = (size_t)(line216 - source);
   size_t middle = (size_t)(line223 - line218);
   *length = before + sizeof(branches) - 1 + middle + sizeof(tail) - 1;
   if (*length > BRIDGE_MAX_TEXT) return NULL;
   char *prefix = malloc(*length + 1);
   if (!prefix) return NULL;
   memcpy(prefix, source, before);
   memcpy(prefix + before, branches, sizeof(branches) - 1);
   memcpy(prefix + before + sizeof(branches) - 1, line218, middle);
   memcpy(prefix + before + sizeof(branches) - 1 + middle, tail, sizeof(tail));
   return prefix;
}

const char *bridge_translate_original_92cb_first_power(
   const char *vertex_text, size_t vertex_length,
   const char *fragment_text, size_t fragment_length,
   const unsigned char *geometry, size_t geometry_length,
   unsigned bank, const struct bridge_92cb_draw_state *draw)
{
   begin_response(true);
   if (!vertex_text || !fragment_text || !geometry || !draw || bank >= 3 ||
       vertex_length != sizeof(private_92cb_vertex) - 1 ||
       fragment_length != sizeof(private_92cb_fragment) - 1 ||
       geometry_length != sizeof(private_92cb_geometry) ||
       memcmp(vertex_text, private_92cb_vertex, vertex_length) ||
       memcmp(fragment_text, private_92cb_fragment, fragment_length) ||
       memcmp(geometry, private_92cb_geometry, geometry_length))
      return error("invalid-input", "Complete original 92cb sources and three-bank geometry must match the pinned capture.");
   if (draw->viewport_x || draw->viewport_y || draw->viewport_width != 1024 ||
       draw->viewport_height != 768 || draw->samples || draw->color_format != 0x8814 ||
       draw->mode != 5 || draw->first || draw->count != 4)
      return error("invalid-input", "The private first-power certificate requires the original single-sample RGBA32F strip draw state.");
   size_t prefix_length = 0;
   char *prefix = private_92cb_prefix(&prefix_length);
   if (!prefix) return error("translation-error", "The pinned original first-power prefix cannot be derived.");
   struct exact_pair_input inputs[2] = {0};
   struct bridge_exact_word vertex_words[16], fragment_words[148];
   const unsigned char *bank_bytes = geometry + 72 + bank * 656;
   for (unsigned i = 0; i < 16; ++i)
      vertex_words[i] = (struct bridge_exact_word){i / 4, i % 4, private_92cb_word(bank_bytes + 4 * i)};
   for (unsigned i = 0; i < 148; ++i)
      fragment_words[i] = (struct bridge_exact_word){i / 4, i % 4, private_92cb_word(bank_bytes + 64 + 4 * i)};
   memcpy(inputs[0].text, vertex_text, vertex_length);
   memcpy(inputs[1].text, prefix, prefix_length);
   bool canonical = pair_exact_components(&inputs[0].exact, vertex_words, 16) &&
      pair_exact_components(&inputs[1].exact, fragment_words, 148);
   if (!canonical) { free(prefix); return error("translation-error", "Pinned exact 92cb bank is not canonical."); }
   struct conversion *stages = calloc(2, sizeof(*stages));
   if (!stages) { free(prefix); return error("allocation-failed", "Private paired conversion allocation failed."); }
   stages[1].profile.stage = 1;
   const char *failed = pair_exact_stage(&stages[0], &inputs[0], vertex_length, true);
   if (!failed) failed = check_input_attempt(&stages[1].profile, inputs[1].text, prefix_length,
      RAW_KNOWN_RETRY | RAW_BRANCH_RETRY | RAW_PRIVATE_92CB_POWER, &inputs[1].exact);
   if (!failed) failed = pair_exact_finish(stages, inputs,
      (size_t[2]){vertex_length, prefix_length}, (int)bank);
   bool rejected = failed || response_overflow;
   cleanup(&stages[0]); cleanup(&stages[1]);
   free(stages); free(prefix);
   if (rejected && response_overflow) return error("translation-error", "Private paired JSON exceeded its bound.");
   return response;
}

const char *bridge_translate_original_92cb_complete(
   const char *vertex_text, size_t vertex_length,
   const char *fragment_text, size_t fragment_length,
   const unsigned char *geometry, size_t geometry_length,
   unsigned bank, const struct bridge_92cb_draw_state *draw)
{
   begin_response(true);
   if (!vertex_text || !fragment_text || !geometry || !draw || bank >= 3 ||
       vertex_length != sizeof(private_92cb_vertex) - 1 ||
       fragment_length != sizeof(private_92cb_fragment) - 1 ||
       geometry_length != sizeof(private_92cb_geometry) ||
       memcmp(vertex_text, private_92cb_vertex, vertex_length) ||
       memcmp(fragment_text, private_92cb_fragment, fragment_length) ||
       memcmp(geometry, private_92cb_geometry, geometry_length))
      return error("invalid-input", "Complete original 92cb sources and three-bank geometry must match the pinned capture.");
   if (draw->viewport_x || draw->viewport_y || draw->viewport_width != 1024 ||
       draw->viewport_height != 768 || draw->samples || draw->color_format != 0x8814 ||
       draw->mode != 5 || draw->first || draw->count != 4)
      return error("invalid-input", "The private full-source certificate requires the original single-sample RGBA32F strip draw state.");
   struct exact_pair_input inputs[2] = {0};
   struct bridge_exact_word vertex_words[16], fragment_words[148];
   const unsigned char *bank_bytes = geometry + 72 + bank * 656;
   for (unsigned i = 0; i < 16; ++i)
      vertex_words[i] = (struct bridge_exact_word){i / 4, i % 4, private_92cb_word(bank_bytes + 4 * i)};
   for (unsigned i = 0; i < 148; ++i)
      fragment_words[i] = (struct bridge_exact_word){i / 4, i % 4, private_92cb_word(bank_bytes + 64 + 4 * i)};
   memcpy(inputs[0].text, vertex_text, vertex_length);
   memcpy(inputs[1].text, fragment_text, fragment_length);
   bool canonical = pair_exact_components(&inputs[0].exact, vertex_words, 16) &&
      pair_exact_components(&inputs[1].exact, fragment_words, 148);
   if (!canonical) { return error("translation-error", "Pinned exact 92cb bank is not canonical."); }
   struct conversion *stages = calloc(2, sizeof(*stages));
   if (!stages) { return error("allocation-failed", "Private paired conversion allocation failed."); }
   stages[1].profile.stage = 1;
   const char *failed = pair_exact_stage(&stages[0], &inputs[0], vertex_length, true);
   if (!failed) failed = check_input_attempt(&stages[1].profile, inputs[1].text, fragment_length,
      RAW_KNOWN_RETRY | RAW_BRANCH_RETRY | RAW_PRIVATE_92CB_COMPLETE, &inputs[1].exact);
   if (!failed) failed = pair_exact_finish(stages, inputs,
      (size_t[2]){vertex_length, fragment_length}, (int)bank + 3);
   bool rejected = failed || response_overflow;
   cleanup(&stages[0]); cleanup(&stages[1]);
   free(stages);
   if (rejected && response_overflow) return error("translation-error", "Private paired JSON exceeded its bound.");
   return response;
}

/* The standard facet deliberately has no profile/raw_ir member. Its guarded
 * syntax is the only input to this independent upstream transaction. */
#include "tgsi/tgsi_parse.h"
#include "tgsi/tgsi_build.h"
struct standard_conversion {
   struct standard_profile profile;
   struct vrend_shader_info info;
   struct vrend_variable_shader_info variable;
   struct vrend_strarray shader;
   char *standard_source;
};
_Static_assert(sizeof(struct standard_conversion) * 2 <= 65536, "standard pair arena bound");
static void standard_cleanup(struct standard_conversion *c)
{
   strarray_free(&c->shader, true);
   free(c->info.sampler_arrays);
   free(c->info.image_arrays);
   free(c->standard_source);
}
/* The pinned converter counts a declaration ending at CONST[0] with ++,
 * rather than max(Last + 1). Put that unique declaration before other CONST
 * declarations. This is a stable permutation of complete original tokens:
 * no register, instruction, property, immediate or label is rewritten. The
 * guard still rejects duplicates/holes used by direct reads, and the strict
 * independently derived maximum-bank comparison remains in force. */
static bool standard_constant_order(struct tgsi_token *tokens)
{
   struct tgsi_parse_context parser;
   if (tgsi_parse_init(&parser, tokens) != TGSI_PARSE_OK) return false;
   unsigned first = 0;
   bool ok = true;
   while (!tgsi_parse_end_of_tokens(&parser)) {
      unsigned start = parser.Position;
      if (!tgsi_parse_token(&parser)) { ok = false; break; }
      if (parser.FullToken.Token.Type == TGSI_TOKEN_TYPE_INSTRUCTION) break;
      if (parser.FullToken.Token.Type != TGSI_TOKEN_TYPE_DECLARATION ||
          parser.FullToken.FullDeclaration.Declaration.File != TGSI_FILE_CONSTANT) continue;
      const struct tgsi_full_declaration *decl = &parser.FullToken.FullDeclaration;
      if (decl->Declaration.Dimension && decl->Dim.Index2D) continue;
      if (!first) first = start;
      if (decl->Range.Last || start == first) continue;
      unsigned width = decl->Declaration.Dimension ? 3 : 2;
      if (decl->Range.First || parser.Position - start != width) {
         ok = false; break;
      }
      struct tgsi_token zero[3];
      memcpy(zero, tokens + start, width * sizeof(*tokens));
      memmove(tokens + first + width, tokens + first, (start - first) * sizeof(*tokens));
      memcpy(tokens + first, zero, width * sizeof(*tokens));
      break;
   }
   tgsi_parse_free(&parser);
   return ok;
}
/* This pinned converter predates NIR's PCOORD system-value declaration. Give
 * upstream validation one private unused input alias; public metadata and the
 * word emitter still consume the complete original tokens. Rebuilding bounds
 * the extra interpolation token and avoids changing any caller-owned stream. */
static const char *standard_point_tokens(const struct standard_profile *p,
                                         const struct tgsi_token *original,
                                         struct tgsi_token **result)
{
   unsigned system = 2, input = 0;
   for (unsigned i = 0; i < 2; ++i)
      if (p->declared[STD_SV][i] && p->system[i].semantic == STD_PCOORD) system = i;
   if (system == 2) return NULL;
   while (input < STANDARD_IO && p->declared[STD_IN][input]) ++input;
   if (input == STANDARD_IO) return error("translation-error", "No bounded private point-coordinate alias.");
   struct tgsi_token *tokens = calloc(BRIDGE_MAX_TOKENS, sizeof(*tokens));
   if (!tokens) return error("allocation-failed", "Point-coordinate validation allocation failed.");
   struct tgsi_parse_context parser;
   if (tgsi_parse_init(&parser, original) != TGSI_PARSE_OK) {
      free(tokens); return error("translation-error", "Original point-coordinate token parsing failed.");
   }
   struct tgsi_header header = tgsi_build_header();
   struct tgsi_processor processor = tgsi_build_processor(parser.FullHeader.Processor.Processor, &header);
   memcpy(tokens + 1, &processor, sizeof(processor));
   unsigned used = 2; bool ok = true;
   while (!tgsi_parse_end_of_tokens(&parser)) {
      if (!tgsi_parse_token(&parser)) { ok = false; break; }
      unsigned built = 0;
      switch (parser.FullToken.Token.Type) {
      case TGSI_TOKEN_TYPE_DECLARATION: {
         struct tgsi_full_declaration *d = &parser.FullToken.FullDeclaration;
         if (d->Declaration.File == TGSI_FILE_SYSTEM_VALUE && d->Range.First == system) {
            d->Declaration.File = TGSI_FILE_INPUT;
            d->Range.First = d->Range.Last = input;
            d->Declaration.Interpolate = 1;
            d->Interp.Interpolate = TGSI_INTERPOLATE_LINEAR;
            d->Interp.Location = TGSI_INTERPOLATE_LOC_CENTER;
         }
         built = tgsi_build_full_declaration(d, tokens + used, &header, BRIDGE_MAX_TOKENS - used);
         break;
      }
      case TGSI_TOKEN_TYPE_IMMEDIATE:
         built = tgsi_build_full_immediate(&parser.FullToken.FullImmediate, tokens + used, &header, BRIDGE_MAX_TOKENS - used);
         break;
      case TGSI_TOKEN_TYPE_PROPERTY:
         built = tgsi_build_full_property(&parser.FullToken.FullProperty, tokens + used, &header, BRIDGE_MAX_TOKENS - used);
         break;
      case TGSI_TOKEN_TYPE_INSTRUCTION: {
         struct tgsi_full_instruction *i = &parser.FullToken.FullInstruction;
         for (unsigned j = 0; j < i->Instruction.NumSrcRegs; ++j)
            if (i->Src[j].Register.File == TGSI_FILE_SYSTEM_VALUE && i->Src[j].Register.Index == (int)system) {
               i->Src[j].Register.File = TGSI_FILE_INPUT; i->Src[j].Register.Index = (int)input;
            }
         built = tgsi_build_full_instruction(i, tokens + used, &header, BRIDGE_MAX_TOKENS - used);
         break;
      }
      default: break;
      }
      if (!built) { ok = false; break; }
      used += built;
   }
   tgsi_parse_free(&parser);
   if (!ok) { free(tokens); return error("translation-error", "Bounded point-coordinate validation rebuild failed."); }
   memcpy(tokens, &header, sizeof(header)); *result = tokens;
   return NULL;
}
static const char *standard_convert(struct standard_conversion *c, const char *owned,
                                    const struct vrend_fs_shader_info *fragment)
{
   struct tgsi_token tokens[BRIDGE_MAX_TOKENS] = {0};
   if (c->profile.uniform_buffers) bridge_tgsi_scratch_begin_uniform();
   else bridge_tgsi_scratch_begin();
   upstream_logged = false;
   if (!tgsi_text_translate(owned, tokens, BRIDGE_MAX_TOKENS) || bridge_tgsi_scratch_failed() || upstream_logged)
      return error("translation-error", "Checked upstream TGSI parsing failed.");
   if (!standard_constant_order(tokens))
      return error("translation-error", "Checked standard constant declaration ordering failed.");
   struct vrend_shader_cfg cfg = {.glsl_version = 300, .max_draw_buffers = 4,
      .use_gles = 1, .use_core_profile = 1, .use_integer = 1};
   struct vrend_shader_key key = {0};
   if (c->profile.stage) key.fs.lower_left_origin = 1;
   else {
      key.vs.attrib_signed_int_bitmask = c->profile.signed_inputs;
      key.vs.attrib_unsigned_int_bitmask = c->profile.unsigned_inputs;
   }
   if (fragment) key.fs_info = *fragment;
   if (!strarray_alloc(&c->shader, SHADER_MAX_STRINGS))
      return error("translation-error", "Standard output allocation failed.");
   struct tgsi_token *point_tokens = NULL;
   const char *failed = standard_point_tokens(&c->profile, tokens, &point_tokens);
   if (failed) return failed;
   bridge_upstream_allocation_begin();
   bool ok = vrend_convert_shader(NULL, &cfg, point_tokens ? point_tokens : tokens, 0, &key, &c->info, &c->variable, &c->shader);
   free(point_tokens);
   size_t bytes = 0;
   for (int i = 0; i < c->shader.num_strings; ++i) bytes += strlen(c->shader.strings[i].buf);
   /* Pinned upstream samplers_used means declared SAMP registers. Our public
    * interface describes actual TEX reads, so unused declarations must not
    * confuse those two independently checked facts. */
   uint32_t declared_samplers = 0;
   for (unsigned i = 0; i < STANDARD_SAMPLERS; ++i)
      if (c->profile.declared[STD_SAMP][i]) declared_samplers |= 1u << i;
   uint32_t declared_uniforms = 0;
   for (unsigned i = 1; i <= STANDARD_UNIFORM_SLOTS; ++i)
      if (c->profile.uniform_counts[i]) declared_uniforms |= 1u << i;
   if (!ok || bridge_upstream_allocation_failed() || upstream_logged || bytes > BRIDGE_MAX_GLSL ||
       c->info.num_consts != c->profile.constants || c->info.samplers_used_mask != declared_samplers ||
       c->info.ubo_used_mask != declared_uniforms || c->info.ubo_indirect ||
       (c->profile.texture_operations && c->info.gles_use_tex_query_level != (c->profile.queried_levels != 0)))
      return error("translation-error", "Standard conversion failed or metadata/output bounds disagree.");
   /* The pinned public info exposes a mask, but not the per-bank sizes. Check
    * those independently emitted declarations before producing word storage. */
   for (unsigned slot = 1; slot <= STANDARD_UNIFORM_SLOTS; ++slot) if (c->profile.uniform_counts[slot]) {
      char declaration[128]; const char *prefix = c->profile.stage ? "fs" : "vs";
      snprintf(declaration, sizeof(declaration), "uniform %subo%u { vec4 %subo%ucontents[%u]; };\n",
               prefix, slot, prefix, slot, c->profile.uniform_counts[slot]);
      unsigned matches = 0;
      for (int i = 0; i < c->shader.num_strings; ++i)
         matches += strstr(c->shader.strings[i].buf, declaration) != NULL;
      if (matches != 1) return error("translation-error", "Upstream uniform bank size disagrees.");
   }
   const char *emitted = standard_emit(&c->profile, tokens, &c->standard_source);
   return emitted ? error(emitted, "Standard word-storage emission failed.") : NULL;
}
static bool standard_fragment_export(const struct standard_conversion *c)
{
   const struct standard_profile *p = &c->profile;
   const struct vrend_fs_shader_info *fs = &c->variable.fs_info;
   unsigned count = 0; bool seen[STANDARD_GENERIC] = {0};
   for (unsigned i = 0; i < STANDARD_IO; ++i)
      count += p->declared[STD_IN][i] && p->input[i].semantic == STD_GENERIC;
   if (fs->num_interps != (int)count || fs->has_sample_input || fs->has_noperspective) return false;
   for (unsigned i = 0; i < count; ++i) {
      const struct vrend_interp_info *e = &fs->interpinfo[i];
      if (e->semantic_name != TGSI_SEMANTIC_GENERIC || e->semantic_index >= STANDARD_GENERIC ||
          e->location != TGSI_INTERPOLATE_LOC_CENTER || seen[e->semantic_index]) return false;
      seen[e->semantic_index] = true;
      bool found = false;
      for (unsigned j = 0; j < STANDARD_IO; ++j) if (p->declared[STD_IN][j] &&
          p->input[j].semantic == STD_GENERIC && p->input[j].sid == e->semantic_index) {
         if (e->interpolate != (p->input[j].flat ? TGSI_INTERPOLATE_CONSTANT : TGSI_INTERPOLATE_PERSPECTIVE)) return false;
         found = true;
      }
      if (!found) return false;
   }
   return true;
}
static void standard_io_json(const struct standard_profile *p, unsigned file)
{
   bool comma = false;
   append("[");
   const struct standard_io *list = file == STD_IN ? p->input : file == STD_OUT ? p->output : p->system;
   unsigned count = file == STD_SV ? 2 : STANDARD_IO;
   static const char *semantics[] = {"ATTRIBUTE", "POSITION", "GENERIC", "COLOR", "VERTEXID", "INSTANCEID", "PSIZE", "PCOORD"};
   for (unsigned i = 0; i < count; ++i) if (p->declared[file][i]) {
      const struct standard_io *io = &list[i];
      char name[32];
      if (io->semantic == STD_ATTRIBUTE) snprintf(name, sizeof(name), "in_%u", i);
      else if (io->semantic == STD_POSITION) snprintf(name, sizeof(name), "%s", p->stage ? "gl_FragCoord" : "gl_Position");
      else if (io->semantic == STD_GENERIC) snprintf(name, sizeof(name), "vso_g%u", io->sid);
      else if (io->semantic == STD_COLOR) snprintf(name, sizeof(name), "fsout_c%u", io->sid);
      else if (io->semantic == STD_PSIZE) snprintf(name, sizeof(name), "gl_PointSize");
      else if (io->semantic == STD_PCOORD) snprintf(name, sizeof(name), "gl_PointCoord");
      else snprintf(name, sizeof(name), "%s", io->semantic == STD_VERTEXID ? "gl_VertexID" : "gl_InstanceID");
      append("%s{\"index\":%u,\"name\":\"%s\",\"type\":\"%s\",\"semantic\":\"%s\",\"semanticIndex\":%u,\"componentMask\":%u",
         comma ? "," : "", i, name, io->semantic == STD_ATTRIBUTE ? standard_attribute_type(p, i) : io->semantic == STD_PSIZE ? "float" : file == STD_SV && io->semantic != STD_PCOORD ? "int" : io->semantic == STD_GENERIC && io->flat ? "uvec4" : "vec4", semantics[io->semantic], io->sid, io->mask);
      if (file == STD_OUT) append(",\"syntacticWriteMask\":%u", io->writes);
      if (io->semantic == STD_GENERIC) append(",\"interpolation\":\"%s\"", io->flat ? "flat" : "smooth");
      if ((io->semantic == STD_POSITION || io->semantic == STD_PCOORD) && file == STD_IN && p->stage) append(",\"interpolation\":\"linear\"");
      append("}"); comma = true;
   }
   append("]");
}
static void standard_result(const struct standard_conversion *c)
{
   const struct standard_profile *p = &c->profile;
   append("\"glsl\":\"");
   {
      const char *s = c->standard_source;
      for (; *s; ++s) {
         unsigned char ch = (unsigned char)*s;
         if (ch == '"' || ch == '\\') append("\\%c", ch);
         else if (ch < 32) append("\\u%04x", ch);
         else append("%c", ch);
      }
   }
   append("\",\"metadata\":{\"profile\":\"%s\",\"stage\":\"%s\",\"inputs\":",
          p->texture_operations ? "virgl-webgl2-standard-texture-gles3-v1" : p->uniform_buffers ? "virgl-webgl2-standard-uniform-gles3-v1" : "virgl-webgl2-standard-gles3-v1",
          p->stage ? "fragment" : "vertex");
   standard_io_json(p, STD_IN); append(",\"outputs\":"); standard_io_json(p, STD_OUT);
   append(",\"attributes\":"); if (p->stage) append("[]"); else standard_io_json(p, STD_IN);
   append(",\"systemValues\":"); standard_io_json(p, STD_SV);
   append(",\"uniforms\":[");
   if (p->constants && !p->buffer_zero) append("{\"name\":\"%sconst0\",\"type\":\"uvec4[]\",\"count\":%u,\"encoding\":\"raw-32bit-words\"}", p->stage ? "fs" : "vs", p->constants);
   append("],\"samplers\":["); bool comma = false;
   for (unsigned i = 0; i < STANDARD_SAMPLERS; ++i) if (p->used_samplers & (1u << i)) {
      append("%s{\"index\":%u,\"name\":\"%ssamp%u\",\"type\":\"sampler2D\"}", comma ? "," : "", i, p->stage ? "fs" : "vs", i);
      comma = true;
   }
   append("],\"uniformBlocks\":[");
   if (!p->stage) append("{\"name\":\"VirglBlock\",\"byteLength\":656,\"members\":[{\"name\":\"winsys_adjust_y\",\"offset\":640,\"type\":\"float\",\"default\":1}]}");
   append("],\"rasterUniforms\":[");
   bool point_coord = false;
   for (unsigned i = 0; i < STANDARD_IO; ++i)
      point_coord |= p->declared[STD_IN][i] && p->input[i].semantic == STD_PCOORD;
   for (unsigned i = 0; i < 2; ++i)
      point_coord |= p->declared[STD_SV][i] && p->system[i].semantic == STD_PCOORD;
   if (!p->stage) append("{\"name\":\"wv_point_size\",\"type\":\"vec2\",\"semantic\":\"POINT_SIZE\"}");
   else if (point_coord) append("{\"name\":\"wv_point_coord_y\",\"type\":\"float\",\"semantic\":\"POINT_COORD_Y\"}");
   append("]");
   if (p->uniform_buffers) {
      append(",\"guestUniformBlocks\":["); bool comma = false;
      for (unsigned i = 0; i <= STANDARD_UNIFORM_SLOTS; ++i) {
         unsigned count = i ? p->uniform_counts[i] : p->buffer_zero ? p->constants : 0;
         if (!count) continue;
         append("%s{\"name\":\"Virgl%sConst%u\",\"stage\":\"%s\",\"slot\":%u,\"byteLength\":%u,\"encoding\":\"raw-32bit-words\",\"members\":[{\"name\":\"%sconst%u\",\"type\":\"uvec4[]\",\"count\":%u,\"offset\":0,\"arrayStride\":16}]}",
                comma ? "," : "", p->stage ? "FS" : "VS", i, p->stage ? "fragment" : "vertex",
                i, count * 16, p->stage ? "fs" : "vs", i, count);
         comma = true;
      }
      append("]");
   }
   if (p->texture_operations) {
      append(",\"textureQueries\":["); bool comma = false;
      for (unsigned i = 0; i < STANDARD_SAMPLERS; ++i) if (p->queried_levels & (1u << i)) {
         append("%s{\"index\":%u,\"name\":\"%ssamplevels%u\",\"type\":\"int\",\"semantic\":\"TEXTURE_LEVELS\"}",
                comma ? "," : "", i, p->stage ? "fs" : "vs", i);
         comma = true;
      }
      append("]");
   }
   append(",\"broadcastColor0\":%s,\"standardSemantics\":{\"kind\":\"native-gles3-highp-v1\",\"precision\":\"native-highp\",\"undefinedDomains\":\"native-gles3\",\"preciseQualifier\":\"no-gpu-shader5\",\"registerStorage\":\"uvec4\",\"flatVaryingStorage\":\"uvec4\",\"scalarResults\":\"tgsi-x-replicated\",\"exactAuthority\":false,\"gpuExecutionBound\":false}}", p->broadcast ? "true" : "false");
}
static const char *standard_input(struct standard_profile *p, const char *text, size_t length, char *owned)
{
   if (!text) return error("invalid-input", "Standard TGSI input is null.");
   if (length > BRIDGE_MAX_TEXT) return error("input-too-large", "TGSI text exceeds 49152 bytes.");
   memcpy(owned, text, length); owned[length] = 0;
   const char *code = standard_validate(p, owned, length);
   /* The pinned parser omits CR from its whitespace set. This facet owns and
    * canonicalizes only accepted whitespace; grammar and extents use original
    * bytes, and no opcode, literal or register is rewritten. */
   if (!code) for (size_t i = 0; i < length; ++i) if (owned[i] == '\r') owned[i] = ' ';
   return code ? error(code, "TGSI is outside the bounded standard GLES3 grammar.") : NULL;
}
static const char *standard_stage(int stage, const char *text, size_t length, bool uniform_buffers, bool texture_operations)
{
   begin_response(false);
   if (stage != 0 && stage != 1) return error("unsupported-stage", "Only vertex and fragment stages are supported.");
   char owned[BRIDGE_MAX_TEXT + 1];
   struct standard_profile p = {.stage = stage, .uniform_buffers = uniform_buffers, .texture_operations = texture_operations};
   const char *failed = standard_input(&p, text, length, owned);
   if (failed) return response;
   struct standard_conversion *c = calloc(1, sizeof(*c));
   if (!c) return error("allocation-failed", "Standard conversion arena allocation failed.");
   c->profile = p;
   failed = standard_convert(c, owned, NULL);
   if (!failed) { append("{\"ok\":true,"); standard_result(c); append("}"); }
   standard_cleanup(c); free(c);
   if (response_overflow) return error("translation-error", "Standard JSON output exceeded its bound.");
   return response;
}
const char *bridge_translate_standard(int stage, const char *text, size_t length)
{
   return standard_stage(stage, text, length, false, false);
}
const char *bridge_translate_standard_uniform(int stage, const char *text, size_t length)
{
   return standard_stage(stage, text, length, true, false);
}
static const char *standard_pair(const char *vertex_text, size_t vertex_length,
                                const char *fragment_text, size_t fragment_length,
                                uint32_t signed_inputs, uint32_t unsigned_inputs,
                                uint32_t packed_signed_inputs, uint32_t packed_normalized_inputs,
                                bool uniform_buffers, bool texture_operations, uint32_t buffer_zero_mask)
{
   begin_response(true);
   if ((signed_inputs | unsigned_inputs | packed_signed_inputs | packed_normalized_inputs) > 0xffffu ||
       (signed_inputs & unsigned_inputs) || ((signed_inputs | unsigned_inputs) & packed_signed_inputs) ||
       (packed_normalized_inputs & ~packed_signed_inputs) || buffer_zero_mask > 3u)
      return error("invalid-input", "Vertex format masks must be compatible 16-bit masks.");
   char owned[2][BRIDGE_MAX_TEXT + 1];
   struct standard_profile profiles[2] = {{.stage = 0, .uniform_buffers = uniform_buffers, .texture_operations = texture_operations},
                                         {.stage = 1, .uniform_buffers = uniform_buffers, .texture_operations = texture_operations}};
   const char *failed = standard_input(&profiles[0], vertex_text, vertex_length, owned[0]);
   if (!failed) failed = standard_input(&profiles[1], fragment_text, fragment_length, owned[1]);
   if (!failed && !standard_match(&profiles[0], &profiles[1]))
      failed = error("incompatible-interface", "Standard fragment inputs require matching declared vertex components.");
   if (failed) return response;
   for (unsigned i = 0; i < 2; ++i) if (buffer_zero_mask & (1u << i)) {
      if (!profiles[i].constants) return error("invalid-input", "Buffered slot zero requires a declared constant bank.");
      profiles[i].buffer_zero = true;
   }
   uint32_t declared_inputs = 0;
   for (unsigned i = 0; i < 16; ++i)
      if (profiles[0].declared[STD_IN][i]) declared_inputs |= 1u << i;
   if ((signed_inputs | unsigned_inputs | packed_signed_inputs) & ~declared_inputs)
      return error("invalid-input", "Format masks must name declared vertex attributes.");
   profiles[0].signed_inputs = (uint16_t)signed_inputs;
   profiles[0].unsigned_inputs = (uint16_t)unsigned_inputs;
   profiles[0].packed_signed_inputs = (uint16_t)packed_signed_inputs;
   profiles[0].packed_normalized_inputs = (uint16_t)packed_normalized_inputs;
   struct standard_conversion *c = calloc(2, sizeof(*c));
   if (!c) return error("allocation-failed", "Standard pair arena allocation failed.");
   c[0].profile = profiles[0]; c[1].profile = profiles[1];
   failed = standard_convert(&c[1], owned[1], NULL);
   if (!failed && !standard_fragment_export(&c[1])) failed = error("translation-error", "Standard interpolation export differs from the checked fragment declarations.");
   if (!failed) failed = standard_convert(&c[0], owned[0], &c[1].variable.fs_info);
   if (!failed) {
      append("{\"ok\":true,\"vertex\":{"); standard_result(&c[0]);
      append("},\"fragment\":{"); standard_result(&c[1]);
      append("},\"interfaceKey\":\"standard-generic-interpolation-v1:");
      bool comma = false;
      for (unsigned sid = 0; sid < STANDARD_GENERIC; ++sid)
         for (unsigned i = 0; i < STANDARD_IO; ++i) if (profiles[1].declared[STD_IN][i] && profiles[1].input[i].semantic == STD_GENERIC && profiles[1].input[i].sid == sid) {
            const struct standard_io *io = &profiles[1].input[i];
            append("%sg%u/%u/%s", comma ? ";" : "", sid, io->mask, io->flat ? "flat" : "smooth"); comma = true;
         }
      append("\"}");
   }
   standard_cleanup(&c[0]); standard_cleanup(&c[1]); free(c);
   if (response_overflow) return error("translation-error", "Standard pair JSON output exceeded its bound.");
   return response;
}
const char *bridge_translate_standard_pair(const char *vertex_text, size_t vertex_length,
                                           const char *fragment_text, size_t fragment_length)
{
   return standard_pair(vertex_text, vertex_length, fragment_text, fragment_length, 0, 0, 0, 0, false, false, 0);
}
const char *bridge_translate_standard_pair_typed(const char *vertex_text, size_t vertex_length,
                                                 const char *fragment_text, size_t fragment_length,
                                                 uint32_t signed_inputs, uint32_t unsigned_inputs)
{
   return standard_pair(vertex_text, vertex_length, fragment_text, fragment_length,
                        signed_inputs, unsigned_inputs, 0, 0, false, false, 0);
}
const char *bridge_translate_standard_pair_vertex_formats(const char *vertex_text, size_t vertex_length,
                                                          const char *fragment_text, size_t fragment_length,
                                                          uint32_t signed_inputs, uint32_t unsigned_inputs,
                                                          uint32_t packed_signed_inputs, uint32_t packed_normalized_inputs)
{
   return standard_pair(vertex_text, vertex_length, fragment_text, fragment_length,
                        signed_inputs, unsigned_inputs, packed_signed_inputs, packed_normalized_inputs, false, false, 0);
}
const char *bridge_translate_standard_uniform_pair(const char *vertex_text, size_t vertex_length,
                                                   const char *fragment_text, size_t fragment_length,
                                                   uint32_t signed_inputs, uint32_t unsigned_inputs,
                                                   uint32_t packed_signed_inputs, uint32_t packed_normalized_inputs,
                                                   uint32_t buffer_zero_mask)
{
   return standard_pair(vertex_text, vertex_length, fragment_text, fragment_length,
                        signed_inputs, unsigned_inputs, packed_signed_inputs, packed_normalized_inputs,
                        true, false, buffer_zero_mask);
}

const char *bridge_translate_standard_texture(int stage, const char *text, size_t length)
{
   return standard_stage(stage, text, length, true, true);
}
const char *bridge_translate_standard_texture_pair(const char *vertex_text, size_t vertex_length,
                                                   const char *fragment_text, size_t fragment_length,
                                                   uint32_t signed_inputs, uint32_t unsigned_inputs,
                                                   uint32_t packed_signed_inputs, uint32_t packed_normalized_inputs,
                                                   uint32_t buffer_zero_mask)
{
   return standard_pair(vertex_text, vertex_length, fragment_text, fragment_length,
                        signed_inputs, unsigned_inputs, packed_signed_inputs, packed_normalized_inputs,
                        true, true, buffer_zero_mask);
}
