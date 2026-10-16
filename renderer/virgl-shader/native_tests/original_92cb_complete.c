/* SPDX-License-Identifier: MIT
 * Native/Wasm differential and mutation gate for the private full original body. */
#include "../bridge.h"
#include "../raw_bits.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Only bridge.c/raw_bits.c are built through these real allocation wrappers.
 * The production build has no hook or conditional semantic path. */
static unsigned calls, fail_at, mutations;
static unsigned char *mutate_vertex, *mutate_fragment, *mutate_geometry;
static int fail_allocation(void)
{
   if (mutate_vertex) {
      mutate_vertex[0] ^= 1; mutate_fragment[0] ^= 1; mutate_geometry[136] ^= 1;
      mutate_vertex = mutate_fragment = mutate_geometry = NULL;
      ++mutations;
   }
   ++calls;
   return fail_at && calls >= fail_at;
}
void *original_complete_calloc(size_t count, size_t size)
{
   return fail_allocation() ? NULL : calloc(count, size);
}
void *original_complete_malloc(size_t size)
{
   return fail_allocation() ? NULL : malloc(size);
}

static void require(int valid, const char *reason)
{
   if (!valid) { fprintf(stderr, "private-92cb-power: %s\n", reason); exit(1); }
}

static unsigned char *read_file(const char *path, size_t *length)
{
   FILE *file = fopen(path, "rb");
   require(file != NULL && !fseek(file, 0, SEEK_END), "open/measure input");
   long extent = ftell(file);
   require(extent > 0 && extent < 65536 && !fseek(file, 0, SEEK_SET), "bounded input");
   unsigned char *data = malloc((size_t)extent + 1);
   require(data != NULL && fread(data, 1, (size_t)extent, file) == (size_t)extent &&
           fgetc(file) == EOF && !ferror(file) && !fclose(file), "complete input");
   data[extent] = 0;
   *length = (size_t)extent;
   return data;
}

static uint64_t fingerprint(const char *text)
{
   uint64_t value = UINT64_C(14695981039346656037);
   for (const unsigned char *p = (const unsigned char *)text; *p; ++p)
      value = (value ^ *p) * UINT64_C(1099511628211);
   return value;
}

static uint32_t word(const unsigned char *bytes)
{
   return (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 |
      (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
}

static void put_word(unsigned char *bytes, uint32_t value)
{
   for (unsigned i = 0; i < 4; ++i) bytes[i] = (unsigned char)(value >> (i * 8));
}

static void rejected(const char *result, const char *reason)
{
   require(result && strstr(result, "\"ok\":false") &&
           strstr(result, "\"code\":\"invalid-input\""), reason);
}

int main(int argc, char **argv)
{
   require(argc == 4, "full vertex, fragment and three-bank geometry arguments");
   size_t vl, fl, gl;
   unsigned char *vertex = read_file(argv[1], &vl);
   unsigned char *fragment = read_file(argv[2], &fl);
   unsigned char *geometry = read_file(argv[3], &gl);
   const struct bridge_92cb_draw_state draw = {0, 0, 1024, 768, 0, 0x8814, 5, 0, 4};
   for (unsigned bank = 0; bank < 3; ++bank) {
      const unsigned char *bank_bytes = geometry + 72 + bank * 656;
      struct bridge_exact_word vertex_words[16], fragment_words[148];
      for (unsigned i = 0; i < 16; ++i)
         vertex_words[i] = (struct bridge_exact_word){i / 4, i % 4, word(bank_bytes + 4 * i)};
      for (unsigned i = 0; i < 148; ++i)
         fragment_words[i] = (struct bridge_exact_word){i / 4, i % 4, word(bank_bytes + 64 + 4 * i)};
      const char *ordinary = bridge_translate_pair((char *)vertex, vl, (char *)fragment, fl);
      require(ordinary && strstr(ordinary, "\"ok\":false"), "ordinary full-original pair remains gated");
      const char *normal_exact = bridge_translate_pair_exact((char *)vertex, vl,
         vertex_words, 16, (char *)fragment, fl, fragment_words, 148);
      require(normal_exact && strstr(normal_exact, "\"ok\":false"),
              "standard exact full-original pair remains gated");
      const char *result = bridge_translate_original_92cb_complete(
         (char *)vertex, vl, (char *)fragment, fl, geometry, gl, bank, &draw);
      if (!result || !strstr(result, "\"ok\":true"))
         fprintf(stderr, "bank %u compiler result: %.500s\n", bank, result ? result : "(null)");
      require(result && strstr(result, "\"ok\":true") &&
              strstr(result, "\"kind\":\"original-92cb-full-guarded-v1\"") &&
              strstr(result, "\"drawTimeRecheckRequired\":true") &&
              strstr(result, "\"productionDrawAuthority\":false") &&
              strstr(result, "pow(") && strstr(result, "fsout_c0") &&
              strstr(result, "private_power_domain") && strstr(result, "\"instructions\":716"),
              "authenticated complete original accepted only conditionally");
      printf("BANK %u JSON_BYTES %zu FNV64 %016llx\n%s\n", bank, strlen(result),
             (unsigned long long)fingerprint(result), result);
   }
   calls = 0;
   const char *baseline = bridge_translate_original_92cb_complete(
      (char *)vertex, vl, (char *)fragment, fl, geometry, gl, 0, &draw);
   unsigned allocations = calls;
   char *saved = strdup(baseline);
   require(saved != NULL && allocations > 0, "allocation baseline");
   mutate_vertex = vertex; mutate_fragment = fragment; mutate_geometry = geometry;
   calls = 0;
   const char *owned = bridge_translate_original_92cb_complete(
      (char *)vertex, vl, (char *)fragment, fl, geometry, gl, 0, &draw);
   require(mutations == 1 && !strcmp(owned, saved), "complete owned sources and bank before first allocation");
   vertex[0] ^= 1; fragment[0] ^= 1; geometry[136] ^= 1;
   for (unsigned failure = 1; failure <= allocations; ++failure) {
      calls = 0; fail_at = failure;
      const char *failed = bridge_translate_original_92cb_complete(
         (char *)vertex, vl, (char *)fragment, fl, geometry, gl, 0, &draw);
      require(failed && strstr(failed, "\"ok\":false"), "every real allocation failure is closed");
      printf("ALLOCATION %u %s\n", failure, failed);
      fail_at = 0; calls = 0;
      require(!strcmp(bridge_translate_original_92cb_complete((char *)vertex, vl,
         (char *)fragment, fl, geometry, gl, 0, &draw), saved), "allocation failure recovery");
   }
   printf("OWNERSHIP mutations=%u allocations=%u\n", mutations, allocations);
   free(saved);
   struct raw_ir *unbound = calloc(1, sizeof(*unbound));
   require(unbound != NULL, "negative IR fixture allocation");
   unbound->temporary[0][0].origin = RAW_FLOAT_SHADOW;
   unbound->temporary[1][0] = (struct raw_lane){.zero = ~UINT32_C(0x3f800000),
      .one = UINT32_C(0x3f800000), .origin = RAW_FLOAT_DECODE};
   const struct raw_instruction unsafe = {.opcode = RAW_POW, .dst = {TEMP,2,1},
      .src = {{TEMP,0,{0,0,0,0}}, {TEMP,1,{0,0,0,0}}}, .flags = RAW_PRIVATE_92CB_COMPLETE};
   require(!raw_record(unbound, &unsafe) && unbound->count == 0,
      "private flag alone cannot grant an unbound numerical certificate");
   free(unbound);
   for (unsigned field = 0; field < 9; ++field) {
      struct bridge_92cb_draw_state changed = draw;
      uint32_t fields[9]; memcpy(fields, &changed, sizeof(fields)); fields[field] ^= 1;
      memcpy(&changed, fields, sizeof(fields));
      rejected(bridge_translate_original_92cb_complete((char *)vertex, vl,
         (char *)fragment, fl, geometry, gl, 0, &changed), "every draw-state field is enforced");
   }
   rejected(bridge_translate_original_92cb_complete(NULL, vl, (char *)fragment, fl,
      geometry, gl, 0, &draw), "null source");
   rejected(bridge_translate_original_92cb_complete((char *)vertex, vl, (char *)fragment, fl,
      geometry, gl, 0, NULL), "null draw state");
   rejected(bridge_translate_original_92cb_complete((char *)vertex, vl-1, (char *)fragment, fl,
      geometry, gl, 0, &draw), "truncated source");
   rejected(bridge_translate_original_92cb_complete((char *)vertex, vl, (char *)fragment, fl,
      geometry, gl-1, 0, &draw), "truncated geometry");
   struct bridge_92cb_draw_state fault = draw;
   fault.viewport_width--;
   rejected(bridge_translate_original_92cb_complete((char *)vertex, vl,
      (char *)fragment, fl, geometry, gl, 0, &fault), "viewport fault");
   fault = draw; fault.samples++;
   rejected(bridge_translate_original_92cb_complete((char *)vertex, vl,
      (char *)fragment, fl, geometry, gl, 0, &fault), "sample fault");
   fault = draw; fault.color_format = 0x8058;
   rejected(bridge_translate_original_92cb_complete((char *)vertex, vl,
      (char *)fragment, fl, geometry, gl, 0, &fault), "format fault");
   char *version = strstr((char *)fragment, "309:         POW TEMP[225].x");
   require(version != NULL, "original late source/destination site");
   size_t version_at = (size_t)(version - (char *)fragment) + 22;
   fragment[version_at] ^= 1;
   rejected(bridge_translate_original_92cb_complete((char *)vertex, vl,
      (char *)fragment, fl, geometry, gl, 0, &draw), "late source version and mask cannot inherit pin");
   fragment[version_at] ^= 1;
   fragment[0] ^= 1;
   rejected(bridge_translate_original_92cb_complete((char *)vertex, vl,
      (char *)fragment, fl, geometry, gl, 0, &draw), "source fault");
   fragment[0] ^= 1;
   vertex[0] ^= 1;
   rejected(bridge_translate_original_92cb_complete((char *)vertex, vl,
      (char *)fragment, fl, geometry, gl, 0, &draw), "paired source fault");
   vertex[0] ^= 1;
   static const size_t changes[] = {8, 72, 72 + 64 + 16 * 4, 72 + 64 + 6 * 4,
                                    72 + 64 + 4 * 4};
   for (unsigned i = 0; i < sizeof(changes) / sizeof(changes[0]); ++i) {
      size_t at = changes[i]; geometry[at] ^= 1;
      rejected(bridge_translate_original_92cb_complete((char *)vertex, vl,
         (char *)fragment, fl, geometry, gl, 0, &draw), "quad/bank/exponent/domain fault");
      geometry[at] ^= 1;
   }
   const struct { size_t at; uint32_t value; } numeric_faults[] = {
      {72 + 64 + 16 * 4, 0xbf800000}, /* negative coefficient */
      {72 + 64 + 16 * 4, 0x7fc00000}, /* nonfinite coefficient */
      {72 + 64 + 24 * 4, 0x40400000}, /* changed exponent */
      {72 + 8 * 4, 0xbe9b8000},     /* half-pixel zero crossing */
   };
   for (unsigned i = 0; i < sizeof(numeric_faults) / sizeof(numeric_faults[0]); ++i) {
      size_t at = numeric_faults[i].at;
      uint32_t original = word(geometry + at);
      put_word(geometry + at, numeric_faults[i].value);
      rejected(bridge_translate_original_92cb_complete((char *)vertex, vl,
         (char *)fragment, fl, geometry, gl, 0, &draw), "negative/NaN/exponent/zero-crossing fault");
      put_word(geometry + at, original);
   }
   rejected(bridge_translate_original_92cb_complete((char *)vertex, vl,
      (char *)fragment, fl, geometry, gl, 3, &draw), "bank selector fault");
   free(vertex); free(fragment); free(geometry);
   puts("STATUS passed; complete original with guarded powers");
   return 0;
}
