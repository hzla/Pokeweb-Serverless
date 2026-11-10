#ifndef POKEBW2_NITRO_MATH_H
#define POKEBW2_NITRO_MATH_H

#include "types.h"

#define MATH_ABS(a) (((a) < 0) ? -(a) : (a))
#define MATH_CLAMP(x, low, high) (((x) > (high)) ? (high) : (((x) < (low)) ? (low) : (x)))
#define MATH_MAX(a, b) (((a) >= (b)) ? (a) : (b))
#define MATH_MIN(a, b) (((a) <= (b)) ? (a) : (b))
// NitroSDK's rounding up and down to a multiple of base, and to a multiple of 32
#define MATH_ROUNDUP(x, base) (((x) + ((base) - 1)) & ~((base) - 1))
#define MATH_ROUNDDOWN(x, base) ((x) & ~((base) - 1))
#define MATH_ROUNDUP32(x) MATH_ROUNDUP(x, 32)
#define MATH_ROUNDDOWN32(x) MATH_ROUNDDOWN(x, 32)

// NitroSDK's linear congruential random numbers, which are inline in the SDK

typedef struct {
    u64 x;
    u64 mul;
    u64 add;
} MATHRandContext32;

static inline void MATH_InitRand32(MATHRandContext32 *context, u64 seed) {
    context->x = seed;
    context->mul = (1566083941LL << 32) + 1812433253LL;
    context->add = 2531011;
}

// A random number below max, or any 32-bit number when max is 0
static inline u32 MATH_Rand32(MATHRandContext32 *context, u32 max) {
    context->x = context->mul * context->x + context->add;
    if (max == 0) {
        return (u32)(context->x >> 32);
    } else {
        return (u32)(((context->x >> 32) * max) >> 32);
    }
}

// CRC-16/CCITT through a table, and SHA-1
typedef struct {
    u16 table[256];
} MATHCRC16Table;

// Added for math_crc.c: the CRC-8 and CRC-32 tables
typedef struct {
    u8 table[256];
} MATHCRC8Table;

typedef struct {
    u32 table[256];
} MATHCRC32Table;

// The state of an MD5 or SHA-1 digest: the chaining words, the block being filled and the count of what was fed in
typedef struct {
    u32 state[4];
    u64 length; // in bytes
    union {
        u8 bytes[64];
        u32 words[16];
    } block;
} MATHMD5Context;

typedef struct {
    u32 state[5];
    union {
        u8 bytes[64];
        u32 words[16];
    } block;
    u32 blockPos;   // bytes of block filled
    u32 blockCount; // 64-byte blocks processed, as a 64-bit count in two words
    u32 blockCountHigh;
} MATHSHA1Context;

// What MATH_CalcHMACSHA1's generic HMAC needs to know about a hash: the sizes of its digest and block, a context and a
// buffer for a digest, and its three calls
typedef struct {
    u32 digestSize;
    u32 blockSize;
    void *context;
    void *digest;
    void (*init)(void *context);
    void (*update)(void *context, const void *data, u32 size);
    void (*getHash)(void *context, void *digest);
} MATHHashInfo;

#define MATH_SHA1_DIGEST_SIZE 20

// libmath, in link order. The names are NitroSDK's, as pret's pokediamond and pmd-sky use them; functions with no SDK
// name in pret have descriptive ones.

// math_pop.c. Swan: countLeadingZeros, countOneBits
// The number of leading zero bits, which MATH_CountLeadingZeros calls from Thumb code, where CLZ doesn't exist
u32 MATH_CountLeadingZerosFunc(u32 x);
// The number of set bits
u8 MATH_CountPopulation(u32 x);

#ifdef __thumb
static inline u32 MATH_CountLeadingZeros(u32 x) {
    return MATH_CountLeadingZerosFunc(x);
}
#else
// ARM code has the CLZ instruction, which the SDK's inline puts in place: assembly a library inlines at its call sites
// (libVCT's vct_flush_send_buffer is one), so a static inline with an asm block, as lib/ allows. MWCC defines __thumb
// only for Thumb code
static inline u32 MATH_CountLeadingZeros(u32 x) {
    asm {
        clz x, x
    }
    return x;
}
#endif

// math_md5.c (MD5) and math_sha1.c (SHA-1 and HMAC-SHA1); the ROM's data order says they are two files, not one
void MATH_MD5Init(MATHMD5Context *context);
void MATH_MD5Update(MATHMD5Context *context, const void *data, u32 size);
void MATH_MD5GetHash(MATHMD5Context *context, void *digest);
void MATH_SHA1Init(MATHSHA1Context *context);
void MATH_SHA1Update(MATHSHA1Context *context, const void *data, u32 size);
void MATH_SHA1GetHash(MATHSHA1Context *context, void *digest);
// The SHA-1 digest of size bytes, through the three above
void MATH_CalcSHA1(void *digest, const void *data, u32 size);
// HMAC-SHA1 of dataSize bytes under a key; the 20-byte digest is written to digest
void MATH_CalcHMACSHA1(void *digest, const void *data, u32 dataSize, const void *key, u32 keySize);
// Chooses whether SHA-1 clears words 6 and 14 of each block, and returns the choice before. The overlays' digest check
// (fs_overlay.c) clears them
u32 sha1_set_masked(u32 masked);

// math_crc.c. Swan: MATH_CRC16CCITTInitTable (MATHi_CRC16InitTable)
void MATHi_CRC8InitTable(MATHCRC8Table *table, u8 poly);
void MATHi_CRC16InitTable(MATHCRC16Table *table, u16 poly);
void MATHi_CRC16InitTableRev(MATHCRC16Table *table, u16 poly);
void MATHi_CRC16UpdateRev(const MATHCRC16Table *table, u16 *crc, const void *data, u32 size);
void MATHi_CRC32InitTableRev(MATHCRC32Table *table, u32 poly);
u8 MATH_CalcCRC8(const MATHCRC8Table *table, const void *data, u32 size);
u16 MATH_CalcCRC16(const MATHCRC16Table *table, const void *data, u32 size);
u16 MATH_CalcCRC16CCITT(const MATHCRC16Table *table, const void *data, u32 size);
u32 MATH_CalcCRC32(const MATHCRC32Table *table, const void *data, u32 size);

// math.c
// Quicksort of num elements of width bytes; stackBuffer may be NULL
typedef s32 (*MATHCompareFunc)(void *a, void *b);
void MATH_QSort(void *head, u32 num, u32 width, MATHCompareFunc comp, void *stackBuffer);

// sha1_block.c
// The SHA-1 compression of the context's block into its state, in ARM
void sha1_block(MATHSHA1Context *context);
// The 16 bytes of SHA-1 round constants in front of sha1_block; data, not code, and never called
void sha1_block_constants(void);

#endif // POKEBW2_NITRO_MATH_H
