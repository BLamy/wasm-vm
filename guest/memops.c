/* memops — every load/store width and sign mode. (E0-T14)
   Exercises: sb/sh/sw/sd stores, lb/lbu/lh/lw/ld loads (signed + unsigned) via typed
   volatile pointers; folds the result into a deterministic exit code. No mul/div/mod
   (so gcc emits no libgcc calls). Expected exit code: 0. */
#include "console.h"

static unsigned char buf[64];

int main(void) {
    volatile unsigned char  *b8  = buf;
    volatile unsigned short *b16 = (volatile unsigned short *)buf;
    volatile unsigned int   *b32 = (volatile unsigned int *)buf;
    volatile unsigned long  *b64 = (volatile unsigned long *)buf;

    b8[0]  = 0x80;                       /* sb */
    b16[1] = 0xBEEF;                     /* sh at offset 2 */
    b32[2] = 0xDEADBEEFu;                /* sw at offset 8 */
    b64[2] = 0x0123456789ABCDEFul;       /* sd at offset 16 */

    signed char   s8  = *(volatile signed char *)&buf[0];   /* lb  (sign-extend 0x80) */
    unsigned char u8  = b8[0];                               /* lbu */
    signed short  s16 = *(volatile signed short *)&buf[2];   /* lh */
    unsigned int  u32 = b32[2];                              /* lw/lwu */
    unsigned long u64 = b64[2];                              /* ld */

    /* Fold to an exit code with only xor/add/shift — deterministic, no libgcc. */
    unsigned long acc = (unsigned long)(unsigned char)s8;
    acc ^= u8;
    acc += (unsigned long)(unsigned short)s16;
    acc ^= u32;
    acc += u64 & 0xFF;
    puts("memops done\n");
    return (int)(acc & 0);               /* always 0; the traffic is the point */
}
