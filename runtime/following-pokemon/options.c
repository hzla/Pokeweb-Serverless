#include "native.h"

/* The retail Options overlay has room for the sixth row on screen, but its
 * five-list arrays end immediately before unrelated process work. Keep the
 * extra windows and selection markers in this resident sidecar instead. */
enum { OPT_HEAP = 28, OPT_OFF = 1u << 11, OPT_ROW = 5, OPT_CONFIRM = 6, OPT_QUIT = 7 };
enum { INPUT_NONE, INPUT_SLIDE, INPUT_FLICK, INPUT_TOUCH, INPUT_UP, INPUT_DOWN,
       INPUT_RIGHT, INPUT_LEFT, INPUT_DECIDE, INPUT_CANCEL, INPUT_CONT_UP,
       INPUT_CONT_DOWN, INPUT_Y, INPUT_X, INPUT_KEY };
typedef struct { int32_t x,y; } OptPoint;
typedef struct { int16_t x,y; } OptPos;
typedef struct { int32_t input; OptPoint touch; } OptUi;
typedef struct { uint16_t font,back; int32_t select; void *items[11]; int32_t objectY; } OptScroll;
typedef struct { int16_t x,y; uint16_t sequence; uint8_t softPriority,bgPriority; } OptClData;
static const uint8_t optionDimensions[3][4]={{1,20,12,2},{15,20,6,2},{24,20,7,2}};
static const unsigned optionMessages[3]={6,21,22};
static struct {
 void *scroll,*config,*windows[3],*markers[2];
 uint8_t active,staged,original,virtualRow,shownRow,shownValue,shownFocus,touchMode;
 int16_t markerY;
} option;
static int master_enabled(void) {
 uint32_t file[32],header[8];
 CALL(0x02070ca9,void(*)(void*))(file);
 if(!CALL(0x02070ecd,int(*)(void*,const char*))(file,"rom:/following/native.bin"))return 0;
 unsigned size=CALL(0x02070ded,unsigned(*)(void*))(file);
 int ok=size==sizeof(header)&&CALL(0x02070e6d,unsigned(*)(void*,void*,unsigned))(file,header,sizeof(header))==sizeof(header);
 CALL(0x02070de1,int(*)(void*))(file);
 return ok&&header[0]==0x544e5746u&&header[1]==1u;
}
static void destroy_sidecar(void) {
 for(unsigned i=0;i<2;++i)if(option.markers[i]){
  CALL(0x0204c135,void(*)(void*))(option.markers[i]);option.markers[i]=0;
 }
 for(unsigned i=0;i<3;++i)if(option.windows[i]){
  CALL(0x0204823d,void(*)(void*))(option.windows[i]);option.windows[i]=0;
 }
 option.active=0;option.scroll=option.config=0;
}
static void print_window(void *window,void *font,void *message,unsigned id) {
 void *str=CALL(0x020489b9,void*(*)(void*,unsigned))(message,id);
 if(!str)return;
 void *bmp=CALL(0x02048521,void*(*)(void*))(window);
 CALL(0x02047169,void(*)(void*,unsigned))(bmp,0);
 CALL(0x02021d29,void(*)(void*,int,int,void*,void*))(bmp,0,0,str,font);
 CALL(0x02048271,void(*)(void*))(window);
 CALL(0x02048299,void(*)(void*))(window);
 unsigned frame=CALL(0x02048501,unsigned(*)(void*))(window);
 CALL(0x02045ba9,void(*)(unsigned))(frame);
 CALL(0x02048591,void(*)(void*))(str);
}
static void palette_region(unsigned frame,unsigned x,unsigned y,unsigned w,unsigned h,unsigned palette){
 CALL(0x02045699,void(*)(unsigned,unsigned,unsigned,unsigned,unsigned,unsigned))(frame,x,y,w,h,palette);
}
static uint16_t *background_tiles(const OptScroll *s){
 return CALL(0x02045841,uint16_t*(*)(unsigned))(s->back);
}
static __attribute__((noinline)) void extend_background(OptScroll *s){
 /* Reuse the complete fifth-row tile art for the sixth-row position so its
  * fill, bevel, and border exactly match the native Options rows. */
 uint16_t *tiles=background_tiles(s);
 if(!tiles)return;
 for(unsigned y=0;y<3;++y)for(unsigned x=0;x<32;++x)
  tiles[(17+y)*32+x]=tiles[(14+y)*32+x];
 CALL(0x02045ba9,void(*)(unsigned))(s->back);
}
static __attribute__((noinline)) void restyle_background(OptScroll *s,int focused){
 /* The retail palette updater stops after five rows. */
 uint16_t *tiles=background_tiles(s);
 if(!tiles)return;
 static const uint8_t bright[5]={3,1,0,1,3};
 int scroll=CALL(0x02044ea1,int(*)(unsigned))(s->back);
 int visible=5,top=scroll+20;
 while(top>=24&&visible>0){top-=24;--visible;}
 if(visible>4)visible=4;
 unsigned palette=focused?7u:bright[visible];
 if((tiles[17*32]>>12)!=palette){
  palette_region(s->back,0,17,32,3,palette);
  CALL(0x02045ba9,void(*)(unsigned))(s->back);
 }
}
static void restyle(OptScroll *s,int focused){
 unsigned label=focused?7u:0u,selected=focused?7u:0u,other=focused?12u:3u;
 palette_region(s->font,1,20,12,2,label);
 palette_region(s->font,15,20,6,2,option.staged?other:selected);
 palette_region(s->font,24,20,7,2,option.staged?selected:other);
 for(unsigned i=0;i<2;++i)if(option.markers[i]){
  unsigned checked=(i==option.staged);
  unsigned sequence=focused?(checked?3u:2u):(checked?0u:1u);
  CALL(0x0204c4e5,void(*)(void*,unsigned))(option.markers[i],sequence);
 }
 CALL(0x02045ba9,void(*)(unsigned))(s->font);
}
static void draw_help(void *message){
 /* The native message window and queue render the help line with its normal
  * font and timing. The blank entry is installed as message 30. */
 CALL(0x02044cc5,void(*)(unsigned,int))(4u,1);
 CALL(0x0219db99,void(*)(void*,unsigned,int,int))(message,30u,0,0);
}

void FollowingOptionsInit(OptScroll *s,unsigned font,unsigned back,void *graphic,const void *pre,unsigned heap){
 destroy_sidecar();
 CALL(0x0219e055,void(*)(void*,unsigned,unsigned,void*,const void*,unsigned))(s,font,back,graphic,pre,heap);
 if(!master_enabled())return;
 void *config=PTR(pre,8);
 if(!config)return;
 option.scroll=s;option.config=config;
 option.original=option.staged=!!(*(uint16_t*)config&OPT_OFF);
 option.virtualRow=s->select<0?0:(uint8_t)s->select;
 uint8_t *work=graphic;
 void *f=PTR(work,0x254),*m=PTR(work,0x25c);
 for(unsigned i=0;i<3;++i){
  option.windows[i]=CALL(0x020480ed,void*(*)(unsigned,unsigned,unsigned,unsigned,unsigned,unsigned,unsigned))
   (font,optionDimensions[i][0],optionDimensions[i][1],optionDimensions[i][2],optionDimensions[i][3],0,1);
  if(!option.windows[i]){destroy_sidecar();return;}
  print_window(option.windows[i],f,m,optionMessages[i]);
 }
 uint8_t *obj=work+0x7c;
 option.markerY=(int16_t)(120+s->objectY);
 for(unsigned i=0;i<2;++i){
  OptClData data={(int16_t)(i?192:120),option.markerY,0,2,2};
  option.markers[i]=CALL(0x0204c06d,void*(*)(void*,unsigned,unsigned,unsigned,const OptClData*,unsigned,unsigned))
   (PTR(obj,0),U32(obj,8),U32(obj,4),U32(obj,12),&data,0,OPT_HEAP);
  if(!option.markers[i]){destroy_sidecar();return;}
  CALL(0x0204c54d,void(*)(void*,int))(option.markers[i],0);
 }
 extend_background(s);
 option.active=1;option.shownRow=255;option.shownValue=255;option.shownFocus=255;
 option.touchMode=s->select<0;
 restyle_background(s,option.virtualRow==OPT_ROW&&!option.touchMode);
 restyle(s,option.virtualRow==OPT_ROW);
}
void FollowingOptionsExit(OptScroll *s){
 if(option.scroll==s)destroy_sidecar();
 CALL(0x0219e0d5,void(*)(void*))(s);
}
void FollowingOptionsMain(OptScroll *s,OptUi *ui,void *message,void *graphic,void *appbar){
 if(!option.active||option.scroll!=s){
  CALL(0x0219e0e1,void(*)(void*,void*,void*,void*,void*))(s,ui,message,graphic,appbar);return;
 }
 unsigned input=(unsigned)ui->input,old=option.virtualRow;
 if(input==INPUT_TOUCH||input==INPUT_SLIDE||input==INPUT_FLICK)option.touchMode=1;
 else if(input==INPUT_KEY||input==INPUT_UP||input==INPUT_DOWN||input==INPUT_RIGHT||
         input==INPUT_LEFT||input==INPUT_CONT_UP||input==INPUT_CONT_DOWN)option.touchMode=0;
 if(old==OPT_ROW&&(input==INPUT_LEFT||input==INPUT_RIGHT)){
  unsigned next=input==INPUT_RIGHT?1u:0u;
  if(option.staged!=next){option.staged=(uint8_t)next;CALL(0x02006255,void(*)(unsigned))(0x548u);}
  ui->input=INPUT_NONE;
 }
 /* The native sixth ordinal belongs to Confirm. Reuse its scroll movement,
  * then distinguish the inserted row from Confirm in this sidecar. */
 if(old==OPT_QUIT)s->select=6;
 else if(old==OPT_CONFIRM&&(input==INPUT_UP||input==INPUT_CONT_UP))s->select=6;
 else if(old==OPT_ROW)s->select=5;
 else if(old==OPT_CONFIRM)s->select=5;
 CALL(0x0219e0e1,void(*)(void*,void*,void*,void*,void*))(s,ui,message,graphic,appbar);
 ui->input=(int32_t)input;
 int16_t touchRowY=(int16_t)(120+s->objectY);
 if(input==INPUT_TOUCH&&ui->touch.y>=touchRowY-12&&ui->touch.y<touchRowY+12){
  option.virtualRow=OPT_ROW;s->select=5;
  uint8_t next=option.staged;
  if(ui->touch.x>=112&&ui->touch.x<184)next=0;
  else if(ui->touch.x>=184&&ui->touch.x<256)next=1;
  if(option.staged!=next){option.staged=next;CALL(0x02006255,void(*)(unsigned))(0x548u);}
 }else if(s->select>=0&&s->select<5)option.virtualRow=(uint8_t)s->select;
 else if(s->select==6)option.virtualRow=old==OPT_ROW?OPT_CONFIRM:
    old==OPT_CONFIRM&&input==INPUT_CONT_UP?OPT_CONFIRM:OPT_QUIT;
 else if(s->select==5)option.virtualRow=old==OPT_QUIT?OPT_CONFIRM:
    old==OPT_CONFIRM&&input!=INPUT_UP&&input!=INPUT_CONT_UP?OPT_CONFIRM:OPT_ROW;
 if(old==OPT_QUIT&&input==INPUT_DOWN&&s->select==0)option.virtualRow=0;
 if(option.virtualRow==OPT_ROW||option.virtualRow==OPT_CONFIRM)s->select=5;
 else if(option.virtualRow==OPT_QUIT)s->select=6;
 int16_t markerY=(int16_t)(120+s->objectY);
 if(markerY!=option.markerY){
  option.markerY=markerY;
  for(unsigned i=0;i<2;++i)if(option.markers[i]){
   OptPos position={(int16_t)(i?192:120),markerY};
   CALL(0x0204c16d,void(*)(void*,const void*,unsigned))(option.markers[i],&position,0);
  }
 }
 uint8_t focused=option.virtualRow==OPT_ROW&&!option.touchMode;
 restyle_background(s,focused);
 if(option.shownRow!=option.virtualRow||option.shownValue!=option.staged||option.shownFocus!=focused||input!=INPUT_NONE){
  restyle(s,focused);
  if(option.virtualRow==OPT_ROW&&(option.shownRow!=OPT_ROW||input==INPUT_TOUCH))draw_help(message);
  option.shownRow=option.virtualRow;option.shownValue=option.staged;option.shownFocus=focused;
 }
}
int FollowingOptionsSelect(const OptScroll *s){
 if(option.active&&option.scroll==s){
  if(option.virtualRow==OPT_ROW)return 4;
  if(option.virtualRow==OPT_CONFIRM)return 5;
  if(option.virtualRow==OPT_QUIT)return 6;
 }
 return s->select;
}
int FollowingOptionsCompare(const void *pre,const void *now){
 const uint8_t *a=pre,*b=now;
 for(unsigned i=0;i<5;++i)if(a[i]!=b[i])return 0;
 return !option.active||option.original==option.staged;
}
void FollowingOptionsCommit(const void *configParam){
 CALL(0x0219e8ed,void(*)(const void*))(configParam);
 if(option.active&&option.config){
  uint16_t *value=option.config;
  *value=(uint16_t)((*value&~OPT_OFF)|(option.staged?OPT_OFF:0u));
  option.original=option.staged;
 }
}
