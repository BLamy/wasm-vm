/* SPDX-License-Identifier: MIT
 * E6-T12e8: checked scalar indirect constant authority, exact originals, and independently authored
 * shared inputs. No guard bypass: every call enters the public bridge API. */
#include "bridge.h"
#include "raw_bits.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_CASES 4096u
#define MAX_PAIRS 320u
#define ANCHORS 24u
#define PAIR_ANCHORS 22u
struct test_case { char *text, *baseline; size_t length; unsigned stage, ok, raw; char name[160]; };
struct pair_case { unsigned vertex, fragment, ok; char name[160]; char *baseline; };
static struct test_case cases[MAX_CASES];
static struct pair_case pairs[MAX_PAIRS];
static unsigned anchors[ANCHORS], pair_anchors[PAIR_ANCHORS], pair_count;
static unsigned calls, recoveries, pair_recoveries, truncations, hostile_cases;
static size_t max_single, max_pair;
/* Only the sanitizer target redirects the two owned implementation files'
 * calloc calls here. Production/native CLI/Wasm have no injection API. */
static unsigned allocation_attempts, fail_allocation, allocation_faults;
static size_t requested_allocation, flow_arena_bytes;
void *indirect_constant_calloc(size_t count, size_t bytes)
{
   ++allocation_attempts;
   requested_allocation = count * bytes;
   if (fail_allocation && allocation_attempts == fail_allocation) return NULL;
   return calloc(count, bytes);
}
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
static const char *pair_text(const char *vertex, size_t vertex_length, const char *fragment, size_t fragment_length)
{
   ++calls;
   const char *result = bridge_translate_pair(vertex, vertex_length, fragment, fragment_length);
   bounded(result, BRIDGE_MAX_PAIR_RESULT, &max_pair); return result;
}
static const char *pair(const struct pair_case *p)
{
   const struct test_case *v = &cases[p->vertex], *f = &cases[p->fragment];
   return pair_text(v->text, v->length, f->text, f->length);
}
static void recover(void)
{
   for (unsigned i = 0; i < ANCHORS; ++i) {
      require(!strcmp(single(cases[anchors[i]].stage, cases[anchors[i]].text, cases[anchors[i]].length), cases[anchors[i]].baseline), "exact legacy/raw standalone recovery");
      ++recoveries;
   }
   for (unsigned i = 0; i < PAIR_ANCHORS; ++i) {
      require(!strcmp(pair(&pairs[pair_anchors[i]]), pairs[pair_anchors[i]].baseline), "exact mixed-backend pair recovery");
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
   char magic[4]; require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VGSA", 4), "indirect-constant stream version");
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
      struct test_case *c = &cases[i]; c->stage = u32(); c->ok = u32(); c->raw = u32(); uint32_t nl = u32(); c->length = u32();
      require(c->stage < 2 && c->ok < 2 && c->raw < 12, "case stage/expectation"); name(c->name, nl); c->text = text((uint32_t)c->length);
   }
   pair_count = u32(); require(pair_count >= PAIR_ANCHORS && pair_count <= MAX_PAIRS, "bounded pair cases");
   for (unsigned i = 0; i < pair_count; ++i) {
      struct pair_case *p = &pairs[i]; p->vertex = u32(); p->fragment = u32(); p->ok = u32(); name(p->name, u32());
      require(p->vertex < count && p->fragment < count && !cases[p->vertex].stage && cases[p->fragment].stage &&
              p->ok < 2, "pair stage identities");
      current = p->name; const char *result = pair(p); require((strstr(result, "\"ok\":true,") != NULL) == (p->ok != 0), "literal pair acceptance");
      p->baseline = strdup(result); require(p->baseline != NULL, "owned pair baseline"); printf("PAIR %u %s\n", i, result);
   }
   for (unsigned i = 0; i < ANCHORS; ++i) {
      anchors[i] = u32(); require(anchors[i] < count && cases[anchors[i]].ok, "positive recovery anchor");
      struct test_case *c = &cases[anchors[i]]; current = c->name;
      c->baseline = strdup(single(c->stage, c->text, c->length)); require(c->baseline != NULL, "owned recovery baseline");
   }
   for (unsigned profile = 0; profile < 12; ++profile)
      for (unsigned stage = 0; stage < 2; ++stage)
         require(cases[anchors[profile * 2 + stage]].stage == stage &&
                 cases[anchors[profile * 2 + stage]].raw == profile, "all twelve profiles in both stages");
   for (unsigned i = 0; i < PAIR_ANCHORS; ++i) {
      pair_anchors[i] = u32(); require(pair_anchors[i] < pair_count && pairs[pair_anchors[i]].ok, "positive pair recovery anchor");
   }
   for (unsigned i = 0; i < PAIR_ANCHORS; ++i)
      for (unsigned j = i + 1; j < PAIR_ANCHORS; ++j)
         require(pair_anchors[i] != pair_anchors[j], "distinct pair anchors");
   for (unsigned i = 0; i < PAIR_ANCHORS; ++i) {
      const struct pair_case *p = &pairs[pair_anchors[i]];
      require(cases[p->vertex].raw != cases[p->fragment].raw, "mixed-backend pair recovery");
   }
   require(fgetc(stdin) == EOF && !ferror(stdin), "no trailing fixture bytes");
   return count;
}
static uint32_t random32(uint32_t *state)
{
   uint32_t v = *state; v ^= v << 13; v ^= v >> 17; v ^= v << 5; return *state = v;
}
static void allocation_failures(void)
{
   current = "indirect-allocation-faults";
   for (unsigned profile = 10; profile <= 11; ++profile)
      for (unsigned stage = 0; stage < 2; ++stage)
         for (unsigned site = 1; site <= (profile == 11 ? 5u : 3u); ++site) {
            const struct test_case *c = NULL;
            char target[80];
            snprintf(target, sizeof(target), "%s-%s", profile == 10 ? "depth-8" : "numeric-provenance-join", stage ? "fragment" : "vertex");
            for (unsigned i = 0; i < MAX_CASES && cases[i].text; ++i)
               if (!strcmp(cases[i].name, target)) c = &cases[i];
            require(c && c->ok && c->raw == profile, "structured indirect allocation witness");
            allocation_attempts = 0; fail_allocation = site;
            const char *result = single(stage, c->text, c->length);
            fail_allocation = 0;
            require(allocation_attempts == site, "intended standalone allocation failed");
            if (site == 2) {
               require(!flow_arena_bytes || flow_arena_bytes == requested_allocation, "stable actual flow allocation");
               flow_arena_bytes = requested_allocation;
            }
            require(strstr(result, profile == 11 && site > 2 ? "unsupported-feature" : "translation-error") != NULL,
                    "exact allocation failure class");
            printf("FAULT %u {\"kind\":\"single\",\"profile\":%u,\"stage\":%u,\"failAt\":%u,\"attempts\":%u,\"requestedBytes\":%zu,\"result\":%s}\n",
                   allocation_faults++, profile, stage, site, allocation_attempts, requested_allocation, result);
            recover();
         }
   const struct pair_case *coupled = NULL;
   for (unsigned i = 0; i < pair_count; ++i)
      if (!strcmp(pairs[i].name, "coupled-pair")) coupled = &pairs[i];
   require(coupled != NULL && coupled->ok, "real both-conditional structured allocation pair");
   for (unsigned site = 1; site <= 10; ++site) {
      allocation_attempts = 0; fail_allocation = site;
      const char *result = pair(coupled);
      fail_allocation = 0;
      require(allocation_attempts == site, "intended pair allocation failed");
      require(strstr(result, site <= 2 ? "translation-error" : "unsupported-feature") != NULL,
              "earliest ordinary pair error survives later conditional failure");
      printf("FAULT %u {\"kind\":\"pair\",\"failAt\":%u,\"attempts\":%u,\"requestedBytes\":%zu,\"result\":%s}\n",
             allocation_faults++, site, allocation_attempts, requested_allocation, result);
      recover();
   }
}
static void hostile(void)
{
   current = "hostile-arguments";
   require(strstr(single(0, NULL, 0), "invalid-input") != NULL, "null input"); ++hostile_cases; recover();
   require(strstr(single(0, cases[0].text, SIZE_MAX), "input-too-large") != NULL, "huge length"); ++hostile_cases; recover();
   require(strstr(single(2, cases[0].text, cases[0].length), "unsupported-stage") != NULL, "invalid stage"); ++hostile_cases; recover();
   const struct test_case *v = &cases[anchors[12]], *f = &cases[anchors[13]];
   require(strstr(pair_text(NULL, 0, f->text, f->length), "invalid-input") != NULL, "null pair vertex"); ++hostile_cases; recover();
   require(strstr(pair_text(v->text, v->length, NULL, 0), "invalid-input") != NULL, "null pair fragment"); ++hostile_cases; recover();
   require(strstr(pair_text(v->text, SIZE_MAX, f->text, f->length), "input-too-large") != NULL, "huge pair vertex length"); ++hostile_cases; recover();
   require(strstr(pair_text(v->text, v->length, f->text, SIZE_MAX), "input-too-large") != NULL, "huge pair fragment length"); ++hostile_cases; recover();
   char buffer[BRIDGE_MAX_TEXT + 1]; memset(buffer, 'x', sizeof(buffer));
   require(strstr(single(0, buffer, sizeof(buffer)), "input-too-large") != NULL, "first excessive text length"); ++hostile_cases; recover();
   for (unsigned stage = 0; stage < 2; ++stage) {
      const struct test_case *c = &cases[anchors[stage ? 13 : 12]];
      for (unsigned byte = 0; byte < 256; ++byte) if ((byte < 32 && byte != 9 && byte != 10 && byte != 13) || byte > 126) {
         memcpy(buffer, c->text, c->length); buffer[c->length / 2] = (char)byte;
         require(strstr(single(stage, buffer, c->length), "invalid-input") != NULL, "invalid byte"); ++hostile_cases; recover();
      }
   }
}
static void truncate_case(const struct test_case *c)
{
   const char *terminal = strstr(c->text, "END\n"); require(terminal != NULL, "anchor END");
   size_t complete = (size_t)(terminal - c->text) + 3;
   for (size_t n = 0; n < c->length; ++n) {
      const char *result = single(c->stage, c->text, n);
      require((strstr(result, "\"ok\":true,") != NULL) == (n >= complete), "truncation requires complete END");
      ++truncations; recover();
   }
}
static void mutate(void)
{
   current = "indirect-constant-anchor-truncations";
   /* New address profiles plus the two ordinary-parser anchors. The complete
    * retained result corpus and all-profile recovery still run for every case. */
   for (unsigned i = 0; i < ANCHORS; ++i)
      if (i < 2 || i >= ANCHORS - 4) truncate_case(&cases[anchors[i]]);
   const char *extra[] = {"address-reassignment-vertex", "address-reassignment-fragment", "depth-8-vertex", "depth-8-fragment"};
   for (unsigned i = 0; i < 4; ++i) {
      const struct test_case *found = NULL;
      for (unsigned c = 0; c < MAX_CASES && cases[c].text; ++c)
         if (!strcmp(cases[c].name, extra[i])) found = &cases[c];
      require(found && found->ok, "label/depth truncation witness");
      truncate_case(found);
   }
   char buffer[BRIDGE_MAX_TEXT + 1]; const uint32_t seeds[] = {0x6bd2c931u, 0xf1037a85u, 0x2e849d67u, 0xa75c1b09u};
   current = "indirect-constant-anchor-mutations";
   for (unsigned seed = 0; seed < 4; ++seed) {
      uint32_t state = seeds[seed];
      for (unsigned n = 0; n < 1024; ++n) {
         const struct test_case *c = &cases[anchors[random32(&state) % ANCHORS]]; memcpy(buffer, c->text, c->length);
         for (unsigned changes = 1 + random32(&state) % 8; changes; --changes) {
            size_t position = random32(&state) % c->length;
            unsigned byte = random32(&state) & 255;
            buffer[position] = (char)byte;
         }
         single(c->stage, buffer, c->length); recover();
      }
      printf("SEED %08x mutations=1024 standalone_recoveries=24576 pair_recoveries=22528 passed\n", seeds[seed]);
   }
}
int main(void)
{
   printf("LAYOUT {\"pointerBytes\":%zu,\"rawIrBytes\":%zu,\"rawInstructionBytes\":%zu,\"rawDestinationBytes\":%zu,\"rawLaneBytes\":%zu,\"registerBytes\":%zu,\"rawSourceBytes\":%zu,\"profileBytes\":%zu,\"rawIrBoundBytes\":32768,\"profileBoundBytes\":8192,\"fixedWasmMemoryBytes\":16777216,\"fixedWasmStackBytes\":262144}\n",
          sizeof(void *), sizeof(struct raw_ir), sizeof(struct raw_instruction), sizeof(struct raw_destination), sizeof(struct raw_lane), sizeof(struct reg), sizeof(struct raw_source), sizeof(struct profile));
   unsigned count = read_cases();
   for (unsigned i = 0; i < count; ++i) {
      const struct test_case *c = &cases[i]; current = c->name; const char *result = single(c->stage, c->text, c->length);
      require((strstr(result, "\"ok\":true,") != NULL) == (c->ok != 0), "literal indirect-constant acceptance");
      if (c->ok) require(strstr(result, c->raw == 11 ? "virgl-webgl2-raw-bits-v11" : c->raw == 10 ? "virgl-webgl2-raw-bits-v10" : c->raw == 9 ? "virgl-webgl2-raw-bits-v9" : c->raw == 8 ? "virgl-webgl2-raw-bits-v8" : c->raw == 7 ? "virgl-webgl2-raw-bits-v7" : c->raw == 6 ? "virgl-webgl2-raw-bits-v6" : c->raw == 5 ? "virgl-webgl2-raw-bits-v5" : c->raw == 4 ? "virgl-webgl2-raw-bits-v4" : c->raw == 3 ? "virgl-webgl2-raw-bits-v3" : c->raw == 2 ? "virgl-webgl2-raw-bits-v2" : c->raw == 1 ? "virgl-webgl2-raw-bits-v1" : "virgl-webgl2-straight-line-v5") != NULL, "exact backend profile");
      else require(strstr(result, "\"code\":\"parse-error\"") || strstr(result, "\"code\":\"unsupported-feature\"") || strstr(result, "\"code\":\"translation-error\""), "structured rejection");
      printf("CASE %u %s\n", i, result); recover();
   }
   allocation_failures(); hostile(); mutate();
   printf("FLOW {\"arenaBytes\":%zu,\"arenaBoundBytes\":53248,\"depthLimit\":8}\n", flow_arena_bytes);
   for (unsigned i = 0; i < count; ++i) { free(cases[i].text); free(cases[i].baseline); }
   for (unsigned i = 0; i < pair_count; ++i) free(pairs[i].baseline);
   printf("STATS {\"originals\":19,\"acceptedOriginals\":12,\"cases\":%u,\"pairs\":%u,\"calls\":%u,\"standaloneRecoveries\":%u,\"pairRecoveries\":%u,\"truncations\":%u,\"hostileCases\":%u,\"mutations\":4096,\"allocationFaults\":%u,\"maxSingleResultBytes\":%zu,\"maxPairResultBytes\":%zu}\n",
          count, pair_count, calls, recoveries, pair_recoveries, truncations, hostile_cases, allocation_faults, max_single, max_pair);
   return 0;
}
