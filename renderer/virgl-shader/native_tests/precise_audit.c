/* SPDX-License-Identifier: MIT
 * Interrogate the pinned upstream text parser's actual per-instruction bit. */
#include "tgsi/tgsi_text.h"
#include "tgsi/tgsi_parse.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static void require(int value,const char *message) { if(!value) { fprintf(stderr,"PRECISE token audit: %s\n",message);exit(1); } }
int main(void) {
 const unsigned expected[]={TGSI_OPCODE_MOV,TGSI_OPCODE_FSEQ,TGSI_OPCODE_FSNE,TGSI_OPCODE_MAX,
  TGSI_OPCODE_MOV,TGSI_OPCODE_FSEQ,TGSI_OPCODE_FSNE,TGSI_OPCODE_MAX,TGSI_OPCODE_END};
 for(unsigned stage=0;stage<2;stage++) {
  char text[1024];snprintf(text,sizeof(text),"%s\nDCL TEMP[0..3]\nIMM[0] FLT32 {0,1,0.5,2}\nMOV_PRECISE TEMP[0], IMM[0]\nFSEQ_PRECISE TEMP[1], IMM[0], IMM[0]\nFSNE_PRECISE TEMP[2], IMM[0], IMM[0]\nMAX_PRECISE TEMP[3], IMM[0], IMM[0]\nMOV TEMP[0], IMM[0]\nFSEQ TEMP[1], IMM[0], IMM[0]\nFSNE TEMP[2], IMM[0], IMM[0]\nMAX TEMP[3], IMM[0], IMM[0]\nEND\n",stage?"FRAG":"VERT");
  struct tgsi_token tokens[8192];memset(tokens,0,sizeof(tokens));
  require(tgsi_text_translate(text,tokens,8192),"actual pinned suffix parsing");
  struct tgsi_parse_context context;require(tgsi_parse_init(&context,tokens)==TGSI_PARSE_OK,"actual token parser");unsigned count=0;
  printf("{\"stage\":\"%s\",\"instructions\":[",stage?"fragment":"vertex");
  while(!tgsi_parse_end_of_tokens(&context)) {
   tgsi_parse_token(&context);
   if(context.FullToken.Token.Type!=TGSI_TOKEN_TYPE_INSTRUCTION)continue;
   struct tgsi_instruction instruction=context.FullToken.FullInstruction.Instruction;
   require(count<9 && instruction.Opcode==expected[count],"preserved opcode order");
   require(instruction.Precise==(count<4),"instruction-local flag has no backward propagation");
   printf("%s{\"opcode\":%u,\"precise\":%s}",count?",":"",instruction.Opcode,instruction.Precise?"true":"false");count++;
  }
  require(count==9,"all instructions examined");tgsi_parse_free(&context);puts("]}");
 }
 return 0;
}
