/* SPDX-License-Identifier: MIT
 * Promoted fresh verifier regression for real upstream allocations, including
 * ignored TEX operand constructors and both mixed-backend stage arrangements.
 * Production has no injection control; only this test build redirects malloc/realloc. */
#include "bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned attempted, fail_at, hit, total_faults, recoveries;
static size_t failed_bytes;
static const char *failed_allocator;
void *precise_word_upstream_malloc(size_t bytes) {
   ++attempted;
   if (attempted == fail_at) { hit=attempted; failed_bytes=bytes; failed_allocator="malloc"; return NULL; }
   return malloc(bytes);
}
void *precise_word_upstream_realloc(void *pointer, size_t bytes) {
   ++attempted;
   if (attempted == fail_at) { hit=attempted; failed_bytes=bytes; failed_allocator="realloc"; return NULL; }
   return realloc(pointer, bytes);
}
struct witness { char *vertex, *fragment; unsigned stage; char name[80]; char *baseline; };
static const char legacy_vertex[] =
   "VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n"
   "DCL TEMP[0]\nMOV TEMP[0], IN[1]\nMOV OUT[0], IN[0]\nMOV OUT[1], TEMP[0]\nEND\n";
#define TEX_LINE "TEX TEMP[0], IN[0], SAMP[0], 2D\n"
static const char legacy_fragment[] =
   "FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL SAMP[0]\n"
   "DCL SVIEW[0], 2D, FLOAT\nDCL CONST[0]\nDCL TEMP[0]\n"
   TEX_LINE TEX_LINE TEX_LINE TEX_LINE TEX_LINE TEX_LINE TEX_LINE
   "MUL OUT[0], TEMP[0], CONST[0]\nEND\n";
static const char raw_vertex[] =
   "VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n"
   "MOV_PRECISE OUT[0], IN[0]\nMOV_PRECISE OUT[1], IN[1]\nEND\n";
static const char raw_fragment[] =
   "FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nMOV_PRECISE OUT[0], IN[0]\nEND\n";
static struct witness witnesses[] = {
   {(char *)legacy_vertex, NULL, 0, "legacy-vertex", NULL},
   {NULL, (char *)legacy_fragment, 1, "legacy-texture-fragment", NULL},
   {(char *)legacy_vertex, (char *)raw_fragment, 0, "legacy-vertex-raw-fragment", NULL},
   {(char *)raw_vertex, (char *)legacy_fragment, 1, "raw-vertex-legacy-texture-fragment", NULL},
};
static unsigned count;
static const char *current="init";
static void require(int value, const char *message) {
   if (!value) { fprintf(stderr,"FAIL %s failAt=%u attempted=%u hit=%u: %s\n", current, fail_at, attempted, hit, message); exit(1); }
}
static const char *translate(struct witness *w) {
   const char *r = w->vertex && w->fragment ? bridge_translate_pair(w->vertex,strlen(w->vertex),w->fragment,strlen(w->fragment)) :
      bridge_translate((int)w->stage,w->vertex ? w->vertex : w->fragment,strlen(w->vertex ? w->vertex : w->fragment));
   const size_t cap = w->vertex && w->fragment ? BRIDGE_MAX_PAIR_RESULT : BRIDGE_MAX_RESULT;
   require(r!=NULL && strnlen(r,cap)<cap,"bounded complete serialized result");
   require(!strstr(r,"(null)"),"no published NULL operand");
   return r;
}
static void recover(void) {
   for (unsigned i=0;i<count;i++) {
      require(!strcmp(translate(&witnesses[i]),witnesses[i].baseline),"exact healthy recovery and reset latch");
      ++recoveries;
   }
}
int main(void) {
   count=sizeof(witnesses)/sizeof(witnesses[0]);
   for(unsigned i=0;i<count;i++) {
      struct witness *w=&witnesses[i];
      current=w->name; attempted=0;fail_at=0;
      const char *result=translate(w);
      if (strncmp(result,"{\"ok\":true,",11)) fprintf(stderr,"BASELINE %s\n", result);
      require(!strncmp(result,"{\"ok\":true,",11),"literal healthy acceptance");
      w->baseline=strdup(result);require(w->baseline!=NULL,"owned baseline");
      printf("{\"kind\":\"baseline\",\"name\":\"%s\",\"allocations\":%u,\"result\":%s}\n",w->name,attempted,w->baseline);
   }
   for(unsigned i=0;i<count;i++) {
      struct witness *w=&witnesses[i];current=w->name;attempted=0;fail_at=0;
      require(!strcmp(translate(w),w->baseline),"stable calibration");
      unsigned sites=attempted;require(sites>4&&sites<1024,"bounded actual upstream sites");
      for(unsigned site=1;site<=sites;site++) {
         attempted=hit=0;failed_bytes=0;fail_at=site;
         const char *result=translate(w); fail_at=0;
         require(hit==site&&attempted>=site&&failed_bytes>0,"intended actual nonzero failure");
         /* This expectation is independent of the worker's fault harness. */
         printf("{\"kind\":\"fault\",\"name\":\"%s\",\"failAt\":%u,\"attempted\":%u,\"bytes\":%zu,\"allocator\":\"%s\",\"result\":%s}\n",w->name,site,attempted,failed_bytes,failed_allocator,result);
         fflush(stdout);
         require(!strncmp(result,"{\"ok\":false,",12),"every actual allocation failure rejects");
         require(!strstr(result,"\"glsl\":")&&!strstr(result,"\"vertex\":")&&!strstr(result,"\"fragment\":"),"no partial successful stage published");
         ++total_faults;recover();
      }
   }
   printf("{\"kind\":\"summary\",\"faults\":%u,\"recoveries\":%u,\"witnesses\":%u}\n",total_faults,recoveries,count);
   for(unsigned i=0;i<count;i++) {free(witnesses[i].baseline);}
   return 0;
}
