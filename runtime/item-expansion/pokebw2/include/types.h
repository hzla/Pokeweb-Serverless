#ifndef POKEBW2_TYPES_H
#define POKEBW2_TYPES_H

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned long u32;
typedef unsigned long long u64;
typedef signed char s8;
typedef signed short s16;
typedef signed long s32;
typedef signed long long s64;

typedef volatile u8 vu8;
typedef volatile u16 vu16;
typedef volatile u32 vu32;
typedef volatile s8 vs8;
typedef volatile s16 vs16;
typedef volatile s32 vs32;

typedef float f32;
typedef double f64;

typedef int BOOL;
#define TRUE 1
#define FALSE 0

#define NULL ((void *)0)

#define NELEMS(array) (sizeof(array) / sizeof((array)[0]))

// NitroSDK's alignment attribute, as in `static u8 buffer[64] ATTRIBUTE_ALIGN(32);`
#define ATTRIBUTE_ALIGN(num) __attribute__((aligned(num)))

#endif // POKEBW2_TYPES_H
