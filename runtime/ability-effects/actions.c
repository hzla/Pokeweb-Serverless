/* Optional action recipes. All state uses the existing per-effect work cells;
 * native move resolution, ability eligibility and damage work remain in charge. */
static void actionObserve(void*f,u8 owner,const volatile u8*r,u32 event){
 const volatile u8*e=effects(r);
 for(u32 n=0;n<r[0];++n,e+=16){u32*w=nativeWork[owner][n];
  if(e[0]==136&&e[1]==5){
   if(event==0x3&&VALUE(3)==owner)w[3]=0;
   if(event==0x29&&VALUE(3)==owner){w[0]=VALUE(0x12);w[1]=VALUE(0x16);w[2]=FN(17,u32(*)(u32))(w[0]);w[3]=1;}
  }
  if(e[0]==164){
   if(event==0x3&&VALUE(3)==owner)w[0]=w[1]=0;
   if(event==0x4b&&VALUE(3)==owner&&VALUE(4)<24&&!VALUE(0x46)&&VALUE(0x32)>0&&!STAT(MON(f,VALUE(4)),13))w[1]|=1u<<VALUE(4);
  }
 }
}
static u32 actionMoveMatches(const volatile u8*e,const u32*w){
 if(e[12]&&w[2]!=e[12])return 0;
 if(e[10]==9)return w[1]==e[11];
 if(e[10]==10)return w[2]==e[12];
 return conversionMatch(e[10],w[0]);
}
static void actionSplash(void*f,u8 owner,const volatile u8*e,u32 event,u32*w){
 if(event!=0x83||VALUE(3)!=owner||preview(f)||!STAT(MON(f,owner),13))return;
 u32 damage[24]={0},value=half(e+2),any=0;
 for(u32 n=0;n<VALUE(5)&&n<12;++n){
  u32 defeated=VALUE(6+n);if(defeated>=24||ally(owner,defeated)||!(w[1]&(1u<<defeated))||w[0]&(1u<<defeated)||STAT(MON(f,defeated),13))continue;
  w[0]|=1u<<defeated;
  for(u8 id=0;id<24;++id)if(id!=defeated&&present(f,id)&&ally(defeated,id)&&STAT(MON(f,id),13)){
   u32 amount=divide(STAT(MON(f,e[1]?id:defeated),14)*value,10000);damage[id]+=amount?amount:1;any=1;
  }
 }
 if(!any)return;
 popup(f,2,owner);
 for(u8 id=0;id<24;++id)if(damage[id]){u8*p=PUSH(f,7,owner);put16(p+4,damage[id]>65535?65535:damage[id]);p[6]=id;POP(f,p);}
 popup(f,3,owner);
}
