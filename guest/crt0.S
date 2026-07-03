# Shared crt0 for the golden bare-metal rv64i guests (E0-T14).
# Sets the stack, zeroes .bss, calls main, then requests HTIF exit with
# (main's return value << 1) | 1 — the convention Spike and wasm-vm both honor.
.section .text.init, "ax"
.globl _start
_start:
    la      sp, __stack_top       # stack at the top of the declared RAM region

    la      t0, __bss_start       # zero .bss [__bss_start, __bss_end)
    la      t1, __bss_end
1:  bgeu    t0, t1, 2f
    sd      zero, 0(t0)
    addi    t0, t0, 8
    j       1b
2:
    call    main                  # int main(void); return value in a0

    slli    a0, a0, 1             # HTIF exit: tohost = (code << 1) | 1
    ori     a0, a0, 1
    la      t0, tohost
    sd      a0, 0(t0)
3:  j       3b                    # park until HTIF tears the machine down
