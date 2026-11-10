#ifndef POKEBW2_SYSTEM_BGWINFRM_H
#define POKEBW2_SYSTEM_BGWINFRM_H

#include "types.h"
#include "gfl/bmpwin.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// bgwinfrm.c: frames of BG screen data that are put on a BG, cleared and slid across it. Names are ours

// How the frames' changes reach the BG's screen: not at all, at once, or at the next VBlank
#define BGWINFRAME_TRANSFER_NONE 0
#define BGWINFRAME_TRANSFER_NOW 1
#define BGWINFRAME_TRANSFER_VBLANK 2

BGWinFrame *BGWinFrame_Create(u32 transferMode, u32 count, HeapID heapId);
void BGWinFrame_Delete(BGWinFrame *frames);
// Sets a frame up for a BG, with a screen of width by height tiles
void BGWinFrame_InitFrame(BGWinFrame *frames, u32 index, u32 bg, u32 width, u32 height);
// Sets a frame's screen data from a buffer, or from an NSCR file
void BGWinFrame_SetScreen(BGWinFrame *frames, u32 index, u16 *screen);
void BGWinFrame_LoadScreen(BGWinFrame *frames, u32 index, u32 arcId, u32 fileId, BOOL compressed);
void BGWinFrame_LoadScreenArc(BGWinFrame *frames, u32 index, ArcTool *arc, u32 fileId, BOOL compressed);
// Puts a frame on its BG at a position, in tiles, cut to its area; or again where it is
void BGWinFrame_Put(BGWinFrame *frames, u32 index, s8 x, s8 y);
void BGWinFrame_Show(BGWinFrame *frames, u32 index);
// Clears the part of the BG that a frame covers
void BGWinFrame_Hide(BGWinFrame *frames, u32 index);
// Moves a frame by a step count times, one step each time BGWinFrame_UpdateMoves runs
void BGWinFrame_StartMove(BGWinFrame *frames, u32 index, s8 moveX, s8 moveY, u8 count);
// Moves the frames, every frame
void BGWinFrame_UpdateMoves(BGWinFrame *frames);
// Moves a frame a step; FALSE once it has arrived
BOOL BGWinFrame_MoveStep(BGWinFrame *frames, u32 index);
// Whether a frame is still moving
BOOL BGWinFrame_IsMoving(BGWinFrame *frames, u32 index);
// Sets the palette of an area of a frame's screen data
void BGWinFrame_SetPalette(BGWinFrame *frames, u32 index, u8 x, u8 y, u8 width, u8 height, u8 palette);
// Writes a window's tiles into a frame's screen data, at the window's position
void BGWinFrame_WriteBmpWin(BGWinFrame *frames, u32 index, BmpWin *window);
u16 *BGWinFrame_GetScreen(BGWinFrame *frames, u32 index);
// The BG a frame is on
u8 BGWinFrame_GetBG(BGWinFrame *frames, u32 index);
// A frame's position and size, in tiles; any pointer may be NULL
void BGWinFrame_GetPos(BGWinFrame *frames, u32 index, s8 *x, s8 *y);
void BGWinFrame_GetSize(BGWinFrame *frames, u32 index, u16 *width, u16 *height);
// Sets the area of the BG that a frame shows in, in tiles; the default is the whole screen
void BGWinFrame_SetArea(BGWinFrame *frames, u32 index, s8 left, s8 right, s8 top, s8 bottom);

#endif // POKEBW2_SYSTEM_BGWINFRM_H
