ENTRY(_start)
SECTIONS {
  . = 0x80200000;
  .text : { *(.text.start) *(.text*) }
  .rodata : { *(.rodata*) }
  .data : { *(.data*) *(.sdata*) }
  . = ALIGN(4096);
  .bss : { *(.bss*) *(.sbss*) *(COMMON) }
}
