/* UART0-stub console access for the golden guests (E0-T14). A volatile byte store to
   the THR at 0x1000_0000 emits one byte (see crates/core/src/dev/console.rs). */
#ifndef GUEST_CONSOLE_H
#define GUEST_CONSOLE_H

#define UART0_THR ((volatile unsigned char *)0x10000000UL)

static inline void putc(char c) { *UART0_THR = (unsigned char)c; }

static inline void puts(const char *s) {
    while (*s) putc(*s++);
}

#endif
