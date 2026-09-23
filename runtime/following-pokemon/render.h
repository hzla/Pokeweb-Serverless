#ifndef FOLLOWING_RENDER_H
#define FOLLOWING_RENDER_H
#include "native.h"
/* Directional ground-plane anchor: shared by native sprite and shadow draws. */
void fwr_anchor(Actor *actor,unsigned face);
void fwr_draw(void *system,void *camera,void *light,Actor *follower,Actor *player,int sprite_y);
#endif
