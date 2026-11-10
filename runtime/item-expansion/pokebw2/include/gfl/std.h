#ifndef POKEBW2_GFL_STD_H
#define POKEBW2_GFL_STD_H

#include "types.h"
#include "gfl/heap.h"
#include "nitro/math.h"
#include "nitro/mi.h"
#include "nitro/std.h"

// NitroSDK's memory functions are in nitro/mi.h, and its string functions in nitro/std.h

// Game Freak's standard library (gf_standard.c): its tables are allocated once, from a heap
void initTableArea(HeapID heapId);
// Compares size bytes, returning the difference of the first that differ
s32 GFL_STD_MemCmp(const void *a, const void *b, u32 size);
u32 GFL_STD_StrLen(const char *str);
// Compares two strings with STD_CompareString, whatever swan's name says
int _STD_CompareNString(const char *a, const char *b);
// Seeds the Mersenne Twister of GFL_RandomMT
void GFL_RandomUpdateMT(u32 seed);
// CRC-16/CCITT of data, which a size below 2 takes as its first byte twice
u16 getCRC16(const void *data, u32 size);
// Seeds a linear congruential generator from the SHA-1 of low entropy data
void buildSeed(MATHRandContext32 *context);
u32 addUpDataStream(const u8 *data, u32 size);
// Encrypts or decrypts data by XOR with a stream from a linear congruential generator, two bytes at a time
void decryptData(void *data, u32 size, u32 seed);
void _decryptData(void *data, u32 size, u32 seed);
// Steps the generator of decryptData and returns its next value
u16 crypt_SAV_BVideo_MG_misc_data(u32 *seed);

// Assertions (assert.c), and printing their messages (debug_print.c), names the ROM does not embed. A failed one calls
// the fail callback; debug builds show the message on the main screen through the handlers, which this build stores
// without calling
typedef void (*AssertInitFunc)(void);
typedef void (*AssertPrintFunc)(const char *message);
typedef void (*AssertFinishFunc)(void);
typedef void (*AssertFailCallback)(void);

void GFL_DebugSetAssertHandlers(AssertInitFunc init, AssertPrintFunc print, AssertFinishFunc finish);
void GFL_DebugSetAssertFailCallback(AssertFailCallback callback);
// Handlers that print to BG 0 of the main engine and stop the game
void GFL_DebugPrintCreateSurface(void);
void GFL_DebugPrintOutputMessage(const char *message);
void GFL_DebugPrintCommit(void);
void GFL_DebugSetVerboseAssertHandlers(void);

// A failed assertion. The game's are built without the file and line, and keep the expression, or a printf-style
// message
void GFL_DebugAssertFail(const char *file, u32 line, const char *expression);
void GFL_DebugAssertFailEx(const char *file, u32 line, const char *format, ...);
#define GFL_ASSERT(expression)                                                                                         \
    do {                                                                                                               \
        if (!(expression)) {                                                                                           \
            GFL_DebugAssertFail("", 0, #expression);                                                                   \
        }                                                                                                              \
    } while (0)
// A failed assertion with file metadata supplied by its caller.
#define GFL_ASSERT_WITH_FILE(file, expression)                                                                         \
    do {                                                                                                               \
        if (!(expression)) {                                                                                           \
            GFL_DebugAssertFail(file, 0, #expression);                                                                 \
        }                                                                                                              \
    } while (0)

#define GFL_ASSERT_MSG(expression, ...)                                                                                \
    do {                                                                                                               \
        if (!(expression)) {                                                                                           \
            GFL_DebugAssertFailEx("", 0, __VA_ARGS__);                                                                 \
        }                                                                                                              \
    } while (0)

#endif // POKEBW2_GFL_STD_H
