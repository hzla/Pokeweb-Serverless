#ifndef POKEBW2_STDDEF_H
#define POKEBW2_STDDEF_H

// The C library's stddef.h, as MWCC's library has it for ARM
typedef unsigned long size_t;

// MSL's wide character for the ARM platform is 16 bits
#ifndef __wchar_t_defined
#define __wchar_t_defined
typedef unsigned short wchar_t;
#endif

#define offsetof(type, member) ((size_t)&(((type *)0)->member))

#endif // POKEBW2_STDDEF_H
