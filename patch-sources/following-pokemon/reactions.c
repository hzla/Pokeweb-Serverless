#include "reactions.h"
uint16_t fwr_u16(const uint8_t *p){return p[0]|((uint16_t)p[1]<<8);}
uint32_t fwr_u32(const uint8_t *p){return fwr_u16(p)|((uint32_t)fwr_u16(p+2)<<16);}
uint32_t fwr_crc(const uint8_t *p,unsigned n){uint32_t c=~0u;while(n--){c^=*p++;for(unsigned j=0;j<8;++j)c=(c>>1)^((0u-(c&1))&0xedb88320u);}return ~c;}
static int range(unsigned off,unsigned n,unsigned length){return off>=48 && off<=length && n<=length-off;}
static int narc_member(const uint8_t *n,unsigned size,const uint8_t **member,unsigned *length){
 if(!n||size<76||size>FWR_CONTEXT_CAPACITY||fwr_u32(n)!=0x4352414e||fwr_u16(n+4)!=0xfeff||fwr_u16(n+6)!=1||fwr_u32(n+8)!=size||fwr_u16(n+12)!=16||fwr_u16(n+14)!=3)return 0;
 unsigned fat=16;if(fwr_u32(n+fat)!=0x46415442||fwr_u32(n+fat+4)<20||fwr_u16(n+fat+8)!=1)return 0;
 unsigned fnt=fat+fwr_u32(n+fat+4);if(fnt>size||size-fnt<16||fwr_u32(n+fnt)!=0x464e5442||fwr_u32(n+fnt+4)<16)return 0;
 unsigned gmif=fnt+fwr_u32(n+fnt+4);if(gmif>size||size-gmif<8||fwr_u32(n+gmif)!=0x46494d47)return 0;
 unsigned gmifSize=fwr_u32(n+gmif+4),start=fwr_u32(n+fat+12),end=fwr_u32(n+fat+16),base=gmif+8;
 if(gmifSize<8||gmifSize>size-gmif||start>end||end>gmifSize-8||base+end>size)return 0;
 *member=n+base+start;*length=end-start;return 1;
}
int fwr_validate(FwrData *out,const void *buffer,unsigned size){
 const uint8_t *b=buffer; *out=(FwrData){0};
 if(!b || size<48 || size>FWR_CAPACITY || fwr_u32(b)!=0x4b545746 || fwr_u32(b+4)!=1 || fwr_u32(b+8)!=size || fwr_crc(b+16,size-16)!=fwr_u32(b+12))return 0;
 FwrData d={.bytes=b,.length=size,.ruleCount=fwr_u16(b+16),.motionCount=fwr_u16(b+18),.messageCount=fwr_u16(b+20),.bubbleCount=fwr_u16(b+22),.rules=fwr_u32(b+24),.motions=fwr_u32(b+28),.messages=fwr_u32(b+32),.bubbles=fwr_u32(b+36),.emoteBytes=fwr_u32(b+40),.emoteCrc=fwr_u32(b+44)};
 if(!d.ruleCount || d.ruleCount>70 || !d.motionCount || d.motionCount>64 || !d.messageCount || d.messageCount>128 || !d.bubbleCount || d.bubbleCount>14 || d.emoteBytes>32768 || d.emoteBytes<64)return 0;
 if(!range(d.rules,d.ruleCount*12,size)||!range(d.motions,d.motionCount*84,size)||!range(d.messages,d.messageCount*8,size)||!range(d.bubbles,d.bubbleCount*16,size))return 0;
 for(unsigned i=0;i<d.ruleCount;++i){
  const uint8_t *r=b+d.rules+i*12;unsigned off=fwr_u32(r+8);
  if(!fwr_u16(r)||r[2]>5||r[3]>10||r[4]>8||r[5]>4||r[6]>100||!r[7]||r[7]>5||!range(off,r[7]*8,size))return 0;
  for(unsigned j=0;j<r[7];++j){const uint8_t *s=b+off+j*8;if(fwr_u16(s)>d.motionCount||fwr_u16(s+2)>d.messageCount||fwr_u16(s+4)>2||s[6]>d.bubbleCount)return 0;}
 }
 const uint8_t *last=b+d.rules+(d.ruleCount-1)*12;
 if(last[2]||last[3]||last[4]||last[5]||last[6]!=100)return 0;
 for(unsigned i=0;i<d.motionCount;++i){const uint8_t *m=b+d.motions+i*84;if(!m[2]||m[2]>10)return 0;
  for(unsigned j=0;j<m[2];++j){const uint8_t *s=m+4+j*8;if(s[0]>4||!s[1]||s[1]>120||s[5]>1)return 0;
 for(unsigned k=2;k<5;++k)if((int8_t)s[k]<-16||(int8_t)s[k]>16)return 0;}}
 for(unsigned i=0;i<d.messageCount;++i){const uint8_t *m=b+d.messages+i*8;unsigned off=fwr_u32(m),n=fwr_u16(m+4);if(!n||n>128||off%2||!range(off,n*2,size)||fwr_u16(b+off+n*2-2)!=0xffff)return 0;
  for(unsigned j=0;j+1<n;++j){unsigned c=fwr_u16(b+off+j*2);if(c==0xffff||!c||(c>=0xf000&&c!=0xfff0&&c!=0xfff1&&c!=0xfffe))return 0;}}
 for(unsigned i=0;i<d.bubbleCount;++i){const uint8_t *e=b+d.bubbles+i*16;if(!e[0]||e[0]>14||e[1]!=4||fwr_u16(e+2)!=i*2)return 0;
 for(unsigned j=0;j<4;++j)if(!fwr_u16(e+4+j*2)||fwr_u16(e+4+j*2)>120||e[12+j]>1)return 0;}
 *out=d;return 1;
}
unsigned fwr_hp(const FwrSnapshot *p){unsigned hp=p->pokemon.hp,max=p->pokemon.max_hp;if(!max)return 0;
 if(hp>=max)return 1;
 unsigned percent=hp*100/max;return percent>=75?2:percent>=50?3:percent>=25?4:5;}
unsigned fwr_status(uint32_t c){return c&(8|128)?5:c&7?8:c&16?2:c&32?3:c&64?4:1;}
int fwr_friend(unsigned c,unsigned v){switch(c){case 0:return 1;
 case 1:return v==255;case 2:return v>=200&&v<255;case 3:return v>=150&&v<200;case 4:return v>=90&&v<150;case 5:return v>=60&&v<90;case 6:return v>=30&&v<60;case 7:return v>=1&&v<30;case 8:return v==0;case 9:return v>=90;case 10:return v<60;default:return 0;}}
static uint32_t random_next(uint32_t *r){uint32_t x=*r?*r:0x4657544b;x^=x<<13;x^=x>>17;x^=x<<5;return *r=x;}
int fwr_choose(const FwrData *d,const FwrSnapshot *p,uint32_t *rng){
 unsigned hp=fwr_hp(p),status=fwr_status(p->status);if(!d->bytes||!hp||p->pokemon.egg||!p->pokemon.species||p->pokemon.species>FW_MAX_SPECIES||p->direction>3)return -1;
 /* Source facing codes: right,left,up,down. Native directions: up,down,left,right. */
 static const uint8_t dir[4]={3,4,2,1};
 for(unsigned i=0;i<d->ruleCount;++i){const uint8_t *r=d->bytes+d->rules+i*12;
  unsigned roll=random_next(rng)%100; /* HGSS rolls before evaluating conditions. */
  if(roll>=r[6]||(r[2]&&r[2]!=hp)||!fwr_friend(r[3],p->friendship)||(r[4]&&!(r[4]==7?status!=1:r[4]==status))||(r[5]&&r[5]!=dir[p->direction]))continue;
  return (int)i;
 }return -1;
}
int fwr_step(const FwrData *d,unsigned rule,unsigned step,FwrStep *out){
 if(rule>=d->ruleCount)return 0;
 const uint8_t *r=d->bytes+d->rules+rule*12;if(step>=r[7])return 0;
 const uint8_t *s=d->bytes+fwr_u32(r+8)+step*8;
 *out=(FwrStep){fwr_u16(s),fwr_u16(s+2),fwr_u16(s+4),s[6],s[7]};return 1;
}
unsigned fwr_text(const FwrData *d,unsigned message,const FwrSnapshot *p,uint16_t *out,unsigned cap){
 if(!cap||!message||message>d->messageCount)return 0;
 unsigned n=0;const uint8_t *m=d->bytes+d->messages+(message-1)*8,*text=d->bytes+fwr_u32(m);
 for(unsigned i=0;i<fwr_u16(m+4);++i){unsigned c=fwr_u16(text+i*2);if(c==0xffff)break;
  if(c==0xfff0||c==0xfff1){const uint16_t *name=c==0xfff0?p->nickname:p->playerName;unsigned max=c==0xfff0?11:8;
   for(unsigned j=0;j<max&&name[j]&&name[j]!=0xffff;++j){if(n+1>=cap)return 0;
 out[n++]=name[j];}}
  else{if(n+1>=cap)return 0;
 out[n++]=(uint16_t)c;}}
 out[n]=0xffff;return n;
}
int fwr_motion_tick(const FwrData *d,unsigned action,FwrMotion *v,int grounded,int *cry){
 *cry=0;if(!action||action>d->motionCount)return 0;
 const uint8_t *m=d->bytes+d->motions+(action-1)*84;if(v->index>=m[2])return 0;
 const uint8_t *s=m+4+v->index*8;
 if(!v->age){if(s[0])v->face=s[0]-1;v->x+=(int8_t)s[2]*4096;if(!grounded)v->y+=(int8_t)s[3]*4096;v->z+=(int8_t)s[4]*4096;*cry=s[5];}
 if(++v->age>=s[1]){v->age=0;++v->index;}return 1;
}

/* Thumb-only EABI division: keep RPM away from ARM immediate-BLX veneers. */
__attribute__((visibility("hidden"))) uint64_t __aeabi_uidivmod(uint32_t n,uint32_t d){
 uint32_t q=0,r=0;if(!d)return 0;
 for(int i=31;i>=0;--i){unsigned carry=r>>31;r=(r<<1)|((n>>i)&1);if(carry||r>=d){r-=d;q|=1u<<i;}}
 return ((uint64_t)r<<32)|q;
}
__attribute__((visibility("hidden"))) uint32_t __aeabi_uidiv(uint32_t n,uint32_t d){return (uint32_t)__aeabi_uidivmod(n,d);}

/* Contextual dialogue is a single-member NARC.  The rule member remains in ROM
 * and is validated before it can influence field input or message rendering. */
int fwr_context_validate(FwrContext *out,const void *buffer,unsigned size){
 const uint8_t *b;unsigned len;*out=(FwrContext){0};
 if(!narc_member(buffer,size,&b,&len))return 0;
 if(len<16||fwr_u32(b)!=0x44435746||fwr_u16(b+4)!=1||fwr_u32(b+8)!=len||fwr_crc(b+16,len-16)!=fwr_u32(b+12))return 0;
 unsigned count=fwr_u16(b+6);if(16+count*20>len)return 0;
 for(unsigned i=0;i<count;++i){const uint8_t *r=b+16+i*20;unsigned text=fwr_u32(r+12),words=fwr_u16(r+16);
  if(r[6]>5||r[7]>10||r[8]>8||r[9]>4||!r[10]||r[11]||fwr_u16(r+18)||!words||words>FWR_TEXT_CAPACITY||text&1||text<16+count*20||text>len||words*2>len-text||fwr_u16(b+text+(words-1)*2)!=0xffff)return 0;
  for(unsigned j=0;j+1<words;++j){unsigned c=fwr_u16(b+text+j*2);if(!c||c==0xffff||(c>=0xf000&&c!=0xfff0&&c!=0xfff1&&c!=0xfff2&&c!=0xfffe))return 0;}
 }
 *out=(FwrContext){.bytes=b,.length=len,.ruleCount=count};return 1;
}
int fwr_context_choose(const FwrContext *d,const FwrSnapshot *p,uint32_t *rng){
 if(!d||!d->bytes||p->pokemon.egg||!p->pokemon.species||p->pokemon.species>FW_MAX_SPECIES)return -1;
 unsigned hp=fwr_hp(p),status=fwr_status(p->status);if(!hp||p->direction>3)return -1;
 static const uint8_t dir[4]={3,4,2,1};
 for(unsigned i=0;i<d->ruleCount;++i){const uint8_t *r=d->bytes+16+i*20;unsigned zone=fwr_u16(r),species=fwr_u16(r+2),roll=random_next(rng)%100;
  if(roll>=r[10]||(zone&&zone!=p->zone)||(species&&species!=p->pokemon.species)||(r[4]!=255&&r[4]!=p->pokemon.form)||(r[5]!=255&&r[5]!=p->type1&&r[5]!=p->type2)||(r[6]&&r[6]!=hp)||!fwr_friend(r[7],p->friendship)||(r[8]&&!(r[8]==7?status!=1:r[8]==status))||(r[9]&&r[9]!=dir[p->direction]))continue;
  return (int)i;
 }return -1;
}
unsigned fwr_context_text(const FwrContext *d,unsigned rule,const FwrSnapshot *p,uint16_t *out,unsigned cap){
 if(!d||!d->bytes||rule>=d->ruleCount||!cap)return 0;
 const uint8_t *r=d->bytes+16+rule*20;unsigned off=fwr_u32(r+12),words=fwr_u16(r+16),n=0;
 for(unsigned i=0;i<words;++i){unsigned c=fwr_u16(d->bytes+off+i*2);if(c==0xffff)break;
  if(c==0xfff0||c==0xfff1){const uint16_t *name=c==0xfff0?p->nickname:p->playerName;unsigned max=c==0xfff0?11:8;for(unsigned j=0;j<max&&name[j]&&name[j]!=0xffff;++j){if(n+1>=cap)return 0;out[n++]=name[j];}}
  else if(c==0xfff2){ /* Location labels are intentionally numeric until a name table is authored. */ if(n+6>=cap)return 0;out[n++]='Z';out[n++]='o';out[n++]='n';out[n++]='e';out[n++]=' ';unsigned z=p->zone; if(z>9999)z=9999;unsigned div=1000;int seen=0;while(div){unsigned q=z/div;if(q||seen||div==1){out[n++]=(uint16_t)('0'+q);seen=1;}z%=div;div/=10;}}
  else{if(n+1>=cap)return 0;out[n++]=(uint16_t)c;}}
 out[n]=0xffff;return n;
}

int fwr_items_validate(FwrItems *out,const void *buffer,unsigned size){
 const uint8_t *b;unsigned len,count,floor;*out=(FwrItems){0};
 if(!narc_member(buffer,size,&b,&len)||len<16||fwr_u32(b)!=0x49545746||fwr_u16(b+4)!=1||fwr_u32(b+8)!=len||fwr_crc(b+16,len-16)!=fwr_u32(b+12))return 0;
 count=fwr_u16(b+6);floor=16+count*28;if(floor>len)return 0;
 for(unsigned i=0;i<count;++i){const uint8_t*r=b+16+i*28;unsigned name=fwr_u32(r+14),nw=fwr_u16(r+18),text=fwr_u32(r+20),tw=fwr_u16(r+24);
  if(r[6]>9||!fwr_u16(r+4)||!r[13]||(r[7]!=255&&!fwr_u16(r+2))||(r[8]>31&&r[8]!=255)||r[9]>5||r[10]>10||r[11]>8||r[12]>4||fwr_u16(r+26)||!nw||nw>192||!tw||tw>192||name%2||text%2||name<floor||text<floor||name+nw*2>len||text+tw*2>len||fwr_u16(b+name+nw*2-2)!=0xffff||fwr_u16(b+text+tw*2-2)!=0xffff)return 0;
  for(unsigned j=0;j+1<nw;++j){unsigned c=fwr_u16(b+name+j*2);if(!c||c==0xffff||c>=0xf000)return 0;}
  for(unsigned j=0;j+1<tw;++j){unsigned c=fwr_u16(b+text+j*2);if(!c||c==0xffff||(c>=0xf000&&c!=0xfff0&&c!=0xfff1&&c!=0xfff2&&c!=0xfff3&&c!=0xfffe))return 0;}
 }
 *out=(FwrItems){b,len,(uint16_t)count};return 1;
}
static int fwr_item_match(const uint8_t *r,const FwrSnapshot *p){
 unsigned hp=fwr_hp(p),status=fwr_status(p->status);static const uint8_t dir[4]={3,4,2,1};
 return hp&&!p->pokemon.egg&&p->pokemon.species&&p->pokemon.species<=FW_MAX_SPECIES&&p->direction<=3&&
  (!fwr_u16(r)||fwr_u16(r)==p->zone)&&(!fwr_u16(r+2)||fwr_u16(r+2)==p->pokemon.species)&&
  (r[7]==255||r[7]==p->pokemon.form)&&(r[8]==255||r[8]==p->type1||r[8]==p->type2)&&
  (!r[9]||r[9]==hp)&&fwr_friend(r[10],p->friendship)&&(!r[11]||(r[11]==7?status!=1:r[11]==status))&&(!r[12]||r[12]==dir[p->direction]);
}
int fwr_item_choose(const FwrItems*d,const FwrSnapshot*p,uint16_t claims,FwrItemChoice*out){
 if(!d||!d->bytes||!out)return 0;
 for(unsigned i=0;i<d->ruleCount;++i){const uint8_t*r=d->bytes+16+i*28;if(!(claims&(1u<<r[6]))&&fwr_item_match(r,p)){*out=(FwrItemChoice){r[6],r[13],fwr_u16(r+4),i};return 1;}}
 return 0;
}
static unsigned fwr_item_copy(const FwrItems*d,unsigned rule,unsigned offset,unsigned words,uint16_t*out,unsigned cap){
 if(!d||rule>=d->ruleCount||!out||!cap)return 0;
 const uint8_t*r=d->bytes+16+rule*28;const uint8_t*t=d->bytes+fwr_u32(r+offset);unsigned n=0;
 for(unsigned i=0;i<fwr_u16(r+words);++i){unsigned c=fwr_u16(t+i*2);if(c==0xffff)break;if(n+1>=cap)return 0;out[n++]=(uint16_t)c;}out[n]=0xffff;return n;
}
unsigned fwr_item_name(const FwrItems*d,unsigned rule,uint16_t*out,unsigned cap){return fwr_item_copy(d,rule,14,18,out,cap);}
unsigned fwr_item_text(const FwrItems*d,unsigned rule,const FwrSnapshot*p,uint16_t*out,unsigned cap){
 if(!d||rule>=d->ruleCount||!p||!out||!cap)return 0;
 const uint8_t*r=d->bytes+16+rule*28;const uint8_t*t=d->bytes+fwr_u32(r+20);uint16_t name[192];unsigned n=0;if(!fwr_item_name(d,rule,name,192))return 0;
 for(unsigned i=0;i<fwr_u16(r+24);++i){unsigned c=fwr_u16(t+i*2);if(c==0xffff)break;const uint16_t *word=0;unsigned max=0;if(c==0xfff0){word=p->nickname;max=11;}else if(c==0xfff1){word=p->playerName;max=8;}else if(c==0xfff3){word=name;max=191;}if(word){for(unsigned j=0;j<max&&word[j]&&word[j]!=0xffff;++j){if(n+1>=cap)return 0;out[n++]=word[j];}}else if(c==0xfff2){if(n+6>=cap)return 0;out[n++]='Z';out[n++]='o';out[n++]='n';out[n++]='e';out[n++]=' ';unsigned z=p->zone;if(z>9999)z=9999;unsigned div=1000;int seen=0;while(div){unsigned q=z/div;if(q||seen||div==1){out[n++]=(uint16_t)('0'+q);seen=1;}z%=div;div/=10;}}else{if(n+1>=cap)return 0;out[n++]=(uint16_t)c;}}
 out[n]=0xffff;return n;
}
