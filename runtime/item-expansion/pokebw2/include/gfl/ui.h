#ifndef POKEBW2_GFL_UI_H
#define POKEBW2_GFL_UI_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// The system's input, the lid, sleep, the backlight and the battery (ui.c). The GCTX_ functions act on the one
// instance, which owns the keypad and touch panel managers

// Called on a soft reset, before the game restarts
typedef void (*SoftResetCallback)(void *work);
typedef void (*UICallback)(void *work);
// Returns TRUE to keep the system from sleeping when the lid closes
typedef BOOL (*UISleepCheckCallback)(void *work);

// The input of a frame, as the keypad and touch panel managers keep it
struct HIDInputState {
    u16 pressed;
    u16 held;
    u16 typed;
    u16 touchX;
    u16 touchY;
    u8 touchPressed;
    u8 touchHeld;
};

// Replaces the input of a frame, at 60 and at 30 frames per second, returning TRUE if it did
typedef BOOL (*HIDInputHook)(HIDInputState *state, HIDInputState *state30);

struct SystemUI {
    KeypadManager *keypad;
    TouchpadManager *touchpad;
    SoftResetCallback softResetCallback;
    void *softResetWork;
    UICallback wakeCallback;
    UICallback sleepCallback;
    UICallback lidOpenCallback;
    UICallback lidCloseCallback;
    UICallback lowBatteryCallback;
    UISleepCheckCallback sleepCheckCallback;
    void *sleepWork;
    void *lidWork;
    void *lowBatteryWork;
    void *sleepCheckWork;
    // Sleep and the soft reset are blocked while any flag is set
    u8 sleepBlock;
    u8 softResetBlock;
    u8 unk3A;
    u8 backlight;
    u8 usingTouch;
    // 60, or 30 to report the input of two frames together
    u8 updateRate;
    u8 frameCount;
    // 0 to 5
    u8 batteryLevel;
    u8 mode;
    u8 lidCloseCalled;
    u8 unk42;
    // Whether the lid is closed while sleep is blocked, with the backlight off
    u8 lidClosed;
};

void GFL_HIDInit(HeapID heapId, u32 mode);
void GFL_HIDUpdate(SystemUI *ui);
void GCTX_HIDUpdate(void);
void GFL_HIDBlockSleep(SystemUI *ui, u8 flags);
void GCTX_HIDBlockSleep(u8 flags);
void GFL_HIDUnblockSleep(SystemUI *ui, u8 flags);
void GCTX_HIDUnblockSleep(u8 flags);
BOOL GFL_HIDIsSleepBlocked(SystemUI *ui, u8 flags);
BOOL GCTX_HIDIsSleepBlocked(u8 flags);
// Called before sleeping and after waking
void GFL_HIDSetSleepCallback(SystemUI *ui, UICallback callback, void *work);
void GCTX_HIDSetSleepCallback(UICallback callback, void *work);
void GFL_HIDSetWakeCallback(SystemUI *ui, UICallback callback, void *work);
void GCTX_HIDSetWakeCallback(UICallback callback, void *work);
void GCTX_HIDSetSleepCheckCallback(UISleepCheckCallback callback, void *work);
// Called when the lid closes and opens while sleep is blocked
void GFL_HIDSetLidCloseCallback(SystemUI *ui, UICallback callback, void *work);
void GCTX_HIDSetLidCallbacks(UICallback close, UICallback open, void *work);
UICallback GFL_HIDGetLidCloseCallback(SystemUI *ui);
UICallback GCTX_HIDGetLidCloseCallback(void);
void GFL_HIDSetLidOpenCallback(SystemUI *ui, UICallback callback, void *work);
// Called after waking when the battery is low
void SetUICallback(SystemUI *ui, UICallback callback, void *work);
void SetUICallbackStatic(UICallback callback, void *work);
void GFL_HIDBlockSoftReset(SystemUI *ui, u8 flags);
void GCTX_HIDBlockSoftReset(u8 flags);
void GFL_HIDUnblockSoftReset(SystemUI *ui, u8 flags);
void GCTX_HIDUnblockSoftReset(u8 flags);
BOOL GFL_HIDIsSoftResetBlocked(SystemUI *ui, u8 flags);
BOOL GCTX_HIDIsSoftResetBlocked(u8 flags);
void GFL_HIDSetSoftResetCallback(SystemUI *ui, SoftResetCallback callback, void *work);
void GCTX_HIDSetSoftResetCallback(SoftResetCallback callback, void *work);
KeypadManager *GFL_HIDGetKeypadManager(SystemUI *ui);
SystemUI *GCTX_HIDGetInstance(void);
BOOL GCTX_HIDIsLidClosed(void);
// Whether the battery is low
BOOL GetIsShouldUICallback(void);
void GFL_HIDDoSoftReset(u32 parameter);
// Sets whether the player is using the touch screen rather than the keys, and returns it
BOOL GCTX_HIDIsUsingTouch(void);
void GCTX_HIDSetUsingTouch(BOOL touch);
void GFL_HIDResetFrameCount(SystemUI *ui);
void GFL_HIDSetUpdateRate(SystemUI *ui, u8 rate);
u8 GFL_HIDGetUpdateRate(SystemUI *ui);
void GCTX_HIDSetUpdateRate(u8 rate);
u8 GCTX_HIDGetUpdateRate(void);
void GCTX_HIDResetFrameCount(void);
// Sets the update rate and clears the input kept for 30 frames per second
void GCTX_HIDChangeFPS(u8 rate);
int GCTX_HIDGetBatteryLevel(void);

#endif // POKEBW2_GFL_UI_H
