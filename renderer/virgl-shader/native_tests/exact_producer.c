/* SPDX-License-Identifier: MIT
 * Binary fixtures carry whole original texts and independent admission claims.
 * The original instrumented executable is retained with its unfiltered profile. */
#include "../bridge.h"
#include "../raw_bits.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned calls, fail_at;
static char *mutate_text;
static struct bridge_exact_word *mutate_components;
void *exact_producer_calloc(size_t n, size_t size)
{
   if (mutate_text) {
      mutate_text[0] = 'X'; mutate_components[0].word ^= 3u;
      mutate_text = NULL; mutate_components = NULL;
   }
   if (++calls == fail_at) return NULL;
   return calloc(n, size);
}
static void require(int yes, const char *why)
{
   if (!yes) { fprintf(stderr, "exact-producer: %s\n", why); exit(1); }
}
static uint32_t read_u32(void)
{
   unsigned char b[4]; require(fread(b, 1, 4, stdin) == 4, "complete integer");
   return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
static int accepted(const char *r) { return !strncmp(r, "{\"ok\":true,", 11); }
static void raw_probes(void)
{
   struct raw_ir *ir = calloc(1, sizeof(*ir)); require(ir != NULL, "probe IR");
   struct raw_exact_bank bank = {0}; ir->exact = &bank;
   const uint32_t words[] = {0,1,0x80000000u,0xffffffffu,0x7fc00001u};
   unsigned probes = 0;
   for (unsigned reg = 0; reg < 46; reg += 45) for (unsigned lane = 0; lane < 4; ++lane)
      for (unsigned i = 0; i < sizeof(words) / sizeof(words[0]); ++i) {
         struct raw_source src = {.file = CONST, .index = reg, .swizzle = {lane,lane,lane,lane}};
         bank.present[reg] = (unsigned char)(1u << lane); bank.words[reg][lane] = words[i];
         require(raw_uif_truth(ir, &src) == (words[i] != 0), "post-swizzle raw predicate, including negative zero");
         bank.present[reg] = 0; require(raw_uif_truth(ir, &src) == -1, "absent component stays unknown");
         src.file = INDIRECT_CONST; bank.present[reg] = 15;
         require(raw_uif_truth(ir, &src) == -1, "indirect address gains no exact fact"); ++probes;
      }
   ir->exact = NULL;
   struct raw_source src = {.file = CONST, .index = 0, .swizzle = {0,0,0,0}};
   require(raw_uif_truth(ir, &src) == -1, "default CONST stays unknown"); free(ir);
   printf("PROBES %u\n", probes);
}
int main(void)
{
   raw_probes();
   char magic[4]; require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VEX1", 4), "fixture header");
   unsigned total = read_u32(); require(total && total <= 15000, "bounded case count");
   for (unsigned i = 0; i < total; ++i) {
      unsigned stage = read_u32(), expected = read_u32(), old_expected = read_u32(), bytes = read_u32();
      unsigned count = read_u32(), partner_bytes = read_u32();
      require(stage < 2 && expected < 2 && old_expected < 2 && bytes <= BRIDGE_MAX_TEXT + 1 &&
         count && count <= BRIDGE_MAX_EXACT_WORDS && partner_bytes <= BRIDGE_MAX_TEXT, "bounded complete case");
      struct bridge_exact_word components[BRIDGE_MAX_EXACT_WORDS];
      for (unsigned j = 0; j < count; ++j) components[j] = (struct bridge_exact_word){read_u32(),read_u32(),read_u32()};
      char *text = malloc(bytes + 1), *partner = malloc(partner_bytes + 1); require(text && partner, "input arrays");
      require(fread(text, 1, bytes, stdin) == bytes && fread(partner, 1, partner_bytes, stdin) == partner_bytes, "whole source bytes");
      text[bytes] = partner[partner_bytes] = 0;
      const char *r = bridge_translate((int)stage, text, bytes);
      require(accepted(r) == (int)old_expected, "unqualified admission prediction");
      char *old = strdup(r); require(old != NULL, "copy default response"); printf("DEFAULT %u %s\n", i, old);
      calls = 0; r = bridge_translate_exact((int)stage, text, bytes, components, count);
      unsigned allocations = calls;
      if (accepted(r) != (int)expected) fprintf(stderr, "case %u: %s\n%s", i, r, text);
      require(accepted(r) == (int)expected, "qualified admission prediction");
      char *saved = strdup(r); require(saved != NULL, "copy exact response"); printf("EXACT %u %s\n", i, saved);
      require(!strcmp(bridge_translate_exact((int)stage, text, bytes, components, count), saved), "repeat exact owns response");
      require(!strcmp(bridge_translate((int)stage, text, bytes), old), "default never retains exact facts");
      if (old_expected && expected) require(!strcmp(saved, old), "ordinary complete result bytes win");
      r = stage ? bridge_translate_pair(partner, partner_bytes, text, bytes) : bridge_translate_pair(text, bytes, partner, partner_bytes);
      printf("PAIR %u %s\n", i, r);
      require(!strcmp(bridge_translate_exact((int)stage, text, bytes, components, count), saved), "pair leaves no stale private facts");
      if (i == 0) {
         char original = text[0]; uint32_t word = components[0].word;
         mutate_text = text; mutate_components = components;
         r = bridge_translate_exact((int)stage, text, bytes, components, count);
         require(text[0] == 'X' && components[0].word == (word ^ 3u), "allocation hook mutated caller inputs");
         require(!strcmp(r, saved), "native full text and tuple snapshot precedes first allocation");
         printf("ALIAS %s\n", r); text[0] = original; components[0].word = word;
      }
      if (i == 0 || (old_expected && expected)) for (unsigned failure = 1; failure <= allocations; ++failure) {
         calls = 0; fail_at = failure; r = bridge_translate_exact((int)stage, text, bytes, components, count);
         printf("FAILURE %u %u %s\n", i, failure, r); fail_at = 0;
         require(!strcmp(bridge_translate_exact((int)stage, text, bytes, components, count), saved), "allocation failure cannot leak assumptions");
      }
      free(saved); free(old); free(text); free(partner);
   }
   const struct bridge_exact_word word = {0,0,0}, bad_reg = {46,0,0}, bad_lane = {0,4,0};
   const struct bridge_exact_word duplicate[2] = {{0,0,0},{0,0,0}}, unsorted[2] = {{0,1,0},{0,0,0}};
   const char *text = "FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0,0,0,1}\nMOV OUT[0], IMM[0]\nEND\n";
   const struct { int stage; const char *text; size_t length; const struct bridge_exact_word *components; size_t count; } bad[] = {
      {2,text,strlen(text),&word,1}, {0,NULL,0,&word,1}, {0,text,strlen(text),NULL,1},
      {0,text,strlen(text),&word,0}, {0,text,strlen(text),&word,185},
      {0,text,BRIDGE_MAX_TEXT+1,&word,1}, {0,text,strlen(text),&bad_reg,1},
      {0,text,strlen(text),&bad_lane,1}, {0,text,strlen(text),duplicate,2},
      {0,text,strlen(text),unsorted,2}, {1,"\0",1,&word,1},
   };
   for (unsigned i = 0; i < sizeof(bad) / sizeof(bad[0]); ++i) {
      const char *r = bridge_translate_exact(bad[i].stage,bad[i].text,bad[i].length,bad[i].components,bad[i].count);
      require(!accepted(r), "invalid native request rejects"); printf("REJECT %u %s\n",i,r);
   }
   require(fgetc(stdin) == EOF && !ferror(stdin), "complete fixture consumed");
   printf("LAYOUT %zu %zu %zu %zu\n", sizeof(struct raw_ir), sizeof(struct profile), sizeof(struct bridge_exact_word), sizeof(struct raw_exact_bank));
   puts("STATUS passed"); return 0;
}
