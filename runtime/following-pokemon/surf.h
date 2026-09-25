#ifndef POKEWEB_FOLLOWING_SURF_H
#define POKEWEB_FOLLOWING_SURF_H
#include "native.h"
void fwsurf_update(ActorSystem *system,unsigned species,unsigned surfing,unsigned tick);
void fwsurf_draw(void *system,void *camera,void *light,unsigned afterPlayer);
void fwsurf_draw_scene(void *system,void *camera,void *light,Actor *follower,Actor *player,int sprite_y);
void fwsurf_destroy(void);
/* Resolve and load one appearance before a stock land-to-water handoff. */
int fwsurf_prepare(ActorSystem *system,unsigned appearance,unsigned tick);
#endif
