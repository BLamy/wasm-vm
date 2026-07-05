/* E0-T13 smoke linker script: bare-metal rv64 at DRAM_BASE (0x80000000), matching
   Spike/QEMU virt defaults so the same layout is diffable later (E0-T20). */
ENTRY(_start)
SECTIONS
{
  . = 0x80000000;
  .text.init : { *(.text.init) }
  .text      : { *(.text*) }
  . = ALIGN(0x1000);
  .htif      : { *(.htif) }
  .data      : { *(.data*) }
  .bss       : { *(.bss*) *(COMMON) }
}
