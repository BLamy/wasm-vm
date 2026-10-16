/* SPDX-License-Identifier: MIT
 * Bounded two-stage sanitizer protocol. The Python runner independently binds
 * literal semantic expectations and original SHA-256 identities to this run. */
#include "bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ANCHORS 4u
#define MAX_CASES 256u
struct pair_case { char *vertex, *fragment, *baseline; size_t vl, fl; unsigned ok; char name[160]; };
static struct pair_case cases[MAX_CASES];
static unsigned calls, recoveries, standalone_recoveries, truncations, attacks;
static const char *current = "initialization";
static char *standalone_vertex, *standalone_fragment;

static void require(int condition, const char *why)
{
   if (!condition) { fprintf(stderr, "FAIL case=%s call=%u: %s\n", current, calls, why); exit(1); }
}
static void bounded(const char *result, size_t cap)
{
   require(result && strnlen(result, cap) < cap, "bounded JSON result");
   require(!strncmp(result, "{\"ok\":true,", 11) || !strncmp(result, "{\"ok\":false,", 12), "structured result");
   if (strstr(result, "\"ok\":false,")) require(!strstr(result, "\"vertex\":") && !strstr(result, "\"fragment\":"), "no partial pair failure");
}
static const char *pair(const char *v, size_t vl, const char *f, size_t fl)
{
   ++calls;
   const char *result = bridge_translate_pair(v, vl, f, fl);
   bounded(result, BRIDGE_MAX_PAIR_RESULT);
   return result;
}
static const char *single(int stage, const char *text, size_t length)
{
   ++calls;
   const char *result = bridge_translate(stage, text, length);
   bounded(result, BRIDGE_MAX_RESULT);
   return result;
}
static void recover(void)
{
   for (unsigned i = 0; i < ANCHORS; ++i) {
      const struct pair_case *c = &cases[i];
      require(!strcmp(pair(c->vertex, c->vl, c->fragment, c->fl), c->baseline), "exact pair recovery");
      ++recoveries;
   }
   require(!strcmp(single(0, cases[0].vertex, cases[0].vl), standalone_vertex), "standalone VS remains smooth after pair");
   require(!strcmp(single(1, cases[0].fragment, cases[0].fl), standalone_fragment), "standalone flat FS recovery");
   standalone_recoveries += 2;
}
static uint32_t u32(void)
{
   unsigned char b[4]; require(fread(b, 1, 4, stdin) == 4, "complete fixture integer");
   return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
static char *text(uint32_t length)
{
   require(length <= BRIDGE_MAX_TEXT, "bounded fixture text");
   char *value = malloc((size_t)length + 1); require(value != NULL, "fixture allocation");
   require(fread(value, 1, length, stdin) == length, "complete fixture text"); value[length] = 0; return value;
}
static unsigned read_cases(void)
{
   char magic[4]; require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VGP1", 4), "pair stream version");
   require(u32() == 19, "nineteen unchanged originals");
   unsigned successes = 0;
   for (unsigned i = 0; i < 19; ++i) {
      uint32_t stage = u32(), ok = u32(), length = u32();
      require(stage < 2 && ok < 2, "original stage/expectation");
      char *original = text(length);
      const char *result = single((int)stage, original, length);
      require((strstr(result, "\"ok\":true,") != NULL) == (ok != 0), "original acceptance");
      require(ok || (strstr(original, "PRECISE") && strstr(result, "\"code\":\"unsupported-feature\"")), "only PRECISE originals reject");
      printf("ORIGINAL %u %s\n", i, result); successes += ok; free(original);
   }
   require(successes == 12, "twelve translated originals");
   unsigned count = u32(); require(count >= ANCHORS && count <= MAX_CASES, "bounded pair case count");
   for (unsigned i = 0; i < count; ++i) {
      struct pair_case *c = &cases[i]; c->ok = u32(); uint32_t nl = u32(); c->vl = u32(); c->fl = u32();
      require(c->ok < 2 && nl > 0 && nl < sizeof(c->name), "bounded case fields");
      require(fread(c->name, 1, nl, stdin) == nl, "complete case name"); c->name[nl] = 0;
      c->vertex = text((uint32_t)c->vl); c->fragment = text((uint32_t)c->fl);
   }
   require(fgetc(stdin) == EOF && !ferror(stdin), "no unconsumed fixture bytes");
   for (unsigned i = 0; i < ANCHORS; ++i) {
      struct pair_case *c = &cases[i]; current = c->name;
      const char *result = pair(c->vertex, c->vl, c->fragment, c->fl);
      require(c->ok && strstr(result, "\"ok\":true,"), "positive recovery anchor");
      c->baseline = strdup(result); require(c->baseline != NULL, "retain bounded recovery result");
   }
   standalone_vertex = strdup(single(0, cases[0].vertex, cases[0].vl));
   standalone_fragment = strdup(single(1, cases[0].fragment, cases[0].fl));
   require(standalone_vertex && standalone_fragment, "retain standalone recovery results");
   return count;
}
static uint32_t random32(uint32_t *state)
{
   uint32_t v = *state; v ^= v << 13; v ^= v >> 17; v ^= v << 5; return *state = v;
}
static void hostile(void)
{
   const struct pair_case *c = &cases[0]; current = "native-hostile-input";
   require(strstr(pair(NULL, 0, c->fragment, c->fl), "invalid-input") != NULL, "null vertex"); ++attacks; recover();
   require(strstr(pair(c->vertex, c->vl, NULL, 0), "invalid-input") != NULL, "null fragment"); ++attacks; recover();
   require(strstr(pair(c->vertex, SIZE_MAX, c->fragment, c->fl), "input-too-large") != NULL, "huge vertex length"); ++attacks; recover();
   require(strstr(pair(c->vertex, c->vl, c->fragment, SIZE_MAX), "input-too-large") != NULL, "huge fragment length"); ++attacks; recover();
   char *buffer = malloc(BRIDGE_MAX_TEXT + 1); require(buffer != NULL, "hostile buffer");
   for (unsigned stage = 0; stage < 2; ++stage) {
      size_t length = stage ? c->fl : c->vl; const char *source = stage ? c->fragment : c->vertex;
      for (unsigned byte = 0; byte < 256; ++byte) if ((byte < 32 && byte != 9 && byte != 10 && byte != 13) || byte > 126) {
         memcpy(buffer, source, length); buffer[length / 2] = (char)byte;
         const char *result = stage ? pair(c->vertex, c->vl, buffer, length) : pair(buffer, length, c->fragment, c->fl);
         require(strstr(result, "invalid-input") != NULL, "invalid ASCII byte rejects"); ++attacks; recover();
      }
   }
   free(buffer);
}
static void mutate(void)
{
   char buffer[BRIDGE_MAX_TEXT + 1]; current = "pair-truncations";
   for (unsigned i = 0; i < ANCHORS; ++i) for (unsigned stage = 0; stage < 2; ++stage) {
      const struct pair_case *c = &cases[i]; const char *source = stage ? c->fragment : c->vertex; size_t length = stage ? c->fl : c->vl;
      const char *terminal = strstr(source, "END"); require(terminal != NULL, "anchor END exists");
      size_t complete = (size_t)(terminal - source) + 3;
      for (size_t n = 0; n < length; ++n) {
         const char *result = stage ? pair(c->vertex, c->vl, source, n) : pair(source, n, c->fragment, c->fl);
         require((strstr(result, "\"ok\":true,") != NULL) == (n >= complete), "only complete END truncations accept"); ++truncations; recover();
      }
   }
   const uint32_t seeds[] = {0x6102ab3du, 0xb487095fu, 0x938ad217u, 0x27a461cbu};
   current = "pair-mutations";
   for (unsigned seed = 0; seed < 4; ++seed) {
      uint32_t state = seeds[seed];
      for (unsigned n = 0; n < 1024; ++n) {
         const struct pair_case *c = &cases[random32(&state) % ANCHORS]; unsigned stage = random32(&state) & 1;
         size_t length = stage ? c->fl : c->vl; memcpy(buffer, stage ? c->fragment : c->vertex, length);
         for (unsigned changes = 1 + random32(&state) % 8; changes; --changes) buffer[random32(&state) % length] = (char)(random32(&state) & 255);
         if (stage) pair(c->vertex, c->vl, buffer, length); else pair(buffer, length, c->fragment, c->fl);
         recover();
      }
      printf("SEED %08x mutations=1024 pair_recoveries=4096 standalone_recoveries=2048 passed\n", seeds[seed]);
   }
}
int main(void)
{
   unsigned count = read_cases();
   for (unsigned i = 0; i < count; ++i) {
      const struct pair_case *c = &cases[i]; current = c->name;
      const char *result = pair(c->vertex, c->vl, c->fragment, c->fl);
      require((strstr(result, "\"ok\":true,") != NULL) == (c->ok != 0), "literal pair acceptance");
      printf("PAIR %u %s\n", i, result); recover();
   }
   hostile(); mutate();
   for (unsigned i = 0; i < count; ++i) { free(cases[i].vertex); free(cases[i].fragment); free(cases[i].baseline); }
   free(standalone_vertex); free(standalone_fragment);
   printf("STATS {\"originals\":19,\"acceptedOriginals\":12,\"pairs\":%u,\"calls\":%u,\"pairRecoveries\":%u,\"standaloneRecoveries\":%u,\"truncations\":%u,\"hostileCases\":%u,\"mutations\":4096}\n", count, calls, recoveries, standalone_recoveries, truncations, attacks);
   return 0;
}
