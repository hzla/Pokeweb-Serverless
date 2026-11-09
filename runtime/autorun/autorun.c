#include <stdint.h>
#include "autorun_addr.h"

/* Autorun for US Black, White, Black 2 and White 2.
 *
 * The field controllers pass the held keys to the player's grid and rail
 * movement through two small FieldPlayer wrappers. With the Running Shoes and
 * the Options row on, B is inverted there: moving runs, holding B walks.
 * Nothing else reads the adjusted keys.
 *
 * The Options row stores "Autorun off" in reserved CONFIG bit 12 (bit 11 is
 * Following Pokemon's), so every existing save starts with Autorun on. */

#define CALL(address, type) ((type)(uintptr_t)(address))
#define AUTORUN_OFF (1u << 12)
#define KEY_B 2u
#define MOVE_FLAG_CAN_RUN 1u

typedef struct {
    uint32_t magic, version;
    uint32_t gridCalls, nogridCalls;
    uint32_t lastKeys, enabled;
#ifdef AUTORUN_TEST
    int16_t x, y, z, pad;
#endif
} AutorunState;

__attribute__((used)) volatile AutorunState AutorunDebug = { .magic = 0x4e555241u /* "ARUN" */, .version = 1u };

static int autorun_enabled(void *player) {
    void *system = CALL(GET_GAME_SYSTEM, void *(*)(void *))(player);
    void *game = system ? CALL(GET_GAME_DATA, void *(*)(void *))(system) : 0;
    void *save = game ? CALL(GET_SAVE, void *(*)(void *))(game) : 0;
    const uint16_t *config = save ? CALL(GET_CONFIG, const uint16_t *(*)(void *))(save) : 0;
    return config && !(*config & AUTORUN_OFF);
}

static void record(void *player, uint32_t keys, int enabled) {
    AutorunDebug.lastKeys = keys;
    AutorunDebug.enabled = (uint32_t)enabled;
#ifdef AUTORUN_TEST
    int16_t position[3];
    CALL(GET_GRID_POS, void (*)(void *, int16_t *, int16_t *, int16_t *))(player, &position[0], &position[1], &position[2]);
    AutorunDebug.x = position[0];
    AutorunDebug.y = position[1];
    AutorunDebug.z = position[2];
#else
    (void)player;
#endif
}

/* Replaces FieldPlayer_UpdateGridMovement(player, pressed, held, flags). */
void GRID_HOOK(void *player, uint32_t pressed, uint32_t held, uint32_t flags) {
    int enabled = (flags & MOVE_FLAG_CAN_RUN) && autorun_enabled(player);
    if (enabled) held ^= KEY_B;
    ++AutorunDebug.gridCalls;
    record(player, held, enabled);
    CALL(GRID_TARGET, void (*)(void *, uint32_t, uint32_t, uint32_t))(*(void **)((uint8_t *)player + 8), pressed, held, flags);
}

/* Replaces FieldPlayer_UpdateRailMovement(player, pressed, held). Rails take
 * no shoe flag from their controller, so check the Running Shoes here. */
void NOGRID_HOOK(void *player, uint32_t pressed, uint32_t held) {
    int enabled = CALL(CHECK_SHOES, int (*)(void *))(player) && autorun_enabled(player);
    if (enabled) held ^= KEY_B;
    ++AutorunDebug.nogridCalls;
    record(player, held, enabled);
    CALL(NOGRID_TARGET, void (*)(void *, uint32_t, uint32_t))(*(void **)((uint8_t *)player + 12), pressed, held);
}
