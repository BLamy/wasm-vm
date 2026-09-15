/* E5.5-T02a browser regression. Sv39 maps adjacent virtual pages to separated
 * RAM frames; integer scalar loads/stores must assemble the virtual byte order.
 * Build with tools/riscv-tests/build-misaligned-virtual-pages.sh. */
.option norvc
.option norelax
.section .text
.global _start
_start:
    la t0, fail
    csrw mtvec, t0
    li t0, -1
    csrw pmpaddr0, t0
    li t0, 31
    csrw pmpcfg0, t0
    la t0, root
    srli t0, t0, 12
    li t1, 8
    slli t1, t1, 60
    or t0, t0, t1
    csrw satp, t0
    sfence.vma
    la t0, supervisor
    csrw mepc, t0
    li t0, 0x800
    csrw mstatus, t0
    mret
supervisor:
    li s0, 0x4ffc
    ld t0, 0(s0)
    li t1, 0x8877665544332211
    bne t0, t1, fail
    lw t0, 2(s0)
    li t1, 0x66554433
    bne t0, t1, fail
    lh t0, 3(s0)
    li t1, 0x5544
    bne t0, t1, fail
    li t0, 0xfedcba9876543210
    sd t0, 0(s0)
    la t1, first
    addi t1, t1, 2047
    addi t1, t1, 2045
    lwu t2, 0(t1)
    li t3, 0x76543210
    bne t2, t3, fail
    la t1, second
    lwu t2, 0(t1)
    li t3, 0xfedcba98
    bne t2, t3, fail
    // Halfword and word stores overlap the edge; inspect independent physical aliases.
    li t0, -1
    sh t0, 3(s0)
    la t1, first
    li t2, 4095
    add t1, t1, t2
    lbu t2, 0(t1)
    li t3, 255
    bne t2, t3, fail
    la t1, second
    lbu t2, 0(t1)
    bne t2, t3, fail
    sw t0, 3(s0)
    lw t2, 3(s0)
    bne t2, t0, fail
    lwu t2, 3(s0)
    li t3, 0xffffffff
    bne t2, t3, fail
    lh t2, 3(s0)
    bne t2, t0, fail
    lhu t2, 3(s0)
    li t3, 65535
    bne t2, t3, fail
    li t0, 1
    j finish
fail:
    li t0, 3
finish:
    la t1, tohost
    sd t0, 0(t1)
1:  j 1b

.section .data
.balign 4096
root:
    .quad ((0x80002000 >> 12) << 10) | 1
    .quad 0
    // Identity-map the RAM gigapage for code, physical aliases, and HTIF.
    .quad ((0x80000000 >> 12) << 10) | 0xcf
.balign 4096
middle:
    .quad ((0x80003000 >> 12) << 10) | 1
.balign 4096
leaf:
    .zero 32
    .quad ((0x80004000 >> 12) << 10) | 0xc7
    .quad ((0x80006000 >> 12) << 10) | 0xc7
.balign 4096
first:
    .zero 4092
    .word 0x44332211
    .zero 4096
second:
    .word 0x88776655
.balign 8
.global tohost
tohost:
    .quad 0
.global fromhost
fromhost:
    .quad 0
