/* The native client recognizes fixed ability IDs. Keep its other switch rules
   while resolving edited Magnet Pull identities/types through this registry. */
PUBLIC const volatile u32 AbilityClientApi[5]={0};
PUBLIC const volatile u8 AbilityClientTrapTypes[256]={0};
#define CLIENT(i,t) ((t)(uintptr_t)AbilityClientApi[i])
PUBLIC u32 AbilityClientTrapped(void*client,void*mon,u8*trapper,u16*ability){
 if(!clientFlow)return CLIENT(0,u32(*)(void*,void*,u8*,u16*))(client,mon,trapper,ability);
 void**context=(void**)client;u32 owner=FN(15,u32(*)(void*))(mon);
 u32 pos=CLIENT(1,u32(*)(void*,void*,u32))(context[0],context[1],owner);
 u8 ids[6];u32 count=CLIENT(2,u32(*)(void*,void*,u16,u8*))(context[0],context[1],(u16)(0x200|pos),ids);
 if(count>6)return CLIENT(0,u32(*)(void*,void*,u8*,u16*))(client,mon,trapper,ability);
 void*foes[6];u16 original[6];u16 effective[6];
 for(u32 n=0;n<count;++n){
  foes[n]=CLIENT(3,void*(*)(void*,u32))(context[1],ids[n]);
  if(!foes[n]){original[n]=0;effective[n]=0;continue;}
  original[n]=*(u16*)((u8*)foes[n]+0x13c);effective[n]=(u16)STAT(foes[n],17);
  /* Suppress the stock Steel-only identity check for edited ID 42. */
  if(original[n]<256&&AbilityClientTrapTypes[original[n]])*(u16*)((u8*)foes[n]+0x13c)=0;
 }
 u32 result=CLIENT(0,u32(*)(void*,void*,u8*,u16*))(client,mon,trapper,ability);
 for(u32 n=0;n<count;++n)if(foes[n])*(u16*)((u8*)foes[n]+0x13c)=original[n];
 if(result!=4)return result;
 for(u32 n=0;n<count;++n){
  u32 id=effective[n];if(id>=256||!AbilityClientTrapTypes[id])continue;
  const volatile u8*r=record(id);void*serverMon=MON(clientFlow,ids[n]);
  if(!r||!serverMon||!STAT(serverMon,13)||!active(r,clientFlow,serverMon))continue;
  if(CLIENT(4,u32(*)(void*,u32))(mon,AbilityClientTrapTypes[id]-1)){
   if(trapper){*trapper=ids[n];}
   if(ability){*ability=(u16)id;}
   return 0;
  }
 }
 return result;
}
#undef CLIENT
