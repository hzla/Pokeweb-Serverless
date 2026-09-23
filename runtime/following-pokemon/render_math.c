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
int fwr_correct(const FwPoint *world,const FwPoint *player_world,
 const FwrPose *native,const FwPoint *player_draw,const FwrCamera *camera,
 unsigned flags,FwrPose *out,FwrResult *result){
 *out=*native;*result=(FwrResult){0};
 FwPoint direction,relative,base,ray;
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
 if(unequal){
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
 if(change>2*FW_TILE||change<-2*FW_TILE)return 0;
 if(camera->projection==2){
  out->position.x+=divide((int64_t)direction.x*change,4096);
  out->position.y+=divide((int64_t)direction.y*change,4096);
  out->position.z+=divide((int64_t)direction.z*change,4096);
 }else{
  /* Move on the eye ray and scale the quad by the same ratio. Its projected
   * anchor and corners stay fixed, including off-center perspective cameras. */
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
 if(!delta(out->position,*player_draw,&relative,8*FW_TILE)){*out=*native;return 0;}
 result->after=dot(relative,direction);return 1;
}
