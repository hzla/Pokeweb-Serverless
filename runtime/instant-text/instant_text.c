#include <stdint.h>

extern void *SaveData_GetConfig(void *save);
extern uint32_t Config_GetTextSpeed(void *config);

/* Native stream speed is a signed wait: negative values are glyphs/update.
 * 128 is bounded, fits the native u8 character budget and normally reveals a
 * whole page in one update. The native stream still owns page/choice handling.
 */
int THUMB_BRANCH_TextSpeed_Convert(uint32_t speed) {
    static const int8_t waits[5] = {3, 1, -2, -4, 6};
    if (speed >= 5) speed = 4;
    if (speed == 2 || speed == 3) {
        void *save = *(void *volatile *)0x0209a378;
        if (save && Config_GetTextSpeed(SaveData_GetConfig(save)) == 2) return -128;
    }
    return waits[speed];
}

int THUMB_BRANCH_LINK_TextSpeed_GetWait_0x14(uint32_t speed) {
    return THUMB_BRANCH_TextSpeed_Convert(speed);
}
