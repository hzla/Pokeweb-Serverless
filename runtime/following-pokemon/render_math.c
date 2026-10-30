#include "render_math.h"
#include <limits.h>
/* Bounded freestanding division: no compiler-runtime or gameplay-module import. */
static int32_t divide(int64_t value,int32_t divisor){
 uint64_t n=value<0?(uint64_t)-value:(uint64_t)value,r=0,q=0;
 if(divisor<=0)return 0;
 for(unsigned bit=0;bit<64;++bit){r=(r<<1)|(n>>63);n<<=1;q<<=1;if(r>=(uint32_t)divisor){r-=(uint32_t)divisor;q|=1;}}
 if(q>INT32_MAX)q=INT32_MAX;
 return value<0?-(int32_t)q:(int32_t)q;
}
static uint32_t root(uint32_t n){
 uint32_t answer=0,bit=1u<<30;
 while(bit>n)bit>>=2;
 while(bit){if(n>=answer+bit){n-=answer+bit;answer=(answer>>1)+bit;}else answer>>=1;bit>>=2;}
 return answer;
}
static int delta(FwPoint a,FwPoint b,FwPoint *out,int32_t limit){
 int64_t x=(int64_t)a.x-b.x,y=(int64_t)a.y-b.y,z=(int64_t)a.z-b.z;
 if(x>limit||x<-limit||y>limit||y<-limit||z>limit||z<-limit)return 0;
 *out=(FwPoint){(int32_t)x,(int32_t)y,(int32_t)z};return 1;
}
static int32_t dot(FwPoint a,FwPoint b){return (int32_t)(((int64_t)a.x*b.x+(int64_t)a.y*b.y+(int64_t)a.z*b.z)/4096);}
static int axis(FwPoint d,FwPoint *out){
 int32_t m=d.x<0?-d.x:d.x,t=d.y<0?-d.y:d.y;if(t>m)m=t;t=d.z<0?-d.z:d.z;if(t>m)m=t;
 if(m<4096)return 0;
 d.x=divide((int64_t)d.x*4096,m);d.y=divide((int64_t)d.y*4096,m);d.z=divide((int64_t)d.z*4096,m);
 int32_t length=(int32_t)root((uint32_t)(d.x*d.x+d.y*d.y+d.z*d.z));
 *out=(FwPoint){divide((int64_t)d.x*4096,length),divide((int64_t)d.y*4096,length),divide((int64_t)d.z*4096,length)};return 1;
}
int fwr_animation_plane(const FwPoint *native,int32_t vertical,
                        const FwrCamera *camera,FwPoint *out){
 if(!native||!out)return 0;
 *out=*native;
 FwPoint view;
 if(!camera||camera->projection>2||vertical< -8*FW_TILE||vertical>8*FW_TILE||
    !delta(camera->eye,camera->target,&view,1<<27))return 0;
 int32_t largest=view.x<0?-view.x:view.x,t=view.y<0?-view.y:view.y;
 if(t>largest)largest=t;
 t=view.z<0?-view.z:view.z;if(t>largest)largest=t;
 if(largest<4096)return 0;
 /* A common fixed-point scale retains more angular precision than a unit
  * vector. Three squared components still fit the freestanding divisor. */
 view.x=divide((int64_t)view.x*16384,largest);
 view.y=divide((int64_t)view.y*16384,largest);
 view.z=divide((int64_t)view.z*16384,largest);
 int32_t length=view.x*view.x+view.y*view.y+view.z*view.z;
 int64_t projection=(int64_t)vertical*view.y;
 int64_t x=(int64_t)native->x-divide(projection*view.x,length);
 int64_t y=(int64_t)native->y-divide(projection*view.y,length);
 int64_t z=(int64_t)native->z-divide(projection*view.z,length);
 if(x<INT32_MIN||x>INT32_MAX||y<INT32_MIN||y>INT32_MAX||z<INT32_MIN||z>INT32_MAX)return 0;
 *out=(FwPoint){(int32_t)x,(int32_t)y,(int32_t)z};return 1;
}
int fwr_camera_anchor(const FwPoint *native,const FwPoint *anchor,
                      const FwrCamera *camera,FwPoint *out){
 if(!native||!out)return 0;
 *out=*native;
 FwPoint forward;
 if(!anchor||!camera||camera->projection>2||anchor->y||
    anchor->x< -8*FW_TILE||anchor->x>8*FW_TILE||
    anchor->z< -8*FW_TILE||anchor->z>8*FW_TILE||
    !delta(camera->eye,camera->target,&forward,1<<27))return 0;
 forward.y=0;if(!axis(forward,&forward))return 0;
 int64_t x=(int64_t)native->x-anchor->x+
   divide((int64_t)anchor->x*forward.z+(int64_t)anchor->z*forward.x,4096);
 int64_t z=(int64_t)native->z-anchor->z+
   divide(-(int64_t)anchor->x*forward.x+(int64_t)anchor->z*forward.z,4096);
 if(x<INT32_MIN||x>INT32_MAX||z<INT32_MIN||z>INT32_MAX)return 0;
 *out=(FwPoint){(int32_t)x,native->y,(int32_t)z};return 1;
}
static int shift_depth(const FwrPose *native,const FwrCamera *camera,FwPoint direction,
                       int32_t change,FwrPose *out){
 *out=*native;
 if(change>2*FW_TILE||change<-2*FW_TILE)return 0;
 if(camera->projection==2){
  out->position.x+=divide((int64_t)direction.x*change,4096);
  out->position.y+=divide((int64_t)direction.y*change,4096);
  out->position.z+=divide((int64_t)direction.z*change,4096);
 }else{
  /* Shift on the eye ray and scale the quad so its screen pixels stay put. */
  FwPoint ray;
  if(!delta(camera->eye,native->position,&ray,1<<27))return 0;
  int32_t distance=dot(ray,direction);
  if(distance<4*FW_TILE||distance-change<4*FW_TILE)return 0;
  out->position.x+=divide((int64_t)ray.x*change,distance);
  out->position.y+=divide((int64_t)ray.y*change,distance);
  out->position.z+=divide((int64_t)ray.z*change,distance);
  out->sx+=divide(-(int64_t)native->sx*change,distance);
  out->sy+=divide(-(int64_t)native->sy*change,distance);
  if(out->sx<=0||out->sy<=0||out->sx>32767||out->sy>32767){*out=*native;return 0;}
 }
 return 1;
}
int fwr_head_position(const FwPoint *base,const FwrCamera *camera,int32_t height,FwPoint *out){
 FwPoint view,right,up;
 if(height<0||height>5*FW_TILE||!delta(camera->eye,camera->target,&view,1<<27)
    ||!axis(view,&view))return 0;
 right=(FwPoint){view.z,0,-view.x};
 /* axis expects at least one full world unit; this vector is already unit. */
 right.x*=4096;right.z*=4096;
 if(!axis(right,&right))return 0;
 up=(FwPoint){view.y*right.z,view.z*right.x-view.x*right.z,-view.y*right.x};
 if(!axis(up,&up))return 0;
 *out=(FwPoint){base->x+divide((int64_t)up.x*height,4096),
  base->y+divide((int64_t)up.y*height,4096),base->z+divide((int64_t)up.z*height,4096)};
 return 1;
}
int32_t fwr_box_advance_limit(const FwrPose *body,const FwrCamera *camera,const FwPoint corners[8]){
 FwPoint view,right,up,ray,relative;
 int32_t minX=INT32_MAX,maxX=INT32_MIN,minY=INT32_MAX,maxY=INT32_MIN;
 int32_t minDepth=INT32_MAX,maxDepth=INT32_MIN;
 if(camera->projection>2||body->sx<=0||body->sy<=0||body->sx>32767||body->sy>32767||
    !delta(camera->eye,camera->target,&view,1<<27)||!axis(view,&view))return 0;
 right=(FwPoint){view.z*4096,0,-view.x*4096};
 if(!axis(right,&right))return 0;
 up=(FwPoint){view.y*right.z,view.z*right.x-view.x*right.z,-view.y*right.x};
 if(!axis(up,&up)||!delta(camera->eye,body->position,&ray,1<<27))return 0;
 int32_t distance=dot(ray,view);
 if(distance<4*FW_TILE)return 0;
 for(unsigned i=0;i<8;++i){
  if(!delta(corners[i],body->position,&relative,16*FW_TILE))return 2*FW_TILE;
  int32_t depth=dot(relative,view),x=dot(relative,right),y=dot(relative,up);
  if(camera->projection!=2){
   if(distance-depth<4*FW_TILE)return 0;
   x=divide((int64_t)x*distance,distance-depth);y=divide((int64_t)y*distance,distance-depth);
  }
  if(x<minX)minX=x;
  if(x>maxX)maxX=x;
  if(y<minY)minY=y;
  if(y>maxY)maxY=y;
  if(depth<minDepth)minDepth=depth;
  if(depth>maxDepth)maxDepth=depth;
 }
 /* Native sprite geometry spans +/-8*sx and 0..16*sy from its foot anchor.
  * Empty texture margins can only make this conservative overlap smaller. */
 if(minX>=body->sx*8||maxX<=-body->sx*8||minY>=body->sy*16||maxY<=0||maxDepth<=0)return 2*FW_TILE;
 /* A geometric tie gap can collapse to the same native 15-bit Z value at
  * the field camera distance. Reserve the same four-unit clearance used
  * for native NPCs; never advance a baseline with less room than that. */
 return minDepth>FWR_PROP_FOREGROUND_GAP?minDepth-FWR_PROP_FOREGROUND_GAP:0;
}
int fwr_cap_advance(const FwrPose *baseline,const FwrPose *adjusted,
                    const FwrCamera *camera,int32_t limit,FwrPose *out){
 *out=*adjusted;FwPoint view,relative;
 if(limit<0||limit>2*FW_TILE||camera->projection>2||
    !delta(camera->eye,camera->target,&view,1<<27)||!axis(view,&view)||
    !delta(adjusted->position,baseline->position,&relative,8*FW_TILE))return 0;
 int32_t advance=dot(relative,view);
 if(advance<=limit)return 0;
 return shift_depth(adjusted,camera,view,limit-advance-16,out);
}
int fwr_above_shadow(const FwrPose *native,const FwPoint *ground,
                     const FwrCamera *camera,FwrPose *out){
 *out=*native;
 if(camera->projection>2||native->sx<=0||native->sy<=0||native->sx>32767||native->sy>32767)return 0;
 FwPoint direction,relative;
 if(!delta(camera->eye,camera->target,&direction,1<<27)||!axis(direction,&direction)
  ||!delta(native->position,*ground,&relative,8*FW_TILE))return 0;
 /* The shadow sits one unit above ground and spans several ground pixels.
  * Clear the whole footprint with a continuous depth clamp across bobbing
  * frames, so the player/follower overlap cannot toggle at a threshold. */
 int32_t current=dot(relative,direction),target=6*4096;
 if(current>=target)return 0;
 return shift_depth(native,camera,direction,target-current+16,out);
}
int fwr_player_in_front(const FwrPose *follower,const FwrPose *player,
                        const FwrCamera *camera,FwPoint direction,int32_t margin,int32_t max_advance,
                        FwrPose *out,int32_t *after){
 *out=*player;
 if(camera->projection>2||margin<FWR_TIE_MARGIN||margin>FW_TILE||max_advance<=0||
    max_advance>2*FW_TILE||
    player->sx<=0||player->sy<=0||player->sx>32767||player->sy>32767)return 0;
 FwPoint relative;
 if(!delta(follower->position,player->position,&relative,8*FW_TILE))return 0;
 int32_t current=dot(relative,direction),target=-margin;
 if(after)*after=current;
 if(current<=target)return 0;
 int32_t advance=current-target+64;
 if(advance>max_advance)advance=max_advance;
 if(!shift_depth(player,camera,direction,advance,out))return 0;
 if(after){
  if(!delta(follower->position,out->position,&relative,8*FW_TILE)){*out=*player;*after=current;return 0;}
  *after=dot(relative,direction);
 }
 return 1;
}
int fwr_cover_feet(const FwrPose *grass,const FwrPose *body,
                   const FwrPose *other,const FwrCamera *camera,FwrPose *out){
 *out=*grass;
 FwPoint direction,relative;
 if(camera->projection>2||!delta(camera->eye,camera->target,&direction,1<<27)||!axis(direction,&direction)
    ||!delta(grass->position,body->position,&relative,8*FW_TILE))return 0;
 /* Native geom type zero uses the inverse camera rotation for both actor
  * and grass quads: every vertex shares its center's camera-normal depth.
  * Keep the grass in its owner's depth interval, rather than advancing it
  * in front of both actors. Its native height still counts toward depth. */
 int32_t current=dot(relative,direction),lower=4*4096,upper=INT32_MAX;
 if(other&&delta(other->position,body->position,&relative,8*FW_TILE)){
  int32_t gap=dot(relative,direction);
  if(gap>0){
   if(gap<256)return 0;
   int32_t margin=divide(gap,3);if(margin>lower)margin=lower;
   lower=margin;upper=gap-margin;
  }
 }
 if(current>=lower&&current<=upper)return 0;
 int32_t change=current<lower?lower-current+16:upper-current-16;
 if(camera->projection==2)change=divide((int64_t)change*4096,dot(direction,direction));
 return shift_depth(grass,camera,direction,change,out);
}
int fwr_correct(const FwPoint *world,const FwPoint *player_world,
 const FwrPose *native,const FwPoint *player_draw,const FwrCamera *camera,
 unsigned flags,FwrPose *out,FwrResult *result){
 *out=*native;*result=(FwrResult){0};
 FwPoint direction,relative,base;
 if(camera->projection>2||native->sx<=0||native->sy<=0||native->sx>32767||native->sy>32767
  ||!delta(camera->eye,camera->target,&direction,1<<27)||!axis(direction,&direction)
  ||!delta(*world,*player_world,&base,4*FW_TILE)||!delta(native->position,*player_draw,&relative,8*FW_TILE))return 0;
 result->axis=direction;result->before=result->after=dot(relative,direction);
 /* Base positions choose ordering; cosmetic bobbing never changes that choice.
  * Elevation cases retain the separately tested stair policies for large art. */
 FwPoint horizontal=direction;horizontal.y=0;
 int32_t horizontal_length=(int32_t)root((uint32_t)(horizontal.x*horizontal.x+horizontal.z*horizontal.z));
 if(horizontal_length<256)return 0;
 int32_t h=divide((int64_t)dot(base,horizontal)*4096,horizontal_length),target=-FWR_TIE_MARGIN;
 int front=h>FW_TILE/2,unequal=base.y>8192||base.y<-8192,lower=0;
 if(flags&(FWR_FORCE_FRONT|FWR_FORCE_BACK)){
  front=!!(flags&FWR_FORCE_FRONT);
  /* Surf's seated rider and mount have overlapping quads. A tie-sized depth
   * gap can quantize away as the rider bobs, switching their visible order. */
  target=front?4*4096:-4*4096;
 }else if(unequal){
  if(!(flags&FWR_LARGE)||(!front&&base.y>0))return 0;
  lower=!front;target=front?8*4096:-4*4096;
 }else if(front){
  target=FWR_TIE_MARGIN;
  if((flags&FWR_NORTH)&&h<=3*FW_TILE/2){
   /* The north-facing visual correction displaced the sprite by -7 Z and
    * -2 Y. Restore its previous camera depth relative to the player by
    * moving only the submitted quad along the eye ray. The projected sprite
    * position remains fixed; the native shadow stays at its corrected anchor. */
   FwPoint lost={(int32_t)0,FWR_NORTH_ART_Y*4096,FWR_NORTH_ANCHOR_Z*4096};
   int32_t previousDepth=result->before+dot(lost,direction);
   if(previousDepth>target)target=previousDepth;
  }
 }
 result->policy=lower?-2:(front?1:-1);
 int32_t current=result->before;
 if(lower?current>=target:(front?current>=target:current<=target))return 0;
 int32_t change=target-current;
 /* Cover fixed-point normalization and translation rounding at submission. */
 change+=change<0?-16:16;
 /* A corrupt/disconnected pose must never cause a large visual teleport. */
 if(!shift_depth(native,camera,direction,change,out))return 0;
 if(!delta(out->position,*player_draw,&relative,8*FW_TILE)){*out=*native;return 0;}
 result->after=dot(relative,direction);return 1;
}
