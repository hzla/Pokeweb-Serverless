#ifndef POKEBW2_SYSTEM_PRINTSYS_H
#define POKEBW2_SYSTEM_PRINTSYS_H

#include "types.h"
#include "gfl/bmpwin.h"
#include "gfl/heap.h"
#include "gfl/str.h"
#include "gfl/tcb.h"
#include "struct_decls.h"
#include "system/wordset.h"

// Printing text (printsys.c): into a bitmap at once, through a queue that spreads it over frames while the game is
// connected, or into a window a few characters a frame; and the measures of strings in a font, and the commands in
// strings. Most of these functions have no name yet

typedef struct PrintQueue PrintQueue;
typedef struct PrintStream PrintStream;

// A color of text, shadow and background color indices
#define PRINT_COLOR(text, shadow, background)                                                                          \
    ((((text) & 0x1f) << 10) | (((shadow) & 0x1f) << 5) | ((background) & 0x1f))

// Sets the string terminator, and creates the bitmap glyphs are drawn into
void GFL_TextRndInit(HeapID heapId);

// Draws a string into a bitmap at once
void GFL_TextRendererDrawToBitmap(GFLBitmap *bitmap, s16 x, s16 y, const StrBuf *strbuf, Font *font);
// Draws in a color that PRINT_COLOR makes
void GFL_TextRendererDrawToBitmapEx(GFLBitmap *bitmap, s16 x, s16 y, const StrBuf *strbuf, Font *font, u16 color);

// A queue of 0x400 bytes, or of size bytes
PrintQueue *PrintQueue_CreateDefault(HeapID heapId);
PrintQueue *PrintQueue_Create(u16 size, HeapID heapId);
void PrintQueue_Free(PrintQueue *queue);
// Whether strings go in the queue even while the game is not connected
void PrintQueue_SetQueueAlways(PrintQueue *queue, u32 queueAlways);
// How long a frame may print for, as OS_GetTick() counts
void PrintQueue_SetTimeLimit(PrintQueue *queue, u64 timeLimit);
// Prints what the queue holds until the frame's time runs out. Returns whether it is empty
BOOL PrintQueue_Main(PrintQueue *queue);
// Whether the queue has printed everything, and whether it still has text to print into a bitmap
BOOL PrintQueue_IsEmpty(PrintQueue *queue);
BOOL PrintQueue_IsBitmapPending(PrintQueue *queue, GFLBitmap *bitmap);
void PrintQueue_Clear(PrintQueue *queue);
// Prints a string into a bitmap through the queue, in its own color or in a color that PRINT_COLOR makes
void PrintQueue_Print(PrintQueue *queue, GFLBitmap *bitmap, s16 x, s16 y, const StrBuf *strbuf, Font *font);
void PrintQueue_PrintColor(PrintQueue *queue, GFLBitmap *bitmap, s16 x, s16 y, const StrBuf *strbuf, Font *font,
                           u16 color);

// A window whose text goes through a print queue, and whose characters are sent to VRAM once it is printed
typedef struct {
    BmpWin *window;
    u8 flushPending;
} PrintWindow;

static inline void PrintWindow_Init(PrintWindow *printWindow, BmpWin *window) {
    printWindow->window = window;
    printWindow->flushPending = FALSE;
}

static inline void PrintWindow_Print(PrintWindow *printWindow, PrintQueue *queue, s16 x, s16 y, const StrBuf *strbuf,
                                     Font *font, u16 color) {
    PrintQueue_PrintColor(queue, BmpWin_GetBitmap(printWindow->window), x, y, strbuf, font, color);
    printWindow->flushPending = TRUE;
}

// PrintWindow_Print in the string's own colors
static inline void PrintWindow_PrintNoColor(PrintWindow *printWindow, PrintQueue *queue, s16 x, s16 y,
                                            const StrBuf *strbuf, Font *font) {
    PrintQueue_Print(queue, BmpWin_GetBitmap(printWindow->window), x, y, strbuf, font);
    printWindow->flushPending = TRUE;
}

// Whether the window's text has been sent to VRAM
static inline BOOL PrintWindow_IsPrinted(PrintWindow *printWindow) {
    return printWindow->flushPending ? FALSE : TRUE;
}

static inline void PrintWindow_Flush(PrintWindow *printWindow, PrintQueue *queue) {
    if (printWindow->flushPending && !PrintQueue_IsBitmapPending(queue, BmpWin_GetBitmap(printWindow->window))) {
        BmpWin_FlushChar(printWindow->window);
        printWindow->flushPending = FALSE;
    }
}

// PrintStream_GetState's states
#define PRINT_STREAM_RUNNING 0
#define PRINT_STREAM_PAUSED 1
#define PRINT_STREAM_DONE 2

// Prints a string into a window a character at a time
PrintStream *PrintStream_Create(BmpWin *window, s16 x, s16 y, const StrBuf *strbuf, Font *font, s32 wait,
                                TCBExManager *tcbManager, u32 a7, HeapID heapId, u16 a9);
// PrintStream_Create with a callback, which the stream calls with events such as the 3 and 5 of the evolution demo's
// messages, and which returns whether to wait
typedef BOOL (*PrintStreamCallback)(u32 event);
PrintStream *PrintStream_CreateWithCallback(BmpWin *window, s16 x, s16 y, const StrBuf *strbuf, Font *font, s32 wait,
                                            TCBExManager *tcbManager, u32 a7, HeapID heapId, u16 a9,
                                            PrintStreamCallback callback);
void PrintStream_Pause(PrintStream *stream);
void PrintStream_Resume(PrintStream *stream);
u32 PrintStream_GetState(PrintStream *stream);
// Whether the page scrolls or clears at the next page break
u32 PrintStream_GetPageMode(PrintStream *stream);
// Continues printing after PRINT_STREAM_PAUSED
void PrintStream_Continue(PrintStream *stream);
void PrintStream_Delete(PrintStream *stream);
// Cuts the wait short, and prints at the fast speed from then on
void PrintStream_SkipWait(PrintStream *stream, s32 waitTimer);
// Prints at the speed of a wait, or at the stream's own speed again
void PrintStream_SetFastWait(PrintStream *stream, s32 wait);
void PrintStream_ClearFast(PrintStream *stream);
BOOL PrintStream_IsFast(PrintStream *stream);

// The width of the line str starts, and where the next line starts
u32 GFL_FontGetLineWidth(const u16 *str, Font *font, u32 spacing, const u16 **end);
u32 GFL_FontGetLineCount(const StrBuf *strbuf);
// The width in pixels of a string's widest line
u32 GFL_FontGetBlockWidth(const StrBuf *strbuf, Font *font, u16 spacing);
// The width of each line, up to maxLines. Returns the count of lines
u32 GFL_FontGetLineWidths(const StrBuf *strbuf, Font *font, u32 spacing, u32 *widths, u32 maxLines);
// Copies a line of the string, with its commands. Returns whether it has the line
BOOL GFL_FontCopyLine(const StrBuf *strbuf, StrBuf *dest, u32 line);
u32 GFL_FontGetBlockHeight(const StrBuf *strbuf, Font *font);

// The commands in strings
u16 GFL_StrCmdGetWordSetCommandCount(const StrBuf *strbuf);
u8 GFL_StrCmdCountLinesUntilWordSetIndex(const StrBuf *strbuf, u8 index);
u8 GFL_StrCmdGetStrWidthUntilWordSetIndex(const StrBuf *strbuf, u8 index, Font *font, u32 spacing);
u16 GFL_StrCmdGetIdentChar(void);
BOOL GFL_StrCmdIsWordSet(const u16 *cmd);
u32 GFL_StrCmdGetCommandCategory(const u16 *cmd);
void GFL_StrCmdBuild(StrBuf *strbuf, u32 category, u16 index, u8 paramCount, const u16 *params);
u32 GFL_StrCmdGetCommandIndex(const u16 *cmd);
u16 GFL_WordSetGetCommandParameter(const u16 *cmd, u32 index);
const u16 *GFL_StrCmdSkipCommand(const u16 *cmd);

#endif // POKEBW2_SYSTEM_PRINTSYS_H
