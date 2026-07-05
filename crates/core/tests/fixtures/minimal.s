.section .text
.globl _start
_start:
    lui   a0, 0x12345
    addi  a1, zero, -1
    addw  a2, a0, a1
1:  jal   zero, 1b
.section .data
.globl tohost
tohost:   .dword 0
.globl fromhost
fromhost: .dword 0
msg:      .ascii "HELLO-ELF-FIXTURE"
.section .bss
.globl bssbuf
bssbuf:   .skip 256
