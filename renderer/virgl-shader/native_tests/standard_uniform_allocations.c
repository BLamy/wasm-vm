/* SPDX-License-Identifier: MIT — genuine allocation faults and original source custody. */
#include "bridge.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static unsigned calls, fail_at, hit, calloc_calls, calloc_fail, calloc_hit;
static char *mutate_vertex, *mutate_fragment;
void *precise_word_calloc(size_t n, size_t size)
{
   ++calloc_calls;
   if (mutate_vertex) { mutate_vertex[0] = 0; mutate_vertex = NULL; }
   if (mutate_fragment) { mutate_fragment[0] = 0; mutate_fragment = NULL; }
   if (calloc_fail == calloc_calls) { calloc_hit = calloc_calls; return NULL; }
   return calloc(n, size);
}
void *precise_word_upstream_malloc(size_t size)
{
   ++calls; if (calls == fail_at) { hit = calls; return NULL; } return malloc(size);
}
void *precise_word_upstream_realloc(void *p, size_t size)
{
   ++calls; if (calls == fail_at) { hit = calls; return NULL; } return realloc(p, size);
}
static const char vertex[] = "VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL IN[3]\nDCL IN[4]\nDCL CONST[0][0]\nDCL CONST[1][0..1023]\nDCL CONST[12][0..1023]\nDCL ADDR[0]\nDCL TEMP[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: UARL ADDR[0].x, IN[2].xxxx\n2: MUL TEMP[0], IN[3], CONST[0][0]\n3: ADD TEMP[0], TEMP[0], CONST[1][ADDR[0].x +1]\n4: ADD TEMP[0], TEMP[0], IN[4]\n5: XOR TEMP[0], TEMP[0], IN[1]\n6: XOR OUT[1], TEMP[0], CONST[12][1023]\n7: END\n";
static const char fragment[] = "FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL CONST[0][0]\nDCL CONST[1][0..1023]\nDCL CONST[12][0..1023]\nDCL OUT[0], COLOR\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\nDCL TEMP[0]\n0: TEX TEMP[0], IN[0], SAMP[0], 2D\n1: SIN TEMP[0].x, CONST[0][0].xxxx\n2: ADD TEMP[0], TEMP[0], CONST[1][1023]\n3: XOR OUT[0], TEMP[0], CONST[12][1023]\n4: END\n";
static void require(int good, const char *why)
{
   if (!good) { fprintf(stderr, "uniform allocation %u/%u hit %u calloc %u/%u: %s\n", calls, fail_at, hit, calloc_calls, calloc_fail, why); exit(1); }
}
static const char *run_text(unsigned mode, const char *v, const char *f)
{
   if (mode < 2) return bridge_translate_standard_uniform((int)mode, mode ? f : v, strlen(mode ? f : v));
   return bridge_translate_standard_uniform_pair(v, strlen(v), f, strlen(f), mode == 4 ? 2 : 0, mode == 4 ? 4 : 0,
                                                  mode == 4 ? 24 : 0, mode == 4 ? 16 : 0, mode == 2 ? 0 : 3);
}
static const char *run(unsigned mode) { return run_text(mode, vertex, fragment); }
static void rejected(const char *r)
{
   require(r && strstr(r, "\"ok\":false"), "genuine fault rejects");
   require(!strstr(r, "\"glsl\"") && !strstr(r, "\"vertex\"") && !strstr(r, "\"fragment\""), "no partial success");
}
int main(void)
{
   char *saved[5]; unsigned counts[5], ccounts[5], faults = 0, recoveries = 0;
   for (unsigned mode = 0; mode < 5; ++mode) {
      calls = calloc_calls = 0; const char *r = run(mode);
      require(r && strstr(r, "\"ok\":true"), "actual healthy dimensional stage/pair");
      saved[mode] = strdup(r); counts[mode] = calls; ccounts[mode] = calloc_calls;
      require(saved[mode] && calls > 4 && calls < 1024 && calloc_calls && calloc_calls < 12, "bounded genuine sites");
      printf("{\"kind\":\"baseline\",\"mode\":%u,\"allocations\":%u,\"callocs\":%u,\"result\":%s}\n", mode, calls, calloc_calls, r);
   }
   for (unsigned mode = 0; mode < 5; ++mode) {
      for (unsigned site = 1; site <= counts[mode]; ++site) {
         calls = calloc_calls = hit = 0; fail_at = site; const char *r = run(mode); rejected(r);
         require(hit == site, "upstream fault actually hit");
         printf("{\"kind\":\"upstream-fault\",\"mode\":%u,\"site\":%u,\"result\":%s}\n", mode, site, r);
         fail_at = 0; ++faults; require(!strcmp(run(mode), saved[mode]), "exact upstream recovery"); ++recoveries;
      }
      for (unsigned site = 1; site <= ccounts[mode]; ++site) {
         calls = calloc_calls = calloc_hit = 0; calloc_fail = site; const char *r = run(mode); rejected(r);
         require(calloc_hit == site, "arena or emitter fault actually hit");
         printf("{\"kind\":\"calloc-fault\",\"mode\":%u,\"site\":%u,\"result\":%s}\n", mode, site, r);
         calloc_fail = 0; ++faults; require(!strcmp(run(mode), saved[mode]), "exact calloc recovery"); ++recoveries;
      }
      char v[sizeof(vertex)], f[sizeof(fragment)]; memcpy(v, vertex, sizeof(v)); memcpy(f, fragment, sizeof(f));
      if (mode != 1) mutate_vertex = v;
      if (mode != 0) mutate_fragment = f;
      require(!strcmp(run_text(mode, v, f), saved[mode]), "complete original sources owned before semantic allocation");
      require((mode == 1 || !v[0]) && (mode == 0 || !f[0]), "caller mutation happened");
      rejected(run_text(mode, v, f)); require(!strcmp(run(mode), saved[mode]), "source mutation exact recovery");
      printf("{\"kind\":\"caller-custody\",\"mode\":%u,\"mutatedBeforeAllocation\":true,\"recovered\":true}\n", mode);
   }
   printf("{\"kind\":\"summary\",\"faults\":%u,\"recoveries\":%u,\"callerMutation\":true,\"partialResults\":false}\n", faults, recoveries);
   for (unsigned mode = 0; mode < 5; ++mode) free(saved[mode]); return 0;
}
