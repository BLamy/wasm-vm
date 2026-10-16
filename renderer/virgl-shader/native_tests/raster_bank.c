/* SPDX-License-Identifier: MIT
 * E6-T12f4: selected interpolation, exact originals, and independently authored
 * shared inputs. No guard bypass: every call enters the public bridge API. */
#include "bridge.h"
#include "raw_bits.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_CASES 8192u
#define MAX_PAIRS 1024u
#define ANCHORS 60u
#define PAIR_ANCHORS 58u
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
static unsigned upstream_attempts, upstream_fail, upstream_hit, upstream_faults;
static size_t upstream_failed_bytes;
static const char *upstream_failed_allocator;
void *precise_word_upstream_malloc(size_t bytes)
{
   if (++upstream_attempts == upstream_fail) {
      upstream_hit = upstream_attempts; upstream_failed_bytes = bytes;
      upstream_failed_allocator = "malloc"; return NULL;
   }
   return malloc(bytes);
}
void *precise_word_upstream_realloc(void *pointer, size_t bytes)
{
   if (++upstream_attempts == upstream_fail) {
      upstream_hit = upstream_attempts; upstream_failed_bytes = bytes;
      upstream_failed_allocator = "realloc"; return NULL;
   }
   return realloc(pointer, bytes);
}
void *precise_word_calloc(size_t count, size_t bytes)
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
static void upstream_allocation_failures(void)
{
   const char *names[] = {"precise::pass-vertex", "precise::pass-fragment", "precise::profile-26-vertex-mixed-pair", "precise::profile-26-fragment-mixed-pair"};
   for (unsigned target = 0; target < 4; ++target) {
      const struct test_case *single_case = NULL;
      const struct pair_case *pair_case = NULL;
      if (target < 2) {
         for (unsigned i = 0; i < MAX_CASES && cases[i].text; ++i)
            if (!strcmp(cases[i].name, names[target])) single_case = &cases[i];
      } else {
         for (unsigned i = 0; i < pair_count; ++i)
            if (!strcmp(pairs[i].name, names[target])) pair_case = &pairs[i];
      }
      require(single_case || pair_case, "actual legacy and mixed allocation witness");
      current = names[target]; upstream_attempts = 0; upstream_fail = 0;
      const char *result = single_case ? single(single_case->stage, single_case->text, single_case->length) : pair(pair_case);
      require(strstr(result, "\"ok\":true,") && !strstr(result, "(null)"), "healthy upstream calibration");
      char *baseline = strdup(result); require(baseline != NULL, "owned upstream calibration");
      unsigned sites = upstream_attempts;
      require(sites > 4 && sites < 128, "bounded actual upstream allocation sites");
      printf("UPSTREAM %u {\"kind\":\"%s\",\"case\":\"%s\",\"allocations\":%u,\"result\":%s}\n", target,
             single_case ? "single" : "pair", names[target], sites, baseline);
      for (unsigned site = 1; site <= sites; ++site) {
         upstream_attempts = upstream_hit = 0; upstream_fail = site;
         result = single_case ? single(single_case->stage, single_case->text, single_case->length) : pair(pair_case);
         upstream_fail = 0;
         require(upstream_hit == site && upstream_attempts >= site && upstream_failed_bytes > 0,
                 "intended nonzero upstream allocation failed");
         require(strstr(result, "\"ok\":false,") && !strstr(result, "(null)"), "never publish a successful partial upstream shader");
         require(strstr(result, single_case ? "translation-error" : "unsupported-feature") != NULL, "transactional upstream allocation failure");
         printf("FAULT %u {\"kind\":\"upstream-%s\",\"case\":\"%s\",\"upstream\":true,\"failAt\":%u,\"attempts\":%u,\"requestedBytes\":%zu,\"allocator\":\"%s\",\"result\":%s}\n",
                allocation_faults++, single_case ? "single" : "pair", names[target], site, upstream_attempts,
                upstream_failed_bytes, upstream_failed_allocator, result);
         ++upstream_faults; recover();
      }
      require(!strcmp(single_case ? single(single_case->stage, single_case->text, single_case->length) : pair(pair_case), baseline),
              "exact upstream calibration result recovers");
      free(baseline);
   }
}
static uint32_t u32(void)
{
   unsigned char b[4]; require(fread(b, 1, 4, stdin) == 4, "complete fixture integer");
   return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
static char *text(uint32_t length)
{
   require(length <= BRIDGE_MAX_TEXT + 1, "bounded text input");
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
   char magic[4]; require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VGSA", 4), "bounded-loop stream version");
   require(u32() == 19, "nineteen originals"); unsigned accepted = 0;
   for (unsigned i = 0; i < 19; ++i) {
      unsigned stage = u32(), ok = u32(); uint32_t length = u32();
      require(stage < 2 && ok < 2, "original stage/expectation");
      char *original = text(length); const char *result = single(stage, original, length);
      require((strstr(result, "\"ok\":true,") != NULL) == (ok != 0), "original acceptance");
      require(ok || (strstr(original, "PRECISE") && strstr(result, "\"code\":\"unsupported-feature\"")), "only PRECISE originals reject");
      printf("ORIGINAL %u %s\n", i, result); accepted += ok; free(original);
   }
   require(accepted == 18, "eighteen-of-nineteen result");
   unsigned count = u32(); require(count >= ANCHORS && count <= MAX_CASES, "bounded cases");
   for (unsigned i = 0; i < count; ++i) {
      struct test_case *c = &cases[i]; c->stage = u32(); c->ok = u32(); c->raw = u32(); uint32_t nl = u32(); c->length = u32();
      require(c->stage < 2 && c->ok < 2 && c->raw < 28, "case stage/expectation"); name(c->name, nl); c->text = text((uint32_t)c->length);
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
   for (unsigned profile = 0; profile < 27; ++profile)
      for (unsigned stage = 0; stage < 2; ++stage)
         require(cases[anchors[profile * 2 + stage]].stage == stage &&
                 cases[anchors[profile * 2 + stage]].raw == profile, "all twenty-seven profiles in both stages");
   for (unsigned stage = 0; stage < 2; ++stage)
      require(cases[anchors[58 + stage]].stage == stage && cases[anchors[58 + stage]].raw == 27, "both copied-bank recovery stages");
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
   current = "loop-allocation-faults";
   for (unsigned stage = 0; stage < 2; ++stage)
      for (unsigned site = 1; site <= 4; ++site) {
         const struct test_case *c = &cases[anchors[24 + stage]];
         require(c->ok && c->raw == 12, "certified loop allocation witness");
         allocation_attempts = 0; fail_allocation = site;
         const char *result = single(stage, c->text, c->length);
         fail_allocation = 0;
         require(allocation_attempts == site, "intended standalone allocation failed");
         if (site == 2 || site == 3) {
            require(!flow_arena_bytes || flow_arena_bytes == requested_allocation, "stable actual flow allocation");
            flow_arena_bytes = requested_allocation;
         }
         require(strstr(result, site <= 3 ? "translation-error" : "unsupported-feature") != NULL, "exact allocation failure class");
         printf("FAULT %u {\"kind\":\"single\",\"profile\":12,\"stage\":%u,\"failAt\":%u,\"attempts\":%u,\"requestedBytes\":%zu,\"result\":%s}\n",
                allocation_faults++, stage, site, allocation_attempts, requested_allocation, result);
         recover();
      }
   const struct pair_case *coupled = NULL;
   for (unsigned i = 0; i < pair_count; ++i)
      if (!strcmp(pairs[i].name, "loop::coupled-pair")) coupled = &pairs[i];
   require(coupled != NULL && coupled->ok, "real both-conditional structured allocation pair");
   for (unsigned site = 1; site <= 8; ++site) {
      allocation_attempts = 0; fail_allocation = site;
      const char *result = pair(coupled);
      fail_allocation = 0;
      require(allocation_attempts == site, "intended pair allocation failed");
      require(strstr(result, site <= 3 ? "translation-error" : "unsupported-feature") != NULL,
              "earliest ordinary pair error survives later conditional failure");
      printf("FAULT %u {\"kind\":\"pair\",\"failAt\":%u,\"attempts\":%u,\"requestedBytes\":%zu,\"result\":%s}\n",
             allocation_faults++, site, allocation_attempts, requested_allocation, result);
      recover();
   }
   const char *selected[] = {"selected::a-plain-vertex", "selected::a-plain-fragment", "selected::b-plain-vertex", "selected::b-plain-fragment",
      "selected::a-finite-payload-vertex", "selected::a-finite-payload-fragment", "selected::a-finite-width-vertex", "selected::a-finite-width-fragment"};
   for (unsigned target = 0; target < 8; ++target) {
      const struct test_case *c = NULL;
      for (unsigned i = 0; i < MAX_CASES && cases[i].text; ++i)
         if (!strcmp(cases[i].name, selected[target])) c = &cases[i];
      require(c && c->ok, "actual selected-lane allocation witness");
      unsigned sites = target < 4 ? 5 : target < 6 ? 6 : 7;
      for (unsigned site = 1; site <= sites; ++site) {
         current = c->name; allocation_attempts = 0; fail_allocation = site;
         const char *result = single(c->stage, c->text, c->length);
         fail_allocation = 0;
         require(allocation_attempts == site, "intended certificate/retry allocation failed");
         require(strstr(result, "\"ok\":false,") &&
                 (strstr(result, "translation-error") || strstr(result, "unsupported-feature")),
                 "only an owned bounded allocation rejection");
         printf("FAULT %u {\"kind\":\"demand\",\"name\":\"%s\",\"stage\":%u,\"failAt\":%u,\"attempts\":%u,\"requestedBytes\":%zu,\"result\":%s}\n",
                allocation_faults++, c->name, c->stage, site, allocation_attempts, requested_allocation, result);
         recover();
      }
   }
   const char *radial[] = {"radial::plain-vertex","radial::plain-fragment","radial::indirect-vertex","radial::indirect-fragment","radial::loop-vertex","radial::loop-fragment","radial::unmarked-structural-port-nested-fragment","radial::unmarked-structural-port-loop-fragment"};
   for (unsigned target = 0; target < 8; ++target) {
      const struct test_case *c = NULL;
      for (unsigned i = 0; i < MAX_CASES && cases[i].text; ++i)
         if (!strcmp(cases[i].name, radial[target])) c = &cases[i];
      require(c && c->ok, "real radial allocation target"); current = c->name;
      allocation_attempts = 0; const char *normal = single(c->stage,c->text,c->length);
      require(strstr(normal,"\"ok\":true,") != NULL,"successful radial allocation calibration");
      unsigned sites = allocation_attempts;
      require(sites >= 4 && sites <= 12,"bounded actual radial allocation count");
      for (unsigned site = 1; site <= sites; ++site) {
         allocation_attempts=0;fail_allocation=site;
         const char *result=single(c->stage,c->text,c->length);fail_allocation=0;
         require(allocation_attempts==site,"actual radial allocation stopped at failure");
         require(strstr(result,"\"ok\":false,") != NULL,"radial OOM rejects with owned error");
         printf("FAULT %u {\"kind\":\"radial\",\"name\":\"%s\",\"stage\":%u,\"failAt\":%u,\"attempts\":%u,\"requestedBytes\":%zu,\"result\":%s}\n",allocation_faults++,c->name,c->stage,site,allocation_attempts,requested_allocation,result);
         recover();
      }
   }
   /* Every PRECISE family executes all actually calibrated retry allocations. */
   for (unsigned profile = 17; profile < 27; ++profile) for (unsigned stage = 0; stage < 2; ++stage) {
      const struct test_case *c = &cases[anchors[profile * 2 + stage]];
      current = c->name; allocation_attempts = 0;
      require(strstr(single(stage,c->text,c->length), "\"ok\":true,") != NULL,"successful precise allocation calibration");
      unsigned sites = allocation_attempts; require(sites >= 2 && sites <= 12,"bounded actual precise allocation count");
      for (unsigned site = 1; site <= sites; ++site) {
         allocation_attempts=0;fail_allocation=site;
         const char *result=single(stage,c->text,c->length);fail_allocation=0;
         require(allocation_attempts==site && strstr(result,"\"ok\":false,") != NULL,"precise failure stops at actual allocation");
         printf("FAULT %u {\"kind\":\"precise\",\"name\":\"%s\",\"stage\":%u,\"failAt\":%u,\"attempts\":%u,\"requestedBytes\":%zu,\"result\":%s}\n",allocation_faults++,c->name,stage,site,allocation_attempts,requested_allocation,result);
         recover();
      }
   }


}
static void raster_allocation_failures(void)
{
   for (unsigned target = 0; target < 4; ++target) {
      const struct test_case *c = target < 2 ? &cases[anchors[58 + target]] : NULL;
      const struct pair_case *p = target >= 2 ? &pairs[pair_anchors[56 + target - 2]] : NULL;
      current = c ? c->name : p->name; allocation_attempts = 0;
      const char *healthy = c ? single(c->stage,c->text,c->length) : pair(p);
      require(strstr(healthy,"\"ok\":true,") != NULL,"raster allocation calibration");
      char *baseline = strdup(healthy); require(baseline != NULL,"owned raster baseline");
      unsigned sites = allocation_attempts; require(sites >= 3 && sites <= 16,"bounded copied-bank allocations");
      for (unsigned site = 1; site <= sites; ++site) {
         allocation_attempts = 0; fail_allocation = site;
         const char *result = c ? single(c->stage,c->text,c->length) : pair(p); fail_allocation = 0;
         require(allocation_attempts == site && strstr(result,"\"ok\":false,"),"actual raster failure is transactional");
         printf("FAULT %u {\"kind\":\"raster-%s\",\"case\":\"%s\",\"sites\":%u,\"failAt\":%u,\"attempts\":%u,\"requestedBytes\":%zu,\"result\":%s}\n",allocation_faults++,c ? "single" : "pair",current,sites,site,allocation_attempts,requested_allocation,result);
         recover();
      }
      require(!strcmp(c ? single(c->stage,c->text,c->length) : pair(p),baseline),"exact raster allocation recovery");free(baseline);
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
   current = "bounded-loop-anchor-truncations";
   /* New address profiles plus the two ordinary-parser anchors. The complete
    * retained result corpus and all-profile recovery still run for every case. */
   for (unsigned i = 0; i < ANCHORS; ++i)
      if (i < 2 || (i >= 34 && i < 38)) truncate_case(&cases[anchors[i]]);
   const char *extra[] = {"equality::alias-left-vertex", "equality::alias-left-fragment"};
   for (unsigned i = 0; i < 2; ++i) {
      const struct test_case *found = NULL;
      for (unsigned c = 0; c < MAX_CASES && cases[c].text; ++c)
         if (!strcmp(cases[c].name, extra[i])) found = &cases[c];
      require(found && found->ok, "label/depth truncation witness");
      truncate_case(found);
   }
   char buffer[BRIDGE_MAX_TEXT + 1]; const uint32_t seeds[] = {0x397b10e5u, 0x86cd4391u, 0xc120ad73u, 0x5e74bf09u};
   current = "bounded-loop-anchor-mutations";
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
      printf("SEED %08x mutations=1024 standalone_recoveries=61440 pair_recoveries=59392 passed\n", seeds[seed]);
   }
}
int main(int argc, char **argv)
{
   /* Smoke output is deliberately not a recording transcript: receipts accept
    * only the no-argument command and its complete STATS/SEED grammar. */
   bool smoke = argc == 2 && !strcmp(argv[1], "--smoke");
   require(argc == 1 || smoke, "only explicit smoke or full recording mode");
   printf("LAYOUT {\"pointerBytes\":%zu,\"rawIrBytes\":%zu,\"rawInstructionBytes\":%zu,\"rawDestinationBytes\":%zu,\"rawLaneBytes\":%zu,\"registerBytes\":%zu,\"rawSourceBytes\":%zu,\"profileBytes\":%zu,\"rawIrBoundBytes\":32768,\"profileBoundBytes\":8192,\"fixedWasmMemoryBytes\":16777216,\"fixedWasmStackBytes\":262144}\n",
          sizeof(void *), sizeof(struct raw_ir), sizeof(struct raw_instruction), sizeof(struct raw_destination), sizeof(struct raw_lane), sizeof(struct reg), sizeof(struct raw_source), sizeof(struct profile));
   unsigned count = read_cases();
   for (unsigned i = 0; i < count; ++i) {
      const struct test_case *c = &cases[i]; current = c->name; const char *result = single(c->stage, c->text, c->length);
      require((strstr(result, "\"ok\":true,") != NULL) == (c->ok != 0), "literal bounded-loop acceptance");
      if (c->ok) { char profile[48]; if (c->raw) snprintf(profile,sizeof(profile),"virgl-webgl2-raw-bits-v%u",c->raw); else snprintf(profile,sizeof(profile),"virgl-webgl2-straight-line-v5"); require(strstr(result,profile)!=NULL,"exact backend profile"); }
      else require(strstr(result, "\"code\":\"parse-error\"") || strstr(result, "\"code\":\"unsupported-feature\"") || strstr(result, "\"code\":\"translation-error\"") || strstr(result, "\"code\":\"input-too-large\""), "structured rejection");
      printf("CASE %u %s\n", i, result); if (!smoke) recover();
   }
   allocation_failures(); raster_allocation_failures(); upstream_allocation_failures();
   if (!smoke) { hostile(); mutate(); }
   printf("FLOW {\"arenaBytes\":%zu,\"arenaBoundBytes\":53248,\"depthLimit\":8}\n", flow_arena_bytes);
   for (unsigned i = 0; i < count; ++i) { free(cases[i].text); free(cases[i].baseline); }
   for (unsigned i = 0; i < pair_count; ++i) free(pairs[i].baseline);
   if (smoke) { printf("SMOKE calls=%u cases=%u pairs=%u allocationFaults=%u passed\n", calls, count, pair_count, allocation_faults); return 0; }
   printf("STATS {\"originals\":19,\"acceptedOriginals\":18,\"cases\":%u,\"pairs\":%u,\"calls\":%u,\"standaloneRecoveries\":%u,\"pairRecoveries\":%u,\"truncations\":%u,\"hostileCases\":%u,\"mutations\":4096,\"allocationFaults\":%u,\"upstreamAllocationFaults\":%u,\"maxSingleResultBytes\":%zu,\"maxPairResultBytes\":%zu}\n",
          count, pair_count, calls, recoveries, pair_recoveries, truncations, hostile_cases, allocation_faults, upstream_faults, max_single, max_pair);
   return 0;
}
