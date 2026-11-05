/* Parameterized item effects. Native work queues retain stat/consumption rules. */
static u32 recipeMoveClass(u32 move,u32 filter){
 if(filter==1||filter==2||filter==5)return FN(31,u32(*)(u32,u32))(move,filter==1?0:filter==2?7:8);
 u32 bit=filter==3?1:filter==4?2:filter==6?4:filter==7?8:filter==8?16:filter==13?32:filter==12?64:0;
 const volatile u8*p=ItemRecipeMoveData;u32 low=0,high=half(p);
 while(low<high){u32 mid=(low+high)/2,id=half(p+2+mid*4);if(id<move)low=mid+1;else high=mid;}
 return low<half(p)&&half(p+2+low*4)==move&&(half(p+4+low*4)&bit);
}
static u32 recipeStages(void*item,void*f,u8 owner,const volatile u8*e){
 u32 queued=0;
 for(u32 n=0;n<7;++n){
  s32 delta=(int8_t)e[5+n];if(!delta)continue;
  u8 stage[16];for(u32 k=0;k<16;++k)stage[k]=0;
  stage[0]=11;stage[1]=(u8)(n+1);put16(stage+2,(u16)delta);stage[6]=100;
  queued|=action(item,f,owner,stage,owner);
 }
 return queued;
}
static void itemRecipe(void*item,void*f,u8 owner,u32*w,Slot*slot,const volatile u8*r,const volatile u8*e,u32 index,u32 event){
 u32 kind=e[0],v=half(e+2);void*mon=MON(f,owner);
 if(kind==129){
  if(preview(f)||!STAT(mon,13))return;
  u32 forced=e[4]&&(event==0x72||event==0x73)&&VALUE(2)==owner;
  if(!forced){
   if(event!=0x4b||VALUE(4)!=owner||VALUE(0x46)||(s32)VALUE(0x32)<=0)return;
   if(e[1]<18&&VALUE(0x16)!=e[1]||e[2]&&FN(17,u32(*)(u32))(VALUE(0x12))!=e[2]||e[3]&&VALUE(0x38)<e[3])return;
  }
  if(recipeStages(item,f,owner,e)&&r[2]&&!forced)consume(item,f,owner,1);
  return;
 }
 if(kind==130){
  if(event!=0x38||VALUE(3)!=owner||e[1]<18&&VALUE(0x16)!=e[1]||e[4]&&FN(17,u32(*)(u32))(VALUE(0x12))!=e[4])return;
  MUL(v);if(r[2]&&v!=4096&&!preview(f))w[0]|=1;return;
 }
 if(kind==131){
  if(event==0x47&&VALUE(4)==owner&&(e[1]>=18||VALUE(0x16)==e[1])&&(!e[4]||VALUE(0x38)>3)&&!FN(43,u32(*)(void*))(mon)){
   MUL(v);if(!preview(f))slot->cells[index]=v!=4096;
  }
  if(event==0x44&&slot->cells[index]&&!preview(f)){
   u32 found=0;for(u32 n=0;n<VALUE(5)&&n<12;++n)if(VALUE(6+n)==owner)found=1;
   if(found){slot->cells[index]=0;if(r[2])consume(item,f,owner,1);}
  }
  return;
 }
 if(kind==132&&event==0x7f&&VALUE(2)==owner&&(s32)VALUE(0x32)>0&&(!e[1]||VALUE(0x39)==e[1])){
  if(REWRITE(0x41,1)&&r[2]&&!preview(f))consume(item,f,owner,1);
  return;
 }
 if(kind==133&&event==0x2d&&VALUE(4)==owner&&VALUE(3)!=owner&&recipeMoveClass(VALUE(0x12),e[1])){
  if(REWRITE(0x40,1)&&r[2]&&!preview(f))consume(item,f,owner,1);
 }
}
