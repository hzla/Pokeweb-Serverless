SECTIONS {
 . = 0;
 .text : { *(.text*) *(.rodata*) }
 . = ALIGN(4);
 .data : { *(.data*) }
 .bss : { *(.bss*) *(COMMON) }
 /DISCARD/ : { *(.comment*) *(.ARM.attributes*) *(.ARM.exidx*) }
}
