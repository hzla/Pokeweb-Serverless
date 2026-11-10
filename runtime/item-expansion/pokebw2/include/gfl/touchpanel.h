#ifndef POKEBW2_GFL_TOUCHPANEL_H
#define POKEBW2_GFL_TOUCHPANEL_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// The touch panel (touchpanel.c)

// A rectangle of the touch screen, in pixels. A table of them ends with top TOUCH_RECT_END
typedef struct {
    u8 top;
    u8 bottom;
    u8 left;
    u8 right;
} TouchRect;

#define TOUCH_RECT_END 0xff
// Rectangles whose top is one of these are circles, or are skipped
#define TOUCH_RECT_CIRCLE 0xfe
#define TOUCH_RECT_SKIP 0xfd
#define TOUCH_RECT_NONE (-1)

TouchpadManager *initTouchpad(HeapID heapId);
// Return the rectangle being touched, or that was touched this frame, or TOUCH_RECT_NONE
s32 GFL_HIDGetTouchHeldRect(const TouchRect *rects);
s32 GFL_HIDGetTouchPressedRect(const TouchRect *rects);
// Reads the touch panel; called every frame
void touchpadData(void);
// Whether it is touched, and whether it was touched this frame
BOOL GFL_HIDIsTouchHeld(void);
BOOL GFL_HIDIsTouchPressed(void);
// Whether a point is held, and whether it was pressed this frame, and where
BOOL GFL_HIDGetTouchHeldPoint(u32 *x, u32 *y);
BOOL GFL_HIDGetTouchPressedPoint(u32 *x, u32 *y);
// The rectangle at a point, or TOUCH_RECT_NONE
s32 GFL_HIDGetTouchRectAt(const TouchRect *rects, u32 x, u32 y);
// Stop and restart sampling around sleep
void GFL_HIDStopTouchSampling(void);
void GFL_HIDRestartTouchSampling(void);
void GFL_HIDClearTouchState(SystemUI *ui);
// Set the touch input of a frame
void GFL_HIDSetTouchPos(SystemUI *ui, u16 x, u16 y, u16 x30, u16 y30);
void GFL_HIDSetTouchPressed(SystemUI *ui, u16 pressed, u16 pressed30);
void GFL_HIDSetTouchHeld(SystemUI *ui, u16 held, u16 held30);

#endif // POKEBW2_GFL_TOUCHPANEL_H
