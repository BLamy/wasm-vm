#include "raw_bits.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static uint32_t rng;
static uint32_t next(void){rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;return rng;}
enum { SAMPLES=16, REG=8, STEPS=96, TRIALS=32 };
static uint32_t input[SAMPLES][REG][4],constant[SAMPLES][REG][4],temp[SAMPLES][REG][4],output[SAMPLES][4];
static unsigned long checks;
static uint32_t value(const struct raw_ir *ir,const struct reg *r,unsigned lane,unsigned sample){unsigned c=r->swizzle[lane];switch(r->file){case TEMP:return temp[sample][r->index][c];case CONST:return constant[sample][r->index][c];case IN:return input[sample][r->index][c];case IMM:return ir->immediates[r->index][c];default:abort();}}
static void verify(struct raw_lane knowledge,uint32_t actual,unsigned sample){
 if((actual&knowledge.zero)||((actual&knowledge.one)!=knowledge.one)||(knowledge.zero&knowledge.one)){fprintf(stderr,"unsound known bits %08x z=%08x o=%08x\n",actual,knowledge.zero,knowledge.one);exit(1);}checks++;
 if(knowledge.origin){unsigned n=knowledge.origin-1;if(actual!=input[sample][n/4][n%4]){fprintf(stderr,"unsound origin\n");exit(2);}checks++;}
}
int main(void){
 const uint32_t seeds[]={0x258bad71,0xc471380f,0x605afde9,0x8ee73421};
 const uint32_t literals[]={0,1,31,32,33,63,0x80000000,0xffffffff,0x7f800000,0x7fc00001,0x80000001,0x007fffff,0x3f000000,0x007fffff,0xaaaaaaaa,0x55555555};
 for(unsigned seed=0;seed<4;seed++){rng=seeds[seed];for(unsigned trial=0;trial<TRIALS;trial++){
  struct raw_ir *ir=calloc(1,sizeof(*ir));if(!ir)return 3;struct profile p={.raw=ir};p.declared[OUT][0]=true;p.components[OUT][0]=15;
  for(unsigned i=0;i<REG;i++)for(unsigned lane=0;lane<4;lane++){ir->immediates[i][lane]=literals[next()%16];ir->temporary[i][lane].zero=0xffffffff;for(unsigned sample=0;sample<SAMPLES;sample++){input[sample][i][lane]=next();constant[sample][i][lane]=sample<8?literals[(sample+i+lane)%16]:next();temp[sample][i][lane]=0;}}
  for(unsigned step=0;step<STEPS;step++){
   struct raw_instruction instruction={.opcode=next()%6};instruction.dst=(struct reg){.file=step%7==0?OUT:TEMP,.index=step%7==0?0:next()%REG,.mask=1+next()%15};
   for(unsigned source=0;source<2;source++){enum file files[]={TEMP,CONST,IN,IMM};instruction.src[source]=(struct reg){.file=files[next()%4],.index=next()%REG};for(unsigned lane=0;lane<4;lane++)instruction.src[source].swizzle[lane]=next()%4;}
   uint32_t result[SAMPLES][4];
   for(unsigned sample=0;sample<SAMPLES;sample++)for(unsigned lane=0;lane<4;lane++)if(instruction.dst.mask&(1u<<lane)){
    uint32_t a=value(ir,&instruction.src[0],lane,sample),b=value(ir,&instruction.src[1],lane,sample),answer=0;
    switch(instruction.opcode){case RAW_MOV:answer=a;break;case RAW_AND:answer=a&b;break;case RAW_OR:answer=a|b;break;case RAW_NOT:answer=~a;break;case RAW_SHL:answer=a<<(b&31);break;case RAW_USHR:answer=a>>(b&31);break;}
    result[sample][lane]=answer;
   }
   raw_record(ir,&instruction);
   for(unsigned sample=0;sample<SAMPLES;sample++)for(unsigned lane=0;lane<4;lane++)if(instruction.dst.mask&(1u<<lane)){
    if(instruction.dst.file==TEMP){temp[sample][instruction.dst.index][lane]=result[sample][lane];verify(ir->temporary[instruction.dst.index][lane],result[sample][lane],sample);}
    else {output[sample][lane]=result[sample][lane];verify(ir->output[0][lane],result[sample][lane],sample);}
   }
   if(raw_outputs_safe(&p))for(unsigned sample=0;sample<SAMPLES;sample++)for(unsigned lane=0;lane<4;lane++)if(!ir->output[0][lane].origin){uint32_t x=output[sample][lane],exponent=x&0x7f800000,mantissa=x&0x007fffff;if(exponent==0x7f800000||(!exponent&&mantissa)){fprintf(stderr,"unsafe output admitted\n");return 4;}checks++;}
  }
  free(ir);
 }}
 printf("{\"schema\":\"independent-known-bits-v1\",\"seeds\":[\"258bad71\",\"c471380f\",\"605afde9\",\"8ee73421\"],\"trials\":128,\"instructions\":12288,\"concreteSchedulesPerTrial\":16,\"checks\":%lu,\"status\":\"passed\"}\n",checks);return 0;
}
