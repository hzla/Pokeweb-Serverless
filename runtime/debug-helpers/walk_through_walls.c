#include <stdint.h>

extern void *GCTX_HIDGetInstance(void);
extern uint32_t *GFL_HIDGetKeypadManager(void *hid);
extern uint32_t GCTX_HIDGetPressedKeys(void);

uint32_t WalkThroughWallsEnabled;
static uint32_t chordWasDown;

/* Called before the shared grid/rail field input snapshot reads the keys.
 * Raw keys remain intact for the game's edge detector and our chord latch.
 * Suppress Start in the published 30/60 Hz buffers to avoid opening Porta PC.
 */
uint32_t THUMB_BRANCH_LINK_FieldInputSnapshot_0x30(void) {
    uint32_t *keys = GFL_HIDGetKeypadManager(GCTX_HIDGetInstance());
    uint32_t down = (keys[3] & 0x308u) == 0x308u;
    if (down && !chordWasDown) WalkThroughWallsEnabled ^= 1u;
    chordWasDown = down;
    if (down) {
        for (unsigned i = 6; i <= 14; ++i) keys[i] &= ~8u;
    }
    return GCTX_HIDGetPressedKeys();
}
