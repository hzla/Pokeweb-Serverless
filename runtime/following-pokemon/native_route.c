#include "native_route.h"
#include <limits.h>
static uint32_t magnitude(int64_t x){return (uint32_t)(x<0?-x:x);}
void fwn_route_reset(FwNativeRoute *r){*r=(FwNativeRoute){0};}
int fwn_pedestrian(unsigned code,unsigned *dir,unsigned *tiles){
    if(code<0x69u||code>0x98u)return 0;
    *dir=(code-0x69u)%4u;
    /* 0x75..0x78 are three-tile ground walks. Other rows include
     * wall-axis and vertical motion; their real writes are authoritative. */
    *tiles=code>=0x75u&&code<=0x78u?3u:0u;
    return *tiles?1:2;
}
int fwn_reposition(const FwPoint *a,const FwPoint *b){
    return magnitude((int64_t)a->x-b->x)>3u*FW_TILE||magnitude((int64_t)a->z-b->z)>3u*FW_TILE;
}
int fwn_large_indoor(unsigned mode,int exterior){return mode==2u&&!exterior;}
int fwn_route_rebase(FwNativeRoute *r,FwFollower *f,const FwPoint *d){
    /* Preflight both trails and the saved player before mutating either. */
    int64_t x=(int64_t)r->player.x+d->x,y=(int64_t)r->player.y+d->y,z=(int64_t)r->player.z+d->z;
    if(x<INT32_MIN||x>INT32_MAX||y<INT32_MIN||y>INT32_MAX||z<INT32_MIN||z>INT32_MAX)return 0;
    FwTrail copy=f->trail;
    if(!fw_trail_translate(&copy,d))return 0;
    if(!fw_trail_translate(&r->reversal,d))return 0;
    f->trail=copy;r->player.x=(int32_t)x;r->player.y=(int32_t)y;r->player.z=(int32_t)z;return 1;
}
int fwn_route_step(FwNativeRoute *r,FwFollower *f,const FwSample *s,const FwPoint *current,FwSample *out){
    if(!r||!f||!s||!current||!out)return -1;
    uint32_t moved=r->valid?fw_world_distance(&r->player,s):0;
    if(r->valid&&(s->generation!=r->player.generation||s->space!=r->player.space||moved>FW_TILE)){
        fwn_route_reset(r);fw_trail_clear(&f->trail);return -1;
    }
    fw_trail_remeasure(&f->trail,f->directional_gap);
    if(r->valid&&moved&&!r->swapping&&f->state==FW_FOLLOWING&&f->trail.count>1){
        int64_t dx=(int64_t)s->x-r->player.x,dz=(int64_t)s->z-r->player.z;
        int64_t fx=(int64_t)current->x-r->player.x,fz=(int64_t)current->z-r->player.z;
        /* Reverse only along the recorded incoming route, not every sideways
         * turn. The private traversal never invents a diagonal shortcut. */
        unsigned old=r->inputValid?r->previousInput:r->player.direction;
        unsigned direction=r->inputValid?r->inputDirection:s->direction;
        int reverse=(old==0&&direction==1)||(old==1&&direction==0)||
                    (old==2&&direction==3)||(old==3&&direction==2);
        if(reverse&&dx*fx+dz*fz>0){
            r->reversal=f->trail;
            FwSample *first=&r->reversal.samples[r->reversal.head];
            first->x=current->x;first->y=current->y;first->z=current->z;
            fw_trail_remeasure(&r->reversal,f->directional_gap);
            r->swapping=r->reversal.distance!=0;r->progress=0;r->easing=0;
            fw_trail_clear(&f->trail);
            FwSample unused;fw_trail_push_directional(&f->trail,&r->player,&unused,f->directional_gap);
        }
    }
    int result=fw_trail_push_directional(&f->trail,s,out,f->directional_gap);
    if(result<0){fwn_route_reset(r);return -1;}
    if(r->swapping){
        uint32_t next=r->progress+fw_metric_distance(&r->player,s,f->directional_gap);
        r->progress=next>r->reversal.distance?r->reversal.distance:next;
        result=fw_trail_pose(&r->reversal,f->directional_gap,r->reversal.distance-r->progress,out);
        /* A reversal traverses the previous trail in the opposite direction. */
        if(result){
            out->direction^=1u;
            if(fwn_has_heading(out)){out->rail=(uint16_t)(out->rail+0x8000u);out->connection^=1u;}
        }
        if(r->progress==r->reversal.distance){r->swapping=0;r->easing=1;r->recovery=0;r->startKeep=f->trail.distance;}
    }else if(r->easing){
        r->recovery+=moved;
        if(r->recovery>=FW_TILE){r->easing=0;}
        else{
            uint32_t keep=(uint32_t)((int64_t)r->startKeep+((int64_t)FW_TILE-r->startKeep)*r->recovery/FW_TILE);
            if(keep>f->trail.distance)keep=f->trail.distance;
            result=fw_trail_pose(&f->trail,f->directional_gap,keep,out);
        }
    }
    r->idle=moved?0:r->idle<255?r->idle+1:255;
    unsigned incoming=r->player.direction;
    if(!r->valid||moved)incoming=s->direction;
    if(!r->valid||moved)r->previousInput=r->inputDirection;
    r->player=*s;r->player.direction=(uint8_t)incoming;r->valid=1;
    return result;
}
