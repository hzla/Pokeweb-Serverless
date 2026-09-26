#ifndef POKEWEB_FOLLOWING_H
#define POKEWEB_FOLLOWING_H
#include <stdint.h>
#include <stddef.h>
#define FW_ABI 1
#define FW_TRAIL_CAPACITY 64
#define FW_PARTY_CAPACITY 6
#define FW_CODE_BASE 0x3000u
#define FW_STOCK_ROWS 1008u
#ifdef FW_UPGRADE
#define FW_MAX_SPECIES 1023u
#define FW_MAX_ROWS 6144u
#else
#define FW_MAX_SPECIES 649u
#define FW_MAX_ROWS 4096u
#endif
#define FW_TILE (16 * 4096)
/* Native units, approximately pixels at the ordinary field camera scale. */
#define FW_MAX_SIDE_GAP 6u
#define FW_DEFAULT_SIDE_GAP_BONUS 6u
#define FW_MAX_DIRECTIONAL_GAP (FW_MAX_SIDE_GAP + FW_DEFAULT_SIDE_GAP_BONUS)
#define FW_DIALOGUE_REACH(gap) (FW_TILE + ((gap) + 1u) * 4096u)
typedef enum { FW_ABSENT, FW_WAITING, FW_FOLLOWING, FW_INTERACTING, FW_SUPPRESSED, FW_DESTROYING, FW_EVENT_PAUSED } FwState;
typedef enum { FW_MENU, FW_DIALOGUE, FW_SCRIPT, FW_WARP, FW_BATTLE, FW_BLACKOUT,
    FW_PARTNER, FW_BIKE, FW_SURF, FW_DIVE, FW_FISHING, FW_FIELD_MOVE,
    FW_COMMUNICATION, FW_ACTIVITY, FW_RESOURCE_FAILURE, FW_DISABLED, FW_REASON_COUNT } FwReason;
typedef enum { FW_GRID, FW_LEDGE, FW_RAIL, FW_WORLD } FwMovement;
typedef struct { uint16_t species; uint8_t form, gender, shiny, egg; uint16_t hp, max_hp; uint32_t personality, trainer; } FwPokemon;
typedef struct {
    int32_t x, y, z;
    uint32_t generation, space;
    uint16_t rail, connection;
    uint8_t direction, kind;
    uint16_t duration;
} FwSample;
typedef struct { int32_t x, y, z; } FwPoint;
typedef struct {
    FwSample samples[FW_TRAIL_CAPACITY];
    uint32_t distance;
    uint16_t head, count;
} FwTrail;
typedef struct {
    FwState state;
    uint8_t suppression[FW_REASON_COUNT];
    uint32_t generation;
    uintptr_t actor;
    FwPokemon selected;
    int8_t slot;
    uint8_t has_selection;
    uint8_t side_gap; /* Uses existing sidecar padding: 0..6 world units. */
    int8_t sprite_y; /* Registry draw-only offset; native shadow stays grounded. */
    FwTrail trail;
    uint8_t directional_gap[4]; /* Up, down, left, right; selected ROM positioning row. */
} FwFollower;
int fw_select(const FwPokemon *party, unsigned count);
/* L/R selection wraps over non-Egg party members, preferring healthy members
 * exactly as automatic lead selection does. Does not reorder the party. */
int fw_cycle_slot(const FwPokemon *party, unsigned count, int current, int direction);
int fw_same_identity(const FwPokemon *a, const FwPokemon *b);
int fw_tired(const FwPokemon *mon);
/* The native billboard owns the directional loop.  This gate keeps its last
 * pose during private interaction, scene and effect ownership. */
int fw_idle_animation_enabled(FwState state, unsigned visible, unsigned effect_busy);
void fw_init(FwFollower *f, uint32_t generation);
void fw_enter(FwFollower *f, FwReason reason);
void fw_leave(FwFollower *f, FwReason reason);
int fw_suppressed(const FwFollower *f);
int fw_interact(FwFollower *f);
void fw_end_interaction(FwFollower *f);
void fw_trail_clear(FwTrail *trail);
/* Returns -1 on discontinuity/overflow (caller must recall); 0 while seeding;
 * 1 when an actual recorded pose is available. Never synthesizes a shortcut. */
int fw_trail_push(FwTrail *trail, const FwSample *sample, FwSample *follower, unsigned side_gap);
int fw_trail_push_directional(FwTrail *trail, const FwSample *sample, FwSample *follower, const uint8_t gaps[4]);
/* Bound a nearly-adjacent follower's world pose to the same forward reach
 * used by dialogue, without changing its route or authored gap. */
int fw_clamp_dialogue_pose(FwPoint *pose,const FwPoint *player,const FwPoint *art_offset,
                           unsigned face,unsigned gap);
uint16_t fw_stock_row(uint16_t code);
uint16_t fw_object_row(uint16_t code, uint16_t extension_count);
uint32_t fw_descriptor_offset(uint16_t row);
#endif
