#include "native_follow.h"
#include "native_shadow.h"
#include "scene.h"
#include "render_math.h"
#include <limits.h>
/* Adapters are pinned by native-contract.json per profile. The normal native
 * draw callback still owns animation and light/shadow creation and teardown. */
unsigned fwn_facing(Actor *p){
    if((p->flags&8192u)&&PTR(p->moveWork,0)){
        unsigned direction=CALL(0x021949e5,unsigned(*)(Actor*,int))(p,0);
        if(direction<4)return direction;
    }
    return p->face;
}
static unsigned heading_face(uint16_t angle,uint16_t camera){
    /* The native rail renderer's sixteen-sector classification, including
     * its wider horizontal sectors. Never quantize to a compass face first. */
    return ((const uint8_t*)0x021cf398u)[(uint16_t)(angle-camera)>>12];
}
void fwn_capture_facing(Actor *p,FwSample *s){
    s->direction=(uint8_t)p->face;s->rail=s->connection=0;
    if((p->flags&8192u)&&p->face<4&&PTR(p->moveWork,0)){
        struct {int16_t x,y,z;} vector;
        CALL(0x02195ab9,void(*)(Actor*,unsigned,void*))(p,p->face,&vector);
        if(!vector.x&&!vector.z)return;
        vector.y=0;
        CALL(0x02074394,void(*)(const void*,void*))(&vector,&vector);
        uint16_t angle=CALL(0x02074595,uint16_t(*)(int,int))(vector.x,vector.z);
        s->rail=angle;s->connection=(uint16_t)(FWN_RAIL_HEADING|p->face);
        s->direction=(uint8_t)heading_face(angle,0);
    }
}
unsigned fwn_pose_facing(Actor *a,const FwSample *s){
    const uint16_t *camera=a&&a->system?((ActorSystem*)a->system)->cameraYaw:0;
    return fwn_has_heading(s)&&camera?heading_face(s->rail,*camera):s->direction;
}
void fwn_refresh_facing(Actor *a,const FwNativeRoute *r){
    if(r->facingValid){
        FwSample s={.kind=FW_WORLD,.connection=FWN_RAIL_HEADING,.rail=r->facingAngle,.direction=(uint8_t)a->face};
        CALL(0x02167099,void(*)(Actor*,unsigned))(a,fwn_pose_facing(a,&s));
    }
}
int fwn_exterior(void *field){
    void *effects=field?CALL(0x0218054d,void*(*)(void*))(field):0;
    return effects?CALL(0x021a3779,int(*)(void*))(effects):-1;
}
int fwn_connection_rebase(FwNativeRoute *r,FwFollower *f,Actor *a,Actor *p){
    if(!r->valid||r->zone==p->zone||!fwn_reposition((const FwPoint*)&r->player,(const FwPoint*)&p->world))return 0;
    unsigned oldMatrix=CALL(0x020188f1,unsigned(*)(unsigned))(r->zone);
    if(CALL(0x020188f1,unsigned(*)(unsigned))(p->zone)!=oldMatrix)return 0;
    int32_t gx=(int32_t)p->initial[0]-fw_tile(r->player.x),gz=(int32_t)p->initial[2]-fw_tile(r->player.z);
    /* An origin rebase translates the native previous grid as well as world
     * position, in complete 32-tile map chunks. A teleport only supplying a
     * distant destination cannot satisfy the residual-step checks. */
    if((gx%32)||(gz%32)||(!gx&&!gz)||gx>1024||gx< -1024||gz>1024||gz< -1024)return 0;
    FwPoint delta={gx*FW_TILE,0,gz*FW_TILE};
    int64_t x=(int64_t)p->world.x-r->player.x-delta.x,z=(int64_t)p->world.z-r->player.z-delta.z;
    if(x< -FW_TILE||x>FW_TILE||z< -FW_TILE||z>FW_TILE||
       (int64_t)p->world.y-r->player.y< -2*FW_TILE||(int64_t)p->world.y-r->player.y>2*FW_TILE)return 0;
    int64_t ax=(int64_t)a->world.x+delta.x,az=(int64_t)a->world.z+delta.z;
    if(ax<INT32_MIN||ax>INT32_MAX||az<INT32_MIN||az>INT32_MAX||
       fw_tile((int32_t)ax)<INT16_MIN||fw_tile((int32_t)ax)>INT16_MAX||
       fw_tile((int32_t)az)<INT16_MIN||fw_tile((int32_t)az)>INT16_MAX)return 0;
    if(!fwn_route_rebase(r,f,&delta))return 0;
    FwSample placed={.x=(int32_t)ax,.y=a->world.y,.z=(int32_t)az,.direction=(uint8_t)a->face};
    fwn_commit(a,&placed);a->previous[0]=(int16_t)(a->previous[0]+gx);a->previous[2]=(int16_t)(a->previous[2]+gz);
    a->zone=p->zone;return 1;
}
void fwn_stationary(Actor *a){
    CALL(0x02167135,void(*)(Actor*,unsigned))(a,0);
    CALL(0x021674fd,void(*)(Actor*))(a);
}
void fwn_commit(Actor *a,const FwSample *s){
    int64_t dx=(int64_t)s->x-a->world.x,dz=(int64_t)s->z-a->world.z;
    uint32_t x=(uint32_t)(dx<0?-dx:dx),z=(uint32_t)(dz<0?-dz:dz),speed=x>z?x:z;
    Vec position={s->x,s->y,s->z};
    for(unsigned i=0;i<3;++i)a->previous[i]=a->grid[i];
    CALL(0x02167349,void(*)(Actor*,const Vec*))(a,&position);
    a->grid[0]=(int16_t)fw_tile(s->x);a->grid[1]=(int16_t)fw_tile(s->y);a->grid[2]=(int16_t)fw_tile(s->z);
    CALL(0x02167099,void(*)(Actor*,unsigned))(a,fwn_pose_facing(a,s));
    a->dimensions[4]=a->descriptor[15];
    a->moveflags&=~(2048u|4096u);
    if(speed){
        unsigned animation=speed<=2048?1u:speed<=4096?2u:speed<=8192?3u:speed<=16384?4u:5u;
        CALL(0x02167135,void(*)(Actor*,unsigned))(a,animation);
        CALL(0x021674f1,void(*)(Actor*))(a);
    }else fwn_stationary(a);
}
void fwn_lighting(Actor *a){
    uint32_t attr=0;
    Vec at={a->world.x,a->world.y,a->world.z};
    if(CALL(0x0215e8e5,int(*)(Actor*,const Vec*,uint32_t*))(a,&at,&attr)&&attr!=UINT32_MAX)
        CALL(0x0216784d,void(*)(Actor*,unsigned))(a,(CALL(0x021a2a35,unsigned(*)(unsigned))(attr)&0x100u)?1u:0u);
    else CALL(0x0216784d,void(*)(Actor*,unsigned))(a,0);
}
static int64_t abs64(int64_t x){return x<0?-x:x;}
static int rail_idle(Actor *a,Actor *p,FwSample *pose){
    void *field=((ActorSystem*)p->system)->field,*fp=field?PTR(field,0x94):0;
    if(!fp||!PTR(p->moveWork,0))return 0;
    unsigned first=p->face<2?2u:0u;
    for(unsigned key=first;key<first+2;++key){
        if(CALL(0x02195729,unsigned(*)(Actor*,unsigned))(p,key)&3u)continue;
        Vec goal;CALL(0x0219a9d1,void(*)(void*,unsigned,Vec*))(fp,key,&goal);
        uint32_t currentKeep=0,goalKeep=0;int64_t currentError=INT64_MAX,goalError=INT64_MAX;
        /* The live trail is supplied through its owning follower below. */
        extern FwFollower *fwfield_route_follower(void);
        FwFollower *f=fwfield_route_follower();if(!f)return 0;
        for(uint32_t keep=0;keep<=f->trail.distance;keep+=4096){
            FwSample point;if(!fw_trail_pose(&f->trail,f->directional_gap,keep,&point))continue;
            int64_t dx=(int64_t)point.x-a->world.x,dz=(int64_t)point.z-a->world.z;
            int64_t error=dx*dx+dz*dz;if(error<currentError){currentError=error;currentKeep=keep;}
            dx=(int64_t)point.x-goal.x;dz=(int64_t)point.z-goal.z;error=dx*dx+dz*dz;
            if(error<goalError){goalError=error;goalKeep=keep;}
        }
        if(currentError>4096ll*4096||goalError>4ll*4096*4*4096)continue;
        uint32_t next=currentKeep;
        if(goalKeep>next)next+=4096;else if(goalKeep<next)next=next>=4096?next-4096:0;
        FwSample point;if(!fw_trail_pose(&f->trail,f->directional_gap,next,&point))continue;
        Vec at={point.x,point.y,point.z};if(!fws_step_clear(a,&at))continue;
        *pose=point;
        if(fwn_has_heading(pose)&&p->face<4){
            const uint16_t *angles=(const uint16_t*)0x021cf6d0u;
            pose->rail=(uint16_t)(pose->rail+angles[p->face]-angles[pose->connection&3u]);
            pose->connection=(uint16_t)(FWN_RAIL_HEADING|p->face);
            pose->direction=(uint8_t)heading_face(pose->rail,0);
        }else fwn_capture_facing(p,pose);
        return 1;
    }
    return 0;
}
int fwn_idle_pose(FwNativeRoute *r,Actor *a,Actor *p,FwSample *pose){
    if(r->idle<8||r->swapping||r->easing||a->descriptor[7]==2)return 0;
    if(p->flags&8192u)return rail_idle(a,p,pose);
    int64_t dx=(int64_t)a->world.x-p->world.x,dz=(int64_t)a->world.z-p->world.z;
    /* Only settle beside after a corner has already put the follower on that
     * side. Never cross through the player to select the other side. */
    Vec goal=p->world;
    if(p->face<2){if(abs64(dx)<FW_TILE/2||abs64(dz)>FW_TILE)return 0;goal.x+=dx<0?-FW_TILE:FW_TILE;}
    else{if(abs64(dz)<FW_TILE/2||abs64(dx)>FW_TILE)return 0;goal.z+=dz<0?-FW_TILE:FW_TILE;}
    int64_t x=(int64_t)goal.x-a->world.x,z=(int64_t)goal.z-a->world.z;
    if(abs64(x)>FW_TILE||abs64(z)>FW_TILE)return 0;
    /* Collision and height are checked at every substep, not merely at the
     * endpoint. A rail map uses its recorded world path instead of a grid
     * side-step because synthetic actors have no native rail cursor. */
    Vec next=a->world;
    int32_t step=4096;
    if(x)next.x+=(int32_t)(x>step?step:x< -step?-step:x);
    else if(z)next.z+=(int32_t)(z>step?step:z< -step?-step:z);
    int32_t height=next.y;
    if(!CALL(0x0215e909,int(*)(Actor*,const Vec*,int32_t*))(a,&next,&height)||
       abs64((int64_t)height-a->world.y)>FW_TILE/2)return 0;
    unsigned dir=x?(x<0?2u:3u):(z<0?0u:1u);
    if(CALL(0x0215e4f1,unsigned(*)(Actor*,unsigned))(a,dir))return 0;
    next.y=height;if(!fws_step_clear(a,&next))return 0;
    pose->x=next.x;pose->y=next.y;pose->z=next.z;pose->direction=(uint8_t)fwn_facing(p);return 1;
}
int fwn_body_position(Actor *a,void *camera,const FwPoint *native,int sprite_y,FwPoint *out){
    if(!a||!native||!out)return 0;
    *out=*native;
    int64_t y=(int64_t)native->y+(int64_t)(sprite_y-(int8_t)a->descriptor[14])*4096;
    if(y<INT32_MIN||y>INT32_MAX)return 0;
    out->y=(int32_t)y;
    if(camera){
        FwrCamera view={*(FwPoint*)((uint8_t*)camera+32),*(FwPoint*)((uint8_t*)camera+56),U32(camera,0)};
        unsigned node=a->descriptor[3];
        if(a->system&&(node==10||node==11)){
            void *mapper=CALL(0x02166fe9,void*(*)(void*))(a->system);
            if(mapper&&CALL(0x021b3d5d,int(*)(void*))(mapper)){
                /* Native grid-sprite alignment belongs to the camera's X/Z
                 * basis on rail maps. Shadows retain their native ground. */
                FwPoint anchor={a->drawOffset.x,0,a->drawOffset.z},position;
                if(fwr_camera_anchor(out,&anchor,&view,&position))*out=position;
            }
        }
        /* Visual bobbing stays in the billboard plane, preserving depth. */
        int64_t bob=(int64_t)a->drawOffset.y+a->externalOffset.y;
        FwPoint position;
        if(bob>=INT32_MIN&&bob<=INT32_MAX&&fwr_animation_plane(out,(int32_t)bob,&view,&position))*out=position;
    }
    return 1;
}
typedef struct{uint16_t geom,pad;FwPoint position;uint16_t frame;int16_t sx,sy;uint16_t rotation,flags,pad2;} NativeBillboard;
_Static_assert(sizeof(NativeBillboard)==28,"native billboard layout");
void fwn_draw(void *system,void *camera,void *light,Actor *a,int sprite_y){
    NativeBillboard *body=0;FwPoint original={0};uint16_t originalFlags=0;int change=0;
    if(system&&a&&(a->flags&5u)==1u){
        /* Use the actor's native scene-node index, never a nearest billboard. */
        unsigned slot=CALL(0x02167241,unsigned(*)(Actor*,unsigned))(a,0);
        void *fieldBl=PTR(a->system,0x28),*scene=PTR(system,4),*slots=PTR(system,0x18);
        unsigned index=0xffffu;
        if(fieldBl&&PTR(fieldBl,4)==system&&slots&&slot<*(uint16_t*)((uint8_t*)system+0x1c))
            index=U32(slots,slot*40);
        if(scene&&PTR(scene,8)&&index<*(uint16_t*)((uint8_t*)scene+14)){
            body=(NativeBillboard*)PTR(scene,8)+index;original=body->position;originalFlags=body->flags;
            FwPoint position;
            if(fwn_body_position(a,(body->geom>>14)==0?camera:0,&original,sprite_y,&position)){
                body->position=position;change=1;
                if((body->geom>>14)==0&&*((uint8_t*)scene+36)==0)
                    body->flags=(uint16_t)((body->flags&~0x1e0u)|(FWN_SHADOW_BODY_ID<<5));
            }
        }
    }
    CALL(0x0204f685,void(*)(void*,void*,void*))(system,camera,light);
    if(change){body->position=original;body->flags=originalFlags;}
}
