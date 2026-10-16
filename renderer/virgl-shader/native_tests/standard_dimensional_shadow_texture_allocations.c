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
static const char vertex[] = "VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL IN[3]\nDCL IN[4]\nDCL SV[0], INSTANCEID\nDCL CONST[0][0]\nDCL CONST[1][0..1023]\nDCL CONST[12][0..1023]\nDCL ADDR[0]\nDCL TEMP[0..1]\nDCL SAMP[7]\nDCL SVIEW[7], SHADOWCUBE, FLOAT\nDCL SAMP[15]\nDCL SVIEW[15], 2D_ARRAY, FLOAT\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nIMM[0] FLT32 {1.0,0.0,0.0,0.25}\nIMM[1] INT32 {1,1,0,1}\nIMM[2] FLT32 {0.25,0.0,0.0,0.0}\nIMM[3] FLT32 {0.0,0.25,0.0,0.0}\n0: MOV OUT[0], IN[0]\n1: UARL ADDR[0].x, IN[2].xxxx\n2: TEX TEMP[0], IMM[0], SAMP[15], SHADOW2D_ARRAY\n3: TXD TEMP[0], IMM[0], IMM[2], IMM[3], SAMP[15], SHADOW2D_ARRAY\n4: TXQ TEMP[0].xyw, IMM[1], SAMP[15], 2D_ARRAY\n5: MUL TEMP[0], IN[3], CONST[0][0]\n6: ADD TEMP[0], TEMP[0], CONST[1][ADDR[0].x +1]\n7: ADD TEMP[0], TEMP[0], IN[4]\n8: XOR TEMP[0], TEMP[0], IN[1]\n9: XOR TEMP[0], TEMP[0], CONST[12][1023]\n10: XOR OUT[1], TEMP[0], SV[0]\n11: TEX_SAT_PRECISE TEMP[1], -|IMM[0].wzyx|, SAMP[7], SHADOWCUBE\n12: TXD TEMP[0], IMM[0], IMM[2], IMM[3], SAMP[7], SHADOWCUBE\n13: TXQ TEMP[0].xyw, IMM[1], SAMP[7], CUBE\n14: END\n";
static const char fragment[] = "FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL CONST[0][0]\nDCL CONST[1][0..1023]\nDCL CONST[12][0..1023]\nDCL OUT[0], COLOR\nDCL SAMP[0]\nDCL SVIEW[0], CUBE, FLOAT\nDCL SAMP[7]\nDCL SVIEW[7], SHADOW2D_ARRAY, FLOAT\nDCL SAMP[15]\nDCL SVIEW[15], 3D, SINT\nDCL TEMP[0..1]\nIMM[0] FLT32 {1.0,0.0,0.0,0.25}\nIMM[1] INT32 {1,1,0,1}\nIMM[2] FLT32 {0.25,0.0,0.0,0.0}\nIMM[3] FLT32 {0.0,0.25,0.0,0.0}\n0: TEX TEMP[0], IN[0], SAMP[15], 3D\n1: TXQ TEMP[0].xyw, IMM[1], SAMP[15], 3D\n2: TEX TEMP[1], IMM[0], SAMP[0], SHADOWCUBE\n3: TXD TEMP[1], IMM[0], IMM[2], IMM[3], SAMP[0], SHADOWCUBE\n4: TXB2_SAT_PRECISE TEMP[0].yw, -|IMM[0].xyzw|, IMM[2].wwww, SAMP[0], SHADOWCUBE\n5: TXQ TEMP[0].xyw, IMM[1], SAMP[0], SHADOWCUBE\n6: SIN TEMP[0].x, CONST[0][0].xxxx\n7: ADD TEMP[0], TEMP[0], CONST[1][1023]\n8: XOR OUT[0], TEMP[0], CONST[12][1023]\n9: TEX TEMP[0], IMM[0], SAMP[7], SHADOW2D_ARRAY\n10: TXD TEMP[1], IMM[0], IMM[2], IMM[3], SAMP[7], SHADOW2D_ARRAY\n11: TXQ TEMP[0].xyw, IMM[1], SAMP[7], 2D_ARRAY\n12: END\n";
static void require(int good, const char *why)
{
   if (!good) { fprintf(stderr, "dimensional comparison allocation %u/%u hit %u calloc %u/%u: %s\n", calls, fail_at, hit, calloc_calls, calloc_fail, why); exit(1); }
}
static const char *run_text(unsigned mode, const char *v, const char *f)
{
   if (mode < 2) return bridge_translate_standard_dimensional_shadow_texture((int)mode, mode ? f : v, strlen(mode ? f : v), mode ? 1 : 0, 0);
   return bridge_translate_standard_dimensional_shadow_texture_pair(v, strlen(v), f, strlen(f), mode == 4 ? 2 : 0, mode == 4 ? 4 : 0,
                                                  mode == 4 ? 24 : 0, mode == 4 ? 16 : 0, mode == 2 ? 0 : 3, 1, 0);
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
      require(r && strstr(r, "\"ok\":true"), "actual healthy dimensional comparison stage/pair");
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
