#include "bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static const char *v="VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n";
static const char *f="FRAG\nDCL OUT[0], COLOR\nDCL TEMP[0]\nIMM[0] UINT32 {1056964608, 1056964608, 1056964608, 1056964608}\nOR TEMP[0], IMM[0], IMM[0]\nMOV OUT[0], TEMP[0]\nEND\n";
int main(void){uint32_t head[2];while(fread(head,sizeof(head),1,stdin)==1){if(head[1]>16385)return 2;char *s=malloc(head[1]+1);if(!s)return 3;if(fread(s,1,head[1],stdin)!=head[1])return 4;s[head[1]]=0;puts(bridge_translate(head[0],s,head[1]));free(s);puts(bridge_translate(1,f,strlen(f)));puts(bridge_translate_pair(v,strlen(v),f,strlen(f)));}return ferror(stdin)?5:0;}
