/* Native entry actions and source-filtered indirect damage. No polling or
 * synthetic weather queries: each guard runs at the existing damage boundary. */
PUBLIC const volatile u32 AbilityEnvironmentApi[5]={0};
#define EX(i,t) ((t)(uintptr_t)AbilityEnvironmentApi[i])
typedef struct DamageOrigin {void*flow;u32 source,target;struct DamageOrigin*previous;} DamageOrigin;
static DamageOrigin*damageOrigin;
static u32 queuedDamageSource(const u8*p){
 u32 message=p[14]?half(p+12):0;s32 weather;
 if(!message&&variable(0x39,&weather)&&weather==1)return 1u<<12;
 if(message==0x262)return 1u<<8;
 if(message==0x353||message==0x356)return 1u<<9;
 if(message==0x1ae||message==0x1a8||message==0x192)return 1u<<10;
 if(message==0x3f5||message==0x40e||message==0x407)return 1u<<11;
 if(message==0x1e4||message==0x1c9)return 1u<<12;
 if(message==0x17a)return 1u<<7;
 return 1u<<13;
}
PUBLIC u32 AbilityIndirectDamageCheck(void*f,void*mon,u32 amount,const u8*p){
 DamageOrigin origin={f,queuedDamageSource(p),p[6],damageOrigin};damageOrigin=&origin;
 u32 result=EX(4,u32(*)(void*,void*,u32))(f,mon,amount);damageOrigin=origin.previous;return result;
}
/* The checked native work call keeps its damage record in r4. Preserve the
 * original three arguments and supply the record only to the new adapter. */
PUBLIC __attribute__((naked)) void AbilityIndirectDamageSite(void){
 __asm__ volatile(".syntax unified\n push {r4, lr}\n adds r3, r4, #0\n bl AbilityIndirectDamageCheck\n pop {r4, pc}\n .syntax divided\n");
}
static u32 environmentDamageGuard(void*f,u8 owner,const volatile u8*e,u32 event){
 u32 mask=e[1]|(u32)e[4]<<8;
 if(event==0x6b&&VALUE(2)==owner&&(s32)VALUE(0x32)>0){
  u32 condition=VALUE(0x1d),bit=condition==4?0:condition==5?1:condition==10?2:condition==8?3:condition==9?4:13;
  if(mask&(1u<<bit))return 1;
 }
 if(event==0x7f&&VALUE(2)==owner&&(s32)VALUE(0x32)>0){
  u32 weather=VALUE(0x39);if(weather==3&&(mask&32)||weather==4&&(mask&64)||weather==1&&(mask&4096))REWRITE(0x41,1);
 }
 if(event==0x50&&VALUE(3)==owner&&(mask&128)&&!VALUE(0x51))REWRITE(0x41,1);
 if(event==0x80&&damageOrigin&&damageOrigin->flow==f&&damageOrigin->target==owner&&VALUE(4)==owner&&(mask&damageOrigin->source))REWRITE(0x51,0);
 return 0;
}
static void environmentEntry(void*f,u8 owner,const volatile u8*e,u32 event){
 if(!onEntry(event,owner)||preview(f)||!STAT(MON(f,owner),13))return;
 u32 kind=e[0],condition=e[1],duration=e[4],cont=duration?EX(1,u32(*)(u8))((u8)duration):1;
 if(kind==168){
  u32 active=EX(0,u32(*)(u32))(condition);if(active&&!e[5])return;
  popup(f,2,owner);u8*p=PUSH(f,active?28:27,owner);
  put32(p+4,condition);
  if(!active){
   put32(p+8,cont);
   u32 message=condition==1?857:condition==2?117:condition==4?114:condition==5?115:condition==6?178:180;
   EX(2,void(*)(void*,u32,u32))(p+16,condition==1?2:1,message);
   if(condition==1)EX(3,void(*)(void*,u32))(p+16,owner);
  }
  POP(f,p);popup(f,3,owner);return;
 }
 if(kind==169){
  u32 own=side(owner),maximum=condition==6?3:condition==7?2:1;
  static const u8 messages[14]={124,128,132,136,140,144,148,152,156,0,0,164,168,172};
  for(u32 target=0;target<2;++target){
   if(e[4]!=2&&target!=(e[4]?own^1:own))continue;
   u32 layers=RX(23,u32(*)(void*,u8,u32))(f,(u8)target,condition);
   u32 count=condition>=6&&condition<=8?e[6]:1;
   for(u32 n=0;n<count&&layers<maximum;++n,++layers){
    popup(f,2,owner);u8*p=PUSH(f,25,owner);put32(p+4,condition);
    /* Hazards are persistent; other native side conditions use chosen turns. */
    put32(p+8,condition>=6&&condition<=8?1:(e[5]?EX(1,u32(*)(u8))(e[5]):1));p[12]=(u8)target;
    EX(2,void(*)(void*,u32,u32))(p+16,1,messages[condition]);EX(3,void(*)(void*,u32))(p+16,target);
    POP(f,p);popup(f,3,owner);
   }
  }
 }
}
