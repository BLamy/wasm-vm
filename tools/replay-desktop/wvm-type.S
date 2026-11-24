# wvm-type TTY TEXT — E5-T34b proof helper. Push the bytes of TEXT into TTY's input
# queue with TIOCSTI, exactly as if it had been typed on that terminal. Root-only (mode 0700):
# the kernel allows TIOCSTI on a non-controlling tty only with CAP_SYS_ADMIN, and the wasm-vm
# kernel keeps CONFIG_LEGACY_TIOCSTI=y. Used by the native proof to type command text into the
# foot terminal: the native CLI's only host keyboard path is the fixed KEY_A proof hook
# (--keyboard-proof), which the proof uses separately. Exit 0 on success, 1 on any error.
	.text
	.globl _start
_start:
	ld	t0, 0(sp)		# argc
	li	t1, 3
	bne	t0, t1, fail
	li	a0, -100		# AT_FDCWD
	ld	a1, 16(sp)		# argv[1]
	li	a2, 0x102		# O_RDWR | O_NOCTTY
	li	a3, 0
	li	a7, 56			# openat
	ecall
	bltz	a0, fail
	mv	s0, a0
	ld	s1, 24(sp)		# argv[2]
1:	lbu	t0, 0(s1)
	beqz	t0, 2f
	mv	a0, s0
	li	a1, 0x5412		# TIOCSTI
	mv	a2, s1
	li	a7, 29			# ioctl
	ecall
	bnez	a0, fail
	addi	s1, s1, 1
	j	1b
2:	li	a0, 0
	li	a7, 93			# exit
	ecall
fail:	li	a0, 1
	li	a7, 93
	ecall
