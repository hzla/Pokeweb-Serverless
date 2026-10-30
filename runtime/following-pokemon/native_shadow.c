#include "native_shadow.h"
#include "native_shadow_shape.h"
#include "render.h"
#include <limits.h>

typedef struct {
 uint16_t geom,pad;FwPoint position;uint16_t frame;int16_t sx,sy;
 uint16_t rotation,flags,pad2;
} ShadowBillboard;
typedef struct {
 void *resource;uint16_t width,height;uint8_t fw,fh,columns,rows;
 uint32_t texture,palette,format,sizeS,sizeT,texKey,palKey;
} ShadowMaterial;
typedef struct {
 uint32_t heap;ShadowMaterial *materials;ShadowBillboard *actors;
 uint16_t materialCount,actorCount;FwPoint scale;
 uint16_t diffuse,ambient,specular,emission;uint8_t baseId,origin;uint16_t pad;
 uint32_t keepView,customNormal;int16_t normal[3],texS,texT,pad2;
} ShadowScene;
_Static_assert(sizeof(ShadowBillboard)==28,"shadow actor ABI");
_Static_assert(sizeof(ShadowMaterial)==40,"shadow material ABI");
_Static_assert(sizeof(ShadowScene)==60,"shadow scene ABI");

static void command(unsigned op,uint32_t value){
 *(volatile uint32_t*)(0x04000400u+op*4u)=value;
}
static void vertex(int16_t x,int16_t y,int16_t z){
 command(0x23,(uint16_t)x|((uint32_t)(uint16_t)y<<16));command(0x23,(uint16_t)z);
}
/* Screen-space stencil triangles share the native fractional raster vertices
 * and sort bounds with their ground triangles. The far plane uses a bounded
 * W of 2048, safely inside the DS's 24-bit W representation. */
static void mask_begin(void){
 static const int32_t matrix[16]={2097152,0,0,0,0,2796203,0,0,0,0,8388608,0,0,0,8388608,8388608};
 command(0x10,0);command(0x11,0);for(unsigned i=0;i<16;++i)command(0x16,(uint32_t)matrix[i]);
 command(0x10,1);command(0x11,0);command(0x15,0);
 command(0x2a,0);command(0x29,(1u<<16)|0xf0u);
}
static void local_point(const ShadowBillboard *shadow,const FwPoint *direction,unsigned x,unsigned y,int16_t *ox,int16_t *oz){
 if(shadow->flags&1024u)x=16-x;
 if(shadow->flags&2048u)y=16-y;
 int px=((int)x-8)*shadow->sx/8,pz=(8-(int)y)*shadow->sy/8;
 *ox=(int16_t)(((int64_t)px*direction->z+(int64_t)pz*direction->x)/4096);*oz=(int16_t)((-(int64_t)px*direction->x+(int64_t)pz*direction->z)/4096);
}
static void point(const ShadowBillboard *shadow,const FwPoint *direction,unsigned x,unsigned y){int16_t px,pz;local_point(shadow,direction,x,y,&px,&pz);vertex(px,0,pz);}
static void triangle(const ShadowBillboard *shadow,const FwPoint *direction,unsigned edge,int lit,uint32_t normal){
 unsigned next=edge+1;if(next==sizeof(fwn_shadow_outline)/sizeof(fwn_shadow_outline[0]))next=0;
 if(((shadow->flags>>10)^(shadow->flags>>11))&1u){unsigned swap=edge;edge=next;next=swap;}
 command(0x40,0);
 /* Lighting uses the current primitive's light mask, latched by BEGIN. */
 if(lit)command(0x20,normal);
 point(shadow,direction,8,8);point(shadow,direction,fwn_shadow_outline[edge][0],fwn_shadow_outline[edge][1]);point(shadow,direction,fwn_shadow_outline[next][0],fwn_shadow_outline[next][1]);
 command(0x41,0);
}
/* Native shadow palette entry 1 is RGB(8,8,8). Evaluate the native
 * material/light state before its modulation, then encode the resulting tint
 * for an untextured shadow primitive. Geometry shadow mode uses decal alpha. */
static int signed11(int n){n&=2047;return n>=1024?n-2048:n;}
static unsigned quotient(unsigned n,unsigned d){unsigned q=0;if(!d)return 0;for(int b=31;b>=0;--b)if((n>>b)>=d){n-=d<<b;q|=1u<<b;}return q;}
static uint16_t shadow_tint(const ShadowScene *scene,void *light,unsigned lights,uint32_t normal,const int32_t *view){
 if(!lights||!light)return 0x2108u;
 int input[3],n[3];for(unsigned k=0;k<3;++k){int v=(normal>>(10*k))&1023;input[k]=v>=512?v-1024:v;}
 for(unsigned k=0;k<3;++k)n[k]=signed11((int)(((int64_t)input[0]*view[k]+(int64_t)input[1]*view[3+k]+(int64_t)input[2]*view[6+k])>>12));
 uint32_t color[3];for(unsigned k=0;k<3;++k)color[k]=((scene->emission>>(5*k))&31u)<<14;
 for(unsigned id=0;id<4;++id){
  if(!(lights&(1u<<id)))continue;
  struct{int16_t x,y,z;} raw;uint16_t rgb;
  CALL(0x0204a78d,void(*)(void*,unsigned,void*))(light,id,&raw);
  CALL(0x0204a7b9,void(*)(void*,unsigned,uint16_t*))(light,id,&rgb);
  int v[3]={raw.x>>3,raw.y>>3,raw.z>>3},l[3],z=0;
  for(unsigned k=0;k<3;++k){v[k]&=1023;if(v[k]>=512)v[k]-=1024;}
  for(unsigned k=0;k<3;++k){int t=(int)(((int64_t)v[0]*view[k]+(int64_t)v[1]*view[3+k]+(int64_t)v[2]*view[6+k])>>12);l[k]=signed11(-t);if(k==2)z=signed11(t);}
  int dot=0;for(unsigned k=0;k<3;++k)dot+=(l[k]*n[k])>>9;
  int diffuse=dot>0?signed11(dot):0,shine=0;
  if(dot>0){int h=signed11(dot+n[2]);unsigned squared=((h*h)>>10)&1023u;unsigned den=(unsigned)(512-z);int value=(int)((squared*quotient(1u<<18,den))>>8)-512;if(value>0){value&=16383;if(value<8192)shine=value>511?511:value;}}
  for(unsigned k=0;k<3;++k){unsigned c=(rgb>>(5*k))&31u,d=(scene->diffuse>>(5*k))&31u,a=(scene->ambient>>(5*k))&31u,sp=(scene->specular>>(5*k))&31u;if(dot>0)color[k]+=(d*c*diffuse)&0xfffffu;color[k]+=(sp*(unsigned)shine+(a<<9))*c;}
 }
 uint16_t out=0;for(unsigned k=0;k<3;++k){unsigned c=color[k]>>14;if(c>31)c=31;unsigned c6=c?2*c+1:0;unsigned modulated=(18*(c6+1)-1)>>6;out|=(uint16_t)((modulated>>1)<<(5*k));}return out;
}
/* Preserve the four fractional viewport bits used by scaled renderers as
 * well as the integer coordinates used on hardware. */
typedef struct{uint16_t x,y;} ScreenPoint;
static unsigned viewport_fraction(uint32_t n,uint32_t w,unsigned size){
 uint64_t value=(uint64_t)n*size*8u,divisor=(uint64_t)w<<13;unsigned q=0;
 for(unsigned bit=1u<<13;bit;bit>>=1,divisor>>=1)if(value>=divisor){value-=divisor;q|=bit;}
 return q;
}
static int screen_points(const ShadowBillboard *shadow,const FwPoint *direction,const int32_t *projection,const int32_t *view,ScreenPoint *out){
 int32_t model[16]={0},clip[4][3];
 for(unsigned row=0;row<3;++row)for(unsigned col=0;col<3;++col)model[row*4+col]=view[row*3+col]*8;
 int32_t t[3]={shadow->position.x/8,shadow->position.y/8,shadow->position.z/8};
 for(unsigned col=0;col<3;++col)model[12+col]=view[9+col]+(int32_t)(((int64_t)model[col]*t[0]+(int64_t)model[4+col]*t[1]+(int64_t)model[8+col]*t[2])>>12);
 model[15]=4096;
 for(unsigned row=0;row<4;++row)for(unsigned k=0;k<3;++k){unsigned col=k==2?3:k;int64_t sum=0;for(unsigned j=0;j<4;++j)sum+=(int64_t)model[row*4+j]*projection[j*4+col];clip[row][k]=(int32_t)(sum>>12);}
 for(unsigned i=0;i<1+sizeof(fwn_shadow_outline)/sizeof(fwn_shadow_outline[0]);++i){
  unsigned x=i?fwn_shadow_outline[i-1][0]:8,y=i?fwn_shadow_outline[i-1][1]:8;int16_t px,pz;local_point(shadow,direction,x,y,&px,&pz);int32_t c[3];
  for(unsigned k=0;k<3;++k)c[k]=(int32_t)(((int64_t)px*clip[0][k]+(int64_t)pz*clip[2][k]+(int64_t)4096*clip[3][k])>>12);
  int32_t w=c[2];if(w<4096||w>=0x7f0000||c[0]<-w||c[0]>w||c[1]<-w||c[1]>w)return 0;
  unsigned nx=(unsigned)(c[0]+w),ny=(unsigned)(-c[1]+w),den=(unsigned)w;if(w>65535){nx>>=1;ny>>=1;den>>=1;}den<<=1;
  unsigned ix=quotient(nx*256u,den),iy=quotient(ny*192u,den);
  unsigned hx=viewport_fraction((unsigned)(c[0]+w),(unsigned)w,256),hy=viewport_fraction((unsigned)(-c[1]+w),(unsigned)w,192);
  /* Rare divider-boundary cases with conflicting integer/fractional floors
   * retain native rendering rather than produce mismatched stencil edges. */
  if((hx>>4)!=ix||(hy>>4)!=iy)return 0;
  out[i].x=(uint16_t)hx;out[i].y=(uint16_t)hy;
 }
 return 1;
}
static void screen_triangle(const ShadowBillboard *shadow,const ScreenPoint *points,unsigned edge){
 unsigned next=edge+1;if(next==sizeof(fwn_shadow_outline)/sizeof(fwn_shadow_outline[0]))next=0;
 if(((shadow->flags>>10)^(shadow->flags>>11))&1u){unsigned swap=edge;edge=next;next=swap;}
 unsigned indices[3]={0,edge+1,next+1};command(0x40,0);
 for(unsigned i=0;i<3;++i){const ScreenPoint *p=points+indices[i];vertex((int16_t)(((int)p->x-2048)*8+1),(int16_t)((1536-(int)p->y)*8-1),0);}
 command(0x41,0);
}
/* Resolve only the live native shadow task bound to this exact actor and
 * identity. A recycled slot or another actor's nearby oval is ineligible. */
static ShadowBillboard *owned_shadow(void *system,Actor *actor){
 if(!system||!actor||!actor->system||(actor->flags&5u)!=1u)return 0;
 ShadowScene *scene=PTR(system,4);uint8_t *slots=PTR(system,24);
 unsigned count=*(uint16_t*)((uint8_t*)system+28);
 if(!scene||!scene->actors||!slots||count>256||scene->actorCount>256)return 0;
 for(unsigned i=0;i<count;++i){
  uint8_t *slot=slots+i*40;unsigned index=U32(slot,0);uint8_t *work=PTR(slot,36);
  if(index>=scene->actorCount||!fwr_grass_work_valid(work))continue;
  uint8_t *task=work-24;
  if(U32(task,0)!=1||U32(task,188)!=0x021a3c61u||U32(task,196)!=0x021a3d15u||U32(task,200)!=0x021a3d69u)continue;
  if(PTR(work,8)!=actor||*(uint16_t*)(work+12)!=actor->id||*(uint16_t*)(work+14)!=actor->model||*(uint16_t*)(work+16)!=actor->zone||U32(work,20)!=i)continue;
  uint8_t *handle=PTR(work,4);
  if(!fwr_grass_work_valid(handle)||PTR(handle,16)!=system||PTR(handle,20)!=scene)continue;
  ShadowBillboard *b=scene->actors+index;
  if(U32(work,0)||!(b->flags&512u)||(b->geom>>14)!=3||(b->geom&0x3fffu)>=scene->materialCount)return 0;
  return b;
 }
 return 0;
}
void fwn_shadow_draw(void *system,void *camera,void *light,Actor *actor){
 ShadowBillboard *body=camera?owned_shadow(system,actor):0;
 ShadowScene *scene=system?PTR(system,4):0;
 ShadowMaterial *mat=body?scene->materials+(body->geom&0x3fffu):0;
 /* NNS_G3dGlbGetProjectionMtx: the native cached projection at global +8. */
 const int32_t *projection=(const int32_t*)0x02143a54u;
 if(body){
  int nonzero=0;
  for(unsigned i=0;i<16;++i){if(projection[i]>INT32_MAX/2||projection[i]<INT32_MIN/2)body=0;nonzero|=projection[i];}
  if(!nonzero)body=0;
  /* Native perspective/frustum and orthographic field projections have
   * integral W and qualify for the matched viewport stencil. */
  if(projection[3]||projection[7]||!((projection[11]==-4096&&projection[15]==0)||(projection[11]==0&&projection[15]==4096)))body=0;
 }
 FwPoint direction={0};
 if(body){
  const FwPoint *eye=(const FwPoint*)((uint8_t*)camera+32),*target=(const FwPoint*)((uint8_t*)camera+56);
  int64_t x=(int64_t)eye->x-target->x,z=(int64_t)eye->z-target->z;
  int64_t bx=(int64_t)eye->x-body->position.x,by=(int64_t)eye->y-body->position.y,bz=(int64_t)eye->z-body->position.z;
  if(x<-(1<<27)||x>(1<<27)||z<-(1<<27)||z>(1<<27)||(x==0&&z==0)||bx<-(1<<22)||bx>(1<<22)||by<-(1<<22)||by>(1<<22)||bz<-(1<<22)||bz>(1<<22))body=0;
  else direction=(FwPoint){(int32_t)x,0,(int32_t)z};
 }
 /* The audited native shadow is a centred, unrotated, flat 16-pixel quad.
  * Unsupported effect geometry retains its native rendering. */
 if(!body||!mat||scene->scale.x!=32768||scene->scale.y!=32768||scene->scale.z!=32768||scene->origin!=0||body->rotation||body->frame||body->sx<=0||body->sy<=0||body->sx>16384||body->sy>16384||mat->format!=2||mat->columns!=1||mat->rows!=1||mat->fw!=16||mat->fh!=16){
  CALL(0x0204f685,void(*)(void*,void*,void*))(system,camera,light);return;
 }
 CALL(0x02074280,void(*)(const FwPoint*,FwPoint*))(&direction,&direction);
 int32_t view[12];CALL(0x02073354,void(*)(const void*,const void*,const void*,void*))((uint8_t*)camera+32,(uint8_t*)camera+44,(uint8_t*)camera+56,view);
 ShadowBillboard shadow=*body;ScreenPoint projected[1+sizeof(fwn_shadow_outline)/sizeof(fwn_shadow_outline[0])];
 if(!screen_points(&shadow,&direction,projection,view,projected)){CALL(0x0204f685,void(*)(void*,void*,void*))(system,camera,light);return;}
 body->flags&=(uint16_t)~512u;
 CALL(0x0204f685,void(*)(void*,void*,void*))(system,camera,light);
 *body=shadow;
 /* Reuse native camera, lighting and scene scale setup without allocating a
  * second scene, changing the native shadow task, or touching other actors. */
 uint32_t emptySystem[9];for(unsigned i=0;i<9;++i)emptySystem[i]=U32(system,i*4);
 ShadowScene empty=*scene;empty.actorCount=0;emptySystem[1]=(uint32_t)&empty;
 CALL(0x0204f685,void(*)(void*,void*,void*))(emptySystem,camera,light);
 command(0x11,0);
 command(0x1c,(uint32_t)(shadow.position.x/8));command(0x1c,(uint32_t)(shadow.position.y/8));command(0x1c,(uint32_t)(shadow.position.z/8));
 uint32_t normalBits=0;
 if(shadow.flags>>12){
  FwPoint normal;const FwPoint *eye=(const FwPoint*)((uint8_t*)camera+32),*target=(const FwPoint*)((uint8_t*)camera+56);
  normal=(FwPoint){eye->x-target->x,eye->y-target->y,eye->z-target->z};
  CALL(0x02074280,void(*)(const FwPoint*,FwPoint*))(&normal,&normal);
  int nx=scene->customNormal?scene->normal[0]:normal.x,ny=scene->customNormal?scene->normal[1]:normal.y,nz=scene->customNormal?scene->normal[2]:normal.z;
  normalBits=((uint32_t)(nx>>3)&1023u)|(((uint32_t)(ny>>3)&1023u)<<10)|(((uint32_t)(nz>>3)&1023u)<<20);
 }
 if(!light&&actor->system){void *field=PTR(actor->system,64);if(field)light=CALL(0x021804dd,void*(*)(void*))(field);}
 uint16_t tint=shadow_tint(scene,light,shadow.flags>>12,normalBits,view);
 command(0x30,scene->diffuse|0x8000u|((uint32_t)scene->ambient<<16));
 command(0x31,scene->specular|((uint32_t)scene->emission<<16));
 /* DS shadow mode ignores texture alpha. Use the native texture's opaque
  * outline as a ground-plane triangle fan; each mask precedes its matching
  * shadow in either native sorting mode. The walking body is never split. */
 for(unsigned edge=0;edge<sizeof(fwn_shadow_outline)/sizeof(fwn_shadow_outline[0]);++edge){
  mask_begin();screen_triangle(&shadow,projected,edge);
  command(0x12,1);command(0x10,0);command(0x12,1);command(0x10,1);
  command(0x2a,0);
  command(0x29,(FWN_SHADOW_BODY_ID<<24)|((uint32_t)(shadow.flags&31u)<<16)|0x80f0u|(shadow.flags>>12));
  triangle(&shadow,&direction,edge,1,tint);
 }
 command(0x12,1);
}
