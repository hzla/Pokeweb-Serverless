#ifndef POKEBW2_STDARG_H
#define POKEBW2_STDARG_H

// Variable arguments as MWCC's library has them for ARM: every argument takes a multiple of 4 bytes on the stack
typedef char *va_list;

#define __va_align(size) ((((unsigned long)(size)) + 3) & ~3)
#define va_start(ap, parm) ((ap) = (va_list)(((unsigned long)&(parm) & ~3) + __va_align(sizeof(parm))))
#define va_arg(ap, type) (*(type *)(((ap) += __va_align(sizeof(type))) - __va_align(sizeof(type))))
#define va_end(ap) ((void)0)

#endif // POKEBW2_STDARG_H
