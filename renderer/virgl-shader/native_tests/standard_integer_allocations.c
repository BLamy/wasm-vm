/* SPDX-License-Identifier: MIT — typed integer allocation/caller-custody attacks. */
#include "bridge.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
static unsigned calls, fail_at, hit, calloc_calls, calloc_fail, calloc_hit;
static char *mutate_vertex, *mutate_fragment;
void *precise_word_calloc(size_t n,size_t size)
{
   ++calloc_calls;
   if(mutate_vertex){mutate_vertex[0]=0;mutate_fragment[0]=0;mutate_vertex=mutate_fragment=NULL;}
   if(calloc_fail==calloc_calls){calloc_hit=calloc_calls;return NULL;}
   return calloc(n,size);
}
void *precise_word_upstream_malloc(size_t size)
{
   ++calls;if(calls==fail_at){hit=calls;return NULL;}return malloc(size);
}
void *precise_word_upstream_realloc(void *p,size_t size)
{
   ++calls;if(calls==fail_at){hit=calls;return NULL;}return realloc(p,size);
}
static const char vertex[]="VERT\nDCL IN[0]\nDCL IN[1]\nDCL CONST[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MUL OUT[1], IN[1], CONST[0]\n2: END\n";
static const char fragment[]="FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL CONST[0]\nDCL OUT[0], COLOR\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\nDCL TEMP[0]\n0: TEX TEMP[0], IN[0], SAMP[0], 2D\n1: SIN TEMP[0].x, CONST[0].xxxx\n2: MOV OUT[0], TEMP[0]\n3: END\n";
static void require(int good,const char *why){if(!good){fprintf(stderr,"standard allocation failure calls=%u at=%u hit=%u calloc=%u/%u: %s\n",calls,fail_at,hit,calloc_calls,calloc_fail,why);exit(1);}}
static const char *run(unsigned kind){return bridge_translate_standard_pair_typed(vertex,strlen(vertex),fragment,strlen(fragment),kind?2:0,kind?0:2);}
static void rejected(const char *r){require(r&&strstr(r,"\"ok\":false"),"every fault rejects");require(!strstr(r,"\"glsl\"")&&!strstr(r,"\"vertex\"")&&!strstr(r,"\"fragment\""),"no partial successful result");}
int main(void)
{
   char *saved[2];unsigned counts[2],ccounts[2],faults=0,recoveries=0;
   for(unsigned kind=0;kind<2;++kind){calls=calloc_calls=0;const char *r=run(kind);require(strstr(r,"\"ok\":true")!=NULL,"healthy actual stage/pair");saved[kind]=strdup(r);counts[kind]=calls;ccounts[kind]=calloc_calls;require(saved[kind]&&calls>4&&calls<1024&&calloc_calls>0&&calloc_calls<12,"bounded real sites");printf("{\"kind\":\"baseline\",\"mode\":%u,\"allocations\":%u,\"callocs\":%u,\"result\":%s}\n",kind,calls,calloc_calls,r);}
   for(unsigned kind=0;kind<2;++kind){
      for(unsigned site=1;site<=counts[kind];++site){calls=calloc_calls=hit=0;fail_at=site;const char *r=run(kind);rejected(r);require(hit==site,"actual upstream failure hit");printf("{\"kind\":\"upstream-fault\",\"mode\":%u,\"site\":%u,\"result\":%s}\n",kind,site,r);fail_at=0;++faults;require(!strcmp(run(kind),saved[kind]),"upstream exact recovery");++recoveries;}
      for(unsigned site=1;site<=ccounts[kind];++site){calls=calloc_calls=calloc_hit=0;calloc_fail=site;const char *r=run(kind);rejected(r);require(calloc_hit==site,"actual bridge arena/string-array failure hit");printf("{\"kind\":\"calloc-fault\",\"mode\":%u,\"site\":%u,\"result\":%s}\n",kind,site,r);calloc_fail=0;++faults;require(!strcmp(run(kind),saved[kind]),"calloc exact recovery");++recoveries;}
   }
   char v[sizeof(vertex)],f[sizeof(fragment)];memcpy(v,vertex,sizeof(v));memcpy(f,fragment,sizeof(f));mutate_vertex=v;mutate_fragment=f;calls=calloc_calls=0;
   require(!strcmp(bridge_translate_standard_pair_typed(v,strlen(v),f,strlen(f),0,2),saved[0]),"both complete sources owned before first semantic allocation");require(!v[0]&&!f[0],"caller mutation actually happened");rejected(bridge_translate_standard_pair_typed(v,strlen(v),f,strlen(f),0,2));
   rejected(bridge_translate_standard(-1,vertex,strlen(vertex)));
   rejected(bridge_translate_standard(0,NULL,0));
   rejected(bridge_translate_standard_pair(NULL,0,fragment,strlen(fragment)));
   require(!strcmp(run(0),saved[0]),"invalid input/stage recovery");
   printf("{\"kind\":\"summary\",\"faults\":%u,\"recoveries\":%u,\"callerMutation\":true,\"partialResults\":false}\n",faults,recoveries);
   for(unsigned i=0;i<2;++i)free(saved[i]);return 0;
}
