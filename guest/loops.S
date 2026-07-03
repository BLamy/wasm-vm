# loops — deterministic arithmetic with a fixed retired-instruction count. (E0-T14)
# Sums 1..10 (= 55) in a counted loop, then returns exit code 0. Pure RV64I, no
# memory traffic, no libgcc. Its retired count is the golden metric for E0-T24.
.section .text
.globl main
main:
    li      a0, 0            # accumulator
    li      t0, 1            # i = 1
    li      t1, 11           # limit (exclusive)
1:  add     a0, a0, t0       # acc += i
    addi    t0, t0, 1        # i++
    blt     t0, t1, 1b       # while i < 11
    li      a0, 0            # exit code 0 (the sum 55 was the work, not the result)
    ret
