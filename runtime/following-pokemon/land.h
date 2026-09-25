#ifndef FOLLOWING_LAND_H
#define FOLLOWING_LAND_H
#include "native.h"
int fwland_begin(ActorSystem *owner, Actor *follower, Actor *player, void *field,
                 uint16_t code, uint32_t registryCrc, uint16_t descriptorCount,
                 const FwPokemon *selected, int slot);
void fwland_end(void);
/* Surf handoff stops land drawing now, but keeps its VRAM allocations until
 * queued draw commands from this field frame have finished. */
void fwland_handoff(unsigned tick);
void fwland_tick(unsigned tick);
int fwland_active(void);
int fwland_invalid(void);
int fwland_validate(void);
/* The selected follower may use slot -1 for automatic lead selection. The
 * active mount always resolves and validates a concrete party slot. */
int fwland_slot(void);
void fwland_follow_player(Actor *follower, Actor *player);
void fwland_draw(void *system, void *camera, void *light, Actor *follower,
                 Actor *player, int spriteY, uint32_t tick);
void FollowingLandStep(void *model, unsigned code);
#endif
