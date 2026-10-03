/* SPDX-License-Identifier: MIT
 * E6-T12e3: bank-specific bounds, exact originals, and independently authored
 * shared inputs. No guard bypass: every call enters the public bridge API. */
#include "bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_CASES 512u
#define PAIRS 4u
#define ANCHORS 4u
struct test_case { char *text, *baseline; size_t length; unsigned stage, ok; char name[160]; };
struct pair_case { unsigned vertex, fragment; char name[160]; char *baseline; };
static struct test_case cases[MAX_CASES];
static struct pair_case pairs[PAIRS];
static unsigned calls, recoveries, pair_recoveries, truncations, hostile_cases;
static size_t max_single, max_pair;
static const char *current = "initialization";
static void require(int condition, const char *why)
{
   if (!condition) { fprintf(stderr, "FAIL case=%s call=%u: %s\n", current, calls, why); exit(1); }
}
static void bounded(const char *result, size_t cap, size_t *maximum)
{
   require(result != NULL, "result exists");
   size_t length = strnlen(result, cap);
   require(length < cap, "bounded serialized result");
   if (length > *maximum) *maximum = length;
   require(!strncmp(result, "{\"ok\":true,", 11) || !strncmp(result, "{\"ok\":false,", 12), "structured result");
   if (strstr(result, "\"ok\":false,"))
      require(!strstr(result, "\"vertex\":") && !strstr(result, "\"fragment\":") && !strstr(result, "\"glsl\":"), "no partial result");
}
static const char *single(unsigned stage, const char *text, size_t length)
{
   ++calls;
   const char *result = bridge_translate((int)stage, text, length);
   bounded(result, BRIDGE_MAX_RESULT, &max_single); return result;
}
static const char *pair(const struct pair_case *p)
{
   ++calls;
   const struct test_case *v = &cases[p->vertex], *f = &cases[p->fragment];
   const char *result = bridge_translate_pair(v->text, v->length, f->text, f->length);
   bounded(result, BRIDGE_MAX_PAIR_RESULT, &max_pair); return result;
}
static void recover(void)
{
   for (unsigned i = 0; i < ANCHORS; ++i) {
      require(!strcmp(single(cases[i].stage, cases[i].text, cases[i].length), cases[i].baseline), "exact low/high standalone recovery");
      ++recoveries;
   }
   for (unsigned i = 1; i < PAIRS; i += 2) {
      require(!strcmp(pair(&pairs[i]), pairs[i].baseline), "exact high/maximal pair recovery");
      ++pair_recoveries;
   }
}
static uint32_t u32(void)
{
   unsigned char b[4]; require(fread(b, 1, 4, stdin) == 4, "complete fixture integer");
   return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
static char *text(uint32_t length)
{
   require(length <= BRIDGE_MAX_TEXT, "bounded text input");
   char *value = malloc((size_t)length + 1); require(value != NULL, "owned fixture allocation");
   require(fread(value, 1, length, stdin) == length, "complete fixture text"); value[length] = 0; return value;
}
static void name(char *value, uint32_t length)
{
   require(length > 0 && length < 160, "bounded name");
   require(fread(value, 1, length, stdin) == length, "complete fixture name"); value[length] = 0;
}
static unsigned read_cases(void)
{
   char magic[4]; require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VGB1", 4), "bank stream version");
   require(u32() == 19, "nineteen originals"); unsigned accepted = 0;
   for (unsigned i = 0; i < 19; ++i) {
      unsigned stage = u32(), ok = u32(); uint32_t length = u32();
      require(stage < 2 && ok < 2, "original stage/expectation");
      char *original = text(length); const char *result = single(stage, original, length);
      require((strstr(result, "\"ok\":true,") != NULL) == (ok != 0), "original acceptance");
      require(ok || (strstr(original, "PRECISE") && strstr(result, "\"code\":\"unsupported-feature\"")), "only PRECISE originals reject");
      printf("ORIGINAL %u %s\n", i, result); accepted += ok; free(original);
   }
   require(accepted == 12, "unchanged twelve-of-nineteen result");
   unsigned count = u32(); require(count >= ANCHORS && count <= MAX_CASES, "bounded cases");
   for (unsigned i = 0; i < count; ++i) {
      struct test_case *c = &cases[i]; c->stage = u32(); c->ok = u32(); uint32_t nl = u32(); c->length = u32();
      require(c->stage < 2 && c->ok < 2, "case stage/expectation"); name(c->name, nl); c->text = text((uint32_t)c->length);
   }
   require(u32() == PAIRS, "four hardware pairs");
   for (unsigned i = 0; i < PAIRS; ++i) {
      struct pair_case *p = &pairs[i]; p->vertex = u32(); p->fragment = u32(); name(p->name, u32());
      require(p->vertex < count && p->fragment < count && !cases[p->vertex].stage && cases[p->fragment].stage &&
              cases[p->vertex].ok && cases[p->fragment].ok, "pair stage identities");
      current = p->name; const char *result = pair(p); require(strstr(result, "\"ok\":true,") != NULL, "hardware pair accepts");
      p->baseline = strdup(result); require(p->baseline != NULL, "owned pair baseline"); printf("PAIR %u %s\n", i, result);
   }
   require(fgetc(stdin) == EOF && !ferror(stdin), "no trailing fixture bytes");
   for (unsigned i = 0; i < ANCHORS; ++i) {
      struct test_case *c = &cases[i]; current = c->name; require(c->ok, "positive recovery anchor");
      c->baseline = strdup(single(c->stage, c->text, c->length)); require(c->baseline != NULL, "owned recovery baseline");
   }
   return count;
}
static uint32_t random32(uint32_t *state)
{
   uint32_t v = *state; v ^= v << 13; v ^= v >> 17; v ^= v << 5; return *state = v;
}
static void hostile(void)
{
   current = "hostile-arguments";
   require(strstr(single(0, NULL, 0), "invalid-input") != NULL, "null input"); ++hostile_cases; recover();
   require(strstr(single(0, cases[0].text, SIZE_MAX), "input-too-large") != NULL, "huge length"); ++hostile_cases; recover();
   require(strstr(single(2, cases[0].text, cases[0].length), "unsupported-stage") != NULL, "invalid stage"); ++hostile_cases; recover();
   char buffer[BRIDGE_MAX_TEXT + 1]; memset(buffer, 'x', sizeof(buffer));
   require(strstr(single(0, buffer, sizeof(buffer)), "input-too-large") != NULL, "first excessive text length"); ++hostile_cases; recover();
   for (unsigned stage = 0; stage < 2; ++stage) {
      const struct test_case *c = &cases[stage ? 3 : 1];
      for (unsigned byte = 0; byte < 256; ++byte) if ((byte < 32 && byte != 9 && byte != 10 && byte != 13) || byte > 126) {
         memcpy(buffer, c->text, c->length); buffer[c->length / 2] = (char)byte;
         require(strstr(single(stage, buffer, c->length), "invalid-input") != NULL, "invalid byte"); ++hostile_cases; recover();
      }
   }
}
static void mutate(void)
{
   current = "bank-anchor-truncations";
   for (unsigned i = 0; i < ANCHORS; ++i) {
      const struct test_case *c = &cases[i]; const char *terminal = strstr(c->text, "END"); require(terminal != NULL, "anchor END");
      size_t complete = (size_t)(terminal - c->text) + 3;
      for (size_t n = 0; n < c->length; ++n) {
         const char *result = single(c->stage, c->text, n);
         require((strstr(result, "\"ok\":true,") != NULL) == (n >= complete), "truncation requires complete END"); ++truncations; recover();
      }
   }
   char buffer[BRIDGE_MAX_TEXT + 1]; const uint32_t seeds[] = {0x7c1209adu, 0x491be583u, 0xea016f35u, 0x265d8cb7u};
   current = "bank-anchor-mutations";
   for (unsigned seed = 0; seed < 4; ++seed) {
      uint32_t state = seeds[seed];
      for (unsigned n = 0; n < 1024; ++n) {
         const struct test_case *c = &cases[random32(&state) % ANCHORS]; memcpy(buffer, c->text, c->length);
         for (unsigned changes = 1 + random32(&state) % 8; changes; --changes) buffer[random32(&state) % c->length] = (char)(random32(&state) & 255);
         single(c->stage, buffer, c->length); recover();
      }
      printf("SEED %08x mutations=1024 standalone_recoveries=4096 pair_recoveries=2048 passed\n", seeds[seed]);
   }
}
int main(void)
{
   unsigned count = read_cases();
   for (unsigned i = 0; i < count; ++i) {
      const struct test_case *c = &cases[i]; current = c->name; const char *result = single(c->stage, c->text, c->length);
      require((strstr(result, "\"ok\":true,") != NULL) == (c->ok != 0), "literal bank acceptance");
      if (c->ok) require(strstr(result, "virgl-webgl2-straight-line-v5") != NULL, "versioned profile");
      else require(strstr(result, "\"code\":\"parse-error\"") || strstr(result, "\"code\":\"unsupported-feature\""), "rejection before upstream");
      printf("CASE %u %s\n", i, result); recover();
   }
   hostile(); mutate();
   for (unsigned i = 0; i < count; ++i) { free(cases[i].text); free(cases[i].baseline); }
   for (unsigned i = 0; i < PAIRS; ++i) free(pairs[i].baseline);
   printf("STATS {\"originals\":19,\"acceptedOriginals\":12,\"cases\":%u,\"pairs\":4,\"calls\":%u,\"standaloneRecoveries\":%u,\"pairRecoveries\":%u,\"truncations\":%u,\"hostileCases\":%u,\"mutations\":4096,\"maxSingleResultBytes\":%zu,\"maxPairResultBytes\":%zu}\n",
          count, calls, recoveries, pair_recoveries, truncations, hostile_cases, max_single, max_pair);
   return 0;
}
