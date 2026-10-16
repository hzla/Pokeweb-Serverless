#include <stddef.h>
#include <stdint.h>

/* The Fly constructor passes its embedded spawn at work + 12. */
typedef struct {
    uint32_t change_type;
    int16_t zone_id;
    uint16_t warp_id;
    int16_t direction;
    uint16_t weights;
    uint32_t is_rail;
    union {
        int32_t grid[3];
        struct {
            uint16_t component;
            uint8_t line, direction;
            int16_t side;
            uint16_t front;
            uint32_t padding;
        } rail;
    } position;
} FlySpawn;

typedef struct {
    uint16_t selected_zone, flags;
    int32_t x, y, z;
} FlyDestination;

typedef struct {
    uint32_t magic, version, count;
    FlyDestination destinations[85];
} FlyConfig;

_Static_assert(sizeof(FlySpawn) == 28, "spawn ABI");
_Static_assert(offsetof(FlySpawn, position) == 16, "position ABI");
_Static_assert(sizeof(FlyDestination) == 16, "config entry ABI");
_Static_assert(sizeof(FlyConfig) == 1372, "config ABI");

/* Volatile keeps the bundled, editor-configured values live after compilation. */
const volatile FlyConfig FlyDestinationConfig = { 0x594c4650, 1, 85, {{0}} };
extern void LoadZoneSpawnInfoCheckRail(FlySpawn *spawn, uint16_t zone);

void Fly_LoadSpawn(FlySpawn *spawn, uint16_t selected_zone) {
    uint16_t landing_zone = selected_zone == 490 ? 326 : selected_zone;
    LoadZoneSpawnInfoCheckRail(spawn, landing_zone);
    /* Keep the existing animation/name callback's zone consistent with the spawn. */
    ((uint32_t *)spawn)[-1] = landing_zone;
    for (uint32_t i = 0; i < 85; i++) {
        const volatile FlyDestination *entry = &FlyDestinationConfig.destinations[i];
        if (!(entry->flags & 1) || entry->selected_zone != selected_zone) continue;
        if (spawn->is_rail) {
            spawn->position.rail.component = (uint16_t)entry->x;
            spawn->position.rail.front = (uint16_t)entry->y;
            spawn->position.rail.side = (int16_t)entry->z;
        } else {
            spawn->position.grid[0] = (int32_t)((uint32_t)entry->x << 16);
            spawn->position.grid[1] = (int32_t)((uint32_t)entry->y << 16);
            spawn->position.grid[2] = (int32_t)((uint32_t)entry->z << 16);
        }
        break;
    }
}
