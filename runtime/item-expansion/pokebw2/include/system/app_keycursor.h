#ifndef POKEBW2_SYSTEM_APP_KEYCURSOR_H
#define POKEBW2_SYSTEM_APP_KEYCURSOR_H

#include "types.h"
#include "gfl/bmpwin.h"
#include "gfl/heap.h"
#include "system/printsys.h"

// The cursor (app_keycursor.c) that bobs in the bottom right corner of a window while its message waits for a button.
// It erases itself with bgColor. keys and touch say whether the A and B buttons, and the touch screen, continue the
// message

KeyCursor *KeyCursor_Create(u16 bgColor, BOOL keys, BOOL touch, HeapID heapId);
// KeyCursor_Create with a cursor of 2 by 2 tiles of its own
KeyCursor *KeyCursor_CreateEx(u16 bgColor, BOOL keys, BOOL touch, HeapID heapId, const u8 *bitmap);
void KeyCursor_Free(KeyCursor *cursor);
// Erases the cursor from a window's bitmap, and draws its next frame
void KeyCursor_Erase(KeyCursor *cursor, GFLBitmap *bitmap, u16 bgColor);
void KeyCursor_Draw(KeyCursor *cursor, GFLBitmap *bitmap, u16 bgColor);
// Shows the cursor while the stream is paused (or done, after KeyCursor_ShowWhenDone), until a button is pressed
void KeyCursor_Update(KeyCursor *cursor, PrintStream *stream, BmpWin *window);
// Shows the cursor until a button is pressed, and returns whether it was
BOOL KeyCursor_UpdateWait(KeyCursor *cursor, BmpWin *window);
// Shows the cursor after the stream is done too
void KeyCursor_ShowWhenDone(KeyCursor *cursor);

#endif // POKEBW2_SYSTEM_APP_KEYCURSOR_H
