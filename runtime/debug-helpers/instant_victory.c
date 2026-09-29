#include <stdint.h>

extern uint32_t GCTX_HIDGetHeldKeys(void);
extern void BattleView_ForceQuitInputNotify(void *view);
extern uint32_t BattleView_ForceQuitInputWait(void *view);
extern void BattleView_Update(void *view);

static void *pendingMain;
static uint32_t chordWasDown;

#define WORD(p, off) (*(uint32_t *)((uint8_t *)(p) + (off)))
#define BYTE(p, off) (*(uint8_t *)((uint8_t *)(p) + (off)))
#define PTR(p, off) (*(void **)((uint8_t *)(p) + (off)))

/* Wrap the native battle process's main-loop call. Returning completion here
 * retains its result calculation, party synchronization, records and teardown.
 * The input-close handshake runs across frames; never spin or free a live UI.
 */
uint32_t InstantVictory_Main(void *main) {
    uint32_t down = (GCTX_HIDGetHeldKeys() & 0xbu) == 0xbu;
    uint32_t pressed = down && !chordWasDown;
    chordWasDown = down;
    void *setup = PTR(main, 0);
    void *view = PTR(main, 4);
    if (pendingMain && pendingMain != main) pendingMain = 0;
    /* Local wild/trainer battles only. Replays, demos, network battles and
     * facilities have additional state/result contracts and are excluded.
     */
    if (pressed && setup && view && WORD(setup, 0) <= 1
        && BYTE(setup, 0x20) == 0 && BYTE(setup, 0x23) == 0
        && !(BYTE(main, 0x473) & 1) && WORD(main, 0x444) == 7) {
        pendingMain = main;
        BattleView_ForceQuitInputNotify(view);
    }
    if (pendingMain == main) {
        BattleView_Update(view);
        if (!BattleView_ForceQuitInputWait(view)) return 0;
        WORD(main, 0x444) = 1;  /* server result: victory */
        WORD(main, 0x448) = 0;  /* no escape/capture result overrides */
        WORD(main, 0x44c) = 0;
        BYTE(setup, 0xac) = 6; /* native sentinel: no captured party member */
        WORD(setup, 0xa8) = 1;
        pendingMain = 0;
        return 1;
    }
    return ((uint32_t (*)(void *))PTR(main, 0x464))(main);
}
