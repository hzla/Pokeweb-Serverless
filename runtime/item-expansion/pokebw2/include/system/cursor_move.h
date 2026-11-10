#ifndef POKEBW2_SYSTEM_CURSOR_MOVE_H
#define POKEBW2_SYSTEM_CURSOR_MOVE_H

#include "types.h"
#include "gfl/heap.h"
#include "gfl/touchpanel.h"
#include "struct_decls.h"

// A cursor that moves between the positions of a table with the keys or the touch screen (cursor_move.c). The names
// are ours

// The directions of the links between positions
#define CURSOR_MOVE_UP 0
#define CURSOR_MOVE_DOWN 1
#define CURSOR_MOVE_LEFT 2
#define CURSOR_MOVE_RIGHT 3

// A link with this bit goes back to the position the cursor came from, if it came along the opposite link
#define CURSOR_MOVE_LINK_RETURN 0x80
#define CURSOR_MOVE_LINK_POS 0x7f
#define CURSOR_MOVE_NO_LINK 0xff

// What the update functions return, besides the position chosen with A or by touch
#define CURSOR_MOVE_NONE (-1)
#define CURSOR_MOVE_CANCEL (-2)
#define CURSOR_MOVE_MOVED (-3)
#define CURSOR_MOVE_CURSOR_ON (-4)
// A key pushed against the edge: right, left, down and up
#define CURSOR_MOVE_EDGE_RIGHT (-5)
#define CURSOR_MOVE_EDGE_LEFT (-6)
#define CURSOR_MOVE_EDGE_DOWN (-7)
#define CURSOR_MOVE_EDGE_UP (-8)

// A position of the cursor. A table of them ends with rect.top TOUCH_RECT_END
typedef struct {
    u8 x;
    u8 y;
    u8 width;
    u8 height;
    // The positions up, down, left and right of this one, with CURSOR_MOVE_LINK_RETURN
    u8 up;
    u8 down;
    u8 left;
    u8 right;
    TouchRect rect;
} CursorMoveData;

// Called with the caller's work, the cursor's position and its previous position (or -1)
typedef void (*CursorMoveCallback)(void *work, int pos, int prevPos);

typedef struct {
    CursorMoveCallback cursorOn;
    CursorMoveCallback cursorOff;
    CursorMoveCallback move;
    CursorMoveCallback touch;
} CursorMoveCallbacks;

CursorMove *CursorMove_Create(const CursorMoveData *data, const CursorMoveCallbacks *callbacks, void *work,
                              BOOL cursorVisible, u8 pos, HeapID heapId);
void CursorMove_Delete(CursorMove *cursor);
// The first key press after a touch only shows the cursor again
void CursorMove_SetHideOnTouch(CursorMove *cursor);
// While the cursor is hidden, B only shows it, rather than also cancelling
void CursorMove_SetBOnlyShowsCursor(CursorMove *cursor);
// Runs a frame: returns the position chosen, or a CURSOR_MOVE_* code. The first moves on presses, the second on
// repeats too
int CursorMove_UpdatePressed(CursorMove *cursor);
u32 CursorMove_Update(CursorMove *cursor);
u8 CursorMove_GetPos(CursorMove *cursor);
void CursorMove_SetPos(CursorMove *cursor, u8 pos);
BOOL CursorMove_IsCursorVisible(CursorMove *cursor);
void CursorMove_SetCursorVisible(CursorMove *cursor, BOOL visible);
// Disabled positions are skipped and can't be touched
void CursorMove_DisablePos(CursorMove *cursor, u32 pos);
void CursorMove_EnablePos(CursorMove *cursor, u32 pos);
const CursorMoveData *CursorMove_GetData(CursorMove *cursor, u32 pos);

#endif // POKEBW2_SYSTEM_CURSOR_MOVE_H
