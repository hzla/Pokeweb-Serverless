#ifndef FOLLOWING_RENDER_MATH_H
#define FOLLOWING_RENDER_MATH_H
#include "following.h"
/* Camera and positions use native 20.12 world units; scale uses native fx16. */
typedef struct { FwPoint eye,target; uint32_t projection; } FwrCamera;
typedef struct { FwPoint position; int32_t sx,sy; } FwrPose;
typedef struct { FwPoint axis; int32_t before,after,policy; } FwrResult;
#define FWR_TIE_MARGIN 512 /* 1/8 world unit; a tile is 16 world units. */
#define FWR_LARGE 1u
#define FWR_NORTH 2u
#define FWR_NORTH_ANCHOR_Z 7
#define FWR_NORTH_ART_Y 2
#define FWR_FORCE_FRONT 4u
#define FWR_FORCE_BACK 8u
#define FWR_BACK_MARGIN (12 * 4096)
int fwr_correct(const FwPoint *world,const FwPoint *player_world,
    const FwrPose *native,const FwPoint *player_draw,const FwrCamera *camera,
    unsigned flags,FwrPose *output,FwrResult *result);
/* Keep the opaque billboard in front of its ground shadow without moving its
 * projected image. The shadow itself remains at the native ground anchor. */
int fwr_above_shadow(const FwrPose *native,const FwPoint *ground,
    const FwrCamera *camera,FwrPose *output);
/* Preserve the player's foreground after follower shadow clearance without
 * putting the follower behind its own shadow or moving either image on screen. */
int fwr_player_in_front(const FwrPose *follower,const FwrPose *player,
    const FwrCamera *camera,FwPoint axis,int32_t margin,int32_t max_advance,
    FwrPose *output,int32_t *after);
#endif
