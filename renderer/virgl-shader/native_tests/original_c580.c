/* SPDX-License-Identifier: MIT
 * Full unchanged original pair against authenticated DRAW-time banks. */
#include "../bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int ok, const char *reason)
{
   if (!ok) { fprintf(stderr, "original-c580: %s\n", reason); exit(1); }
}

static uint32_t word(FILE *input)
{
   unsigned char bytes[4];
   require(fread(bytes, 1, 4, input) == 4, "complete bank word");
   return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 |
      (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}

static char *source(const char *path, size_t *length)
{
   FILE *input = fopen(path, "rb");
   require(input != NULL, "open original source");
   require(fseek(input, 0, SEEK_END) == 0, "source extent");
   long size = ftell(input);
   require(size > 0 && size <= BRIDGE_MAX_TEXT, "bounded source bytes");
   require(fseek(input, 0, SEEK_SET) == 0, "source rewind");
   char *text = malloc((size_t)size + 1);
   require(text != NULL, "source allocation");
   require(fread(text, 1, (size_t)size, input) == (size_t)size, "complete original source");
   require(fgetc(input) == EOF && !ferror(input), "source end");
   require(fclose(input) == 0, "source close");
   text[size] = 0;
   require(strlen(text) == (size_t)size, "source contains no embedded NUL");
   *length = (size_t)size;
   return text;
}

static int accepted(const char *result)
{
   return result != NULL && !strncmp(result, "{\"ok\":true,", 11);
}

int main(int argc, char **argv)
{
   require(argc == 4, "vertex, fragment, paired banks");
   size_t vertex_length, fragment_length;
   char *vertex = source(argv[1], &vertex_length);
   char *fragment = source(argv[2], &fragment_length);
   FILE *input = fopen(argv[3], "rb");
   require(input != NULL, "open paired-bank evidence");
   char magic[4];
   require(fread(magic, 1, 4, input) == 4 && !memcmp(magic, "VOB1", 4) && word(input) == 3,
           "three complete authenticated banks");
   for (unsigned bank = 0; bank < 3; ++bank) {
      struct bridge_exact_word vertex_words[12], fragment_words[136];
      for (unsigned i = 0; i < 12; ++i)
         vertex_words[i] = (struct bridge_exact_word){i / 4, i % 4, word(input)};
      for (unsigned i = 0; i < 136; ++i)
         fragment_words[i] = (struct bridge_exact_word){i / 4, i % 4, word(input)};
      const char *result = bridge_translate_pair_exact(vertex, vertex_length,
         vertex_words, 12, fragment, fragment_length, fragment_words, 136);
      require(accepted(result), "complete private original pair admitted");
      printf("EXACT %u %s\n", bank, result);
      result = bridge_translate_pair(vertex, vertex_length, fragment, fragment_length);
      require(!accepted(result), "ordinary original pair remains gated");
      printf("DEFAULT %u %s\n", bank, result);
   }
   require(fgetc(input) == EOF && !ferror(input), "no trailing paired bank bytes");
   require(fclose(input) == 0, "paired-bank close");
   free(vertex);
   free(fragment);
   puts("STATUS passed");
   return 0;
}
