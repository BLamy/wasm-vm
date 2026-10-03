#include "raw_bits.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint32_t rng;
static uint64_t assertions, instructions, safe_outputs;
static uint64_t opcode_hits[RAW_UCMP+1], origin_hits, exact_hits, partial_hits, alias_hits;
static uint32_t random32(void) { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; }
static int64_t signed32(uint32_t x) { return x < UINT32_C(0x80000000) ? (int64_t)x : (int64_t)x - INT64_C(4294967296); }
static uint32_t evaluate(enum raw_opcode op, uint32_t a, uint32_t b, uint32_t c) {
   switch(op) {
   case RAW_MOV: return a;
   case RAW_AND: return a & b;
   case RAW_OR: return a | b;
   case RAW_NOT: return ~a;
   case RAW_SHL: return a << (b % 32);
   case RAW_USHR: return a >> (b % 32);
   case RAW_UADD: return (uint32_t)((uint64_t)a + (uint64_t)b);
   case RAW_ISGE: return signed32(a) >= signed32(b) ? UINT32_MAX : 0;
   case RAW_USEQ: return a == b ? UINT32_MAX : 0;
   case RAW_USNE: return a != b ? UINT32_MAX : 0;
   case RAW_UCMP: return a ? b : c;
   }
   abort();
}
struct concrete { uint32_t temp[4][4], input[2][4], constant[2][4], out[4]; };
static uint32_t get(const struct raw_ir *ir, const struct concrete *c, struct raw_source s, unsigned lane) {
   unsigned component=s.swizzle[lane];
   if(s.file==TEMP) return c->temp[s.index][component];
   if(s.file==IN) return c->input[s.index][component];
   if(s.file==CONST) return c->constant[s.index][component];
   if(s.file==IMM) return ir->immediates[s.index][component];
   abort();
}
static void check(struct raw_lane fact, uint32_t concrete, const struct concrete *c, unsigned seed, unsigned trial, unsigned instruction, unsigned lane) {
   ++assertions;
   if ((fact.zero & fact.one) || (concrete & fact.zero) || ((~concrete) & fact.one)) {
      fprintf(stderr,"knowledge failed seed=%08x trial=%u instruction=%u lane=%u bits=%08x zero=%08x one=%08x\n",seed,trial,instruction,lane,concrete,fact.zero,fact.one); abort();
   }
   if(fact.origin) {
      ++origin_hits; unsigned index=(fact.origin-1)/4, component=(fact.origin-1)%4;
      if(concrete != c->input[index][component]) {fprintf(stderr,"origin failed seed=%08x trial=%u instruction=%u lane=%u\n",seed,trial,instruction,lane);abort();}
   }
   if((fact.zero|fact.one)==UINT32_MAX) ++exact_hits;
}
int main(void) {
   const uint32_t seeds[]={UINT32_C(0x2fe68731),UINT32_C(0xc47b920d),UINT32_C(0x741dba53),UINT32_C(0xaf5681e9),UINT32_C(0x0932c7bd)};
   const uint32_t edges[]={0,1,2,UINT32_C(0x7fffffff),UINT32_C(0x80000000),UINT32_MAX,UINT32_C(0x7f800000),UINT32_C(0xff800000),UINT32_C(0x7fc00001),UINT32_C(0x00800000),UINT32_C(0x00000001),UINT32_C(0x80000001),UINT32_C(0x3f800000)};
   const uint32_t masks[]={0,UINT32_MAX,1,UINT32_C(0x80000000),UINT32_C(0x7f800000),UINT32_C(0x007fffff),UINT32_C(0x55555555),UINT32_C(0xaaaaaaaa)};
   for(unsigned seed=0;seed<5;++seed) {rng=seeds[seed];
      for(unsigned trial=0;trial<160;++trial) {
         struct raw_ir *ir=calloc(1,sizeof(*ir)); struct concrete schedules[32]={0};
         if(!ir) abort();
         for(unsigned schedule=0;schedule<32;++schedule)
            for(unsigned r=0;r<2;++r) for(unsigned lane=0;lane<4;++lane) {
               schedules[schedule].input[r][lane]=random32();
               schedules[schedule].constant[r][lane]=schedule<13?edges[(schedule+lane+r)%13]:random32();
            }
         for(unsigned r=0;r<4;++r) for(unsigned lane=0;lane<4;++lane) {
            uint32_t word=random32(); if(trial%3==0) word=edges[(r+lane+trial)%13];
            uint32_t mask=masks[random32()%8];
            ir->temporary[r][lane]=(struct raw_lane){.zero=~word & mask,.one=word & mask};
            if((random32()%5)==0) ir->temporary[r][lane]=(struct raw_lane){.origin=1+random32()%8};
            for(unsigned s=0;s<32;++s) {struct raw_lane a=ir->temporary[r][lane];
               schedules[s].temp[r][lane]=a.origin?schedules[s].input[(a.origin-1)/4][(a.origin-1)%4]:(random32() & ~(a.zero|a.one))|a.one;
            }
            ir->immediates[r][lane]=edges[(trial+r*4+lane)%13];
         }
         for(unsigned step=0;step<64;++step) {
            struct raw_instruction ins={0};
            ins.opcode=step<11?(enum raw_opcode)step:(enum raw_opcode)(random32()%11);
            ins.dst.file=step%7==0?OUT:TEMP; ins.dst.index=ins.dst.file==OUT?0:random32()%4;
            ins.dst.mask=1+random32()%15; if(ins.dst.mask!=15) ++partial_hits;
            for(unsigned source=0;source<3;++source) {
               enum file files[]={TEMP,IMM,IN,CONST}; ins.src[source].file=files[random32()%4];
               ins.src[source].index=random32()%(ins.src[source].file==TEMP||ins.src[source].file==IMM?4:2);
               for(unsigned lane=0;lane<4;++lane) ins.src[source].swizzle[lane]=random32()%4;
               if(ins.src[source].file==ins.dst.file && ins.src[source].index==ins.dst.index) ++alias_hits;
            }
            raw_record(ir,&ins); ++instructions; ++opcode_hits[ins.opcode];
            for(unsigned s=0;s<32;++s) {
               uint32_t result[4]={0};
               for(unsigned lane=0;lane<4;++lane) if(ins.dst.mask&(1u<<lane)) {
                  uint32_t a=get(ir,&schedules[s],ins.src[0],lane),b=get(ir,&schedules[s],ins.src[1],lane),c=get(ir,&schedules[s],ins.src[2],lane);
                  result[lane]=evaluate(ins.opcode,a,b,c);
               }
               for(unsigned lane=0;lane<4;++lane) if(ins.dst.mask&(1u<<lane)) {
                  if(ins.dst.file==TEMP) schedules[s].temp[ins.dst.index][lane]=result[lane]; else schedules[s].out[lane]=result[lane];
                  check(ins.dst.file==TEMP?ir->temporary[ins.dst.index][lane]:ir->output[0][lane],result[lane],&schedules[s],seeds[seed],trial,step,lane);
               }
            }
            if(ins.dst.file==OUT) {
               struct profile p={.raw=ir};p.declared[OUT][0]=true;p.components[OUT][0]=ins.dst.mask;
               if(raw_outputs_safe(&p)) for(unsigned s=0;s<32;++s) for(unsigned lane=0;lane<4;++lane) if(ins.dst.mask&(1u<<lane)) {
                  ++safe_outputs; uint32_t bits=schedules[s].out[lane],exponent=(bits>>23)&255u,mantissa=bits&UINT32_C(0x7fffff);
                  if(!ir->output[0][lane].origin && (exponent==255u || (exponent==0u && mantissa))) abort();
               }
            }
         }
         free(ir);
      }
   }
   printf("{\"seeds\":[\"2fe68731\",\"c47b920d\",\"741dba53\",\"af5681e9\",\"0932c7bd\"],\"trials\":800,\"schedulesPerTrial\":32,\"instructions\":%"PRIu64",\"assertions\":%"PRIu64",\"originAssertions\":%"PRIu64",\"exactKnownAssertions\":%"PRIu64",\"safeOutputAssertions\":%"PRIu64",\"partialInstructions\":%"PRIu64",\"aliasSources\":%"PRIu64",\"opcodeHits\":[",instructions,assertions,origin_hits,exact_hits,safe_outputs,partial_hits,alias_hits);
   for(unsigned i=0;i<=RAW_UCMP;++i)printf("%s%"PRIu64,i?",":"",opcode_hits[i]);puts("],\"ok\":true}");
}
