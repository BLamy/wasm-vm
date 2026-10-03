#include "bridge.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
static int word(uint32_t *v) { unsigned char b[4]; size_t n=fread(b,1,4,stdin); if(!n)return 0;if(n!=4)exit(2);*v=(uint32_t)b[0]|((uint32_t)b[1]<<8)|((uint32_t)b[2]<<16)|((uint32_t)b[3]<<24);return 1; }
int main(void) { uint32_t stage,n; char text[65537]; while(word(&stage)){if(!word(&n)||n>65536||fread(text,1,n,stdin)!=n)return 2;text[n]=0;const char *s=bridge_translate((int)stage,text,n);if(!s)return 3;puts(s);}return ferror(stdin)?4:0; }
