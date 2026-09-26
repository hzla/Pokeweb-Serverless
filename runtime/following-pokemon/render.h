#ifndef FOLLOWING_RENDER_H
#define FOLLOWING_RENDER_H
#include "native.h"
typedef struct { Vec position; int16_t sx,sy; } FwrEffectPose;
/* Native BlAct MatFlags bits 12–15 select the map's enabled lights. */
#define FWR_LIGHT_MASK 0xf000u
/* Directional ground-plane anchor: shared by native sprite and shadow draws. */
void fwr_anchor(Actor *actor,unsigned face);
void fwr_draw(void *system,void *camera,void *light,Actor *follower,Actor *player,int sprite_y);
/* Recall reuses the last submitted pose, after draw-only ground/depth fixes. */
int fwr_effect_pose(Actor *actor,const Vec *native,FwrEffectPose *out);
#endif
