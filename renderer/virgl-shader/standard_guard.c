/* SPDX-License-Identifier: MIT
 * Closed structural grammar for standard GLES3 translation. In contrast to
 * the exact facet, runtime numeric/initialization/indirect domains retain the
 * native GLES rules; no facts are manufactured from guest supplied values.
 */
#include "standard_guard.h"
#include "bridge.h"
#include "tgsi/tgsi_info.h"
#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

static void spaces(const char **p) { while (**p == ' ' || **p == '\t' || **p == '\r') ++*p; }
static bool take(const char **p, char c)
{
   spaces(p);
   if (**p != c) return false;
   ++*p; return true;
}
static bool word(const char **p, const char *s)
{
   spaces(p);
   size_t n = strlen(s);
   if (strncmp(*p, s, n) || isalnum((unsigned char)(*p)[n]) || (*p)[n] == '_') return false;
   *p += n; return true;
}
static bool ended(const char **p) { spaces(p); return !**p; }
static bool number(const char **p, uint32_t max, uint32_t *out)
{
   spaces(p);
   uint32_t n = 0; unsigned digits = 0;
   bool zero = **p == '0';
   while (isdigit((unsigned char)**p)) {
      unsigned d = (unsigned)(**p - '0');
      if (++digits > 10 || (zero && digits > 1) || d > max || n > (max - d) / 10) return false;
      n = n * 10 + d; ++*p;
   }
   if (!digits) return false;
   *out = n; return true;
}
static unsigned limit(const struct standard_profile *p, unsigned f)
{
   switch (f) {
   case STD_IN: return p->stage ? STANDARD_IO : 16;
   case STD_OUT: return STANDARD_IO;
   case STD_TEMP: return BRIDGE_MAX_TEMPORARIES;
   case STD_CONST: return STANDARD_CONSTANTS;
   case STD_IMM: return BRIDGE_MAX_IMMEDIATES;
   case STD_SAMP: case STD_SVIEW: return STANDARD_SAMPLERS;
   case STD_ADDR: return 1;
   case STD_SV: return 2;
   default: return 0;
   }
}
struct operand { unsigned file, first, last, mask; bool indirect; };
enum operand_kind { DECL, DST, SRC };
static bool reg(const char **at, const struct standard_profile *p, struct operand *r, enum operand_kind kind)
{
   const char **s = at;
   static const char *names[STD_FILES] = {"IN", "OUT", "TEMP", "CONST", "IMM", "SAMP", "SVIEW", "ADDR", "SV"};
   unsigned f;
   for (f = 0; f < STD_FILES; ++f) if (word(s, names[f])) break;
   if (f == STD_FILES || !take(s, '[')) return false;
   *r = (struct operand){.file = f, .mask = 15};
   uint32_t n;
   if (kind == SRC && f == STD_CONST && word(s, "ADDR")) {
      if (!p->declared[STD_ADDR][0] || !take(s, '[') || !number(s, 0, &n) || !take(s, ']') ||
          !take(s, '.') || !word(s, "x")) return false;
      r->indirect = true;
   } else {
      if (!number(s, limit(p, f) - 1, &n)) return false;
      r->first = r->last = n;
      spaces(s);
      if (!strncmp(*s, "..", 2)) {
         if (kind != DECL || (f != STD_TEMP && f != STD_CONST)) return false;
         *s += 2;
         if (!number(s, limit(p, f) - 1, &n) || n < r->first) return false;
         r->last = n;
      }
   }
   if (!take(s, ']')) return false;
   if (take(s, '.')) {
      unsigned count = 0, last = 0; r->mask = 0;
      spaces(s);
      while (**s && strchr("xyzw", **s)) {
         unsigned c = (unsigned)(strchr("xyzw", **s) - "xyzw");
         if (count == 4 || (kind != SRC && count && c <= last)) return false;
         ++count; last = c; r->mask |= 1u << c; ++*s;
      }
      if (!count || (kind == SRC && count != 4)) return false;
   }
   if (f == STD_ADDR && (kind == SRC || (kind == DST && r->mask != 1))) return false;
   return true;
}
static bool declaration(const char **s, struct standard_profile *p)
{
   struct operand r;
   if (!reg(s, p, &r, DECL) || r.file == STD_IMM) return false;
   struct standard_io io = {.mask = r.mask};
   if (r.file == STD_OUT || (r.file == STD_IN && p->stage) || r.file == STD_SV) {
      if (!take(s, ',')) return false;
      uint32_t sid = 0;
      if (word(s, "POSITION")) {
         if (r.file == STD_SV || (p->stage && r.file == STD_OUT)) return false;
         io.semantic = STD_POSITION;
         if (!p->stage && r.mask != 15) return false;
      } else if (word(s, "GENERIC")) {
         if (r.file == STD_SV || (p->stage && r.file == STD_OUT) || !take(s, '[') ||
             !number(s, STANDARD_GENERIC - 1, &sid) || !take(s, ']')) return false;
         io.semantic = STD_GENERIC;
      } else if (word(s, "COLOR")) {
         if (!p->stage || r.file != STD_OUT) return false;
         io.semantic = STD_COLOR;
         if (take(s, '[') && (!number(s, 3, &sid) || !take(s, ']'))) return false;
      } else if (word(s, "VERTEXID")) {
         if (p->stage || r.file != STD_SV) return false;
         io.semantic = STD_VERTEXID;
      } else if (word(s, "INSTANCEID")) {
         if (p->stage || r.file != STD_SV) return false;
         io.semantic = STD_INSTANCEID;
      } else return false;
      io.sid = (uint8_t)sid;
      if (p->stage && r.file == STD_IN) {
         if (!take(s, ',')) return false;
         if (io.semantic == STD_POSITION) { if (!word(s, "LINEAR")) return false; }
         else if (word(s, "CONSTANT")) io.flat = 1;
         else if (!word(s, "PERSPECTIVE")) return false;
      }
      struct standard_io *list = r.file == STD_IN ? p->input : r.file == STD_OUT ? p->output : p->system;
      for (unsigned i = 0; i < limit(p, r.file); ++i)
         if (p->declared[r.file][i] && list[i].semantic == io.semantic && list[i].sid == io.sid) return false;
      list[r.first] = io;
   } else if (r.file == STD_SVIEW) {
      if (!take(s, ',') || !word(s, "2D") || !take(s, ',') || !word(s, "FLOAT")) return false;
   } else if (r.mask != 15) return false;
   if (!ended(s)) return false;
   for (unsigned i = r.first; i <= r.last; ++i) {
      if (p->declared[r.file][i]) return false;
      p->declared[r.file][i] = (uint8_t)r.mask;
   }
   if (r.file == STD_IN && !p->stage) p->input[r.first] = io;
   if (r.file == STD_CONST && r.last + 1 > p->constants) p->constants = (uint16_t)(r.last + 1);
   return true;
}
static bool literal(const char **s, unsigned type)
{
   spaces(s);
   if (type == 0) {
      if (!strncmp(*s, "0x", 2)) {
         *s += 2;
         for (unsigned i = 0; i < 8; ++i) {
            if (!isxdigit((unsigned char)**s)) return false;
            ++*s;
         }
         return !isxdigit((unsigned char)**s);
      }
      const char *begin = *s;
      while (**s && strchr("+-0123456789.eE", **s)) ++*s;
      size_t len = (size_t)(*s - begin);
      if (!len || len > 32) return false;
      char value[33]; memcpy(value, begin, len); value[len] = 0;
      char *tail; errno = 0;
      float f = strtof(value, &tail);
      return !*tail && !errno && isfinite(f);
   }
   bool negative = type == 2 && take(s, '-');
   uint32_t value;
   /* The pinned text parser negates a signed int in place; INT32_MIN would
    * overflow there. All 32-bit words remain representable as UINT32 literals. */
   (void)negative;
   return number(s, type == 1 ? UINT32_MAX : INT32_MAX, &value);
}
static bool immediate(const char **s, struct standard_profile *p)
{
   uint32_t index;
   if (!take(s, '[') || !number(s, BRIDGE_MAX_IMMEDIATES - 1, &index) ||
       index != p->immediates || !take(s, ']')) return false;
   unsigned type;
   if (word(s, "FLT32")) type = 0;
   else if (word(s, "UINT32")) type = 1;
   else if (word(s, "INT32")) type = 2;
   else return false;
   if (!take(s, '{')) return false;
   for (unsigned i = 0; i < 4; ++i) {
      if ((i && !take(s, ',')) || !literal(s, type)) return false;
   }
   if (!take(s, '}') || !ended(s)) return false;
   p->declared[STD_IMM][p->immediates++] = 15;
   return true;
}
static bool property(const char **s, struct standard_profile *p)
{
   if (!p->stage) return false;
   unsigned bit;
   if (word(s, "FS_COORD_ORIGIN")) { bit = 1; if (!word(s, "LOWER_LEFT")) return false; }
   else if (word(s, "FS_COORD_PIXEL_CENTER")) { bit = 2; if (!word(s, "HALF_INTEGER")) return false; }
   else if (word(s, "FS_COLOR0_WRITES_ALL_CBUFS")) {
      bit = 4; uint32_t broadcast;
      if (!number(s, 1, &broadcast)) return false;
      p->broadcast = (uint8_t)broadcast;
   } else return false;
   if ((p->properties & bit) || !ended(s)) return false;
   p->properties |= (uint8_t)bit;
   return true;
}
/* A closed GLES3 operation set. The pinned opcode table supplies arities only
 * after selection; unknown/memory/subroutine/64-bit instructions never enter
 * the upstream parser. Native ESSL still validates supported host operations. */
static bool supported(unsigned op)
{
   switch (op) {
#define OP(x) case TGSI_OPCODE_##x:
   OP(MOV) OP(RCP) OP(RSQ) OP(MUL) OP(ADD) OP(DP2) OP(DP3) OP(DP4)
   OP(MIN) OP(MAX) OP(MAD) OP(SUB) OP(LRP) OP(SQRT) OP(FRC) OP(FLR)
   OP(ROUND) OP(EX2) OP(LG2) OP(POW) OP(ABS) OP(COS) OP(SIN) OP(SSG)
   OP(DIV) OP(TRUNC) OP(CEIL) OP(FSEQ) OP(FSNE) OP(FSLT) OP(FSGE)
   OP(I2F) OP(U2F) OP(F2I) OP(F2U) OP(UADD) OP(UMUL) OP(INEG)
   OP(IMIN) OP(IMAX) OP(UMIN) OP(UMAX) OP(AND) OP(OR) OP(XOR) OP(NOT)
   OP(SHL) OP(ISHR) OP(USHR) OP(SEQ) OP(SNE) OP(SLT) OP(SGE)
   OP(USEQ) OP(USNE) OP(USLT) OP(USGE) OP(ISLT) OP(ISGE) OP(UCMP)
   OP(UARL) OP(ARL) OP(DDX) OP(DDY) OP(TEX) OP(KILL_IF) OP(KILL)
   OP(IF) OP(UIF) OP(ELSE) OP(ENDIF) OP(BGNLOOP) OP(ENDLOOP) OP(BRK) OP(END)
#undef OP
      return true;
   default: return false;
   }
}
struct flow { unsigned opcode, start, target, else_target; bool otherwise, has_target, has_else_target; };
static bool instruction(const char **s, struct standard_profile *p, struct flow *flow, unsigned *depth, bool *done)
{
   uint32_t pc;
   if (!number(s, BRIDGE_MAX_INSTRUCTIONS - 1, &pc) || pc != p->instructions || !take(s, ':')) return false;
   spaces(s);
   char mnemonic[32]; unsigned len = 0;
   while (isalnum((unsigned char)**s) || **s == '_') {
      if (len == sizeof(mnemonic) - 1) return false;
      mnemonic[len++] = *(*s)++;
   }
   mnemonic[len] = 0;
   bool saturate = false, precise = false;
   if (len >= 8 && !strcmp(mnemonic + len - 8, "_PRECISE")) { precise = true; mnemonic[len -= 8] = 0; }
   if (len >= 4 && !strcmp(mnemonic + len - 4, "_SAT")) { saturate = true; mnemonic[len -= 4] = 0; }
   unsigned op;
   for (op = 0; op < TGSI_OPCODE_LAST; ++op)
      if (supported(op) && !strcmp(mnemonic, tgsi_get_opcode_info(op)->mnemonic)) break;
   if (op == TGSI_OPCODE_LAST) return false;
   const struct tgsi_opcode_info *info = tgsi_get_opcode_info(op);
   if ((saturate || precise) && (!info->num_dst || op == TGSI_OPCODE_UARL || op == TGSI_OPCODE_ARL)) return false;
   if (!p->stage && (op == TGSI_OPCODE_KILL || op == TGSI_OPCODE_KILL_IF || op == TGSI_OPCODE_DDX || op == TGSI_OPCODE_DDY)) return false;
   unsigned texture_sampler = 0;
   for (unsigned i = 0; i < info->num_dst + info->num_src; ++i) {
      if (i && !take(s, ',')) return false;
      bool neg = false, absolute = false;
      if (i >= info->num_dst) { neg = take(s, '-'); absolute = take(s, '|'); }
      enum tgsi_opcode_type source_type = tgsi_opcode_infer_src_type(op);
      if (op == TGSI_OPCODE_UCMP && i == info->num_dst) source_type = TGSI_TYPE_UNSIGNED;
      if (absolute && source_type != TGSI_TYPE_FLOAT && source_type != TGSI_TYPE_UNTYPED) return false;
      struct operand r;
      if (!reg(s, p, &r, i < info->num_dst ? DST : SRC) || (absolute && !take(s, '|'))) return false;
      if (r.indirect) { if (!p->constants) return false; }
      else if (!p->declared[r.file][r.first]) return false;
      if (i < info->num_dst) {
         if (r.file != STD_TEMP && r.file != STD_OUT && r.file != STD_ADDR) return false;
         if (r.file == STD_ADDR && op != TGSI_OPCODE_UARL && op != TGSI_OPCODE_ARL) return false;
         if (r.file != STD_ADDR && (op == TGSI_OPCODE_UARL || op == TGSI_OPCODE_ARL)) return false;
         if ((r.mask & p->declared[r.file][r.first]) != r.mask) return false;
         if (r.file == STD_OUT) p->output[r.first].writes |= (uint8_t)r.mask;
      } else {
         bool sampler = op == TGSI_OPCODE_TEX && i == info->num_dst + 1;
         if (sampler) {
            if (r.file != STD_SAMP || r.mask != 15 || neg || absolute || !p->declared[STD_SVIEW][r.first]) return false;
            texture_sampler = r.first;
         } else if (r.file != STD_IN && r.file != STD_TEMP && r.file != STD_CONST && r.file != STD_IMM && r.file != STD_SV) return false;
      }
   }
   if (op == TGSI_OPCODE_TEX) {
      if (!take(s, ',') || !word(s, "2D")) return false;
      p->used_samplers |= (uint16_t)(1u << texture_sampler);
   }
   /* Labels must describe the same edges as the structured blocks. The
    * pinned TGSI dumper uses zero for unspecified loop labels. */
   unsigned target = 0;
   bool has_target = info->is_branch && take(s, ':');
   if (has_target && !number(s, BRIDGE_MAX_INSTRUCTIONS - 1, &target)) return false;
   if (!ended(s)) return false;
   if (op == TGSI_OPCODE_IF || op == TGSI_OPCODE_UIF || op == TGSI_OPCODE_BGNLOOP) {
      if (*depth == STANDARD_DEPTH) return false;
      flow[(*depth)++] = (struct flow){.opcode = op, .start = pc, .target = target, .has_target = has_target};
   } else if (op == TGSI_OPCODE_ELSE) {
      if (!*depth || flow[*depth - 1].opcode == TGSI_OPCODE_BGNLOOP || flow[*depth - 1].otherwise) return false;
      struct flow *frame = &flow[*depth - 1];
      if (frame->has_target && frame->target != pc) return false;
      frame->otherwise = true; frame->has_else_target = has_target; frame->else_target = target;
   } else if (op == TGSI_OPCODE_ENDIF || op == TGSI_OPCODE_ENDLOOP) {
      if (!*depth || ((flow[*depth - 1].opcode == TGSI_OPCODE_BGNLOOP) != (op == TGSI_OPCODE_ENDLOOP))) return false;
      const struct flow *frame = &flow[*depth - 1];
      if (op == TGSI_OPCODE_ENDLOOP) {
         if ((frame->has_target && frame->target && frame->target != pc) ||
             (has_target && target && target != frame->start)) return false;
      } else if (frame->otherwise ? frame->has_else_target && frame->else_target != pc : frame->has_target && frame->target != pc) return false;
      --*depth;
   } else if (op == TGSI_OPCODE_BRK) {
      bool loop = false;
      for (unsigned i = 0; i < *depth; ++i) loop |= flow[i].opcode == TGSI_OPCODE_BGNLOOP;
      if (!loop) return false;
   } else if (op == TGSI_OPCODE_END) {
      if (*depth) return false;
      *done = true;
   }
   ++p->instructions;
   return true;
}
const char *standard_validate(struct standard_profile *p, const char *text, size_t length)
{
   if (!text) return "invalid-input";
   if (length > BRIDGE_MAX_TEXT) return "input-too-large";
   if (p->stage != 0 && p->stage != 1) return "unsupported-stage";
   for (size_t i = 0; i < length; ++i)
      if ((text[i] < 32 && text[i] != '\t' && text[i] != '\n' && text[i] != '\r') || (unsigned char)text[i] > 126) return "invalid-input";
   struct flow flow[STANDARD_DEPTH] = {{0}};
   unsigned lines = 0, depth = 0;
   bool header = false, done = false;
   for (size_t at = 0; at < length;) {
      size_t first = at;
      while (at < length && text[at] != '\n') ++at;
      size_t bytes = at - first;
      if (bytes > BRIDGE_MAX_LINE_BYTES || ++lines > BRIDGE_MAX_LINES) return "input-too-large";
      char line[BRIDGE_MAX_LINE_BYTES + 1]; memcpy(line, text + first, bytes); line[bytes] = 0;
      if (at < length) ++at;
      const char *s = line;
      if (ended(&s)) continue;
      if (done) return "unsupported-feature";
      if (!header) {
         if (!word(&s, p->stage ? "FRAG" : "VERT") || !ended(&s)) return "unsupported-stage";
         header = true;
      } else if (word(&s, "DCL")) {
         if (p->instructions || !declaration(&s, p)) return "unsupported-feature";
      } else if (word(&s, "IMM")) {
         if (p->instructions || !immediate(&s, p)) return "unsupported-feature";
      } else if (word(&s, "PROPERTY")) {
         if (p->instructions || !property(&s, p)) return "unsupported-feature";
      } else if (!instruction(&s, p, flow, &depth, &done)) return "unsupported-feature";
   }
   if (!header || !done) return "unsupported-feature";
   bool output = false;
   for (unsigned i = 0; i < STANDARD_IO; ++i) if (p->declared[STD_OUT][i]) {
      if (p->output[i].semantic == (p->stage ? STD_COLOR : STD_POSITION)) output = true;
   }
   if (!output) return "unsupported-feature";
   for (unsigned i = 0; i < STANDARD_IO; ++i)
      if (p->stage && p->declared[STD_IN][i] && p->input[i].semantic == STD_POSITION && (p->properties & 3) != 3) return "unsupported-feature";
   if (p->broadcast) {
      unsigned colors = 0;
      for (unsigned i = 0; i < STANDARD_IO; ++i) if (p->declared[STD_OUT][i]) {
         if (p->output[i].sid) return "unsupported-feature";
         ++colors;
      }
      if (colors != 1) return "unsupported-feature";
   }
   return NULL;
}
bool standard_match(struct standard_profile *vertex, const struct standard_profile *fragment)
{
   for (unsigned i = 0; i < STANDARD_IO; ++i) if (fragment->declared[STD_IN][i] && fragment->input[i].semantic == STD_GENERIC) {
      bool found = false;
      for (unsigned j = 0; j < STANDARD_IO; ++j) if (vertex->declared[STD_OUT][j] && vertex->output[j].semantic == STD_GENERIC && vertex->output[j].sid == fragment->input[i].sid) {
         if ((fragment->input[i].mask & vertex->output[j].mask) != fragment->input[i].mask) return false;
         vertex->output[j].flat = fragment->input[i].flat;
         found = true;
      }
      if (!found) return false;
   }
   return true;
}
