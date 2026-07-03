/* hello — prints "Hello from RV64\n" via the UART0 stub, exits 0. (E0-T14)
   Exercises: rodata, the console MMIO store path, crt0 → main → HTIF exit. */
#include "console.h"

int main(void) {
    puts("Hello from RV64\n");
    return 0;
}
