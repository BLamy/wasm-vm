.section .text.start,"ax"
.globl _start
_start:
  li sp, 0x81000000
  csrwi sie, 0
  csrci sstatus, 2
  call main
1: j 1b
