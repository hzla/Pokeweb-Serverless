#ifndef FW_NATIVE_FOLLOW_H
#define FW_NATIVE_FOLLOW_H
#include "native.h"
#include "native_route.h"
int fwn_exterior(void *field);
unsigned fwn_facing(Actor *player);
void fwn_capture_facing(Actor *player,FwSample *sample);
unsigned fwn_pose_facing(Actor *actor,const FwSample *sample);
void fwn_refresh_facing(Actor *actor,const FwNativeRoute *route);
int fwn_body_position(Actor *actor,void *camera,const FwPoint *native,int sprite_y,FwPoint *output);
int fwn_connection_rebase(FwNativeRoute *route,FwFollower *f,Actor *actor,Actor *player);
void fwn_commit(Actor *actor,const FwSample *pose);
void fwn_stationary(Actor *actor);
void fwn_lighting(Actor *actor);
int fwn_idle_pose(FwNativeRoute *route,Actor *actor,Actor *player,FwSample *pose);
void fwn_draw(void *system,void *camera,void *light,Actor *actor,int sprite_y);
#endif
