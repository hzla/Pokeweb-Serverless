#include "gifts.h"
#include "native.h"
#define PK5_FAST 2u
#define PK5_CORE_WORDS 64u
#define PK5_BLOCK_C 2
static uint16_t sum(const uint8_t *data){uint16_t v=0;for(unsigned i=0;i<PK5_CORE_WORDS;++i)v=(uint16_t)(v+data[i*2]+((uint16_t)data[i*2+1]<<8));return v;}
static int same(void *mon,const FwrSnapshot*s){
 uint32_t(*p)(void*,unsigned,void*)=CALL(0x0201cd25,uint32_t(*)(void*,unsigned,void*));
 return mon&&p(mon,0,0)==s->pokemon.personality&&p(mon,7,0)==s->pokemon.trainer&&p(mon,5,0)==s->pokemon.species&&p(mon,0x6f,0)==s->pokemon.form&&!p(mon,0x4c,0);
}
static void *find(void *gameData,const FwrSnapshot*s){
 void *party=CALL(0x0201735d,void*(*)(void*))(gameData);if(!party)return 0;unsigned n=CALL(0x0201fe25,unsigned(*)(void*))(party);if(n>6)n=6;
 for(unsigned i=0;i<n;++i){void*m=CALL(0x0201ff35,void*(*)(void*,unsigned))(party,i);if(same(m,s))return m;}return 0;
}
static int access(void *mon,uint16_t *claims,uint16_t set,uint16_t *old){
 uint8_t *p=mon;if(!p)return 0;uint16_t sanity=(uint16_t)(p[4]|p[5]<<8),check=(uint16_t)(p[6]|p[7]<<8);int fast=(sanity&PK5_FAST)!=0;
 int decrypted=CALL(0x0201ccc5,int(*)(void*))(p);
 if(!fast&&sum(p+8)!=check){p[4]=sanity&255;p[5]=sanity>>8;CALL(0x0201ed09,void(*)(void*,unsigned,unsigned))(p+8,128,check);return 0;}
 void *block=CALL(0x0201eef1,void*(*)(void*,unsigned,unsigned))(p,*(uint32_t*)p,PK5_BLOCK_C);if(!block){CALL(0x0201cced,int(*)(void*,int))(p,decrypted);return 0;}
 uint8_t *b=block;uint16_t value=(uint16_t)(b[0x1e]|b[0x1f]<<8);if(claims)*claims=value&0x3ff;if(old)*old=value;
 if(set){value|=set;b[0x1e]=value&255;b[0x1f]=value>>8;}
 CALL(0x0201cced,int(*)(void*,int))(p,decrypted);return 1;
}
int fwg_claims(void *gameData,const FwrSnapshot*s,uint16_t*out){void*m=find(gameData,s);return m&&access(m,out,0,0);}
int fwg_grant(void *gameData,const FwrSnapshot*s,const FwrItemChoice*c){
 if(!c||c->slot>9||!c->item||!c->quantity)return -1;
 void*m=find(gameData,s);uint16_t claims=0,old=0;
 if(!m||!access(m,&claims,0,&old)||(claims&(1u<<c->slot)))return -1;
 void *bag=CALL(0x02017355,void*(*)(void*))(gameData);if(!bag)return -1;
 /* Retail BagSave APIs validate pocket, quantity, stack capacity, and item ID. */
 if(!CALL(0x02008239,int(*)(void*,unsigned,unsigned,unsigned))(bag,c->item,c->quantity,4))return 0;
 if(!access(m,0,(uint16_t)(1u<<c->slot),0))return -1;
 if(CALL(0x02008269,int(*)(void*,unsigned,unsigned,unsigned))(bag,c->item,c->quantity,4))return 1;
 /* No yield occurs above. Restore exactly the pre-transaction metadata value. */
 m=find(gameData,s);if(m){uint8_t *p=m;int d=CALL(0x0201ccc5,int(*)(void*))(p);void*b=CALL(0x0201eef1,void*(*)(void*,unsigned,unsigned))(p,*(uint32_t*)p,PK5_BLOCK_C);if(b){uint8_t*q=b;q[0x1e]=old&255;q[0x1f]=old>>8;}CALL(0x0201cced,int(*)(void*,int))(p,d);}return 0;
}
