/* Shared linker script for the golden guests (E0-T14). Entry at DRAM_BASE, a small
   declared stack region, and a .tohost section whose symbols Spike locates by name. */
ENTRY(_start)
SECTIONS
{
  . = 0x80000000;

  .text.init : { *(.text.init) }
  .text      : { *(.text*) }
  .rodata    : { *(.rodata*) }
  .data      : { *(.data*) }

  . = ALIGN(8);
  __bss_start = .;
  .bss       : { *(.bss*) *(COMMON) }
  . = ALIGN(8);
  __bss_end = .;

  /* HTIF mailbox — 8-byte-aligned tohost/fromhost the runner watches. Plain
     assignments (not PROVIDE) so BOTH symbols always land in the table; our guests
     never define their own. */
  . = ALIGN(64);
  .tohost (NOLOAD) : {
    tohost = .;
    . += 8;
    fromhost = .;
    . += 8;
  }

  /* 8 KiB stack above everything; __stack_top is its high end. */
  . = ALIGN(16);
  . = . + 0x2000;
  __stack_top = .;
}
