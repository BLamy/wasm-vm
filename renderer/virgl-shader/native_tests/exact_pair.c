/* SPDX-License-Identifier: MIT
 * Whole paired texts and predictions, owned before the first real allocation. */
#include "../bridge.h"
#include "../raw_bits.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned calls, fail_at, mutations;
static char *mutate_texts[2];
static struct bridge_exact_word *mutate_words[2];
void *exact_pair_calloc(size_t n, size_t size)
{
   if (mutate_texts[0]) {
      for (unsigned stage = 0; stage < 2; ++stage) {
         mutate_texts[stage][0] = 'X'; mutate_words[stage][0].word ^= 3u;
         mutate_texts[stage] = NULL; mutate_words[stage] = NULL;
      }
      ++mutations;
   }
   if (++calls == fail_at) return NULL;
   return calloc(n, size);
}
static void require(int yes, const char *why)
{
   if (!yes) { fprintf(stderr, "exact-pair: %s\n", why); exit(1); }
}
static uint32_t read_u32(void)
{
   unsigned char b[4]; require(fread(b, 1, 4, stdin) == 4, "complete integer");
   return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}
static int accepted(const char *r) { return !strncmp(r, "{\"ok\":true,", 11); }
static const char *pair(char **texts, unsigned *lengths, struct bridge_exact_word words[2][184], unsigned *counts)
{
   return bridge_translate_pair_exact(texts[0], lengths[0], words[0], counts[0], texts[1], lengths[1], words[1], counts[1]);
}
int main(void)
{
   char magic[4]; require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VEP1", 4), "fixture header");
   unsigned total = read_u32(); require(total && total <= 15000, "bounded cases");
   for (unsigned i = 0; i < total; ++i) {
      unsigned lengths[2] = {read_u32(), read_u32()}, counts[2] = {read_u32(), read_u32()};
      unsigned expected = read_u32(), old_expected = read_u32();
      require(lengths[0] <= BRIDGE_MAX_TEXT + 1 && lengths[1] <= BRIDGE_MAX_TEXT + 1 &&
         counts[0] <= 184 && counts[1] <= 184 && expected < 2 && old_expected < 2, "bounded complete pair");
      struct bridge_exact_word words[2][184]; char *texts[2];
      for (unsigned s = 0; s < 2; ++s) {
         for (unsigned j = 0; j < counts[s]; ++j) words[s][j] = (struct bridge_exact_word){read_u32(), read_u32(), read_u32()};
      }
      for (unsigned s = 0; s < 2; ++s) {
         texts[s] = malloc(lengths[s] + 1); require(texts[s] != NULL, "input allocation");
         require(fread(texts[s], 1, lengths[s], stdin) == lengths[s], "entire original text"); texts[s][lengths[s]] = 0;
      }
      const char *r = bridge_translate_pair(texts[0], lengths[0], texts[1], lengths[1]);
      if (accepted(r) != (int)old_expected) fprintf(stderr, "ordinary case %u expected%u: %s\n", i, old_expected, r);
      require(accepted(r) == (int)old_expected, "ordinary complete pair prediction");
      char *old = strdup(r); require(old != NULL, "own old response"); printf("DEFAULT %u %s\n", i, old);
      calls = 0; r = pair(texts, lengths, words, counts); unsigned allocations = calls;
      if (accepted(r) != (int)expected) fprintf(stderr, "case %u: %s\n%s\n%s\n", i, r, texts[0], texts[1]);
      require(accepted(r) == (int)expected, "private complete pair prediction");
      char *saved = strdup(r); require(saved != NULL, "own private response"); printf("EXACT %u %s\n", i, saved);
      if (old_expected && expected) require(!strcmp(old, saved), "ordinary entire paired bytes win");
      for (unsigned s = 0; s < 2; ++s) {
         r = counts[s] ? bridge_translate_exact((int)s, texts[s], lengths[s], words[s], counts[s]) :
            bridge_translate((int)s, texts[s], lengths[s]);
         printf("SINGLE %u %u %s\n", i, s, r);
      }
      require(!strcmp(pair(texts, lengths, words, counts), saved), "single calls cannot retain pair pointers");
      require(!strcmp(bridge_translate_pair(texts[0], lengths[0], texts[1], lengths[1]), old), "default pair retains no assumptions");
      require(!strcmp(pair(texts, lengths, words, counts), saved), "A/B/A result ownership");
      if (i == 0) {
         char initials[2] = {texts[0][0], texts[1][0]}; uint32_t first[2] = {words[0][0].word, words[1][0].word};
         for (unsigned s = 0; s < 2; ++s) { mutate_texts[s] = texts[s]; mutate_words[s] = words[s]; }
         r = pair(texts, lengths, words, counts);
         require(mutations == 1, "one first-allocation input mutation");
         require(!strcmp(r, saved), "both complete sources and tuples owned before first allocation");
         printf("ALIAS %s\n", r);
         for (unsigned s = 0; s < 2; ++s) {
            require(texts[s][0] == 'X' && words[s][0].word == (first[s] ^ 3u), "actual opposite-stage caller mutation");
            texts[s][0] = initials[s]; words[s][0].word = first[s];
         }
      }
      if (expected) for (unsigned failure = 1; failure <= allocations; ++failure) {
         calls = 0; fail_at = failure; r = pair(texts, lengths, words, counts);
         printf("FAILURE %u %u %s\n", i, failure, r); fail_at = 0;
         require(!strcmp(pair(texts, lengths, words, counts), saved), "every actual allocation recovers independently");
      }
      free(old); free(saved); free(texts[0]); free(texts[1]);
   }
   const char *v = "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n";
   const char *f = "FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0,0,0,1}\nMOV OUT[0], IMM[0]\nEND\n";
   const struct bridge_exact_word word = {0,0,0};
   for (unsigned i = 0; i < 8; ++i) {
      const char *r = bridge_translate_pair_exact(i == 0 ? NULL : v, i == 6 ? 49153 : strlen(v),
         i == 2 ? NULL : &word, i == 4 ? 185 : i == 5 ? 0 : 1,
         i == 1 ? NULL : f, i == 7 ? 49153 : strlen(f), i == 3 ? NULL : &word, i == 5 ? 0 : 1);
      require(!accepted(r), "independent native ABI rejection"); printf("REJECT %u %s\n", i, r);
   }
   const struct bridge_exact_word bad_register[] = {{46,0,0}}, bad_component[] = {{0,4,0}};
   const struct bridge_exact_word duplicate[] = {{0,0,0},{0,0,0}}, unsorted[] = {{0,1,0},{0,0,0}};
   const struct bridge_exact_word *bad_words[] = {bad_register,bad_component,duplicate,unsorted};
   unsigned serial = 8;
   for (unsigned s = 0; s < 2; ++s) for (unsigned kind = 0; kind < 4; ++kind) {
      unsigned count = kind < 2 ? 1 : 2;
      const char *r = bridge_translate_pair_exact(v,strlen(v),s ? &word : bad_words[kind],s ? 1 : count,
         f,strlen(f),s ? bad_words[kind] : &word,s ? count : 1);
      require(!accepted(r), "canonical/native register/lane rejection"); printf("REJECT %u %s\n",serial++,r);
   }
   const char *r = bridge_translate_pair_exact(v,strlen(v),&word,1,f,strlen(f),&word,185);
   require(!accepted(r), "opposite count bound"); printf("REJECT %u %s\n",serial++,r);
   require(fgetc(stdin) == EOF && !ferror(stdin), "entire fixture consumed");
   printf("LAYOUT %zu %zu %zu %zu\n", sizeof(struct raw_ir), sizeof(struct profile), sizeof(struct bridge_exact_word), sizeof(struct raw_exact_bank));
   puts("STATUS passed"); return 0;
}
