/* SPDX-License-Identifier: MIT */
/* Original bytes enter the real C APIs; every repeat must recover exactly. */
#include "../bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct original { unsigned stage; size_t length; char *text, *result; };
static struct original originals[19];
static char *paired[88];
static unsigned calls, recoveries;
static void require(int value, const char *label)
{
   if (!value) { fprintf(stderr, "original corpus: %s\n", label); exit(2); }
}
static unsigned u32(void)
{
   unsigned char bytes[4];
   require(fread(bytes, 1, 4, stdin) == 4, "complete protocol word");
   return bytes[0] | (unsigned)bytes[1] << 8 | (unsigned)bytes[2] << 16 | (unsigned)bytes[3] << 24;
}
static char *text(unsigned length)
{
   require(length <= BRIDGE_MAX_TEXT, "bounded input");
   char *value = malloc((size_t)length + 1);
   require(value != NULL, "test input allocation");
   require(fread(value, 1, length, stdin) == length, "complete input bytes");
   value[length] = 0;
   return value;
}
static const char *single(unsigned index)
{
   const struct original *o = &originals[index]; ++calls;
   return bridge_translate(o->stage, o->text, o->length);
}
static const char *pair(unsigned index)
{
   unsigned vertex = index / 11, fragment = 8 + index % 11;
   const struct original *v = &originals[vertex], *f = &originals[fragment]; ++calls;
   return bridge_translate_pair(v->text, v->length, f->text, f->length);
}
static void recover(unsigned index)
{
   unsigned si = index % 19, pi = index % 88;
   require(!strcmp(single(si), originals[si].result), "single result recovers exactly");
   require(!strcmp(pair(pi), paired[pi]), "pair result recovers exactly");
   recoveries += 2;
   printf("RECOVERY %u %u %u\n", index, si, pi);
}
int main(void)
{
   char magic[4];
   require(fread(magic, 1, 4, stdin) == 4 && !memcmp(magic, "VGC6", 4), "protocol identity");
   require(u32() == 19, "all nineteen originals");
   for (unsigned i = 0; i < 19; ++i) {
      struct original *o = &originals[i]; o->stage = u32(); o->length = u32();
      require(o->stage == (unsigned)(i >= 8), "ordered complete stage inventory");
      o->text = text((unsigned)o->length);
      o->result = strdup(single(i)); require(o->result != NULL, "owned original result");
      printf("ORIGINAL %u %s\n", i, o->result);
   }
   for (unsigned i = 0; i < 88; ++i) {
      paired[i] = strdup(pair(i)); require(paired[i] != NULL, "owned pair result");
      printf("PAIR %u %s\n", i, paired[i]);
   }
   unsigned attacks = u32(); require(attacks > 0 && attacks <= 1024, "bounded attacks");
   for (unsigned i = 0; i < attacks; ++i) {
      unsigned stage = u32(), length = u32(); require(stage < 2, "attack stage");
      char *input = text(length); ++calls;
      printf("ATTACK %u %s\n", i, bridge_translate(stage, input, length));
      free(input); recover(i);
   }
   require(fgetc(stdin) == EOF && !ferror(stdin), "no trailing protocol bytes");
   for (unsigned round = 0; round < 8; ++round) {
      for (unsigned i = 0; i < 19; ++i) {
         require(!strcmp(single(i), originals[i].result), "repeat original identity"); ++recoveries;
      }
      for (unsigned i = 0; i < 88; ++i) {
         require(!strcmp(pair(i), paired[i]), "repeat pair identity"); ++recoveries;
      }
      printf("ROUND %u\n", round);
   }
   for (unsigned i = 0; i < 19; ++i) { free(originals[i].text); free(originals[i].result); }
   for (unsigned i = 0; i < 88; ++i) free(paired[i]);
   printf("STATS {\"originals\":19,\"pairs\":88,\"attacks\":%u,\"calls\":%u,\"recoveries\":%u,\"rounds\":8}\n", attacks, calls, recoveries);
   return 0;
}
