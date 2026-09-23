#include "../reactions.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static unsigned char bytes[FWR_CAPACITY],bad[FWR_CAPACITY],archive[FWR_CONTEXT_CAPACITY];
static void repair(unsigned n){uint32_t crc=fwr_crc(bad+16,n-16);for(unsigned i=0;i<4;++i)bad[12+i]=(uint8_t)(crc>>(8*i));}
static void put16(unsigned char*p,unsigned v){p[0]=(unsigned char)v;p[1]=(unsigned char)(v>>8);}
static void put32(unsigned char*p,unsigned v){for(unsigned i=0;i<4;++i)p[i]=(unsigned char)(v>>(8*i));}
static unsigned wrap_narc(unsigned member){
 memmove(bad+60,bad,member);memset(bad,0,60);unsigned size=60+member;
 put32(bad,0x4352414e);put16(bad+4,0xfeff);put16(bad+6,1);put32(bad+8,size);put16(bad+12,16);put16(bad+14,3);
 put32(bad+16,0x46415442);put32(bad+20,20);put16(bad+24,1);put32(bad+28,0);put32(bad+32,member);
 put32(bad+36,0x464e5442);put32(bad+40,16);put32(bad+44,4);put32(bad+48,0x00010000);
 put32(bad+52,0x46494d47);put32(bad+56,8+member);return size;
}
static unsigned make_items(unsigned count){
 unsigned floor=16+count*28,size=floor+count*4;memset(bad,0,size);put32(bad,0x49545746);put16(bad+4,1);put16(bad+6,count);put32(bad+8,size);
 for(unsigned i=0;i<count;++i){unsigned char*r=bad+16+i*28;unsigned name=floor+i*4,text=name+2;put16(r+4,i+1);r[6]=(unsigned char)(i%10);r[7]=255;r[8]=255;r[13]=1;put32(r+14,name);put16(r+18,1);put32(r+20,text);put16(r+24,1);put16(bad+name,0xffff);put16(bad+text,0xffff);}
 repair(size);return wrap_narc(size);
}
int main(int argc,char **argv){
 assert(argc==4);FILE *file=fopen(argv[1],"rb");assert(file);unsigned n=(unsigned)fread(bytes,1,sizeof(bytes),file);fclose(file);FwrData d,x;
 assert(fwr_validate(&d,bytes,n));assert(d.ruleCount==34&&d.messageCount==27&&d.motionCount==12&&d.bubbleCount==7);
 file=fopen(argv[2],"rb");assert(file);unsigned an=(unsigned)fread(archive,1,sizeof(archive),file);fclose(file);FwrContext installed_context;
 assert(fwr_context_validate(&installed_context,archive,an)&&installed_context.ruleCount==0);
 file=fopen(argv[3],"rb");assert(file);an=(unsigned)fread(archive,1,sizeof(archive),file);fclose(file);FwrItems installed_items;
 assert(fwr_items_validate(&installed_items,archive,an)&&installed_items.ruleCount==0);
 FwrSnapshot s={.pokemon={.species=25,.hp=100,.max_hp=100},.friendship=100};
 for(unsigned hp=0;hp<=100;++hp){s.pokemon.hp=hp;assert(fwr_hp(&s)==(hp==100?1:hp>=75?2:hp>=50?3:hp>=25?4:5));}
 s.pokemon.max_hp=0;assert(!fwr_hp(&s));s.pokemon.max_hp=3;s.pokemon.hp=2;assert(fwr_hp(&s)==3);s.pokemon.max_hp=100;
 for(unsigned status=0;status<256;++status)assert(fwr_status(status)==(status&136?5:status&7?8:status&16?2:status&32?3:status&64?4:1));
 for(unsigned f=0;f<256;++f){unsigned sum=0;for(unsigned c=1;c<=8;++c)sum+=fwr_friend(c,f);assert(sum==1);assert(fwr_friend(9,f)==(f>=90));assert(fwr_friend(10,f)==(f<60));}
 unsigned seen[34]={0};uint32_t rng=946;
 for(unsigned status=0;status<6;++status)for(unsigned friend=0;friend<256;++friend)for(unsigned hp=1;hp<=100;hp+=11)for(unsigned dir=0;dir<4;++dir){
  s.pokemon.hp=hp;s.friendship=friend;s.status=(unsigned[]){0,8,1,16,32,64}[status];s.direction=dir;
  for(unsigned k=0;k<20;++k){int rule=fwr_choose(&d,&s,&rng);assert(rule>=0&&rule<34);seen[rule]++;
   const uint8_t *r=bytes+d.rules+rule*12;assert(!r[2]||r[2]==fwr_hp(&s));assert(fwr_friend(r[3],friend));assert(!r[4]||(r[4]==7?fwr_status(s.status)!=1:r[4]==fwr_status(s.status)));}
 }
 for(unsigned i=0;i<34;++i){assert(seen[i]);FwrStep step;unsigned j=0;while(fwr_step(&d,i,j,&step))++j;assert(j>=1&&j<=5);}
 for(unsigned species=1;species<=FW_MAX_SPECIES;++species){s.pokemon.species=species;assert(fwr_choose(&d,&s,&rng)>=0);}
 s.pokemon.egg=1;assert(fwr_choose(&d,&s,&rng)<0);s.pokemon.egg=0;s.pokemon.species=FW_MAX_SPECIES+1;assert(fwr_choose(&d,&s,&rng)<0);
 for(unsigned i=0;i<11;++i)s.nickname[i]=(uint16_t)('A'+i);s.nickname[11]=65535;
 for(unsigned i=0;i<8;++i)s.playerName[i]=(uint16_t)('a'+i);s.playerName[8]=65535;
 for(unsigned i=1;i<=27;++i){uint16_t text[192];unsigned len=fwr_text(&d,i,&s,text,192);assert(len&&text[len]==65535);assert(!fwr_text(&d,i,&s,text,2));for(unsigned j=0;j<len;++j)assert(text[j]!=0xfff0&&text[j]!=0xfff1);}
 for(unsigned action=1;action<=12;++action)for(unsigned ground=0;ground<2;++ground){FwrMotion m={0};unsigned ticks=0,sounds=0;int sound;const uint8_t *a=bytes+d.motions+(action-1)*84;unsigned expected=0;for(unsigned i=0;i<a[2];++i)expected+=a[4+i*8+1];
  while(fwr_motion_tick(&d,action,&m,ground,&sound)){++ticks;sounds+=sound;assert(ticks<=1200);assert(m.face<=3);if(ground)assert(m.y==0);}
  assert(ticks==expected);assert(sounds<=10);
 }

 for(unsigned i=0;i<n;++i){memcpy(bad,bytes,n);bad[i]^=128;assert(!fwr_validate(&x,bad,n));}
 for(unsigned off=24;off<=36;off+=4){memcpy(bad,bytes,n);memset(bad+off,255,4);repair(n);assert(!fwr_validate(&x,bad,n));}
 memcpy(bad,bytes,n);bad[d.rules+7]=6;repair(n);assert(!fwr_validate(&x,bad,n));
 memcpy(bad,bytes,n);bad[d.motions+5]=0;repair(n);assert(!fwr_validate(&x,bad,n));
 memcpy(bad,bytes,n);bad[d.bubbles+12]=2;repair(n);assert(!fwr_validate(&x,bad,n));
 FwrItems gifts;unsigned gift_size=make_items(125);assert(fwr_items_validate(&gifts,bad,gift_size)&&gifts.ruleCount==125);
 s.pokemon.species=25;s.pokemon.hp=s.pokemon.max_hp=100;s.pokemon.egg=0;s.direction=0;s.zone=0;s.type1=12;s.type2=4;
 FwrItemChoice gift;assert(fwr_item_choose(&gifts,&s,0,&gift)&&gift.rule==0&&gift.slot==0);assert(fwr_item_choose(&gifts,&s,1,&gift)&&gift.rule==1&&gift.slot==1);
 gift_size=make_items(126);assert(!fwr_items_validate(&gifts,bad,gift_size));
 memcpy(bad,bytes,n);memset(bad+n,0,sizeof(bad)-n);
 unsigned full=sizeof(bad);for(unsigned j=0;j<4;++j)bad[8+j]=(uint8_t)(full>>(8*j));repair(full);
 assert(fwr_validate(&x,bad,full));assert(!fwr_validate(&x,bad,full+1));
 puts("Reaction tests passed: every rule reached, all HP/status/friendship boundaries, all species, capacity-bounded reusable-slot gift rules, 27 bounded substitutions, 12 motions, corruption and animation bounds.");
}
