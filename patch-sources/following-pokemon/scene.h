#ifndef FOLLOWING_SCENE_H
#define FOLLOWING_SCENE_H
#include "native.h"
#include "events.h"
enum { FWS_NONE, FWS_PAUSED, FWS_RECALLED, FWS_REFRESH=4, FWS_INVALID=8 };
enum { FWS_UNKNOWN_COMMAND=1,FWS_UNKNOWN_EVENT,FWS_PLAYER_MOVEMENT,
 FWS_COLLISION,FWS_ACTOR_ID,FWS_POOL,FWS_UNKNOWN_MOVEMENT,FWS_EVENT_LIMIT,
 FWS_VM_LIMIT,FWS_IDENTITY,FWS_ACTOR_LOST,FWS_BRIDGE,FWS_UNKNOWN_FINISHER };
int fws_attach(ActorSystem *sys,FwFollower *f,uint32_t generation,void (*recall)(void));
void fws_detach(void);
void fws_set_player(Actor *player);
void fws_mark_menu(void *event);
int fws_take_restore(FweRestore *restore);
unsigned fws_poll(void);
int fws_pc_fade(void);
void fws_restored(void);
void fws_observe(unsigned kind,void *subject,uintptr_t value);
int fws_safe_opcode(unsigned code);
int fws_step_clear(Actor *f,const Vec *target);
#endif
