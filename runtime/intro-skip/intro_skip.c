#include <stdint.h>
#include "intro_skip_addr.h"

/* Skip the new-game intro on US Black 2 and White 2.
 *
 * A new game normally plays the Aspertia City flyover (3D demo 5), opens the
 * field on the street outside the player's house, runs the zone's scripts 29
 * and 30 (mom takes Professor Juniper's call and goes inside, then a warp
 * into the house) and the house's script 17 ("I'm home!"). Only script 17
 * changes lasting state: it clears flag 0x2E4, which the new-game setup
 * script sets to keep mom out of the house until then.
 *
 * Five call sites in overlay 35's EventGameOpening / EventFieldFirst are
 * redirected:
 *   demo   Event3DDemo_Create         -> an event that ends at once
 *   init   FieldScript_CallPlayerInitSetup -> the same, then clear 0x2E4
 *   hide   SetActorFlag(player, hidden) -> nothing
 *   script EventScriptCall_Start (scripts 29 and 30) -> nothing
 *   spawn  LoadAspertiaCitySpawnInfo  -> the house, where script 30 warps,
 *          facing down as script 17 leaves the player
 * The field then fades in once, in the house, with the player in control. */

#define CALL(address, type) ((type)(uintptr_t)(address))
#define ZONE_PLAYER_HOUSE 428 /* ZONE_ASPERTIA_CITY_2 */
#define WARP_DIR_DOWN 2
#define FLAG_MOM_AWAY 0x2e4
#define TILE(n) ((int32_t)(n) << 16)

typedef struct {
    uint32_t magic, version;
    uint32_t demo, init, hide, script, spawn;
} IntroSkipState;

__attribute__((used)) volatile IntroSkipState IntroSkipDebug = { .magic = 0x504b5349u /* "ISKP" */, .version = 1u };

static uint32_t finished(void *event, uint32_t *state, void *data) {
    (void)event; (void)state; (void)data;
    return 1; /* GAMEEVENT_DONE */
}

void *DEMO_HOOK(void *gsys, void *parent, uint32_t demo, uint32_t param, uint32_t realTime) {
    (void)demo; (void)param; (void)realTime;
    ++IntroSkipDebug.demo;
    return CALL(GAME_EVENT_CREATE, void *(*)(void *, void *, void *, uint32_t))(gsys, parent, (void *)finished, 4);
}

void INIT_HOOK(void *gsys, uint32_t mode) {
    CALL(PLAYER_INIT_SETUP, void (*)(void *, uint32_t))(gsys, mode);
    void *game = CALL(GET_GAME_DATA, void *(*)(void *))(gsys);
    CALL(FLAG_RESET, void (*)(void *, uint32_t))(CALL(GET_EVENT_WORK, void *(*)(void *))(game), FLAG_MOM_AWAY);
    ++IntroSkipDebug.init;
}

void HIDE_HOOK(void *actor, uint32_t flag) {
    (void)actor; (void)flag;
    ++IntroSkipDebug.hide;
}

void *SCRIPT_HOOK(void *event, uint32_t script, void *actor, uint32_t param, uint32_t heap) {
    (void)event; (void)script; (void)actor; (void)param; (void)heap;
    ++IntroSkipDebug.script;
    return 0;
}

void SPAWN_HOOK(void *spawn) {
    CALL(CREATE_ZONE_CHANGE, void (*)(void *, uint32_t, int32_t, int32_t, int32_t, int32_t))(
        spawn, ZONE_PLAYER_HOUSE, WARP_DIR_DOWN, TILE(14), 0, TILE(3));
    ++IntroSkipDebug.spawn;
}
