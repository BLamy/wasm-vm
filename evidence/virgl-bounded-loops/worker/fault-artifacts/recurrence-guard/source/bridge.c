/* SPDX-License-Identifier: MIT
 * Bounded profile adapter around the unmodified upstream VirGL compiler.
 * The guard validates a deliberately small language before upstream's general
 * TGSI parser sees it. No unbounded numeric/range value, unsupported property,
 * indirect address, unsupported stage, or control-flow token reaches upstream.
 * Checked indirect constants use the owned raw backend exclusively.
 */
#include "bridge.h"
#include "raw_bits.h"
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
static unsigned register_limit(unsigned file)
{
   return file == TEMP ? TEMP_REGISTERS : file == CONST ? CONST_REGISTERS : FILE_REGISTERS;
}
static bool register_name(const char **p, struct reg *r, enum operand_kind kind)
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
   } else if (!index_number(p, &r->index, register_limit(f))) return false;
   r->file = indirect ? INDIRECT_CONST : (enum file)f;
   r->last = r->index;
   space(p);
   if (!strncmp(*p, "..", 2)) {
      if (kind != DECLARATION || (f != TEMP && f != CONST)) { failure_code = "unsupported-feature"; return false; }
      *p += 2;
      if (!index_number(p, &r->last, register_limit(f)) || r->last < r->index) return false;
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
                   (kind == DESTINATION && count == 1))) {
         failure_code = "unsupported-feature";
         return false;
      }
   }
   return true;
}
static bool source(const char **p, struct profile *s, unsigned consumed, struct raw_source *operand)
{
   struct reg r;
   if (!register_name(p, &r, SOURCE)) return false;
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
      if (!s->syntax_only) {
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
   if (!s->syntax_only && r.file == TEMP && (s->written[TEMP][r.index] & needed) != needed) return false;
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
   if (s->started || !register_name(p, &r, DECLARATION) || r.file == IMM) return false;
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
         if (s->stage != 0 || r.file != OUT || r.index != 0) return false;
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
         if (word(p, "CONSTANT")) flat = true;
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
       !loop_scalar_arg(&v[9], 0, j)  ||
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

enum { FLOW_DEPTH = 8 };
struct flow_frame {
   struct raw_lane temporary[TEMP_REGISTERS][4], output[FILE_REGISTERS][4];
   unsigned temporary_written[TEMP_REGISTERS], output_written[FILE_REGISTERS];
   unsigned target, else_target;
   bool has_target, has_else, has_else_target, address_written;
   bool is_loop, entry_live, saved_live, exit_live;
   struct raw_lane address;
};
struct flow_context { struct flow_frame frames[FLOW_DEPTH]; unsigned depth; };
_Static_assert(sizeof(struct flow_context) <= 53248, "bounded conditional heap arena");

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

static bool control(const char **p, struct profile *s, struct flow_context *flow, enum raw_opcode opcode)
{
   failure_code = "unsupported-feature";
   struct raw_instruction raw = {.opcode = opcode, .flags = s->raw_flags};
   bool loop = opcode == RAW_BGNLOOP || opcode == RAW_ENDLOOP;
   if (opcode == RAW_UIF && !source(p, s, 1u, &raw.src[0])) return false;
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
         if (frame->is_loop) loop_header(s);
         else flow_snapshot(s, frame, false);
      }
   } else if (opcode == RAW_BRK) {
      unsigned depth = flow->depth;
      while (depth && !flow->frames[depth - 1].is_loop) --depth;
      if (!depth) return false;
      if (!s->syntax_only) {
         if (s->current_pc != s->raw->loop.break_pc || !s->live) return false;
         struct flow_frame *frame = &flow->frames[depth - 1];
         flow_snapshot(s, frame, false); frame->exit_live = true;
         s->live = false;
      }
   } else {
      if (!flow->depth) return false;
      struct flow_frame *frame = &flow->frames[flow->depth - 1];
      if (opcode == RAW_ENDLOOP) {
         if (!frame->is_loop || (!s->syntax_only && (s->current_pc != s->raw->loop.end || !frame->exit_live))) return false;
         if (!s->syntax_only) { flow_snapshot(s, frame, true); s->live = true; }
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
   if (flow) {
      if (word(p, "BGNLOOP")) return control(p, s, flow, RAW_BGNLOOP);
      if (word(p, "BRK")) return control(p, s, flow, RAW_BRK);
      if (word(p, "ENDLOOP")) return control(p, s, flow, RAW_ENDLOOP);
      if (word(p, "UIF")) return control(p, s, flow, RAW_UIF);
      if (word(p, "ELSE")) return control(p, s, flow, RAW_ELSE);
      if (word(p, "ENDIF")) return control(p, s, flow, RAW_ENDIF);
   }
   if (word(p, "MOV")) { arity = 1; partial = true; }
   else if (s->raw) {
      if (word(p, "UARL")) raw.opcode = RAW_UARL;
      else if (word(p, "AND")) raw.opcode = RAW_AND;
      else if (word(p, "OR")) raw.opcode = RAW_OR;
      else if (word(p, "NOT")) raw.opcode = RAW_NOT;
      else if (word(p, "SHL")) raw.opcode = RAW_SHL;
      else if (word(p, "USHR")) raw.opcode = RAW_USHR;
      else if (word(p, "UADD")) raw.opcode = RAW_UADD;
      else if (word(p, "ISGE")) raw.opcode = RAW_ISGE;
      else if (word(p, "USEQ")) raw.opcode = RAW_USEQ;
      else if (word(p, "USNE")) raw.opcode = RAW_USNE;
      else if (word(p, "UCMP")) raw.opcode = RAW_UCMP;
      else if (word(p, "FSLT")) raw.opcode = RAW_FSLT;
      else if (word(p, "FSGE")) raw.opcode = RAW_FSGE;
      else if (word(p, "ADD")) raw.opcode = RAW_ADD;
      else if (word(p, "MUL")) raw.opcode = RAW_MUL;
      else if (word(p, "MAD")) raw.opcode = RAW_MAD;
      else if (word(p, "TEX")) raw.opcode = RAW_TEX;
      else if (word(p, "DIV")) raw.opcode = RAW_DIV;
      else if (word(p, "MAX")) raw.opcode = RAW_MAX;
      else if (word(p, "FRC")) raw.opcode = RAW_FRC;
      else if (word(p, "LRP")) raw.opcode = RAW_LRP;
      else if (word(p, "DP3")) raw.opcode = RAW_DP3;
      else if (word(p, "RCP")) raw.opcode = RAW_RCP;
      else if (word(p, "RSQ")) raw.opcode = RAW_RSQ;
      else { failure_code = "unsupported-feature"; return false; }
      tex = raw.opcode == RAW_TEX;
      arity = raw.opcode == RAW_UARL || raw.opcode == RAW_NOT || raw.opcode == RAW_FRC ||
         raw.opcode == RAW_RCP || raw.opcode == RAW_RSQ || tex ? 1 :
         raw.opcode == RAW_UCMP || raw.opcode == RAW_MAD || raw.opcode == RAW_LRP ? 3 : 2;
      partial = !tex && raw.opcode != RAW_MAD;
      /* These formerly unsupported numeric tokens retain that error category
       * for malformed syntax and unproven domains in an owned raw stage. */
      if (raw.opcode == RAW_UARL || ((UINT64_C(1) << raw.opcode) & RAW_NUMERIC_OPCODES)) failure_code = "unsupported-feature";
   }
   else if (word(p, "ADD") || word(p, "MUL")) { arity = 2; partial = true; }
   else if (word(p, "MAD")) arity = 3;
   else if (word(p, "TEX")) { tex = true; arity = 1; }
   else { failure_code = "unsupported-feature"; return false; }
   if (++s->instructions > BRIDGE_MAX_INSTRUCTIONS) return false;
   struct reg dst;
   if (!register_name(p, &dst, DESTINATION)) return false;
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
      if (s->raw && ((UINT64_C(1) << raw.opcode) & RAW_NUMERIC_OPCODES) && punctuation(p, '-'))
         raw.flags |= RAW_NEGATE_SOURCE0 << i;
      if (!source(p, s, consumed, s->raw ? &raw.src[i] : NULL)) return false;
   }
   if (tex) {
      struct reg sampler;
      if (s->stage != 1 || !punctuation(p, ',') || !register_name(p, &sampler, SOURCE) || sampler.file != SAMP || sampler.explicit_mask ||
          !s->declared[SAMP][sampler.index] || !s->declared[SVIEW][sampler.index] || !punctuation(p, ',') || !word(p, "2D")) return false;
      raw.sampler = sampler.index;
   }
   if (!end(p)) return false;
   if (s->raw) {
      raw.dst = (struct raw_destination){dst.file, dst.index, dst.mask};
      raw.flags |= s->raw_flags;
      if (s->syntax_only) s->raw->instructions[s->raw->count++] = raw;
      else if (!raw_record(s->raw, &raw)) {
         missing_numeric_authority = true;
         failure_code = "unsupported-feature";
         return false;
      }
   }
   if (dst.file == ADDR) s->address_written = true;
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
      if (++line_count > 256 || strlen(line) > 512 || s->ended) return false;
      if (!header) {
         header = true;
         if (word(&p, s->stage == 0 ? "FRAG" : "VERT")) { failure_code = "unsupported-stage"; return false; }
         if (!word(&p, s->stage == 0 ? "VERT" : "FRAG") || !end(&p)) return false;
      } else if (word(&p, "DCL")) {
         if (!declaration(&p, s)) return false;
      } else if (word(&p, "IMM")) {
         unsigned i;
         if (s->started || !punctuation(&p, '[') || !index_number(&p, &i, FILE_REGISTERS) || i != s->immediates || !punctuation(&p, ']')) return false;
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
         if (!instruction(&p, s, flow)) return false;
      }
   }
   if (flow && flow->depth) { failure_code = "unsupported-feature"; return false; }
   if (!header || !s->ended || !s->instructions || !s->declared[OUT][0]) return false;
   if (s->syntax_only) return s->semantic[OUT][0] == (s->stage == 0 ? 1u : 3u);
   for (unsigned i = 0; i < 8; ++i)
      if (s->declared[OUT][i] && s->written[OUT][i] != s->components[OUT][i]) return false;
   if (s->raw && (!s->raw->opcode_mask || !raw_outputs_safe(s) ||
       (s->address_declared && !s->raw->indirect_indices))) {
      failure_code = "unsupported-feature";
      return false;
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
      else if (semantic == 1) snprintf(name, sizeof(name), "gl_Position");
      else if (semantic == 2) snprintf(name, sizeof(name), "vso_g%u", sid);
      else snprintf(name, sizeof(name), "fsout_c0");
      append("%s{\"index\":%u,\"name\":\"%s\",\"type\":\"vec4\",\"semantic\":\"%s\",\"semanticIndex\":%u,\"componentMask\":%u", comma ? "," : "", i, name, names[semantic], sid, s->components[f][i]);
      if (f == OUT) append(",\"writtenMask\":%u", s->written[f][i]);
      if (semantic == 2) append(",\"interpolation\":\"%s\"", s->flat[f][i] ? "flat" : "smooth");
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
_Static_assert(sizeof(struct conversion) * 2 <= 32768, "pair conversion stack bound");

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

static const char *check_input(struct profile *profile, const char *text, size_t length)
{
   if (!text) return error("invalid-input", "TGSI text is required.");
   if (length > BRIDGE_MAX_TEXT) return error("input-too-large", "TGSI text exceeds 16384 bytes.");
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
      if (word(&p, "BGNLOOP") || word(&p, "BRK") || word(&p, "ENDLOOP")) {
         candidate = structured_candidate = loop_candidate = true;
      } else if (word(&p, "UIF") || word(&p, "ELSE") || word(&p, "ENDIF")) {
         candidate = structured_candidate = true;
      } else if (word(&p, "AND") || word(&p, "OR") || word(&p, "NOT") || word(&p, "SHL") || word(&p, "USHR") ||
          word(&p, "UADD") || word(&p, "ISGE") || word(&p, "USEQ") || word(&p, "USNE") || word(&p, "UCMP") ||
          word(&p, "FSLT") || word(&p, "FSGE") || word(&p, "UARL")) {
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
      } else if (word(&p, "DIV") || word(&p, "MAX") || word(&p, "FRC") || word(&p, "LRP") ||
                 word(&p, "DP3") || word(&p, "RCP") || word(&p, "RSQ")) {
         candidate = numeric_candidate = true;
      }
   }
   if (candidate) {
      profile->raw_flags = (numeric_candidate || structured_candidate ? RAW_MIXED : 0) |
         (structured_candidate ? RAW_STRUCTURED : 0);
      profile->raw = calloc(1, sizeof(*profile->raw));
      if (!profile->raw) return error("translation-error", "Raw IR allocation failed.");
   }
   if (loop_candidate) {
      /* Syntax-only records share the one bounded IR; they never reach emit.
       * The complete recognized graph supplies the independent finite policy. */
      profile->syntax_only = true;
      memcpy(checked, text, length); checked[length] = 0;
      failure_code = "parse-error";
      if (!validate(checked, profile) || !loop_recognize(profile->raw)) {
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
         .raw_flags = RAW_MIXED | RAW_STRUCTURED | RAW_CONDITIONAL};
      memcpy(checked, text, length); checked[length] = 0;
      failure_code = "parse-error"; missing_numeric_authority = false;
      if (validate(checked, profile)) return NULL;
      profile->raw_flags &= ~RAW_CONDITIONAL;
      return error(!strcmp(failure_code, "translation-error") ? failure_code : "unsupported-feature",
         !strcmp(failure_code, "translation-error") ? "Structured flow allocation failed." :
         "TGSI is malformed or outside the documented straight-line profile.");
   }
   memcpy(checked, text, length); checked[length] = 0;
   failure_code = "parse-error";
   missing_numeric_authority = false;
   if (validate(checked, profile)) return NULL;
   if (!missing_numeric_authority)
      return error(failure_code, !strcmp(failure_code, "translation-error") ? "Structured flow allocation failed." :
         "TGSI is malformed or outside the documented straight-line profile.");
   /* The ordinary result wins whenever it succeeds. A failed domain use gets
    * one fresh whole-text attempt: no first-pass facts or borrowed response
    * pointer survive, and no concurrent second IR grows the storage budget. */
   int stage = profile->stage;
   free(profile->raw);
   *profile = (struct profile){.stage = stage, .raw_flags = RAW_MIXED | RAW_CONDITIONAL |
      (structured_candidate ? RAW_STRUCTURED : 0)};
   profile->raw = calloc(1, sizeof(*profile->raw));
   if (!profile->raw) return numeric_rejection();
   memcpy(checked, text, length); checked[length] = 0;
   failure_code = "parse-error";
   missing_numeric_authority = false;
   if (!validate(checked, profile) || !(profile->raw->opcode_mask & RAW_FINITE_BANK_USED))
      return numeric_rejection();
   return NULL;
}

static const char *convert(struct conversion *c, const char *text, size_t length,
                           const struct vrend_fs_shader_info *fragment_interface)
{
   if (c->profile.raw) {
      /* Raw stages never enter the float-backed upstream emitter. These are
       * value-only metadata from declarations already checked by our guard. */
      c->info.num_consts = (int)c->profile.constant_extent;
      for (unsigned i = 0; i < c->profile.raw->count; ++i)
         if (c->profile.raw->instructions[i].opcode == RAW_TEX)
            c->info.samplers_used_mask |= 1u << c->profile.raw->instructions[i].sampler;
      if (c->profile.stage) {
         struct vrend_fs_shader_info *fs = &c->variable.fs_info;
         for (unsigned i = 0; i < FILE_REGISTERS; ++i) if (c->profile.declared[IN][i]) {
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
   if (!tgsi_text_translate(input, tokens, BRIDGE_MAX_TOKENS)) return error("parse-error", "Upstream TGSI validation rejected the shader.");
   struct vrend_shader_cfg cfg = {.glsl_version = 300, .max_draw_buffers = 1, .use_gles = 1, .use_core_profile = 1, .use_integer = 1};
   struct vrend_shader_key key = {0};
   if (c->profile.stage == 1) key.fs.lower_left_origin = 1;
   if (fragment_interface) key.fs_info = *fragment_interface;
   if (!strarray_alloc(&c->shader, SHADER_MAX_STRINGS)) return error("translation-error", "Shader output allocation failed.");
   bool converted = vrend_convert_shader(NULL, &cfg, tokens, 0, &key, &c->info, &c->variable, &c->shader);
   size_t total = 0;
   for (int i = 0; i < c->shader.num_strings; ++i) total += strlen(c->shader.strings[i].buf);
   if (!converted || upstream_logged || total > BRIDGE_MAX_GLSL)
      return error("translation-error", "Upstream translation failed, logged a diagnostic, or exceeded the output bound.");
   return NULL;
}

/* The profile permits only GENERIC fragment inputs, all centered and either
 * PERSPECTIVE or CONSTANT. Cross-check upstream's value-only export before it
 * becomes a vertex key; never accept caller keys or copy owned shader pointers. */
static bool checked_fragment_interface(const struct conversion *fragment)
{
   const struct profile *p = &fragment->profile;
   const struct vrend_fs_shader_info *info = &fragment->variable.fs_info;
   unsigned count = 0;
   bool seen[FILE_REGISTERS] = {0};
   for (unsigned i = 0; i < FILE_REGISTERS; ++i) count += p->declared[IN][i];
   if (info->num_interps != (int)count || info->has_sample_input || info->has_noperspective) return false;
   for (unsigned i = 0; i < count; ++i) {
      const struct vrend_interp_info *entry = &info->interpinfo[i];
      if (entry->semantic_name != TGSI_SEMANTIC_GENERIC || entry->semantic_index >= FILE_REGISTERS ||
          entry->location != TGSI_INTERPOLATE_LOC_CENTER || seen[entry->semantic_index]) return false;
      seen[entry->semantic_index] = true;
      bool matched = false;
      for (unsigned j = 0; j < FILE_REGISTERS; ++j) if (p->declared[IN][j] && p->semantic_index[IN][j] == entry->semantic_index) {
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
   for (unsigned i = 0; i < FILE_REGISTERS; ++i) if (fragment->declared[IN][i]) {
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
         if (fragment->declared[IN][i] && fragment->semantic_index[IN][i] == sid) {
            append("%sg%u/%u/%s", comma ? ";" : "", sid, fragment->components[IN][i], fragment->flat[IN][i] ? "flat" : "smooth");
            comma = true;
         }
   append("\"");
}

static void constant_domain(int stage, int count)
{
   append(",\"constantDomains\":[{\"kind\":\"constant-bank-finite-f32-v1\",\"stage\":\"%s\",\"slot\":0,\"name\":\"%sconst0\",\"count\":%d}]",
      stage ? "fragment" : "vertex", stage ? "fs" : "vs", count);
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
   const char *name = !c->owned_shader ? "virgl-webgl2-straight-line-v5" :
      c->profile.raw->loop.checked ? "virgl-webgl2-raw-bits-v12" :
      c->profile.raw->indirect_indices ?
         (c->profile.raw->opcode_mask & RAW_FINITE_BANK_USED ? "virgl-webgl2-raw-bits-v11" : "virgl-webgl2-raw-bits-v10") :
      c->profile.raw->opcode_mask & RAW_STRUCTURED_OPCODES ?
         (c->profile.raw->opcode_mask & RAW_FINITE_BANK_USED ? "virgl-webgl2-raw-bits-v9" : "virgl-webgl2-raw-bits-v8") :
      c->profile.raw->opcode_mask & RAW_FINITE_BANK_USED ? "virgl-webgl2-raw-bits-v7" :
      c->profile.raw->opcode_mask & RAW_V6_OPCODES ? "virgl-webgl2-raw-bits-v6" :
      c->profile.raw->opcode_mask & (RAW_V5_OPCODES | RAW_V5_NEGATION) ? "virgl-webgl2-raw-bits-v5" :
      c->profile.raw->opcode_mask & RAW_V4_OPCODES ? "virgl-webgl2-raw-bits-v4" :
      c->profile.raw->opcode_mask & RAW_V3_OPCODES ? "virgl-webgl2-raw-bits-v3" :
      c->profile.raw->opcode_mask & RAW_V2_OPCODES ? "virgl-webgl2-raw-bits-v2" : "virgl-webgl2-raw-bits-v1";
   append("\",\"metadata\":{\"profile\":\"%s\",\"stage\":\"%s\",\"inputs\":", name, stage ? "fragment" : "vertex");
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
   else if (profile->raw && profile->raw->loop.checked)
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
   if (profile->raw && profile->raw->loop.checked)
      append(",\"constantConstraints\":[{\"kind\":\"constant-bank-counted-table-i32-v1\",\"stage\":\"%s\",\"slot\":0,\"name\":\"%sconst0\",\"count\":%d,\"register\":9,\"component\":0,\"maximum\":18}]",
         stage ? "fragment" : "vertex", stage ? "fs" : "vs", info->num_consts);
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
