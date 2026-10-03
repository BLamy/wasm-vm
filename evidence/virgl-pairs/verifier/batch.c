#include "bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
static int word(uint32_t *v){unsigned char b[4];size_t n=fread(b,1,4,stdin);if(!n)return 0;if(n!=4)exit(2);*v=(uint32_t)b[0]|((uint32_t)b[1]<<8)|((uint32_t)b[2]<<16)|((uint32_t)b[3]<<24);return 1;}
int main(void){uint32_t mode,n,m;char a[65537],b[65537];while(word(&mode)){if(!word(&n)||!word(&m)||n>65536||m>65536||fread(a,1,n,stdin)!=n||fread(b,1,m,stdin)!=m)return 2;a[n]=b[m]=0;const char *s=mode<2?bridge_translate((int)mode,a,n):mode==2?bridge_translate_pair(a,n,b,m):mode==3?bridge_translate_pair(NULL,0,b,m):mode==4?bridge_translate_pair(a,n,NULL,0):mode==5?bridge_translate_pair(a,SIZE_MAX,b,m):bridge_translate_pair(a,n,b,SIZE_MAX);if(!s)return 3;puts(s);}return ferror(stdin)?4:0;}
