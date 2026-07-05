# E0-T13 smoke test: a 4-instruction rv64i program that writes 1 to `tohost`,
# requesting HTIF exit with status 0. Assembled + run under spike by smoke.sh.
.section .text.init, "ax"
.globl _start
_start:
    li   t0, 1            # (0 << 1) | 1  → HTIF exit code 0
    la   t1, tohost
    sd   t0, 0(t1)
1:  j    1b               # park until HTIF tears the machine down

# HTIF mailbox — spike locates these by symbol name.
.section .htif, "aw", @progbits
.align 6
.globl tohost
tohost:   .dword 0
.align 6
.globl fromhost
fromhost: .dword 0
