# Golden guest builds (E0-T14). Run inside the pinned T13 toolchain:
#   tools/toolchain/run.sh -- make -C guest
# Reproducible: SOURCE_DATE_EPOCH pins any timestamp; -ffile-prefix-map strips the
# build path; the container fixes the compiler version, so rebuilds are byte-identical.

CC      := riscv64-unknown-elf-gcc
# -mcmodel=medany: PC-relative addressing so `la`/rodata work at DRAM_BASE
# (0x80000000 is exactly at the medlow boundary and can't be reached by lui).
CFLAGS  := -march=rv64i -mabi=lp64 -mcmodel=medany \
           -nostdlib -nostartfiles -ffreestanding -O2 \
           -fno-pic -fno-builtin -Wall -Wextra \
           -ffile-prefix-map=$(CURDIR)=. -frandom-seed=golden
LDFLAGS := -T link.ld -Wl,--build-id=none -Wl,--no-warn-rwx-segments

export SOURCE_DATE_EPOCH := 0

PROGS := hello loops memops
ELFS  := $(addsuffix .elf,$(PROGS))

all: $(ELFS)

# Compile to fixed-name .o FIRST, then link. Compiling + linking in one step makes gcc
# create a random temp object (ccXXXXXX.o) whose name leaks into .strtab via STT_FILE,
# breaking byte-reproducibility; explicit .o names are deterministic.
crt0.o:   crt0.S ;                 $(CC) $(CFLAGS) -c -o $@ $<
hello.o:  hello.c console.h ;      $(CC) $(CFLAGS) -c -o $@ hello.c
loops.o:  loops.S ;               $(CC) $(CFLAGS) -c -o $@ $<
memops.o: memops.c console.h ;     $(CC) $(CFLAGS) -c -o $@ memops.c

hello.elf:  crt0.o hello.o  link.ld ; $(CC) $(CFLAGS) $(LDFLAGS) -o $@ crt0.o hello.o
loops.elf:  crt0.o loops.o  link.ld ; $(CC) $(CFLAGS) $(LDFLAGS) -o $@ crt0.o loops.o
memops.elf: crt0.o memops.o link.ld ; $(CC) $(CFLAGS) $(LDFLAGS) -o $@ crt0.o memops.o

clean:
	rm -f $(ELFS) crt0.o hello.o loops.o memops.o

.PHONY: all clean
